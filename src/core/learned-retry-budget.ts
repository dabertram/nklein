/**
 * F3.30 — learned retry budgets (pure). Estimate how many stochastic retries are actually USEFUL for a given
 * (model, role, failure-mode) from the attempt ledger's history, and cap that by diminishing returns. A weak/flaky
 * model may need several retries to land a card; a model that never recovers a given failure mode should not be retried
 * into the ground. The signal is directly in the ledger: each attempt records `retriesBefore` (0 = first try) and
 * whether it ultimately succeeded — so the distribution of `retriesBefore` among the SUCCESSES tells us where the
 * marginal value of one-more-retry falls below a threshold.
 *
 * PURE + deterministic: folds the observations, no I/O. The consumer (the §5.AA retry ladder capping the stochastic
 * `same_model_retry` rung) rides a separate wire.
 */

export interface RetryBudgetObservation {
	/** Whether the attempt ultimately succeeded (a success at this retry depth). */
	succeeded: boolean;
	/** Retries that preceded this attempt (0 = first try). Negative values are clamped to 0. */
	retriesBefore: number;
}

export interface LearnedRetryBudgetOptions {
	/** Never recommend more than this many retries regardless of evidence. Default 4. */
	maxRetriesCeiling?: number;
	/** Always allow at least this many retries even with no/weak evidence (so a cold model still gets tries). Default 1. */
	minRetries?: number;
	/** Stop extending the budget once a deeper retry captures less than this fraction of total successes. Default 0.1. */
	marginalSuccessThreshold?: number;
	/** Below this many total observations the estimate is low-confidence → fall back to `minRetries`. Default 5. */
	minSamplesToJudge?: number;
}

export interface LearnedRetryBudget {
	/** The recommended maximum number of retries for this cell. */
	recommendedMaxRetries: number;
	/** Total observations folded. */
	sampleCount: number;
	/** Successes observed. */
	successCount: number;
	/** Short human rail for telemetry. */
	reason: string;
}

/**
 * Estimate the useful retry budget from a cell's observations. The recommended budget is the SMALLEST retry depth `d`
 * such that extending to `d+1` would capture fewer than `marginalSuccessThreshold` of all successes — i.e. the knee of
 * the cumulative-success-by-retry-depth curve — clamped to `[minRetries, maxRetriesCeiling]`. With too few samples, or
 * no successes at all, it returns `minRetries` (still try, but don't grind).
 */
export function estimateLearnedRetryBudget(
	observations: readonly RetryBudgetObservation[],
	options: LearnedRetryBudgetOptions = {},
): LearnedRetryBudget {
	const maxRetriesCeiling = Math.max(0, Math.trunc(options.maxRetriesCeiling ?? 4));
	const minRetries = Math.min(maxRetriesCeiling, Math.max(0, Math.trunc(options.minRetries ?? 1)));
	const marginalSuccessThreshold = options.marginalSuccessThreshold ?? 0.1;
	const minSamplesToJudge = Math.max(1, Math.trunc(options.minSamplesToJudge ?? 5));

	const sampleCount = observations.length;
	// Count successes bucketed by retry depth (clamped ≥ 0).
	const successesByDepth = new Map<number, number>();
	let successCount = 0;
	for (const observation of observations) {
		if (!observation.succeeded) {
			continue;
		}
		successCount += 1;
		const depth = Math.max(0, Math.trunc(observation.retriesBefore));
		successesByDepth.set(depth, (successesByDepth.get(depth) ?? 0) + 1);
	}

	if (sampleCount < minSamplesToJudge || successCount === 0) {
		return {
			recommendedMaxRetries: minRetries,
			sampleCount,
			successCount,
			reason:
				successCount === 0
					? `no successes in ${sampleCount} samples → floor ${minRetries}`
					: `only ${sampleCount} samples (< ${minSamplesToJudge}) → floor ${minRetries}`,
		};
	}

	// Walk depths upward, accumulating captured successes; stop once the NEXT depth adds < threshold of all successes.
	let cumulative = 0;
	let knee = minRetries;
	for (let depth = 0; depth <= maxRetriesCeiling; depth += 1) {
		const atDepth = successesByDepth.get(depth) ?? 0;
		cumulative += atDepth;
		knee = Math.max(knee, depth);
		const nextDepthSuccesses = successesByDepth.get(depth + 1) ?? 0;
		if (nextDepthSuccesses / successCount < marginalSuccessThreshold) {
			break;
		}
	}
	const recommendedMaxRetries = Math.min(maxRetriesCeiling, Math.max(minRetries, knee));
	return {
		recommendedMaxRetries,
		sampleCount,
		successCount,
		reason: `knee at ${recommendedMaxRetries} retries (${cumulative}/${successCount} successes captured; marginal < ${marginalSuccessThreshold})`,
	};
}
