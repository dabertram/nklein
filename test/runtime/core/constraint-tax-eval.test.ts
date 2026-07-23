import { describe, expect, it } from "vitest";
import { summarizeConstraintTaxEval } from "../../../src/core/constraint-tax-eval";

describe("summarizeConstraintTaxEval (F12.78b)", () => {
	it("reports wrong-but-valid separately from invalid loud failures", () => {
		const summary = summarizeConstraintTaxEval([
			{ cardId: "a", arm: "direct_constrained", valid: true, correct: false },
			{ cardId: "b", arm: "direct_constrained", valid: true, correct: true },
			{ cardId: "a", arm: "free_text_then_package", valid: true, correct: true },
			{ cardId: "b", arm: "free_text_then_package", valid: false, correct: false },
		]);
		expect(summary.direct).toMatchObject({
			total: 2,
			valid: 2,
			correct: 1,
			wrongButValid: 1,
			validityRate: 1,
			wrongButValidRate: 0.5,
			wrongAmongValidRate: 0.5,
		});
		expect(summary.twoPhase).toMatchObject({ invalid: 1, wrongButValid: 0 });
		expect(summary.packagingFailureRate).toBe(0.5);
		expect(summary.wrongButValidRateDelta).toBe(-0.5);
		expect(summary.pairedCardCount).toBe(2);
	});

	it("uses zero rates rather than NaN when an arm has no observations", () => {
		const summary = summarizeConstraintTaxEval([]);
		expect(summary.direct.wrongAmongValidRate).toBe(0);
		expect(summary.twoPhase.validityRate).toBe(0);
		expect(summary.packagingFailureRate).toBe(0);
	});
});
