import { describe, expect, it } from "vitest";
import { estimateLearnedRetryBudget, type RetryBudgetObservation } from "../../../src/core/learned-retry-budget";

const obs = (succeeded: boolean, retriesBefore: number): RetryBudgetObservation => ({ succeeded, retriesBefore });

describe("estimateLearnedRetryBudget (F3.30)", () => {
	it("returns the min-retries floor when there are too few samples", () => {
		const result = estimateLearnedRetryBudget([obs(true, 0), obs(true, 1)], { minRetries: 1, minSamplesToJudge: 5 });
		expect(result.recommendedMaxRetries).toBe(1);
		expect(result.reason).toContain("samples");
	});

	it("returns the floor (still try, don't grind) when nothing ever succeeds", () => {
		const observations = Array.from({ length: 8 }, (_, i) => obs(false, i % 3));
		const result = estimateLearnedRetryBudget(observations, { minRetries: 1 });
		expect(result.recommendedMaxRetries).toBe(1);
		expect(result.successCount).toBe(0);
		expect(result.reason).toContain("no successes");
	});

	it("recommends a low budget when nearly all successes land on the first try", () => {
		// 9 first-try successes, 1 that needed one retry → the 2nd retry captures <10% → knee at 1.
		const observations = [...Array.from({ length: 9 }, () => obs(true, 0)), obs(true, 1)];
		const result = estimateLearnedRetryBudget(observations, { marginalSuccessThreshold: 0.15 });
		expect(result.recommendedMaxRetries).toBe(1);
	});

	it("extends the budget when successes keep arriving at deeper retry depths", () => {
		// Successes spread 0..3 retries, each depth ~25% of successes → knee pushed to 3 (capped at ceiling).
		const observations = [
			...Array.from({ length: 3 }, () => obs(true, 0)),
			...Array.from({ length: 3 }, () => obs(true, 1)),
			...Array.from({ length: 3 }, () => obs(true, 2)),
			...Array.from({ length: 3 }, () => obs(true, 3)),
		];
		const result = estimateLearnedRetryBudget(observations, { maxRetriesCeiling: 4, marginalSuccessThreshold: 0.1 });
		expect(result.recommendedMaxRetries).toBe(3);
		expect(result.successCount).toBe(12);
	});

	it("never exceeds the ceiling", () => {
		const observations = Array.from({ length: 20 }, (_, i) => obs(true, i % 6));
		const result = estimateLearnedRetryBudget(observations, { maxRetriesCeiling: 2, marginalSuccessThreshold: 0.01 });
		expect(result.recommendedMaxRetries).toBeLessThanOrEqual(2);
	});
});
