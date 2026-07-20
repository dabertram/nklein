/**
 * F12.77 — the RESIDENT-SET RECOMMENDATION: which models are worth keeping loaded. PURE core.
 *
 * Cold loads cost 40–90s. A fleet that reloads the same model six times an evening has spent ten minutes doing
 * nothing, and the fix is simply knowing which models to keep resident.
 *
 * ── WHY THIS IS NOT `model-residency-planner.ts`, WHICH ALREADY EXISTS ──
 * That module answers "if X does not fit, what do I UNLOAD to make room?" — an autonomous eviction planner, and
 * a good one. It also has zero consumers, and that is not an oversight: **the standing production constraint
 * (David, 2026-07-19) is that !Klein never auto-loads or auto-unloads models.** Prompt-cache thrash and MLX
 * behaviour make it the wrong thing to do, so the autonomous planner is dev-time tooling and its purpose in
 * production was removed by decision, not by neglect.
 *
 * What production actually needs is the opposite question: **"given how this fleet is used, which set should the
 * OPERATOR keep loaded?"** That is a recommendation, and the difference is not cosmetic.
 *
 * ── THE CONSTRAINT IS ENFORCED BY SHAPE, NOT BY DISCIPLINE ──
 * `ResidentSetRecommendation` has no `toLoad`, no `toUnload`, no action of any kind — only a set, reasons, and
 * costs. **There is no field a caller could execute**, so this module cannot grow into an auto-loader by
 * increments, which is exactly how such things normally arrive: one convenience field, one "dev-only" flag, one
 * default flip. The standing constraint survives as a type rather than as a comment someone has to remember.
 *
 * Honesty stance: an UNMEASURED model does not earn residency. Residency is a scarce, exclusive resource — every
 * recommended model denies the slot to another — so "we have no idea whether this is any good" must not outrank a
 * model with evidence. Same direction as the CodeAct gate: absent evidence resolves to "no".
 */

export interface ResidencyCandidate {
	readonly modelId: string;
	readonly sizeBytes: number;
	/** Measured fitness 0..1 for the role it would serve; null when this pairing was never measured. */
	readonly measuredFitness: number | null;
	/** Observations behind that fitness. A score from one or two runs is not evidence. */
	readonly observationCount: number;
	/** How often this model was requested over the observation window. Drives what residency is WORTH. */
	readonly requestCount: number;
}

export type ExclusionReason = "unmeasured" | "thin_evidence" | "below_fitness_bar" | "never_requested" | "no_room";

export interface RecommendedModel {
	readonly modelId: string;
	readonly sizeBytes: number;
	/** Estimated seconds of cold-load time avoided over the observed window. */
	readonly secondsSaved: number;
	readonly reason: string;
}

export interface ExcludedModel {
	readonly modelId: string;
	readonly reason: ExclusionReason;
	readonly detail: string;
}

/**
 * The recommendation. Deliberately actionless — see the docblock. A caller can render this, print it, or put it in
 * a settings panel; it cannot execute it, because there is nothing here to execute.
 */
export interface ResidentSetRecommendation {
	readonly recommended: readonly RecommendedModel[];
	readonly excluded: readonly ExcludedModel[];
	readonly bytesUsed: number;
	readonly bytesAvailable: number;
	/** Total cold-load seconds this set would have avoided over the observed window. */
	readonly secondsSaved: number;
	readonly summary: string;
}

/** Observed cold-load cost, mid-range of the 40–90s field measurement. */
export const COLD_LOAD_SECONDS = 65;
/** Fitness at or above which a model is worth a residency slot. */
export const RESIDENCY_FITNESS_BAR = 0.55;
/** Below this many observations a fitness score is treated as unmeasured rather than weak. */
const MIN_OBSERVATIONS = 5;
/** Fraction of the machine budget reserved for the OS + KV cache (matches the residency planner's default). */
const DEFAULT_RESERVE_FRACTION = 0.25;

/**
 * Recommend a resident set.
 *
 * Ranked by cold-load seconds avoided (requests × load cost) rather than by fitness alone: a slightly-worse model
 * requested forty times saves far more wall time than an excellent one requested twice, and residency is about
 * time saved, not about which model is best. Fitness is a GATE, not the ranking — a bad model kept warm is a bad
 * model answering faster.
 *
 * Never recommends a set exceeding the usable budget. Over-recommending would be worse than saying nothing: the
 * operator loads it, the machine swaps, and the resulting slowdown gets blamed on the model rather than on this
 * advice.
 */
export function recommendResidentSet(input: {
	readonly candidates: readonly ResidencyCandidate[];
	readonly budgetBytes: number;
	readonly reserveFraction?: number;
	readonly coldLoadSeconds?: number;
}): ResidentSetRecommendation {
	const reserve = input.reserveFraction ?? DEFAULT_RESERVE_FRACTION;
	const usable = Math.max(0, Math.floor(input.budgetBytes * (1 - reserve)));
	const loadCost = input.coldLoadSeconds ?? COLD_LOAD_SECONDS;

	const excluded: ExcludedModel[] = [];
	const eligible: { candidate: ResidencyCandidate; secondsSaved: number }[] = [];

	for (const candidate of input.candidates) {
		const measured = candidate.measuredFitness;
		if (measured === null || !Number.isFinite(measured)) {
			excluded.push({
				modelId: candidate.modelId,
				reason: "unmeasured",
				detail:
					"never measured — residency is exclusive, so an unknown model must not take a slot from one with evidence",
			});
			continue;
		}
		if (candidate.observationCount < MIN_OBSERVATIONS) {
			excluded.push({
				modelId: candidate.modelId,
				reason: "thin_evidence",
				detail: `only ${candidate.observationCount} observation(s) (need ${MIN_OBSERVATIONS}) — a score from that few runs is not evidence`,
			});
			continue;
		}
		if (measured < RESIDENCY_FITNESS_BAR) {
			excluded.push({
				modelId: candidate.modelId,
				reason: "below_fitness_bar",
				detail: `fitness ${measured.toFixed(2)} is below ${RESIDENCY_FITNESS_BAR} — a bad model kept warm is a bad model answering faster`,
			});
			continue;
		}
		// <= 1, not <= 0. A model requested exactly ONCE saves nothing by being resident: that single load had to
		// happen anyway, so residency buys zero seconds while consuming an exclusive slot. Off-by-one caught by test.
		if (candidate.requestCount <= 1) {
			excluded.push({
				modelId: candidate.modelId,
				reason: "never_requested",
				detail: `requested ${candidate.requestCount}× in the observed window — residency saves nothing, since the first load has to happen regardless`,
			});
			continue;
		}
		// Requests beyond the first are the ones that would have paid a cold load.
		eligible.push({ candidate, secondsSaved: (candidate.requestCount - 1) * loadCost });
	}

	eligible.sort(
		(left, right) => right.secondsSaved - left.secondsSaved || left.candidate.sizeBytes - right.candidate.sizeBytes,
	);

	const recommended: RecommendedModel[] = [];
	let bytesUsed = 0;
	for (const entry of eligible) {
		if (bytesUsed + entry.candidate.sizeBytes > usable) {
			excluded.push({
				modelId: entry.candidate.modelId,
				reason: "no_room",
				detail: `would exceed the usable budget (${usable} bytes after a ${Math.round(reserve * 100)}% reserve) — recommending it anyway would invite the operator to make the machine swap`,
			});
			continue;
		}
		bytesUsed += entry.candidate.sizeBytes;
		recommended.push({
			modelId: entry.candidate.modelId,
			sizeBytes: entry.candidate.sizeBytes,
			secondsSaved: entry.secondsSaved,
			reason: `requested ${entry.candidate.requestCount}× at fitness ${(entry.candidate.measuredFitness ?? 0).toFixed(2)} — keeping it resident avoids ~${Math.round(entry.secondsSaved)}s of cold loads`,
		});
	}

	const secondsSaved = recommended.reduce((total, model) => total + model.secondsSaved, 0);

	return {
		recommended,
		excluded,
		bytesUsed,
		bytesAvailable: usable,
		secondsSaved,
		summary:
			recommended.length === 0
				? `No model earns a residency slot (${input.candidates.length} candidate(s) considered). !Klein recommends; it never loads.`
				: `Recommend keeping ${recommended.length} model(s) resident (${Math.round(secondsSaved)}s of cold loads avoided over the observed window), using ${bytesUsed} of ${usable} usable bytes. !Klein does NOT load these — the operator does.`,
	};
}
