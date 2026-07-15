/**
 * F3.16 — learn whether a model needs ENFORCED reasoning (pure). Forcing a reasoning phase (a `<think>` loop, a
 * reason-then-act split) helps some model×role×difficulty cells and wastes tokens/latency on others. This core folds
 * observed quality WITH vs WITHOUT enforced reasoning per cell into a benefit estimate + a recommendation, so the
 * orchestrator applies the loop ONLY where the evidence says it helps.
 *
 * Pure + deterministic. The effectful side records per-attempt (reasoningEnabled, qualityScore) observations keyed by
 * (modelKey, role, difficulty); this summarizes them.
 */

export interface ReasoningObservation {
	readonly reasoningEnabled: boolean;
	/** 0..1 answer quality for this attempt. */
	readonly qualityScore: number;
}

export interface ReasoningBenefitConfig {
	/** Minimum observations on EACH side (on/off) before the estimate is trusted. Default 3. */
	readonly minSamplesPerArm: number;
	/** Quality benefit at/above which enforcing is recommended. Default 0.1. */
	readonly minBenefitToEnforce: number;
}

export const DEFAULT_REASONING_BENEFIT_CONFIG: ReasoningBenefitConfig = {
	minSamplesPerArm: 3,
	minBenefitToEnforce: 0.1,
};

export type ReasoningRecommendation = "enforce" | "skip" | "insufficient_evidence";

export interface ReasoningBenefitProfile {
	/** Mean quality with reasoning enforced, or null when unmeasured. */
	readonly qualityWithReasoning: number | null;
	/** Mean quality without enforced reasoning, or null when unmeasured. */
	readonly qualityWithoutReasoning: number | null;
	/** withReasoning − withoutReasoning; null when either arm is unmeasured. */
	readonly benefit: number | null;
	readonly onSamples: number;
	readonly offSamples: number;
	readonly recommendation: ReasoningRecommendation;
}

function mean(values: readonly number[]): number | null {
	return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function learnReasoningBenefit(
	observations: readonly ReasoningObservation[],
	config: ReasoningBenefitConfig = DEFAULT_REASONING_BENEFIT_CONFIG,
): ReasoningBenefitProfile {
	const on = observations.filter((o) => o.reasoningEnabled).map((o) => o.qualityScore);
	const off = observations.filter((o) => !o.reasoningEnabled).map((o) => o.qualityScore);
	const qualityWith = mean(on);
	const qualityWithout = mean(off);
	const benefit = qualityWith !== null && qualityWithout !== null ? qualityWith - qualityWithout : null;

	let recommendation: ReasoningRecommendation;
	if (on.length < config.minSamplesPerArm || off.length < config.minSamplesPerArm || benefit === null) {
		recommendation = "insufficient_evidence";
	} else if (benefit >= config.minBenefitToEnforce) {
		recommendation = "enforce";
	} else {
		recommendation = "skip";
	}

	return {
		qualityWithReasoning: qualityWith,
		qualityWithoutReasoning: qualityWithout,
		benefit,
		onSamples: on.length,
		offSamples: off.length,
		recommendation,
	};
}

/** Apply the learned profile: enforce reasoning only when the evidence recommends it (insufficient ⇒ caller default). */
export function shouldEnforceReasoning(profile: ReasoningBenefitProfile, fallbackWhenUnknown = false): boolean {
	if (profile.recommendation === "enforce") {
		return true;
	}
	if (profile.recommendation === "skip") {
		return false;
	}
	return fallbackWhenUnknown;
}
