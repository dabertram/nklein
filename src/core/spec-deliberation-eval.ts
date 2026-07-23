/** F12.111b paired acceptance math: plain clarification versus pre-code disagreement detection. */

export type SpecDeliberationEvalArm = "plain_single_model" | "deliberation";

export interface ExpectedAmbiguityConcept {
	readonly id: string;
	/** A generated concern matches when it contains at least one term from every group. */
	readonly keywordGroups: readonly (readonly string[])[];
}

export interface SpecDeliberationEvalObservation {
	readonly caseId: string;
	readonly arm: SpecDeliberationEvalArm;
	readonly concerns: readonly string[];
	readonly expected: readonly ExpectedAmbiguityConcept[];
	readonly modelCalls: number;
	readonly durationMs: number;
	readonly error: string | null;
}

export interface ScoredSpecDeliberationObservation extends SpecDeliberationEvalObservation {
	readonly matchedConceptIds: readonly string[];
	readonly missedConceptIds: readonly string[];
	readonly falseConcernCount: number;
	readonly recall: number;
	readonly preciseEnough: boolean;
	readonly qualityPass: boolean;
}

function ratio(numerator: number, denominator: number): number {
	return denominator > 0 ? numerator / denominator : 1;
}

function concernMatches(concern: string, concept: ExpectedAmbiguityConcept): boolean {
	const normalized = concern.toLowerCase();
	return concept.keywordGroups.every((alternatives) =>
		alternatives.some((term) => normalized.includes(term.toLowerCase())),
	);
}

export function scoreSpecDeliberationObservation(
	observation: SpecDeliberationEvalObservation,
): ScoredSpecDeliberationObservation {
	const matchedConceptIds = observation.expected
		.filter((concept) => observation.concerns.some((concern) => concernMatches(concern, concept)))
		.map((concept) => concept.id);
	const matchedConcernIndexes = new Set<number>();
	for (const concept of observation.expected) {
		const index = observation.concerns.findIndex((concern) => concernMatches(concern, concept));
		if (index >= 0) matchedConcernIndexes.add(index);
	}
	const falseConcernCount = observation.concerns.length - matchedConcernIndexes.size;
	const recall = ratio(matchedConceptIds.length, observation.expected.length);
	const preciseEnough = falseConcernCount <= (observation.expected.length === 0 ? 0 : 1);
	return {
		...observation,
		matchedConceptIds,
		missedConceptIds: observation.expected
			.filter((concept) => !matchedConceptIds.includes(concept.id))
			.map((concept) => concept.id),
		falseConcernCount,
		recall,
		preciseEnough,
		qualityPass: observation.error === null && recall >= 0.5 && preciseEnough,
	};
}

function summarizeArm(rows: readonly ScoredSpecDeliberationObservation[], arm: SpecDeliberationEvalArm) {
	const selected = rows.filter((row) => row.arm === arm);
	const totalExpected = selected.reduce((sum, row) => sum + row.expected.length, 0);
	const totalMatched = selected.reduce((sum, row) => sum + row.matchedConceptIds.length, 0);
	const totalConcerns = selected.reduce((sum, row) => sum + row.concerns.length, 0);
	const falseConcerns = selected.reduce((sum, row) => sum + row.falseConcernCount, 0);
	return {
		cases: selected.length,
		qualityPasses: selected.filter((row) => row.qualityPass).length,
		qualityPassRate: ratio(selected.filter((row) => row.qualityPass).length, selected.length),
		conceptRecall: ratio(totalMatched, totalExpected),
		falseConcernRate: ratio(falseConcerns, totalConcerns),
		modelCalls: selected.reduce((sum, row) => sum + row.modelCalls, 0),
		totalDurationMs: selected.reduce((sum, row) => sum + row.durationMs, 0),
		errors: selected.filter((row) => row.error !== null).length,
	};
}

export function summarizeSpecDeliberationEval(observations: readonly SpecDeliberationEvalObservation[]) {
	const scored = observations.map(scoreSpecDeliberationObservation);
	const plain = summarizeArm(scored, "plain_single_model");
	const deliberation = summarizeArm(scored, "deliberation");
	return {
		plain,
		deliberation,
		qualityPassRateDelta: deliberation.qualityPassRate - plain.qualityPassRate,
		conceptRecallDelta: deliberation.conceptRecall - plain.conceptRecall,
		modelCallMultiplier: ratio(deliberation.modelCalls, plain.modelCalls),
		pairedCaseCount: new Set(observations.map((row) => row.caseId)).size,
		scored,
	};
}
