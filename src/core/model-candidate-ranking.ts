/**
 * P25.3 phase 2 — turn "what is NEW" into "what is new AND RUNNABLE HERE". PURE core.
 *
 * ── WHAT THIS ADDS TO F3.34 ──
 * The model-research lane already answers "what exists and what changed". That list is not yet decision-grade for
 * acquisition, because a model this host cannot hold is not a candidate no matter how good it is. This applies the
 * phase-1 residency arithmetic to each finding and re-orders on RUNNABILITY.
 *
 * ── THE ASYMMETRY THAT MAKES NAIVE RANKING WRONG ──
 * `estimateModelResidency` has two bases. With a declared architecture it is arithmetic. Without one it falls back
 * to an anchored heuristic that **assumes NO grouped-query attention, over-stating KV cache by 4–8×** — deliberately,
 * because for a LOAD decision over-stating is fail-safe: wrong-high refuses a model that would have fit, wrong-low
 * wedges a host.
 *
 * **For an ACQUISITION list that bias points the wrong way.** Nearly every modern model uses GQA, so a heuristic
 * `exceeds` is usually a model that would in fact run — and burying it at the bottom of a shopping list hides
 * exactly the candidates worth having. So a heuristic `exceeds` is NOT reported as "too big". It is reported as
 * **undetermined**, ranked above the models known to be too big, and its actionable next step is *fetch the
 * architecture*, not *discard the model*. A declared-architecture `exceeds` is a real refusal and is ranked last.
 *
 * ── WHY THERE IS NO QUALITY SCORE ──
 * Fit is the only axis this module can measure. Ranking within a tier preserves the SOURCE's order (recency,
 * popularity, whatever the research lane produced) rather than inventing a benchmark-free quality number —
 * a fabricated ranking of models to download would be indistinguishable from a real one by inspection, and it
 * would decide what gets executed on this machine.
 */

import {
	estimateModelResidency,
	fitModelResidency,
	type ModelArchitecture,
	type ResidencyFit,
} from "./model-residency-sizing";

export interface ModelCandidate {
	/** Catalogue key, e.g. `qwen/qwen3-8b`. */
	readonly key: string;
	/** Parameter count in billions, as the model card states it. */
	readonly paramB: number;
	/** Bits per weight after quantisation: 4 for Q4_K_M, 8 for Q8, 16 for f16. */
	readonly weightBitsPerParam: number;
	/** Exact geometry when the source published it — this is what removes the heuristic's GQA penalty. */
	readonly architecture?: ModelArchitecture;
	/** On-disk size from the catalogue, when known. Cross-checked against the weights estimate. */
	readonly sizeBytes?: number | null;
}

export type RunnabilityTier =
	/** Fits with headroom. */
	| "runnable"
	/** Fits, but with no room for a second model or a longer context. */
	| "runnable_tight"
	/** Over budget ONLY under the GQA-blind heuristic — likely runnable; fetch the architecture to decide. */
	| "undetermined_needs_architecture"
	/** Over budget with the real geometry in hand. A genuine refusal. */
	| "exceeds_budget";

const TIER_ORDER: Record<RunnabilityTier, number> = {
	runnable: 0,
	runnable_tight: 1,
	undetermined_needs_architecture: 2,
	exceeds_budget: 3,
};

export interface RankedModelCandidate {
	readonly candidate: ModelCandidate;
	readonly tier: RunnabilityTier;
	readonly fit: ResidencyFit;
	readonly notes: readonly string[];
}

export interface RankedModelCandidates {
	readonly ranked: readonly RankedModelCandidate[];
	readonly summary: string;
}

/**
 * A catalogue size this far from the estimated weights means the stated paramB or quantisation is wrong.
 *
 * Generous, because quantisation schemes mix bit-widths across tensors and an exact match is not expected. What it
 * catches is the case worth catching: metadata describing a different artefact than the one that would download.
 */
const WEIGHTS_DISAGREEMENT_RATIO = 0.35;

function classify(fit: ResidencyFit): RunnabilityTier {
	if (fit.verdict === "fits") {
		return "runnable";
	}
	if (fit.verdict === "tight") {
		return "runnable_tight";
	}
	return fit.estimate.basis === "declared_architecture" ? "exceeds_budget" : "undetermined_needs_architecture";
}

export function rankModelCandidatesByFit(input: {
	readonly candidates: readonly ModelCandidate[];
	/** Memory available for model residency on this host. */
	readonly budgetBytes: number;
	/** The context the model would actually be SERVED at — !Klein's floor is 32k, not the advertised maximum. */
	readonly contextTokens: number;
	readonly kvBitsPerElement?: number;
}): RankedModelCandidates {
	const scored = input.candidates.map((candidate, index) => {
		const estimate = estimateModelResidency({
			paramB: candidate.paramB,
			weightBitsPerParam: candidate.weightBitsPerParam,
			contextTokens: input.contextTokens,
			...(candidate.architecture ? { architecture: candidate.architecture } : {}),
			...(input.kvBitsPerElement === undefined ? {} : { kvBitsPerElement: input.kvBitsPerElement }),
		});
		const fit = fitModelResidency(estimate, input.budgetBytes);
		const tier = classify(fit);
		const notes: string[] = [...estimate.caveats];
		if (tier === "undetermined_needs_architecture") {
			notes.push(
				"over budget only under the GQA-blind heuristic, which over-states KV cache by 4–8× — fetch this model's layer/kv-head/head-dim geometry before ruling it out, rather than discarding it",
			);
		}
		if (typeof candidate.sizeBytes === "number" && candidate.sizeBytes > 0) {
			const ratio = Math.abs(candidate.sizeBytes - estimate.weightsBytes) / candidate.sizeBytes;
			if (ratio > WEIGHTS_DISAGREEMENT_RATIO) {
				notes.push(
					`catalogue size (${(candidate.sizeBytes / 1024 ** 3).toFixed(1)} GiB) disagrees with the weights estimate (${(estimate.weightsBytes / 1024 ** 3).toFixed(1)} GiB) by ${Math.round(ratio * 100)}% — the stated parameter count or quantisation probably does not describe the artefact that would download`,
				);
			}
		}
		return { candidate, tier, fit, notes, index };
	});

	// Stable within a tier: the source's order is preserved rather than replaced by a quality number this module
	// has no evidence for.
	const ranked = [...scored]
		.sort((left, right) => TIER_ORDER[left.tier] - TIER_ORDER[right.tier] || left.index - right.index)
		.map(({ candidate, tier, fit, notes }) => ({ candidate, tier, fit, notes }));

	const count = (tier: RunnabilityTier) => ranked.filter((entry) => entry.tier === tier).length;
	const undetermined = count("undetermined_needs_architecture");
	return {
		ranked,
		summary:
			`${ranked.length} candidate(s) at ${input.contextTokens} tokens: ` +
			`${count("runnable")} runnable, ${count("runnable_tight")} tight, ` +
			`${undetermined} undetermined, ${count("exceeds_budget")} over budget` +
			(undetermined > 0
				? ` — the undetermined ones are NOT rejects: the heuristic assumes no GQA, so they are the candidates most worth resolving`
				: ""),
	};
}
