import { describe, expect, it } from "vitest";
import {
	decideReasoningRoundStop,
	type ReasoningRoundStopInput,
} from "../../../src/core/enforced-reasoning-round-stop";

/** A round on a fresh loop: one round done, no prior best, generous budget. */
function firstRound(overrides: Partial<ReasoningRoundStopInput> = {}): ReasoningRoundStopInput {
	return { roundsUsed: 1, roundBudget: 3, lastQuality: 0.5, ...overrides };
}

describe("decideReasoningRoundStop — continue while making progress", () => {
	it("continues on the first completed round when budget remains (no prior best to compare)", () => {
		const d = decideReasoningRoundStop(firstRound());
		expect(d.continueLoop).toBe(true);
		expect(d.verdict).toBe("continue");
		expect(d.roundsRemaining).toBe(2);
		expect(d.bestQuality).toBe(0.5);
		expect(d.lastRoundIsBest).toBe(true);
		expect(d.reason).toContain("first round");
	});

	it("continues when a later round improves by more than the epsilon", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 2, roundBudget: 4, lastQuality: 0.7, bestPriorQuality: 0.5 });
		expect(d.continueLoop).toBe(true);
		expect(d.verdict).toBe("continue");
		expect(d.roundsRemaining).toBe(2);
		expect(d.bestQuality).toBe(0.7);
		expect(d.lastRoundIsBest).toBe(true);
		expect(d.reason).toContain("improved");
	});

	it("reports roundsRemaining as budget minus rounds used", () => {
		expect(decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 5, lastQuality: 0.4 }).roundsRemaining).toBe(4);
		expect(
			decideReasoningRoundStop({ roundsUsed: 3, roundBudget: 5, lastQuality: 0.9, bestPriorQuality: 0.6 })
				.roundsRemaining,
		).toBe(2);
	});
});

describe("decideReasoningRoundStop — exhausted (the hard terminating bound)", () => {
	it("stops when rounds used reaches the budget", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 3, roundBudget: 3, lastQuality: 0.4, bestPriorQuality: 0.3 });
		expect(d.continueLoop).toBe(false);
		expect(d.verdict).toBe("exhausted");
		expect(d.roundsRemaining).toBe(0);
		expect(d.bestQuality).toBe(0.4);
		expect(d.reason).toContain("budget spent");
	});

	it("stops when rounds used somehow exceeds the budget", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 5, roundBudget: 3, lastQuality: 0.4 });
		expect(d.verdict).toBe("exhausted");
		expect(d.continueLoop).toBe(false);
	});

	it("exhausted wins even if the last round also converged (budget checked first)", () => {
		// last quality clears the target AND the budget is spent — the terminating bound takes precedence.
		const d = decideReasoningRoundStop({
			roundsUsed: 3,
			roundBudget: 3,
			lastQuality: 0.95,
			bestPriorQuality: 0.6,
			targetQuality: 0.9,
		});
		expect(d.verdict).toBe("exhausted");
		expect(d.bestQuality).toBe(0.95);
	});

	it("clamps a sub-1 budget to 1 (a single round is the minimum), stopping immediately as exhausted", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 0, lastQuality: 0.4 });
		expect(d.verdict).toBe("exhausted");
		expect(d.roundsRemaining).toBe(0);
	});
});

describe("decideReasoningRoundStop — converged (clears the target bar)", () => {
	it("stops when the last round reaches the target quality", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.9,
			bestPriorQuality: 0.6,
			targetQuality: 0.85,
		});
		expect(d.continueLoop).toBe(false);
		expect(d.verdict).toBe("converged");
		expect(d.bestQuality).toBe(0.9);
		expect(d.reason).toContain("converged");
	});

	it("converges exactly at the bar (>= is inclusive)", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 5, lastQuality: 0.8, targetQuality: 0.8 });
		expect(d.verdict).toBe("converged");
	});

	it("does not converge below the bar — continues instead", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 5, lastQuality: 0.79, targetQuality: 0.8 });
		expect(d.verdict).toBe("continue");
	});

	it("ignores a non-finite / absent target (no convergence bar applies)", () => {
		expect(
			decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 5, lastQuality: 0.99, targetQuality: null }).verdict,
		).toBe("continue");
		expect(
			decideReasoningRoundStop({
				roundsUsed: 1,
				roundBudget: 5,
				lastQuality: 0.99,
				targetQuality: Number.NaN,
			}).verdict,
		).toBe("continue");
	});
});

describe("decideReasoningRoundStop — regressed (self-correction hurting)", () => {
	it("stops and keeps the best when the last round scores worse than the prior best", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 2, roundBudget: 5, lastQuality: 0.4, bestPriorQuality: 0.7 });
		expect(d.continueLoop).toBe(false);
		expect(d.verdict).toBe("regressed");
		expect(d.bestQuality).toBe(0.7);
		expect(d.lastRoundIsBest).toBe(false);
		expect(d.reason).toContain("hurting");
	});

	it("tolerates a dip within regressEpsilon (treated as a plateau, not a regression)", () => {
		// drop of 0.05, regressEpsilon 0.1 → NOT a regression. Gain -0.05 < plateauEpsilon → plateaued.
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.65,
			bestPriorQuality: 0.7,
			regressEpsilon: 0.1,
		});
		expect(d.verdict).toBe("plateaued");
		expect(d.continueLoop).toBe(false);
		expect(d.bestQuality).toBe(0.7);
	});

	it("regresses past the regressEpsilon band", () => {
		// drop of 0.2, regressEpsilon 0.1 → past the band → regression.
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.5,
			bestPriorQuality: 0.7,
			regressEpsilon: 0.1,
		});
		expect(d.verdict).toBe("regressed");
	});

	it("never regresses on the first round (no prior best to fall from)", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 5, lastQuality: 0.1 });
		expect(d.verdict).toBe("continue");
	});
});

describe("decideReasoningRoundStop — settled (self-consistency agreement)", () => {
	it("stops when panel agreement reaches the stop threshold", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.6,
			bestPriorQuality: 0.4,
			lastAgreement: 0.8,
		});
		expect(d.continueLoop).toBe(false);
		expect(d.verdict).toBe("settled");
		expect(d.reason).toContain("settled");
	});

	it("continues when agreement is below the threshold (and quality still improving)", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.6,
			bestPriorQuality: 0.4,
			lastAgreement: 0.5,
		});
		expect(d.verdict).toBe("continue");
	});

	it("honours a custom agreementStopThreshold", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 1,
			roundBudget: 5,
			lastQuality: 0.6,
			lastAgreement: 0.6,
			agreementStopThreshold: 0.55,
		});
		expect(d.verdict).toBe("settled");
	});

	it("clamps an out-of-range agreement into [0,1]", () => {
		// agreement 1.5 clamps to 1 → >= default 0.75 → settled.
		const d = decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 5, lastQuality: 0.6, lastAgreement: 1.5 });
		expect(d.verdict).toBe("settled");
	});

	it("regression is checked before settle (a hurting round stops even if agreement is high)", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.3,
			bestPriorQuality: 0.8,
			lastAgreement: 0.95,
		});
		expect(d.verdict).toBe("regressed");
	});
});

describe("decideReasoningRoundStop — plateaued (diminishing returns)", () => {
	it("stops when the last round gains less than the plateau epsilon", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.705,
			bestPriorQuality: 0.7,
		});
		expect(d.continueLoop).toBe(false);
		expect(d.verdict).toBe("plateaued");
		expect(d.bestQuality).toBe(0.705);
		expect(d.reason).toContain("diminishing");
	});

	it("continues when the gain clears a custom epsilon", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.72,
			bestPriorQuality: 0.7,
			plateauEpsilon: 0.01,
		});
		expect(d.verdict).toBe("continue");
	});

	it("a flat repeat (no gain) plateaus", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 2, roundBudget: 5, lastQuality: 0.7, bestPriorQuality: 0.7 });
		expect(d.verdict).toBe("plateaued");
		expect(d.lastRoundIsBest).toBe(true); // ties count as best
	});
});

describe("decideReasoningRoundStop — robustness + purity", () => {
	it("bestQuality is the max of prior best and last round", () => {
		expect(
			decideReasoningRoundStop({ roundsUsed: 2, roundBudget: 5, lastQuality: 0.3, bestPriorQuality: 0.9 })
				.bestQuality,
		).toBe(0.9);
		expect(
			decideReasoningRoundStop({ roundsUsed: 2, roundBudget: 5, lastQuality: 0.95, bestPriorQuality: 0.6 })
				.bestQuality,
		).toBe(0.95);
	});

	it("clamps a sub-1 roundsUsed to 1", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 0, roundBudget: 3, lastQuality: 0.5 });
		expect(d.roundsUsed).toBe(1);
		expect(d.roundsRemaining).toBe(2);
	});

	it("treats a non-finite lastQuality as 0", () => {
		const d = decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 3, lastQuality: Number.NaN });
		expect(d.bestQuality).toBe(0);
		expect(d.verdict).toBe("continue");
	});

	it("treats a non-finite bestPriorQuality as 'no prior round'", () => {
		const d = decideReasoningRoundStop({
			roundsUsed: 2,
			roundBudget: 3,
			lastQuality: 0.5,
			bestPriorQuality: Number.NaN,
		});
		// no comparable prior → first-round semantics → continue, no regression/plateau.
		expect(d.verdict).toBe("continue");
		expect(d.reason).toContain("first round");
	});

	it("is deterministic — identical inputs give identical decisions", () => {
		const input: ReasoningRoundStopInput = {
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.72,
			bestPriorQuality: 0.6,
			targetQuality: 0.9,
			lastAgreement: 0.4,
		};
		expect(decideReasoningRoundStop(input)).toEqual(decideReasoningRoundStop(input));
	});

	it("does not mutate the input", () => {
		const input: ReasoningRoundStopInput = {
			roundsUsed: 2,
			roundBudget: 5,
			lastQuality: 0.72,
			bestPriorQuality: 0.6,
			targetQuality: 0.9,
			lastAgreement: 0.4,
		};
		const snapshot = JSON.parse(JSON.stringify(input));
		decideReasoningRoundStop(input);
		expect(input).toEqual(snapshot);
	});

	it("runs a realistic loop to termination: improve → improve → plateau", () => {
		// round 1: 0.5 (continue), round 2: 0.7 (continue), round 3: 0.705 (plateau → stop). Budget 4 never reached.
		const r1 = decideReasoningRoundStop({ roundsUsed: 1, roundBudget: 4, lastQuality: 0.5 });
		expect(r1.verdict).toBe("continue");
		const r2 = decideReasoningRoundStop({ roundsUsed: 2, roundBudget: 4, lastQuality: 0.7, bestPriorQuality: 0.5 });
		expect(r2.verdict).toBe("continue");
		const r3 = decideReasoningRoundStop({
			roundsUsed: 3,
			roundBudget: 4,
			lastQuality: 0.705,
			bestPriorQuality: 0.7,
		});
		expect(r3.verdict).toBe("plateaued");
		expect(r3.bestQuality).toBe(0.705);
	});
});
