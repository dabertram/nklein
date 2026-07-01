/**
 * Context-occupancy PRESSURE decider (todo §5.AD) — a multi-way triage over how full the context window is.
 *
 * §5.AD treats context SIZE as a capability lever in BOTH directions: over-filling a window degrades output ("context
 * rot", attention dilution — effective ≪ advertised per RULER/NoLiMa), but running a model on too LITTLE context also
 * hurts (it can't see the background it needs). So at each assembly/turn !Klein should not just ask the binary "compact
 * yet?" — it should look at the current OCCUPANCY (tokens used vs. the model's quality-effective window) and pick one of
 * three moves: `compact` (over the comfortable ceiling — shed the lowest-value tokens before rot sets in), `proceed`
 * (comfortably within the productive band — leave it be), or `expand` (well under the window with real headroom — there
 * is room to add more retrieval / reasoning / re-anchoring). And when it decides to compact, it should say WHICH ZONE to
 * trim first: per the U-shape (Liu et al. 2023), the dead-center MIDDLE band carries the least-attended tokens and is the
 * safest to shed, while the FRONT durable framing and the BACK task/acceptance are load-bearing and trimmed only as a
 * last resort.
 *
 * Pure, no I/O — a decision function over token accounting. Token COUNTS (used, window, per-zone occupancy) are injected
 * as plain numbers; there is no tokenizer, model call, or state here. This module decides the DIRECTION + the trim
 * ORDER; the effectful moves live elsewhere.
 *
 * **Boundary (no duplication):**
 * - §5.AD `context-compaction.ts` `shouldCompact` is a BINARY "used ≥ 80% window?" gate that fires the message-bucket
 *   planner; it has no `expand` direction and no zone-level triage. This module is the higher-level three-way decider
 *   that SITS ABOVE it — a `compact` verdict here is what would then invoke `planCompaction`. The two share the ~0.8
 *   ceiling convention but answer different questions (this one also decides proceed-vs-expand and which zone to shed).
 * - §5.AD `context-budget-knee.ts` FITS the quality-effective window (the target this module reads as `windowTokens`);
 *   it does not decide runtime occupancy.
 * - §5.AD `context-smart-zone.ts` ORDERS parts into front/middle/back and explicitly leaves trimming aside; this module
 *   names WHICH of those zones to trim first but does not itself reorder or drop any content.
 * - §5.AE `jit-fragment-budget.ts` SELECTS fragments within a budget (build-time inclusion); this decides the runtime
 *   direction (compact/proceed/expand) once a window is in play.
 * - §5.W `run-attention-signals.ts` `assessRunBudgetPressure` reports pressure on RUN ceilings (iterations / wall-time /
 *   tokens-spent), an operator-attention signal — not the context WINDOW's occupancy or its zone triage.
 */

/**
 * The three occupancy zones, mirroring §5.AD `context-smart-zone.ts` bands:
 * - `front` — durable framing (role / invariants / tool contract). Load-bearing; trimmed only as a last resort.
 * - `middle` — bulk reference in the dead center (repo map, long files, older history). Least-attended (U-shape) →
 *   the safest to shed first.
 * - `back` — the concrete task / acceptance / current step, in the strong end-zone. Load-bearing; trimmed near-last.
 */
export type OccupancyZone = "front" | "middle" | "back";

/** Per-zone token occupancy (any subset may be supplied). Absent / non-finite / non-positive zones carry 0 tokens. */
export interface ZoneOccupancy {
	front?: number;
	middle?: number;
	back?: number;
}

export interface OccupancyPressureInput {
	/** Tokens currently occupied by the assembled context/conversation. Non-finite / negative reads as 0. */
	usedTokens: number;
	/** The model's quality-effective context window in tokens (e.g. the §5.AD budget-knee fit, NOT the raw max). */
	windowTokens: number;
	/**
	 * Optional per-zone breakdown of `usedTokens` (front/middle/back). Used only to order `trimZoneOrder` — the sum need
	 * not equal `usedTokens` (callers may account some overhead outside the zones). When omitted, `trimZoneOrder` falls
	 * back to the research default order for whichever zones exist.
	 */
	zones?: ZoneOccupancy;
	/**
	 * Compact at/above this fraction of the window — the over-fill ceiling where rot risk outweighs more context.
	 * Default 0.8 (matches `context-compaction.ts`). Clamped to (0, 1].
	 */
	compactAboveFraction?: number;
	/**
	 * `expand` at/below this fraction — real headroom remains, so more context (retrieval / reasoning / re-anchor) can be
	 * added. Default 0.5. Clamped to [0, `compactAboveFraction`]; if it would meet/exceed the compact ceiling it is pulled
	 * just below it so the two verdicts never overlap (a crossed input thereby collapses the `proceed` band to nothing —
	 * the caller's own choice, unambiguous rather than double-claimed).
	 */
	expandBelowFraction?: number;
}

export type OccupancyAction = "compact" | "proceed" | "expand";

export interface OccupancyPressureDecision {
	/**
	 * The triage verdict:
	 * - `compact` — occupancy is at/above the compact ceiling; shed tokens (starting with `trimZoneOrder[0]`) before rot.
	 * - `proceed` — occupancy sits in the productive band; the context is well-sized, leave it.
	 * - `expand` — occupancy is at/below the expand floor with headroom to spare; there is room to add more context.
	 */
	action: OccupancyAction;
	/** `usedTokens / windowTokens`, clamped to [0, 1] (over-window reads a full 1). `1` when the window is unusable (≤ 0). */
	usedFraction: number;
	/**
	 * Free tokens under the compact ceiling — `windowTokens * compactAboveFraction - usedTokens`, floored at 0. The
	 * budget a caller may safely add on an `expand` (and 0 whenever the ceiling is already reached).
	 */
	headroomTokens: number;
	/**
	 * When `action` is `compact`: the zones to trim, MOST-trimmable first — `middle` (dead center, least attended) before
	 * `back` before `front` (durable framing, last resort). Only zones actually carrying tokens are listed; among zones
	 * of equal trim priority order is stable, and the research priority (middle→back→front) is the tie-break, never zone
	 * size (we shed the least-valuable tokens first even if another zone is bulkier). Empty for `proceed` / `expand`, and
	 * empty on `compact` when no per-zone occupancy is known.
	 */
	trimZoneOrder: OccupancyZone[];
	/** Human-readable rationale (why this verdict) — for logs / the model-telemetry surface. */
	reason: string;
}

const DEFAULT_COMPACT_ABOVE_FRACTION = 0.8;
const DEFAULT_EXPAND_BELOW_FRACTION = 0.5;

/** Trim priority, most-trimmable first: the dead-center middle sheds before the load-bearing task, framing goes last. */
const TRIM_PRIORITY: readonly OccupancyZone[] = ["middle", "back", "front"];

/** A finite, non-negative token count (non-finite / negative → 0). */
function nonNegative(value: number | undefined): number {
	return Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;
}

/** Clamp a fraction into [lo, hi]; a non-finite input falls back to `fallback`. */
function clampFraction(value: number | undefined, lo: number, hi: number, fallback: number): number {
	const raw = Number.isFinite(value) ? (value as number) : fallback;
	if (raw < lo) {
		return lo;
	}
	return raw > hi ? hi : raw;
}

/**
 * Order the zones to trim first when compacting. Only zones carrying tokens are included; they are ordered by the
 * research trim priority (middle → back → front), so the least-attended dead-center tokens are shed before the
 * load-bearing task, and the durable front framing only as a last resort. Stable + independent of zone size.
 */
function orderTrimZones(zones: ZoneOccupancy | undefined): OccupancyZone[] {
	if (zones === undefined) {
		return [];
	}
	return TRIM_PRIORITY.filter((zone) => nonNegative(zones[zone]) > 0);
}

/**
 * Decide the context-occupancy pressure verdict (pure): compare `usedTokens` against the quality-effective
 * `windowTokens` and return one of `compact` / `proceed` / `expand`, plus the trim-zone order to use when compacting.
 *
 * - At/above `compactAboveFraction` of the window → `compact` (over-fill; shed the lowest-value zone first).
 * - At/below `expandBelowFraction` → `expand` (real headroom; more context may be added).
 * - Otherwise → `proceed` (the productive middle band; well-sized).
 *
 * A non-positive `windowTokens` is unusable — we cannot reason about a fraction of it — so the verdict is a cautious
 * `compact` (assume pressure) with `usedFraction: 1` and no headroom. Never mutates the input.
 */
export function decideContextOccupancy(input: OccupancyPressureInput): OccupancyPressureDecision {
	const used = nonNegative(input.usedTokens);
	const window = input.windowTokens;
	const compactAbove = clampFraction(input.compactAboveFraction, Number.EPSILON, 1, DEFAULT_COMPACT_ABOVE_FRACTION);
	// The expand floor must stay strictly below the compact ceiling so the `proceed` band never collapses and the two
	// verdicts can't both fire; if the caller's value meets/exceeds the ceiling, pull it just under.
	const expandBelowRaw = clampFraction(input.expandBelowFraction, 0, compactAbove, DEFAULT_EXPAND_BELOW_FRACTION);
	const expandBelow = expandBelowRaw >= compactAbove ? compactAbove - Number.EPSILON : expandBelowRaw;

	if (!(window > 0)) {
		return {
			action: "compact",
			usedFraction: 1,
			headroomTokens: 0,
			trimZoneOrder: orderTrimZones(input.zones),
			reason: "window size unusable (<= 0) — assuming pressure and compacting",
		};
	}

	const rawFraction = used / window;
	const usedFraction = rawFraction >= 1 ? 1 : rawFraction;
	const ceilingTokens = window * compactAbove;
	const headroomTokens = Math.max(0, ceilingTokens - used);

	if (usedFraction >= compactAbove) {
		const trimZoneOrder = orderTrimZones(input.zones);
		const target = trimZoneOrder.length > 0 ? trimZoneOrder[0] : null;
		return {
			action: "compact",
			usedFraction,
			headroomTokens,
			trimZoneOrder,
			reason: `occupancy ${(usedFraction * 100).toFixed(0)}% >= compact ceiling ${(compactAbove * 100).toFixed(0)}%${
				target ? ` — trim ${target} first` : " — no per-zone breakdown; trim least-attended (middle) first"
			}`,
		};
	}

	if (usedFraction <= expandBelow) {
		return {
			action: "expand",
			usedFraction,
			headroomTokens,
			trimZoneOrder: [],
			reason: `occupancy ${(usedFraction * 100).toFixed(0)}% <= expand floor ${(expandBelow * 100).toFixed(
				0,
			)}% — headroom for more context`,
		};
	}

	return {
		action: "proceed",
		usedFraction,
		headroomTokens,
		trimZoneOrder: [],
		reason: `occupancy ${(usedFraction * 100).toFixed(0)}% within the productive band — context well-sized`,
	};
}
