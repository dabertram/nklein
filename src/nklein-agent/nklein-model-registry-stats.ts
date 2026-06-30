import { normalizePositiveInteger, normalizePositiveNumber } from "../core/normalize-number";
import type {
	NKleinModelRegistryCapabilityStats,
	NKleinModelRegistryConstraints,
	NKleinModelRegistrySpeedStats,
	NKleinModelRegistryWindowStats,
} from "./nklein-model-registry";
import {
	normalizeNullableString,
	normalizePassRate,
	normalizeScore,
	normalizeScoreLikeNumber,
} from "./nklein-model-registry-normalizers";
import {
	calculateEffectiveCapability,
	calculateEffectiveContextWindow,
	DEFAULT_CAPABILITY_PRIOR,
} from "./nklein-model-registry-scoring";
import { asRecord } from "./nklein-value-guards";

/**
 * Pure per-model stats factories + deserializers for the model registry, extracted from
 * nklein-model-registry. They build empty stat blocks and coerce untrusted persisted stats into
 * valid {speed, capability, window, constraints} blocks (recomputing the effective context window /
 * capability via the scoring module). The registry-owned stat types are type-only imports (erased →
 * no runtime cycle); behavior-preserving relative to the inline definitions.
 */

/** A zeroed speed-stats block (no samples yet). */
export function createEmptySpeedStats(): NKleinModelRegistrySpeedStats {
	return {
		samples: 0,
		promptTokensEwma: null,
		outputTokensEwma: null,
		totalTokensEwma: null,
		prefillTokensPerSecondEwma: null,
		decodeTokensPerSecondEwma: null,
		ttftMsEwma: null,
		wallTimeMsEwma: null,
		wallTimeMsPer1kPromptTokensEwma: null,
		lastPromptTokens: null,
		lastOutputTokens: null,
		lastWallTimeMs: null,
		lastObservedAt: null,
	};
}

/** A capability-stats block seeded with the default prior and no observations. */
export function createEmptyCapabilityStats(): NKleinModelRegistryCapabilityStats {
	return {
		samples: 0,
		staticPrior: DEFAULT_CAPABILITY_PRIOR,
		evalScore: null,
		externalScore: null,
		observedPassRate: null,
		effectiveScore: DEFAULT_CAPABILITY_PRIOR,
		lastObservedAt: null,
	};
}

/** Coerce persisted context-window stats, recomputing the effective window via the scoring module. */
export function normalizeWindowStats(value: unknown): NKleinModelRegistryWindowStats {
	const record = asRecord(value);
	const stats = {
		advertised: normalizePositiveInteger(record?.advertised),
		observed: normalizePositiveInteger(record?.observed),
		userOverride: normalizePositiveInteger(record?.userOverride),
		effective: null,
	};
	return {
		...stats,
		effective: calculateEffectiveContextWindow(stats),
	};
}

/** Coerce persisted speed stats (EWMA + last-sample fields), defaulting samples to 0. */
export function normalizeSpeedStats(value: unknown): NKleinModelRegistrySpeedStats {
	const record = asRecord(value);
	return {
		samples: normalizePositiveInteger(record?.samples) ?? 0,
		promptTokensEwma: normalizePositiveNumber(record?.promptTokensEwma),
		outputTokensEwma: normalizePositiveNumber(record?.outputTokensEwma),
		totalTokensEwma: normalizePositiveNumber(record?.totalTokensEwma),
		prefillTokensPerSecondEwma: normalizeScoreLikeNumber(record?.prefillTokensPerSecondEwma),
		decodeTokensPerSecondEwma: normalizeScoreLikeNumber(record?.decodeTokensPerSecondEwma),
		ttftMsEwma: normalizePositiveNumber(record?.ttftMsEwma),
		wallTimeMsEwma: normalizePositiveNumber(record?.wallTimeMsEwma),
		wallTimeMsPer1kPromptTokensEwma: normalizePositiveNumber(record?.wallTimeMsPer1kPromptTokensEwma),
		lastPromptTokens: normalizePositiveInteger(record?.lastPromptTokens),
		lastOutputTokens: normalizePositiveInteger(record?.lastOutputTokens),
		lastWallTimeMs: normalizePositiveNumber(record?.lastWallTimeMs),
		lastObservedAt: normalizePositiveInteger(record?.lastObservedAt),
	};
}

/** Coerce persisted capability stats, recomputing the effective score via the scoring module. */
export function normalizeCapabilityStats(value: unknown, now: number): NKleinModelRegistryCapabilityStats {
	const record = asRecord(value);
	const capability = {
		samples: normalizePositiveInteger(record?.samples) ?? 0,
		staticPrior: normalizeScore(record?.staticPrior) ?? DEFAULT_CAPABILITY_PRIOR,
		evalScore: normalizeScore(record?.evalScore),
		externalScore: normalizeScore(record?.externalScore),
		observedPassRate: normalizePassRate(record?.observedPassRate),
		effectiveScore: DEFAULT_CAPABILITY_PRIOR,
		lastObservedAt: normalizePositiveInteger(record?.lastObservedAt),
	};
	return {
		...capability,
		effectiveScore: calculateEffectiveCapability(capability, now),
	};
}

/** Coerce persisted per-model constraints, falling back to the given defaults for missing fields. */
export function normalizeConstraints(
	value: unknown,
	fallback: NKleinModelRegistryConstraints,
): NKleinModelRegistryConstraints {
	const record = asRecord(value);
	return {
		sharedEndpointId: normalizeNullableString(record?.sharedEndpointId) ?? fallback.sharedEndpointId,
		inputCostPerMillionTokens: normalizePositiveNumber(record?.inputCostPerMillionTokens),
		outputCostPerMillionTokens: normalizePositiveNumber(record?.outputCostPerMillionTokens),
		maxConcurrentRequests: normalizePositiveInteger(record?.maxConcurrentRequests) ?? fallback.maxConcurrentRequests,
	};
}
