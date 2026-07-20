import { describe, expect, it } from "vitest";
import { decideStopIterating, learnRoundsBudget } from "../../src/core/rounds-budget";

/**
 * rounds-budget wire (dev rounds-budget) — the two decisions the command surfaces. learnRoundsBudget finds the
 * plateau; decideStopIterating stops on converged / cap / diminishing-returns. The convergence short-circuit is
 * load-bearing: a satisfactory result stops regardless of budget, so a passing repro never burns extra rounds.
 */

describe("rounds-budget", () => {
	it("learns the budget as the leading rounds that clear the worth-it floor", () => {
		// 0.2, 0.1 clear 0.02; 0.01, 0.005 do not → plateau after 2.
		expect(learnRoundsBudget([0.2, 0.1, 0.01, 0.005], 0.02, 5)).toBe(2);
	});

	it("clamps the learned budget to [1, cap] — empty history is try-once, not zero", () => {
		expect(learnRoundsBudget([], 0.02, 5)).toBe(1);
		expect(learnRoundsBudget([0.5, 0.5, 0.5, 0.5, 0.5], 0.02, 3)).toBe(3); // capped
	});

	it("STOPS on convergence regardless of remaining budget — a passing result never burns rounds", () => {
		expect(
			decideStopIterating({ roundsDone: 0, maxRounds: 5, lastImprovement: 1, minImprovement: 0.02, converged: true })
				.stop,
		).toBe(true);
	});

	it("STOPS on diminishing returns and CONTINUES while improving under budget", () => {
		expect(
			decideStopIterating({ roundsDone: 2, maxRounds: 5, lastImprovement: 0.005, minImprovement: 0.02 }).stop,
		).toBe(true);
		expect(
			decideStopIterating({ roundsDone: 1, maxRounds: 5, lastImprovement: 0.1, minImprovement: 0.02 }).stop,
		).toBe(false);
	});

	it("STOPS at the budget ceiling even while still improving", () => {
		expect(
			decideStopIterating({ roundsDone: 5, maxRounds: 5, lastImprovement: 0.5, minImprovement: 0.02 }).stop,
		).toBe(true);
	});
});
