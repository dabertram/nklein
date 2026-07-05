import { describe, expect, it } from "vitest";
import { blendAnswerBudget, learnAnswerBudget, nearestRankPercentile } from "../../../src/core/answer-budget-learn";

describe("nearestRankPercentile", () => {
	it("p90 of 1..10 is the 9th value", () => {
		expect(nearestRankPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
	});

	it("p100 is the max; empty is 0", () => {
		expect(nearestRankPercentile([3, 7, 9], 1)).toBe(9);
		expect(nearestRankPercentile([], 0.9)).toBe(0);
	});
});

describe("learnAnswerBudget", () => {
	it("is the percentile of consumption plus the safety margin, rounded up", () => {
		// p90 (nearest-rank, 10 samples) = the 9th value = 90; +10% margin ⇒ ceil(99) = 99.
		const b = learnAnswerBudget([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], { percentile: 0.9, marginFraction: 0.1 });
		expect(b.budgetTokens).toBe(99);
		expect(b.samples).toBe(10);
		expect(b.confident).toBe(true);
	});

	it("sorts unordered observations before taking the percentile", () => {
		expect(learnAnswerBudget([100, 10, 50], { percentile: 1, marginFraction: 0 }).budgetTokens).toBe(100);
	});

	it("drops non-finite / negative observations", () => {
		const b = learnAnswerBudget([50, Number.NaN, -10, Number.POSITIVE_INFINITY, 60], {
			percentile: 1,
			marginFraction: 0,
		});
		expect(b.samples).toBe(2); // only 50 and 60 are usable
		expect(b.budgetTokens).toBe(60);
	});

	it("no usable samples ⇒ budget 0, not confident", () => {
		expect(learnAnswerBudget([], {})).toEqual({ budgetTokens: 0, samples: 0, confident: false });
		expect(learnAnswerBudget([Number.NaN, -1], {}).confident).toBe(false);
	});

	it("marks not-confident below minSamples", () => {
		expect(learnAnswerBudget([100, 100], { minSamples: 5 }).confident).toBe(false);
	});
});

describe("blendAnswerBudget", () => {
	it("EWMA-converges the running budget toward the freshly-learned one", () => {
		expect(blendAnswerBudget(100, 200, 0.5)).toBe(150);
		expect(blendAnswerBudget(100, 200, 0)).toBe(100); // alpha 0 ⇒ keep previous
		expect(blendAnswerBudget(100, 200, 1)).toBe(200); // alpha 1 ⇒ take latest
	});
});
