import { describe, expect, it } from "vitest";
import { planReviewEffort } from "../../src/core/review-effort-scaling";

describe("review effort scaling (F12.35)", () => {
	it("skips the deep pass only when EVERY reassuring signal is present", () => {
		const plan = planReviewEffort({ difficulty: 0.2, deterministicGreen: true, workerConfidence: 0.9 });
		expect(plan.depth).toBe("skip_deep");
		expect(plan.reviewPasses).toBe(1);
		expect(plan.debateRounds).toBe(0);
		expect(plan.reason).toContain("injects more errors than it catches");
	});

	it("treats UNKNOWN as not-reassuring — an unmeasured card never earns the cheap path", () => {
		// Checks never ran.
		expect(planReviewEffort({ difficulty: 0.2, deterministicGreen: null, workerConfidence: 0.9 }).depth).toBe(
			"standard",
		);
		// Confidence unknown.
		const noConfidence = planReviewEffort({ difficulty: 0.2, deterministicGreen: true });
		expect(noConfidence.depth).toBe("standard");
		expect(noConfidence.reason).toContain("worker confidence unknown");
	});

	it("goes DEEP when the lenses already disagree", () => {
		const plan = planReviewEffort({
			difficulty: 0.1,
			deterministicGreen: true,
			workerConfidence: 0.95,
			lensDisagreement: true,
		});
		expect(plan.depth).toBe("deep");
		expect(plan.reviewPasses).toBe(4);
		expect(plan.debateRounds).toBe(2);
	});

	it("goes DEEP on red deterministic checks even for an easy, confident card", () => {
		const plan = planReviewEffort({ difficulty: 0.1, deterministicGreen: false, workerConfidence: 0.99 });
		expect(plan.depth).toBe("deep");
		expect(plan.reason).toContain("RED");
	});

	it("goes DEEP on hard cards and on uncertain routing", () => {
		expect(planReviewEffort({ difficulty: 0.9, deterministicGreen: true, workerConfidence: 0.9 }).depth).toBe("deep");
		const uncertain = planReviewEffort({
			difficulty: 0.3,
			deterministicGreen: true,
			workerConfidence: 0.9,
			routingUncertainty: 0.8,
		});
		expect(uncertain.depth).toBe("deep");
		expect(uncertain.reason).toContain("uncertain routing");
	});

	it("names the signals that blocked the cheap path", () => {
		const plan = planReviewEffort({ difficulty: 0.6, deterministicGreen: true, workerConfidence: 0.5 });
		expect(plan.depth).toBe("standard");
		expect(plan.reason).toContain("above the easy ceiling");
		expect(plan.reason).toContain("below bar");
	});

	it("treats a non-finite difficulty as maximally hard (fail-safe, not fail-cheap)", () => {
		expect(planReviewEffort({ difficulty: Number.NaN, deterministicGreen: true, workerConfidence: 1 }).depth).toBe(
			"deep",
		);
	});
});
