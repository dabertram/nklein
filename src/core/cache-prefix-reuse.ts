/**
 * Prompt-cache prefix-reuse ESTIMATOR (todo §5.AQ item D — the cache-aware-layout axis). Given the fragment sequence
 * that was assembled LAST turn and the one about to be assembled THIS turn, predict how much of the prefix KV cache the
 * local runtime will reuse — BEFORE the request is sent — so a layout decision can be scored against the actual cache
 * lever.
 *
 * Why this is its own module (and not the sibling guards): local runtimes (llama.cpp / LM Studio / MLX) reuse the KV
 * cache for the longest LEADING run of the prompt that is byte-identical to the previous turn, then re-prefill
 * everything from the first differing token onward. `cache-aware-prompt-layout.ts` (item D) answers a coarser question
 * ("does a would-be prefix contain volatile content?" / "are two whole prefixes byte-equal?") and `cache-health.ts`
 * (item E) INTERPRETS the counts a runtime REPORTS after the fact (`cache_n` / `cached_tokens`). Neither PREDICTS the
 * partial reuse that a given fragment ORDERING will yield. That prediction is the missing lever: it is exactly what a
 * cache-aware layout orderer consults to decide whether moving a fragment earlier/later grows or shrinks the reusable
 * prefix — the whole point of the §5.AQ "byte-stable prefix rewards layout" finding.
 *
 * The model is fragment-level and PURE. A fragment is a `{ id, tokenCount }` pair: `id` stands in for the fragment's
 * exact bytes (two fragments with the same id render to the same bytes) and `tokenCount` is INJECTED as a plain number
 * (this module never tokenizes and never reads a clock or I/O). The reusable prefix is the longest run from position 0
 * for which BOTH the id AND the token count agree between the two sequences — a mismatch of EITHER breaks the run,
 * because a runtime keys reuse on the byte prefix and a differing token count means differing bytes even if an id were
 * reused loosely. This mirrors `prefixesAreCacheEquivalent`'s deliberate strictness, lifted to the fragment level so it
 * can report the PARTIAL overlap a whole-string `===` cannot.
 *
 * Boundary: this is the CACHE-PREFIX axis only. `context-smart-zone.ts` (§5.AD) orders for ATTENTION (lost-in-the-middle)
 * and `jit-fragment-budget.ts` (§5.AE) selects WITHIN a budget — different levers; this module neither reorders nor trims,
 * it only SCORES a proposed ordering's cache-prefix reuse so those callers (or an orderer) can compare alternatives.
 */

/** One assembled prompt fragment. `id` proxies the fragment's exact bytes; `tokenCount` is an injected token count. */
export interface CacheFragment {
	/** Stable identity of the fragment — two fragments with the same id render to byte-identical content. */
	id: string;
	/** The fragment's token count (injected as a plain number; a runtime prefills this many tokens for it). */
	tokenCount: number;
}

/** The length of the shared leading run between two fragment sequences ({@link sharedPrefixTokens}). */
export interface SharedPrefix {
	/** How many leading fragments are identical (same id AND token count) in both sequences, from position 0. */
	sharedFragments: number;
	/** The summed token count of those shared leading fragments — the tokens a runtime can serve from the KV cache. */
	sharedTokens: number;
}

/** The full prefix-reuse estimate for a next-turn assembly vs the previous one ({@link estimatePrefixReuse}). */
export interface PrefixReuseEstimate extends SharedPrefix {
	/** Total token count of the NEXT-turn sequence (the denominator for {@link reuseRatio}). */
	nextTotalTokens: number;
	/** Tokens the runtime must freshly PREFILL next turn = `nextTotalTokens - sharedTokens` (never negative). */
	recomputeTokens: number;
	/** `sharedTokens / nextTotalTokens` in `[0, 1]` — the predicted cache-hit fraction (`0` when next is empty). */
	reuseRatio: number;
	/**
	 * True when the reusable prefix does NOT cover the whole next sequence — i.e. at least one token must be re-prefilled.
	 * (When both sequences are empty there is nothing to recompute, so this is `false`.)
	 */
	requiresRecompute: boolean;
	/**
	 * True when the VERY FIRST fragment differs (or one side is empty while the other is not) — the cliff case where
	 * reuse is 0 and the entire next sequence re-prefills. The single most important thing a layout must avoid churning.
	 */
	firstFragmentChanged: boolean;
}

/** Floor a possibly-messy token count to a non-negative integer (a fragment can't prefill fewer than zero tokens). */
function normalizeTokenCount(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.trunc(value);
}

/** Two fragments are prefix-equivalent iff BOTH id and (normalized) token count agree — the byte-equality proxy. */
function fragmentsMatch(a: CacheFragment, b: CacheFragment): boolean {
	return a.id === b.id && normalizeTokenCount(a.tokenCount) === normalizeTokenCount(b.tokenCount);
}

/**
 * Compute the shared leading run between the previous and next fragment sequences: the longest prefix (from position 0)
 * for which every fragment matches by id AND token count. Returns the count of shared fragments and their summed
 * (normalized) token count — the tokens a byte-stable runtime reuses from its prefix KV cache. Pure; scans at most
 * `min(previous.length, next.length)` fragments and stops at the first mismatch.
 */
export function sharedPrefixTokens(previous: readonly CacheFragment[], next: readonly CacheFragment[]): SharedPrefix {
	const limit = Math.min(previous.length, next.length);
	let sharedFragments = 0;
	let sharedTokens = 0;
	for (let i = 0; i < limit; i++) {
		const prevFragment = previous[i];
		const nextFragment = next[i];
		if (prevFragment === undefined || nextFragment === undefined || !fragmentsMatch(prevFragment, nextFragment)) {
			break;
		}
		sharedFragments++;
		// Count from the NEXT fragment — it and the previous one are equal here, so either is correct; NEXT is what
		// actually gets prefilled this turn.
		sharedTokens += normalizeTokenCount(nextFragment.tokenCount);
	}
	return { sharedFragments, sharedTokens };
}

/** Sum the (normalized) token counts of a fragment sequence. */
function totalTokens(fragments: readonly CacheFragment[]): number {
	let total = 0;
	for (const fragment of fragments) {
		total += normalizeTokenCount(fragment.tokenCount);
	}
	return total;
}

/**
 * Estimate prefix-cache reuse for the NEXT-turn assembly given the PREVIOUS one. Predicts, without sending a request,
 * how many tokens the runtime reuses from its prefix KV cache vs must re-prefill, plus the hit ratio and the cliff flag.
 *
 * `sharedTokens`/`sharedFragments` come from {@link sharedPrefixTokens}; `nextTotalTokens = Σ next tokenCount`;
 * `recomputeTokens = nextTotalTokens - sharedTokens`; `reuseRatio = nextTotalTokens > 0 ? sharedTokens / nextTotalTokens
 * : 0`. `firstFragmentChanged` is true when the sequences disagree at position 0 (including one being empty while the
 * other is not) — the worst case (0 reuse, full re-prefill). Pure + deterministic; token counts are injected.
 */
export function estimatePrefixReuse(
	previous: readonly CacheFragment[],
	next: readonly CacheFragment[],
): PrefixReuseEstimate {
	const { sharedFragments, sharedTokens } = sharedPrefixTokens(previous, next);
	const nextTotalTokens = totalTokens(next);
	// sharedTokens is a prefix sum of NEXT's normalized token counts, so it can never exceed nextTotalTokens.
	const recomputeTokens = nextTotalTokens - sharedTokens;
	const reuseRatio = nextTotalTokens > 0 ? sharedTokens / nextTotalTokens : 0;

	const firstPrev = previous[0];
	const firstNext = next[0];
	const firstFragmentChanged =
		firstPrev === undefined || firstNext === undefined
			? firstPrev !== firstNext // one empty, the other not ⇒ changed; both empty ⇒ unchanged
			: !fragmentsMatch(firstPrev, firstNext);

	return {
		sharedFragments,
		sharedTokens,
		nextTotalTokens,
		recomputeTokens,
		reuseRatio,
		requiresRecompute: recomputeTokens > 0,
		firstFragmentChanged,
	};
}
