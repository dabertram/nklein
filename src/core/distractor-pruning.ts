/**
 * Distractor-aware retrieval pruning (§5.AD) — a PURE, generic ranker/pruner over any score-bearing retrieval results
 * (code-search matches, repo-map symbols, online snippets). Research grounding: similar-but-irrelevant context measurably
 * HURTS output (context-rot / distractor interference), and the sensitivity varies per model. So before retrieval results
 * feed §5.AD's smart-zone MIDDLE band, prune the low-relevance tail HARDER for models with high learned distractor
 * sensitivity — keeping the clearly-relevant items, dropping the marginal ones that only dilute attention. Generic over
 * `{ score }` so it is reused across retrieval sources and is trivially testable; never prunes to nothing (`minKeep`).
 */

export interface DistractorPruningOptions {
	/**
	 * The model's distractor sensitivity in [0, 1]: 0 = keep everything (no pruning), 1 = maximally aggressive (keep only
	 * the items closest to the top score). Clamped to [0, 1]. Sourced per-model from the §5.AA profile once learned;
	 * callers pass a neutral default (e.g. 0) until then.
	 */
	sensitivity: number;
	/** Always keep at least this many top-scored items, so pruning never empties a non-empty result set. Default 1. */
	minKeep?: number;
	/** Optional hard cap on how many items survive, regardless of scores. */
	maxKeep?: number;
}

/**
 * The strongest fraction-of-top floor we ever impose, at sensitivity 1.0 — keep items scoring ≥80% of the top. Capped
 * below 1.0 so even a maximally-sensitive model still keeps the genuinely-near-top items, never collapsing to only the
 * single best.
 */
const MAX_KEEP_FLOOR_FRACTION = 0.8;

/**
 * Prune distractors from scored retrieval results (pure). Returns the kept items sorted by score desc (relevance order,
 * stable for ties). Items scoring below `topScore × sensitivity × 0.8` are dropped as distractors; `minKeep` top items
 * are always retained, and `maxKeep` caps the survivors. Sensitivity 0 (or a single item) ⇒ everything is kept.
 */
export function pruneDistractors<T extends { score: number }>(
	items: readonly T[],
	options: DistractorPruningOptions,
): T[] {
	const minKeep = Math.max(0, Math.trunc(options.minKeep ?? 1));
	const sensitivity = Math.max(0, Math.min(1, options.sensitivity));
	// Stable sort by score desc (preserve input order for ties).
	const ranked = items
		.map((item, index) => ({ item, index }))
		.sort((left, right) => right.item.score - left.item.score || left.index - right.index)
		.map((entry) => entry.item);
	if (ranked.length === 0) {
		return [];
	}
	const topScore = ranked[0].score;
	const floor = topScore * sensitivity * MAX_KEEP_FLOOR_FRACTION;
	const kept = ranked.filter((item, position) => position < minKeep || item.score >= floor);
	const capped =
		typeof options.maxKeep === "number" ? kept.slice(0, Math.max(minKeep, Math.trunc(options.maxKeep))) : kept;
	return capped;
}
