import type { NKleinModelRegistryCapabilityStats, NKleinModelRegistryWindowStats } from "./nklein-model-registry";

/**
 * Pure scoring math for the model registry, extracted from nklein-model-registry: the EWMA smoother,
 * the effective context-window selection, and the capability-score blend (observed scores decayed by
 * age toward a static prior, prior weight shrinking as samples accrue). No registry state — the Stats
 * inputs are type-only imports (erased at build), so there is no runtime cycle.
 */

/** Default capability prior (0-100) used when a model has no usable observed/eval signal yet. */
export const DEFAULT_CAPABILITY_PRIOR = 35;

/** Half-life over which an observed capability score decays back toward its static prior. */
const CAPABILITY_OBSERVATION_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** Exponential weighted moving average; returns `next` verbatim when there is no previous value. */
export function ewma(previous: number | null, next: number, alpha: number): number {
	if (previous === null) {
		return next;
	}
	return previous * (1 - alpha) + next * alpha;
}

/** Effective context window: the user override, else the observed value, else the advertised one. */
export function calculateEffectiveContextWindow(windowStats: NKleinModelRegistryWindowStats): number | null {
	return windowStats.userOverride ?? windowStats.observed ?? windowStats.advertised;
}

/** Decay an observed score toward the capability's static prior by its age (capability half-life). */
function decayObservedCapabilityScore(
	score: number,
	capability: NKleinModelRegistryCapabilityStats,
	now?: number,
): number {
	if (typeof now !== "number" || capability.lastObservedAt === null) {
		return score;
	}
	const ageMs = Math.max(0, now - capability.lastObservedAt);
	const observationWeight = 0.5 ** (ageMs / CAPABILITY_OBSERVATION_HALF_LIFE_MS);
	return capability.staticPrior + (score - capability.staticPrior) * observationWeight;
}

/**
 * Effective capability (0-100): average the available, age-decayed observed scores (eval, external,
 * observed pass-rate×100) with the static prior, where the prior's weight is `1/(1+samples)` so it
 * fades as real observations accrue. Falls back to {@link DEFAULT_CAPABILITY_PRIOR} with no signal.
 */
export function calculateEffectiveCapability(capability: NKleinModelRegistryCapabilityStats, now?: number): number {
	const observedScores = [
		capability.evalScore,
		capability.externalScore,
		capability.observedPassRate === null ? null : capability.observedPassRate * 100,
	]
		.filter((score): score is number => score !== null)
		.map((score) => decayObservedCapabilityScore(score, capability, now));
	const priorWeight = 1 / (1 + Math.max(0, capability.samples));
	const weightedTotal =
		observedScores.reduce((total, score) => total + score, 0) + capability.staticPrior * priorWeight;
	const totalWeight = observedScores.length + priorWeight;
	if (totalWeight === 0) {
		return DEFAULT_CAPABILITY_PRIOR;
	}
	return Math.round(weightedTotal / totalWeight);
}
