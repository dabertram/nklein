/**
 * §5.M / §5.AD — the turn-budget allocator (pure core). A turn's context window is a fixed token budget that must be
 * apportioned across competing BANDS: the non-negotiable fixed costs (system/invariants, the current message, the
 * offered tool defs) plus the flexible content that fills whatever is left, best-first (objective/focus-chain, recent
 * transcript, overflow summary, and the semantic/episodic/procedural memory layers). This module decides who gets how
 * many tokens: FIXED bands reserve their exact cost first; the remainder is handed to FLEXIBLE bands in priority order,
 * each capped at what it wants and dropped when the leftover can't meet its minimum (so its budget flows to the next).
 *
 * Pure + total + deterministic. The ≥32k floor is enforced upstream (the window passed in already clears it); this
 * exposes {@link MIN_CONTEXT_FLOOR_TOKENS} + an `underFloor` flag so a caller can assert it, but never fabricates budget.
 */

/** The hard minimum context window (§5 prime directive). A model below this is rejected before it ever reaches here. */
export const MIN_CONTEXT_FLOOR_TOKENS = 32_000;

export type BudgetBandId =
	| "system_invariants"
	| "objective_focus"
	| "current_message"
	| "recent_transcript"
	| "overflow_summary"
	| "semantic"
	| "episodic"
	| "procedural"
	| "tool_defs";

export interface BudgetBand {
	id: BudgetBandId;
	/**
	 * FIXED bands (system/invariants, current_message, tool_defs) reserve their exact `desired` cost first and are never
	 * shrunk — the prompt is invalid without them. FLEXIBLE bands fill the remainder by priority, up to `desired`.
	 */
	fixed: boolean;
	/** Tokens the band needs (fixed) or would ideally use (flexible cap). Clamped to ≥ 0. */
	desired: number;
	/** Minimum useful tokens for a FLEXIBLE band; if the leftover can't cover it, the band is dropped. Default 0. */
	min?: number;
	/** Priority for distributing the leftover among FLEXIBLE bands — higher fills first. Ignored for fixed bands. */
	priority: number;
}

export interface BudgetAllocation {
	/** Tokens granted to each band that appeared in the input (bands absent from input are absent here). */
	allocations: Partial<Record<BudgetBandId, number>>;
	/** Flexible bands dropped because the leftover budget could not meet their `min`. */
	dropped: BudgetBandId[];
	/** Sum of all granted tokens. */
	totalAllocated: number;
	/** Window minus what the FIXED bands reserved and the FLEXIBLE bands took. Negative ⇒ the fixed bands over-fill. */
	leftover: number;
	/** True when the fixed bands alone exceed the window (the prompt cannot fit — the caller must shed fixed cost). */
	overBudget: boolean;
	/** True when the window is below the §5 ≥32k floor (should never happen — an upstream gate rejects such models). */
	underFloor: boolean;
}

// Non-finite (NaN / ±Infinity) coerces to 0 — Math.max(0, NaN) is NaN, which would poison the whole allocation.
const clampTokens = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0);

/**
 * Allocate a turn's token budget across its bands (pure). Fixed bands reserve their exact cost; the remainder is filled
 * by flexible bands in descending priority (ties broken by input order — a stable pass), each capped at `desired` and
 * dropped when the leftover can't meet its `min` (its budget then flows to the next band).
 */
export function allocateTurnBudget(window: number, bands: readonly BudgetBand[]): BudgetAllocation {
	const budget = clampTokens(window);
	const allocations: Partial<Record<BudgetBandId, number>> = {};
	const dropped: BudgetBandId[] = [];

	// 1. Fixed bands reserve their exact cost first — non-negotiable.
	let reserved = 0;
	for (const band of bands) {
		if (band.fixed) {
			const cost = clampTokens(band.desired);
			allocations[band.id] = cost;
			reserved += cost;
		}
	}

	// 2. The remainder is handed to flexible bands, highest priority first (stable on ties).
	let remaining = Math.max(0, budget - reserved);
	const flexible = bands
		.map((band, index) => ({ band, index }))
		.filter((entry) => !entry.band.fixed)
		.sort((a, b) => b.band.priority - a.band.priority || a.index - b.index);

	for (const { band } of flexible) {
		const want = clampTokens(band.desired);
		const grant = Math.min(want, remaining);
		if (grant >= clampTokens(band.min ?? 0) && grant > 0) {
			allocations[band.id] = grant;
			remaining -= grant;
		} else {
			// Can't meet the minimum (or nothing left) — drop it; its budget stays available for lower-priority bands.
			allocations[band.id] = 0;
			dropped.push(band.id);
		}
	}

	const totalAllocated = Object.values(allocations).reduce((sum, value) => sum + (value ?? 0), 0);
	return {
		allocations,
		dropped,
		totalAllocated,
		leftover: budget - totalAllocated,
		overBudget: reserved > budget,
		underFloor: budget < MIN_CONTEXT_FLOOR_TOKENS,
	};
}
