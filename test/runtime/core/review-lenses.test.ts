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

describe("P20.12 — spec_fit uses behavioural comparison, not requirement enumeration", () => {
	/**
	 * arXiv 2508.12358 (ASE'25) measured spec-conformance judging and found it fails in ONE direction —
	 * over-correction, flagging CORRECT code as defective. A three-step decomposition collapsed GPT-4o from 52.4%
	 * to 11.0%, and more chain-of-thought made it worse; "Behavioural Comparison" recovered it to 85.4%.
	 *
	 * This matters more for `spec_fit` than for any other lens: it is tier `weak` (assigned to the smallest models
	 * on the fleet, the population the study measured degrading) AND it is eye #1 on every panel, including the
	 * single-eye review of a trivial card — so on those cards it is the ONLY judgement made.
	 */
	const specFit = REVIEW_LENSES.find((lens) => lens.id === "spec_fit");

	it("asks what the code DOES and compares it to the request", () => {
		expect(specFit?.stance).toContain("BEHAVIOUR");
		expect(specFit?.stance.toLowerCase()).toContain("what the code now does");
	});

	it("requires a NAMEABLE failing situation before something counts as a defect", () => {
		// The direct counter to over-correction: an unfalsifiable objection is not a finding. Mirrors the
		// failure-scenario discipline the rest of the review surface already applies.
		expect(specFit?.stance.toLowerCase()).toContain("name the specific input or situation");
		expect(specFit?.stance.toLowerCase()).toContain("it is not a finding");
	});

	it("does NOT ask the reviewer to enumerate requirements step by step", () => {
		// The measured-bad structure. If this reappears, the lens has regressed to the shape the study collapsed.
		expect(specFit?.stance.toLowerCase()).not.toContain("list each requirement");
	});

	it("does NOT prime the reviewer to treat any difference as a defect", () => {
		// "flag anything missing, EXTRA, or misinterpreted" invited exactly that reading.
		expect(specFit?.stance.toLowerCase()).not.toContain("flag anything");
		expect(specFit?.stance.toLowerCase()).toContain("differs from how you would have written it");
	});

	it("is still the weak-tier, first-eye lens — the change is to STRUCTURE, not to its role", () => {
		expect(specFit?.minReviewerTier).toBe("weak");
		expect(REVIEW_LENSES[0]?.id).toBe("spec_fit");
	});
});
