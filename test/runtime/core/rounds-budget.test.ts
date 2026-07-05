import { describe, expect, it } from "vitest";
import { decideStopIterating, learnRoundsBudget, type RoundState } from "../../../src/core/rounds-budget";

const state = (over: Partial<RoundState>): RoundState => ({
	roundsDone: 1,
	maxRounds: 5,
	lastImprovement: 0.3,
	minImprovement: 0.1,
	...over,
});

describe("decideStopIterating", () => {
	it("stops when converged, regardless of budget/improvement", () => {
		expect(decideStopIterating(state({ converged: true, roundsDone: 0, lastImprovement: 1 })).stop).toBe(true);
	});

	it("stops when the rounds budget is reached", () => {
		expect(decideStopIterating(state({ roundsDone: 5, maxRounds: 5 })).stop).toBe(true);
	});

	it("stops on diminishing returns (last improvement below the floor)", () => {
		const d = decideStopIterating(state({ lastImprovement: 0.05, minImprovement: 0.1 }));
		expect(d.stop).toBe(true);
		expect(d.reason).toContain("Diminishing returns");
	});

	it("keeps iterating while improving and under budget", () => {
		expect(decideStopIterating(state({ roundsDone: 2, maxRounds: 5, lastImprovement: 0.2 })).stop).toBe(false);
	});
});

describe("learnRoundsBudget", () => {
	it("budgets the leading rounds whose gain clears the floor (stop once plateaued)", () => {
		// 0.4, 0.2 clear 0.1; 0.05 does not ⇒ budget 2.
		expect(learnRoundsBudget([0.4, 0.2, 0.05, 0.01], 0.1, 10)).toBe(2);
	});

	it("clamps to the cap when every round keeps improving", () => {
		expect(learnRoundsBudget([0.5, 0.5, 0.5, 0.5], 0.1, 3)).toBe(3);
	});

	it("empty history ⇒ 1 (try once)", () => {
		expect(learnRoundsBudget([], 0.1, 5)).toBe(1);
	});

	it("never below 1 even when the first round already plateaus", () => {
		expect(learnRoundsBudget([0.01], 0.1, 5)).toBe(1);
	});
});
