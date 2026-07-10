// §5.Z / low-spec enablement — observation-driven context-size RECOMMENDATIONS for SLOW hardware (todo 7356,
// David 2026-07-09). Distinct from the quality-knee estimator (context-budget-knee.ts): that fits the context past
// which ACCURACY plateaus; THIS fits the context past which a SLOW host can no longer keep up in reasonable time.
// The output is ADVISORY and default-adaptive — never a hard reject. If even the smallest observed context is slow,
// the recommendation is "keep working, but compact/slice harder", not "this host is excluded".
//
// Pure + dependency-free: a scatter of per-(host,model,role) timing observations in, a recommendation out. The
// mapping from the §5.AF ledger / registry to these observations is a separate concern.

export interface ContextTimingObservation {
	/** The prompt/context load in tokens for this turn (the axis the recommendation caps). */
	contextTokens: number;
	/** Total wall time for the turn (ms). */
	wallTimeMs: number;
	/** Time spent queued/waiting before the model produced output (ms); optional. */
	activeWaitMs?: number;
	/** A no-progress / timeout / stall signal fired for this turn. */
	stalled?: boolean;
	/** Whether the turn/task succeeded (a failed turn at a large context is evidence against that size). */
	success: boolean;
}

export type ContextSizeRecommendationBasis =
	| "none"
	| "insufficient_evidence"
	| "slow_processing"
	| "stalls"
	| "all_slow";

export interface ContextSizeRecommendation {
	/**
	 * The recommended MAX context tokens for this host/model/role, or null when no cap is warranted (the host keeps
	 * up at every observed size). Advisory: the caller defaults to it but honors a user override.
	 */
	recommendedMaxContextTokens: number | null;
	basis: ContextSizeRecommendationBasis;
	/** Human-readable justification (surfaced in Settings / CLI). */
	reason: string;
	/** Whether the recommendation rests on enough distinct levels + repeats to be trusted. */
	confident: boolean;
	/** When even the smallest observed context is slow: adaptations to keep the host working (never exclude). */
	adaptations: readonly string[];
	observationCount: number;
	levelCount: number;
}

export interface ContextSizeRecommendationPolicy {
	/** Above this mean wall time a context level counts as "slow" for this host. */
	slowWallTimeMs: number;
	/** At/above this stall rate a level counts as stall-prone. */
	stallRateThreshold: number;
	/** At/below this success rate a level is failing (evidence against that size). */
	minSuccessRate: number;
	/** Context tokens within this fraction of each other bin into one LEVEL (mirrors the quality-knee binner). */
	levelBinRelativeWidth: number;
	/** Minimum distinct levels for a confident recommendation. */
	minLevelsForConfidence: number;
	/** Minimum observations at a level for it to count (a single slow sample isn't a trend). */
	minSamplesPerLevel: number;
}

export const DEFAULT_CONTEXT_SIZE_RECOMMENDATION_POLICY: ContextSizeRecommendationPolicy = {
	slowWallTimeMs: 25_000,
	stallRateThreshold: 0.34,
	minSuccessRate: 0.5,
	levelBinRelativeWidth: 0.15,
	minLevelsForConfidence: 2,
	minSamplesPerLevel: 1,
};

interface ContextLevel {
	contextTokens: number;
	samples: number;
	meanWallTimeMs: number;
	stallRate: number;
	successRate: number;
}

/** Bin near-identical context sizes into levels, averaging timing/stall/success within each (ascending by size). */
function binIntoLevels(observations: readonly ContextTimingObservation[], relativeWidth: number): ContextLevel[] {
	const sorted = [...observations]
		.filter((observation) => Number.isFinite(observation.contextTokens) && observation.contextTokens > 0)
		.sort((left, right) => left.contextTokens - right.contextTokens);
	const levels: ContextLevel[] = [];
	let bucket: ContextTimingObservation[] = [];
	const flush = (): void => {
		if (bucket.length === 0) {
			return;
		}
		const contextTokens = Math.round(bucket.reduce((sum, o) => sum + o.contextTokens, 0) / bucket.length);
		const meanWallTimeMs = bucket.reduce((sum, o) => sum + Math.max(0, o.wallTimeMs), 0) / bucket.length;
		const stallRate = bucket.filter((o) => o.stalled).length / bucket.length;
		const successRate = bucket.filter((o) => o.success).length / bucket.length;
		levels.push({ contextTokens, samples: bucket.length, meanWallTimeMs, stallRate, successRate });
		bucket = [];
	};
	for (const observation of sorted) {
		if (bucket.length === 0) {
			bucket.push(observation);
			continue;
		}
		const anchor = bucket[0] as ContextTimingObservation;
		if (observation.contextTokens <= anchor.contextTokens * (1 + relativeWidth)) {
			bucket.push(observation);
		} else {
			flush();
			bucket.push(observation);
		}
	}
	flush();
	return levels;
}

/** Is a level "comfortable" for this host — fast enough, not stall-prone, mostly succeeding? */
function levelIsComfortable(level: ContextLevel, policy: ContextSizeRecommendationPolicy): boolean {
	return (
		level.meanWallTimeMs <= policy.slowWallTimeMs &&
		level.stallRate < policy.stallRateThreshold &&
		level.successRate > policy.minSuccessRate
	);
}

/**
 * Recommend a context-size cap from observed SLOW-PROCESSING evidence. The recommendation is the LARGEST context
 * level that stays comfortable (fast, not stalling, succeeding) — so the host runs as much context as it can handle
 * without tipping into slow/stalling territory. When every level is comfortable there is no cap (null). When even
 * the smallest is slow, the cap is that smallest size PLUS adaptation suggestions (compaction, phased retrieval,
 * more decomposition, long-running mode) — the host keeps working slowly, it is never excluded.
 */
export function recommendContextCap(
	observations: readonly ContextTimingObservation[],
	policy: ContextSizeRecommendationPolicy = DEFAULT_CONTEXT_SIZE_RECOMMENDATION_POLICY,
): ContextSizeRecommendation {
	const levels = binIntoLevels(observations, policy.levelBinRelativeWidth).filter(
		(level) => level.samples >= policy.minSamplesPerLevel,
	);
	const base = { observationCount: observations.length, levelCount: levels.length, adaptations: [] as string[] };
	if (levels.length === 0) {
		return {
			...base,
			recommendedMaxContextTokens: null,
			basis: "insufficient_evidence",
			reason: "No usable context-timing observations yet.",
			confident: false,
		};
	}

	const comfortable = levels.filter((level) => levelIsComfortable(level, policy));
	const confident = levels.length >= policy.minLevelsForConfidence;

	// Every level comfortable ⇒ no cap needed.
	if (comfortable.length === levels.length) {
		return {
			...base,
			recommendedMaxContextTokens: null,
			basis: "none",
			reason: `All ${levels.length} observed context level(s) processed comfortably (≤ ${policy.slowWallTimeMs} ms, low stalls); no cap needed.`,
			confident,
		};
	}

	// No comfortable level ⇒ even the smallest is slow. Recommend the smallest observed + adaptations (never exclude).
	if (comfortable.length === 0) {
		const smallest = levels[0] as ContextLevel;
		const stallDriven = smallest.stallRate >= policy.stallRateThreshold;
		return {
			...base,
			recommendedMaxContextTokens: smallest.contextTokens,
			basis: "all_slow",
			reason: `Even the smallest observed context (~${smallest.contextTokens} tokens) processes slowly on this host (mean ${Math.round(smallest.meanWallTimeMs)} ms${stallDriven ? ", stall-prone" : ""}). Keep working, but slice/compact harder.`,
			confident,
			adaptations: [
				"compact or summarize the prompt more aggressively",
				"phase retrieval (fetch less context per turn)",
				"decompose the task into smaller cards",
				"queue / long-running mode instead of interactive expectations",
			],
		};
	}

	// Mixed: cap at the largest comfortable level (the host handles up to here).
	const largestComfortable = comfortable[comfortable.length - 1] as ContextLevel;
	const firstSlow = levels.find((level) => !levelIsComfortable(level, policy)) as ContextLevel;
	const stallDriven = firstSlow.stallRate >= policy.stallRateThreshold;
	return {
		...base,
		recommendedMaxContextTokens: largestComfortable.contextTokens,
		basis: stallDriven ? "stalls" : "slow_processing",
		reason:
			`This host stays comfortable up to ~${largestComfortable.contextTokens} tokens; at ~${firstSlow.contextTokens} tokens it ` +
			(stallDriven
				? `stalls (${Math.round(firstSlow.stallRate * 100)}% of turns).`
				: `slows to ${Math.round(firstSlow.meanWallTimeMs)} ms/turn.`) +
			" Recommend capping context here (advisory — override to run larger, slower).",
		confident,
	};
}
