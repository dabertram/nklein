/**
 * Cache-stable prefix ORDER planner (todo §5.AQ item D — the byte-stable-prefix LAYOUT lever). Given the fragments that
 * make up a turn's prompt, each tagged with how CACHE-STABLE it is, emit the fragment ORDER that maximizes the
 * byte-identical LEADING prefix a local runtime (llama.cpp / LM Studio / MLX) can reuse across turns: most-stable
 * content FIRST, volatile content LAST.
 *
 * Why this is its own module — the gap the sibling cache cores explicitly leave open. Those runtimes reuse the KV cache
 * for the longest LEADING run of the prompt that is byte-identical to the previous turn, then re-prefill from the first
 * differing token. `cache-aware-prompt-layout.ts` (item D) LINTS one prefix for volatile content + concatenates a
 * given stable/volatile split — it does NOT decide the split from a pile of mixed-stability fragments.
 * `cache-prefix-reuse.ts` (item D) SCORES a proposed ordering and says outright that it "neither reorders nor trims, it
 * only SCORES a proposed ordering... so those callers (or an ORDERER) can compare alternatives" — the orderer it defers
 * to is THIS module. `cache-prefix-retention.ts` (item E) arbitrates a POOL of whole prefixes and likewise disclaims
 * "never reorders a prompt ... item D's orderer for the prefix". This module supplies that orderer: it PRODUCES the
 * stable-first ordering the reuse estimator was built to score and the retention policy assumes upstream.
 *
 * Distinct AXIS from `context-smart-zone.ts` (§5.AD): that orders for ATTENTION (U-shaped front/middle/back so critical
 * facts dodge the dead center) and deliberately puts the concrete TASK last for the strong end-zone — an attention win.
 * This module orders for the CACHE (a byte-stable leading prefix). The two agree at the extremes (durable framing first,
 * volatile task last) but answer different questions; keep them separate levers. And distinct from
 * `jit-fragment-budget.ts` (§5.AE) which SELECTS a subset within a token budget — this module reorders a given set, it
 * never trims (so it cannot violate the never-overflow guard §6.2; budgeting stays a separate concern).
 *
 * The model is fragment-level and PURE. A fragment is `{ id, tokenCount, stability }` — `id` proxies the fragment's
 * exact bytes (the cache-prefix contract from `cache-prefix-reuse.ts`), `tokenCount` is an INJECTED token count (this
 * module never tokenizes), and `stability` is the tier telling us how likely the fragment's bytes are to change turn to
 * turn. The order is a STABLE partition by tier (fixed most-stable-first tier order; input order preserved WITHIN a
 * tier) — a stable partition is exactly what the cache wants, because reordering two equal-tier fragments between turns
 * would itself churn the prefix and throw away the reuse we're trying to protect. The result also reports the CACHE
 * BOUNDARY (where the stable prefix ends and volatile content begins) and, when the previous turn's ordered fragments
 * are supplied, the predicted reuse against them via {@link estimatePrefixReuse} (composed by import, never edited).
 */

import { type CacheFragment, estimatePrefixReuse, type PrefixReuseEstimate } from "./cache-prefix-reuse";

/**
 * How cache-stable a fragment's bytes are across turns, most-stable first. The tier order IS the layout order — the
 * runtime reuses the longest byte-identical leading run, so the earlier tiers must be the ones least likely to change:
 * - `static` — never changes for the life of the process: the system prompt, tool/function definitions. The cacheable
 *   core; must lead so it is reused verbatim every turn.
 * - `persistent` — stable across a session and rarely edited: project conventions, resolved skill bodies, a repo map.
 *   Changes only when the workspace does, so it caches well behind the static core.
 * - `session` — stable within the current session but not guaranteed across turns: the running task framing, pinned
 *   focus. Usually reused, but a mid-session edit re-prefills only from here down, not the static core above.
 * - `volatile` — expected to differ nearly every turn: the injected date, freshly retrieved docs, the current
 *   sub-step/question, the latest conversation turn. MUST go last so churning it never invalidates the stable prefix —
 *   the whole §5.AQ item-D finding, and the exact cliff `cache-prefix-reuse.ts` warns about when volatile leads.
 */
export type PrefixStability = "static" | "persistent" | "session" | "volatile";

/** The layout order of the stability tiers, most-stable (cacheable) first → volatile last. Index = tier rank. */
export const PREFIX_STABILITY_ORDER: readonly PrefixStability[] = ["static", "persistent", "session", "volatile"];

/** Rank of a stability tier in {@link PREFIX_STABILITY_ORDER} (0 = most stable ⇒ placed first). */
const STABILITY_RANK: Readonly<Record<PrefixStability, number>> = {
	static: 0,
	persistent: 1,
	session: 2,
	volatile: 3,
};

/** A prompt fragment competing for a position in the turn's assembly, tagged with its cache-stability tier. */
export interface PrefixOrderFragment extends CacheFragment {
	/**
	 * How cache-stable this fragment is (drives its band in the ordering). Anything at or below the first tier that
	 * changes turn to turn breaks the reusable prefix from that point down — so lower-stability fragments are pushed
	 * later. Defaults to {@link DEFAULT_STABILITY} when omitted (treat unknown provenance as volatile — the safe choice,
	 * since misplacing a truly-volatile fragment early would silently defeat caching).
	 */
	stability?: PrefixStability;
}

/** The result of ordering a turn's fragments for a byte-stable cache prefix ({@link planCacheStablePrefixOrder}). */
export interface CacheStablePrefixOrder {
	/** The fragments in cache-stable order (most-stable first, volatile last), ready to hand to the assembler. */
	ordered: PrefixOrderFragment[];
	/**
	 * Index of the first VOLATILE fragment in {@link ordered} — the cache BOUNDARY. Everything before it is the stable
	 * prefix (`static`+`persistent`+`session`) a runtime can hold warm; from here down re-prefills whenever it changes.
	 * Equals `ordered.length` when no fragment is volatile (the whole prompt is a stable prefix).
	 */
	volatileBoundaryIndex: number;
	/**
	 * Summed token count of the fragments BEFORE the volatile boundary — the size of the stable prefix, i.e. the tokens
	 * that stay cacheable when only volatile content changes. The concrete cache win this ordering buys.
	 */
	stablePrefixTokens: number;
	/** Summed token count of the volatile tail (from {@link volatileBoundaryIndex} on) — what re-prefills each turn. */
	volatileTailTokens: number;
}

/** Fragments with unknown stability are treated as volatile — placing them late can never DEFEAT caching, only defer it. */
const DEFAULT_STABILITY: PrefixStability = "volatile";

/** The effective stability tier of a fragment (its own, or the safe volatile default). */
function stabilityOf(fragment: PrefixOrderFragment): PrefixStability {
	return fragment.stability ?? DEFAULT_STABILITY;
}

/** Floor a possibly-messy token count to a non-negative integer (a fragment can't prefill fewer than zero tokens). */
function normalizeTokenCount(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.trunc(value);
}

/**
 * Order a turn's fragments so the byte-stable prefix leads and volatile content trails — the §5.AQ item-D cache-aware
 * layout. Fragments are grouped by stability tier in {@link PREFIX_STABILITY_ORDER} (static → persistent → session →
 * volatile); WITHIN a tier the caller's input order is preserved (a STABLE partition, so equal-tier fragments never
 * churn the prefix between turns). Returns the ordered fragments plus the cache boundary and the stable/volatile token
 * split. Pure — never mutates the input; returns a fresh array of the same fragment objects in the new order.
 *
 * This is only the REORDER; it never drops or merges fragments (budgeting is `jit-fragment-budget.ts`) and it does not
 * emit a string (concatenation is `assembleCacheAwarePrompt`). Pair it with {@link planCacheStablePrefixOrder} to also
 * score the resulting layout's predicted reuse against the previous turn.
 */
export function orderFragmentsForStablePrefix(fragments: readonly PrefixOrderFragment[]): PrefixOrderFragment[] {
	// Stable sort by tier rank: `Array.prototype.sort` is required stable in modern engines, and a numeric tier key
	// keeps fragments of the SAME tier in their original relative order — the property the cache prefix depends on.
	return fragments
		.map((fragment, index) => ({ fragment, index }))
		.sort((a, b) => {
			const byTier = STABILITY_RANK[stabilityOf(a.fragment)] - STABILITY_RANK[stabilityOf(b.fragment)];
			return byTier !== 0 ? byTier : a.index - b.index;
		})
		.map((entry) => entry.fragment);
}

/**
 * Plan the cache-stable ordering for a turn AND (optionally) predict its reuse against the previous turn's ordered
 * fragments. Orders `fragments` via {@link orderFragmentsForStablePrefix}, locates the volatile boundary, and sums the
 * stable-prefix vs volatile-tail tokens. Pure + deterministic; token counts and stability tiers are injected.
 *
 * The `previousOrdered` fragments — the ordering produced for the LAST turn (or any sequence the runtime currently holds
 * cached) — are optional. When supplied, {@link planCacheStablePrefixWithReuse} composes {@link estimatePrefixReuse} to
 * report how much of THIS ordering the runtime will actually reuse; use it to confirm the layout kept the prefix stable.
 */
export function planCacheStablePrefixOrder(fragments: readonly PrefixOrderFragment[]): CacheStablePrefixOrder {
	const ordered = orderFragmentsForStablePrefix(fragments);

	let volatileBoundaryIndex = ordered.length;
	for (let i = 0; i < ordered.length; i++) {
		const fragment = ordered[i];
		if (fragment !== undefined && stabilityOf(fragment) === "volatile") {
			volatileBoundaryIndex = i;
			break;
		}
	}

	let stablePrefixTokens = 0;
	let volatileTailTokens = 0;
	for (let i = 0; i < ordered.length; i++) {
		const fragment = ordered[i];
		if (fragment === undefined) {
			continue;
		}
		const tokens = normalizeTokenCount(fragment.tokenCount);
		if (i < volatileBoundaryIndex) {
			stablePrefixTokens += tokens;
		} else {
			volatileTailTokens += tokens;
		}
	}

	return { ordered, volatileBoundaryIndex, stablePrefixTokens, volatileTailTokens };
}

/** A cache-stable ordering paired with the predicted reuse of that ordering against the previous turn. */
export interface CacheStablePrefixPlan extends CacheStablePrefixOrder {
	/**
	 * Predicted prefix-cache reuse of {@link CacheStablePrefixOrder.ordered} vs the previous turn's ordered fragments
	 * (from {@link estimatePrefixReuse}). Present only when `previousOrdered` was supplied; a cold first turn (no
	 * previous) omits it, since there is nothing cached to reuse yet.
	 */
	reuse?: PrefixReuseEstimate;
}

/**
 * Order a turn's fragments for a byte-stable prefix AND score the result's reuse against the previous turn. Combines
 * {@link planCacheStablePrefixOrder} (the ordering + boundary + token split) with {@link estimatePrefixReuse} (the
 * predicted reuse of the new ordering vs `previousOrdered`). When `previousOrdered` is omitted (a cold turn) the reuse
 * estimate is left off. Pure + deterministic; composes the sibling estimator by import without modifying it.
 */
export function planCacheStablePrefixWithReuse(
	fragments: readonly PrefixOrderFragment[],
	previousOrdered?: readonly CacheFragment[],
): CacheStablePrefixPlan {
	const plan = planCacheStablePrefixOrder(fragments);
	if (previousOrdered === undefined) {
		return plan;
	}
	return { ...plan, reuse: estimatePrefixReuse(previousOrdered, plan.ordered) };
}
