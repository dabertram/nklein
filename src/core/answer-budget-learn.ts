/**
 * §5.AD (output sibling) — LEARN the per-(model, task-class) output/answer budget from observed token consumption. The
 * proactive complement to §5.AA's reactive retry ladder: instead of always guessing `max_tokens`, learn from what each
 * (model, task-class) has actually consumed (completion + reasoning tokens) and size to a high percentile + a safety
 * margin, so most turns finish in one shot while the reactive ladder stays the safety net for the tail. `blendAnswerBudget`
 * converges the estimate online (EWMA) as more turns are observed. Pure + total + deterministic (no clock, no I/O).
 */

export interface LearnAnswerBudgetOptions {
	/** The consumption percentile to cover (0.9 = p90, 0.95 = p95). Clamped to (0,1]. Default 0.9. */
	percentile?: number;
	/** Safety headroom above the percentile, as a fraction (0.15 = +15%). Clamped ≥ 0. Default 0.1. */
	marginFraction?: number;
	/** Minimum samples before the learned budget is trusted. Default 5. */
	minSamples?: number;
}

export interface LearnedAnswerBudget {
	/** The learned budget in tokens (percentile × (1 + margin), rounded up); 0 when there are no usable samples. */
	budgetTokens: number;
	/** Usable (finite, ≥ 0) sample count. */
	samples: number;
	/** True once `samples ≥ minSamples` — below that, prefer a conservative default over this estimate. */
	confident: boolean;
}

const clamp01Exclusive = (value: number): number => Math.min(1, Math.max(Number.EPSILON, value));

/** Nearest-rank percentile of an ASCENDING-sorted sample (pure). `p` in (0,1]; empty ⇒ 0. */
export function nearestRankPercentile(sortedAscending: readonly number[], p: number): number {
	if (sortedAscending.length === 0) {
		return 0;
	}
	const rank = Math.ceil(clamp01Exclusive(p) * sortedAscending.length);
	const index = Math.min(sortedAscending.length - 1, Math.max(0, rank - 1));
	return sortedAscending[index] ?? 0;
}

/**
 * Learn an answer/output budget from observed token consumption (pure): the chosen percentile of the samples, plus a
 * safety margin, rounded up. Non-finite / negative observations are dropped. No usable samples ⇒ budget 0 (the caller
 * falls back to a conservative default).
 */
export function learnAnswerBudget(
	observations: readonly number[],
	options: LearnAnswerBudgetOptions = {},
): LearnedAnswerBudget {
	const percentile = options.percentile ?? 0.9;
	const marginFraction = Math.max(0, options.marginFraction ?? 0.1);
	const minSamples = Math.max(1, Math.trunc(options.minSamples ?? 5));

	const usable = observations.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
	if (usable.length === 0) {
		return { budgetTokens: 0, samples: 0, confident: false };
	}
	const p = nearestRankPercentile(usable, percentile);
	// Subtract a tiny epsilon before ceil so float noise (e.g. 90 * 1.1 = 99.00000000000001) doesn't inflate the budget.
	return {
		budgetTokens: Math.ceil(p * (1 + marginFraction) - 1e-9),
		samples: usable.length,
		confident: usable.length >= minSamples,
	};
}

/**
 * Converge a running budget toward a freshly-learned one (EWMA). `alpha` in [0,1] — higher reacts faster to recent
 * consumption. The result is rounded up so it stays a valid token budget. Pure.
 */
export function blendAnswerBudget(previousBudget: number, learnedBudget: number, alpha = 0.3): number {
	const a = Math.min(1, Math.max(0, alpha));
	const prev = Math.max(0, previousBudget);
	const next = Math.max(0, learnedBudget);
	return Math.ceil(prev * (1 - a) + next * a);
}
