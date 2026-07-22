import { describe, expect, it } from "vitest";
import { runDevTestGraderBaseline, scoreDevTestGraderState } from "../../../src/core/dev-test-grader-baseline";
import { assessGraderIntegrity, FORGERY_VECTORS } from "../../../src/core/null-agent-baseline";

/**
 * P20.1b — the forgery baseline, run end-to-end against the real grader. The load-bearing assertions: an agent that
 * does NOTHING (and one that does arbitrary non-completing work) scores ZERO — the grader is not trivially forgeable
 * — and state tampering also scores zero now that the live grader requires independently executed acceptance evidence.
 */

describe("scoreDevTestGraderState", () => {
	const zero = { completed: 0, review: 0, planning: 0, ready: 0, inProgress: 0, backlog: 0, failed: 0, trash: 0 };

	it("scores a real completion 100 and everything else 0", () => {
		expect(scoreDevTestGraderState({ ...zero, completed: 3 }, true)).toBe(100);
		expect(scoreDevTestGraderState({ ...zero, completed: 3 }, null)).toBe(0);
		expect(scoreDevTestGraderState({ ...zero, backlog: 3 }, null)).toBe(0);
		// The empty-board guard: zero incomplete AND zero completed is NOT a pass (the old false-green).
		expect(scoreDevTestGraderState({ ...zero }, null)).toBe(0);
		// Acceptance green but no card completed is not a pass either.
		expect(scoreDevTestGraderState({ ...zero, review: 2 }, true)).toBe(0);
	});
});

describe("runDevTestGraderBaseline", () => {
	it("runs a state for every declared forgery vector (a new vector without a state fails loudly)", () => {
		const result = runDevTestGraderBaseline();
		expect(result.vectors.map((v) => v.id).sort()).toEqual(FORGERY_VECTORS.map((v) => v.id).sort());
	});

	it("the null and random agents score ZERO — the grader is not trivially forgeable", () => {
		const result = runDevTestGraderBaseline();
		expect(result.nullAgentScore).toBe(0);
		expect(result.randomAgentScore).toBe(0);
		expect(result.vectors.find((v) => v.id === "empty_output")?.forged).toBe(false);
		expect(result.vectors.find((v) => v.id === "random_activity")?.forged).toBe(false);
	});

	it("trivial-validator and test-hook vectors survive (acceptance green ≠ completion)", () => {
		const result = runDevTestGraderBaseline();
		expect(result.vectors.find((v) => v.id === "trivial_validator_satisfaction")?.forged).toBe(false);
		expect(result.vectors.find((v) => v.id === "test_hook_override")?.forged).toBe(false);
	});

	it("rejects STATE-TAMPERING without independent acceptance evidence", () => {
		const result = runDevTestGraderBaseline();
		const tampering = result.vectors.find((v) => v.id === "state_tampering");
		expect(tampering?.score).toBe(0);
		expect(tampering?.forged).toBe(false);
		expect(result.anyForged).toBe(false);
	});

	it("feeds assessGraderIntegrity the accepted-completion positive control", () => {
		const result = runDevTestGraderBaseline();
		const verdict = assessGraderIntegrity({
			nullAgent: result.nullAgentScore,
			randomAgent: result.randomAgentScore,
			realAgent: result.verifiedCompletionScore,
		});
		expect(result.verifiedCompletionScore).toBe(100);
		expect(verdict.verdict).toBe("sound");
		expect(verdict.allNumbersVoid).toBe(false);
	});
});
