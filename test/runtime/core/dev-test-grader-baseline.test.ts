import { describe, expect, it } from "vitest";
import { runDevTestGraderBaseline, scoreDevTestGraderState } from "../../../src/core/dev-test-grader-baseline";
import { assessGraderIntegrity, FORGERY_VECTORS } from "../../../src/core/null-agent-baseline";

/**
 * P20.1b — the forgery baseline, run end-to-end against the real grader. The load-bearing assertions: an agent that
 * does NOTHING (and one that does arbitrary non-completing work) scores ZERO — the grader is not trivially forgeable
 * — while STATE-TAMPERING scores 100, because the board's own counts are the grader's only truth. Both are pinned as
 * CURRENT behaviour: the tampering result should start failing the day acceptance evidence is required independently
 * of the board (P20.3), which is the concrete reason to keep that gate honest.
 */

describe("scoreDevTestGraderState", () => {
	const zero = { completed: 0, review: 0, planning: 0, ready: 0, inProgress: 0, backlog: 0, failed: 0, trash: 0 };

	it("scores a real completion 100 and everything else 0", () => {
		expect(scoreDevTestGraderState({ ...zero, completed: 3 }, null)).toBe(100);
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

	it("STATE-TAMPERING forges a pass (the board is inside the trust boundary) — pinned as current behaviour", () => {
		const result = runDevTestGraderBaseline();
		const tampering = result.vectors.find((v) => v.id === "state_tampering");
		expect(tampering?.score).toBe(100);
		expect(tampering?.forged).toBe(true);
		expect(result.anyForged).toBe(true);
	});

	it("feeds assessGraderIntegrity a NON-void input: null correct, discrimination pending a real-agent run", () => {
		const result = runDevTestGraderBaseline();
		const verdict = assessGraderIntegrity({
			nullAgent: result.nullAgentScore,
			randomAgent: result.randomAgentScore,
			realAgent: null,
		});
		// The null agent scored 0, so the grader is NOT trivially forgeable via the null vector; without a real-agent
		// score the discriminating gap is unmeasured, so `indeterminate` — but crucially not `allNumbersVoid`.
		expect(verdict.verdict).toBe("indeterminate");
		expect(verdict.allNumbersVoid).toBe(false);
	});
});
