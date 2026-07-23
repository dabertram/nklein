/** F12.78b acceptance math: distinguish invalid (loud) failures from wrong-but-valid (silent) failures. */

export type ConstraintTaxEvalArm = "direct_constrained" | "free_text_then_package";

export interface ConstraintTaxEvalObservation {
	readonly cardId: string;
	readonly arm: ConstraintTaxEvalArm;
	readonly valid: boolean;
	readonly correct: boolean;
}

export interface ConstraintTaxArmSummary {
	readonly total: number;
	readonly valid: number;
	readonly correct: number;
	readonly invalid: number;
	readonly wrongButValid: number;
	readonly validityRate: number;
	readonly accuracyRate: number;
	/** Silent-failure rate over every attempted card. */
	readonly wrongButValidRate: number;
	/** Silent-failure rate conditional on the output having passed structural validation. */
	readonly wrongAmongValidRate: number;
}

function ratio(numerator: number, denominator: number): number {
	return denominator > 0 ? numerator / denominator : 0;
}

export function summarizeConstraintTaxArm(
	observations: readonly ConstraintTaxEvalObservation[],
	arm: ConstraintTaxEvalArm,
): ConstraintTaxArmSummary {
	const rows = observations.filter((observation) => observation.arm === arm);
	const valid = rows.filter((row) => row.valid).length;
	const correct = rows.filter((row) => row.correct).length;
	const wrongButValid = rows.filter((row) => row.valid && !row.correct).length;
	return {
		total: rows.length,
		valid,
		correct,
		invalid: rows.length - valid,
		wrongButValid,
		validityRate: ratio(valid, rows.length),
		accuracyRate: ratio(correct, rows.length),
		wrongButValidRate: ratio(wrongButValid, rows.length),
		wrongAmongValidRate: ratio(wrongButValid, valid),
	};
}

export function summarizeConstraintTaxEval(observations: readonly ConstraintTaxEvalObservation[]) {
	const direct = summarizeConstraintTaxArm(observations, "direct_constrained");
	const twoPhase = summarizeConstraintTaxArm(observations, "free_text_then_package");
	return {
		direct,
		twoPhase,
		wrongButValidRateDelta: twoPhase.wrongButValidRate - direct.wrongButValidRate,
		packagingFailureRate: ratio(twoPhase.invalid, twoPhase.total),
		pairedCardCount: new Set(observations.map((row) => row.cardId)).size,
	};
}
