import { describe, expect, it } from "vitest";
import { assignReviewLenses, REVIEW_LENSES, shouldStopAddingEyes } from "../../../src/core/review-lenses";

describe("assignReviewLenses (W4.4 — orthogonal eyes in failure-mass order)", () => {
	it("eye #1 is ALWAYS spec-fit (MAST: specification failures dominate at 41.8%)", () => {
		expect(assignReviewLenses({ eyes: 1, reviewerTier: "strong" })[0]?.id).toBe("spec_fit");
		expect(assignReviewLenses({ eyes: 1, reviewerTier: "weak" })[0]?.id).toBe("spec_fit");
	});

	it("a strong reviewer's panel follows the failure-mass order", () => {
		expect(assignReviewLenses({ eyes: 4, reviewerTier: "strong" }).map((lens) => lens.id)).toEqual([
			"spec_fit",
			"integration",
			"test_quality",
			"correctness",
		]);
	});

	it("a weak reviewer never gets lenses it can't render (no security verdicts from a 4B)", () => {
		const ids = assignReviewLenses({ eyes: 7, reviewerTier: "weak" }).map((lens) => lens.id);
		expect(ids).toEqual(["spec_fit", "correctness", "simplicity"]);
		expect(ids).not.toContain("security");
	});

	it("every lens carries an explicit judge-ONLY stance (no generic 'review this')", () => {
		for (const lens of REVIEW_LENSES) {
			expect(lens.stance).toMatch(/Judge ONLY/);
		}
	});
});

describe("shouldStopAddingEyes (the marginal-value stopping rule)", () => {
	it("stops when the last eye added nothing new", () => {
		expect(shouldStopAddingEyes([5, 2, 0])).toBe(true);
	});

	it("continues while eyes keep contributing", () => {
		expect(shouldStopAddingEyes([5, 2, 1])).toBe(false);
		expect(shouldStopAddingEyes([])).toBe(false);
	});
});
