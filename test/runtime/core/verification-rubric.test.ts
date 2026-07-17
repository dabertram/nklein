import { describe, expect, it } from "vitest";
import { buildVerificationRubric, renderRubricLensStance } from "../../../src/core/verification-rubric";

describe("buildVerificationRubric (F12.5)", () => {
	it("extracts bullets, acceptance lines, and must-sentences in order, deduped and capped", () => {
		const rubric = buildVerificationRubric(
			[
				"Implement the rate limiter.",
				"- Reject requests over 100 req/s per client.",
				"- Reject requests over 100 req/s per client.",
				"Acceptance: npm test -- rate-limiter passes.",
				"The limiter must expose a reset endpoint for tests.",
			].join("\n"),
		);
		expect(rubric.items).toEqual([
			"Reject requests over 100 req/s per client.",
			"npm test -- rate-limiter passes.",
			"The limiter must expose a reset endpoint for tests.",
		]);
		expect(rubric.empty).toBe(false);
	});

	it("caps at 8 items and reports empty for prose with nothing checklist-shaped", () => {
		const many = buildVerificationRubric(
			Array.from({ length: 12 }, (_, i) => `- requirement number ${i}`).join("\n"),
		);
		expect(many.items).toHaveLength(8);
		const empty = buildVerificationRubric("Please tidy things up a bit.");
		expect(empty.empty).toBe(true);
		expect(renderRubricLensStance(empty)).toBeNull();
	});

	it("renders a tri-state per-item stance with evidence demanded", () => {
		const stance = renderRubricLensStance(buildVerificationRubric("- Return 429 on limit breach."));
		expect(stance).toContain("met / not-met / cannot-tell");
		expect(stance).toContain("1. Return 429 on limit breach.");
		expect(stance).toContain("cannot-tell without evidence is a finding");
	});
});
