import { describe, expect, it } from "vitest";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { decideNextRetryStrategy, retryLadderForOutcome } from "../../../src/core/retry-policy";

describe("decideNextRetryStrategy", () => {
	it("parks immediately on a success (nothing to retry)", () => {
		const d = decideNextRetryStrategy({
			lastOutcome: "success",
			attemptsSoFar: 1,
			retryBudget: 5,
			triedStrategies: [],
		});
		expect(d.strategy).toBe("park");
	});

	it("picks the first relevant rung for the failure mode (no_tool_call → reduced_tool_set first)", () => {
		const d = decideNextRetryStrategy({
			lastOutcome: "no_tool_call",
			attemptsSoFar: 1,
			retryBudget: 5,
			triedStrategies: [],
		});
		expect(d.strategy).toBe("reduced_tool_set");
		expect(d.reason).toContain("no_tool_call");
	});

	it("skips rungs already tried (no circles) and advances down the ladder", () => {
		const d = decideNextRetryStrategy({
			lastOutcome: "no_tool_call",
			attemptsSoFar: 2,
			retryBudget: 5,
			triedStrategies: ["reduced_tool_set", "constrained_schema"],
		});
		expect(d.strategy).toBe("alternate_endpoint");
	});

	it("parks when the learned retry budget is exhausted", () => {
		const d = decideNextRetryStrategy({
			lastOutcome: "no_tool_call",
			attemptsSoFar: 5,
			retryBudget: 5,
			triedStrategies: [],
		});
		expect(d.strategy).toBe("park");
		expect(d.reason).toMatch(/budget/i);
	});

	it("parks when every relevant rung has been tried", () => {
		const d = decideNextRetryStrategy({
			lastOutcome: "malformed",
			attemptsSoFar: 1,
			retryBudget: 9,
			triedStrategies: ["constrained_schema", "prompt_variant", "best_of_n"],
		});
		expect(d.strategy).toBe("park");
		expect(d.reason).toMatch(/no untried/i);
	});

	it("uses a sensible budget floor (always allows at least 1 attempt)", () => {
		const d = decideNextRetryStrategy({
			lastOutcome: "timeout",
			attemptsSoFar: 0,
			retryBudget: 0,
			triedStrategies: [],
		});
		expect(d.strategy).toBe("context_shrink"); // budget clamped to ≥1, attemptsSoFar 0 < 1
	});

	it("maps each failure mode to a sensible first rung", () => {
		const first = (outcome: ModelOutcomeKind) =>
			decideNextRetryStrategy({ lastOutcome: outcome, attemptsSoFar: 0, retryBudget: 9, triedStrategies: [] })
				.strategy;
		expect(first("timeout")).toBe("context_shrink");
		expect(first("loop")).toBe("same_model_retry");
		expect(first("malformed")).toBe("constrained_schema");
		expect(first("narrated")).toBe("constrained_schema");
		expect(first("other_failure")).toBe("same_model_retry");
		// A no-output `aborted` transient re-runs first (the same ask often completes given another go, §5.AA).
		expect(first("aborted")).toBe("same_model_retry");
	});

	it("re-runs an aborted transient rather than parking it (§5.AA root-cause 2026-06-28)", () => {
		const d = decideNextRetryStrategy({
			lastOutcome: "aborted",
			attemptsSoFar: 0,
			retryBudget: 3,
			triedStrategies: [],
		});
		expect(d.strategy).toBe("same_model_retry");
		expect(d.strategy).not.toBe("park");
	});
});

describe("retryLadderForOutcome", () => {
	it("treats aborted as a retryable transient (re-run first, never empty)", () => {
		const ladder = retryLadderForOutcome("aborted");
		expect(ladder[0]).toBe("same_model_retry");
		expect(ladder.length).toBeGreaterThan(0);
	});
});

describe("retryLadderForOutcome", () => {
	it("returns the priority-ordered ladder; success has none", () => {
		expect(retryLadderForOutcome("success")).toEqual([]);
		expect(retryLadderForOutcome("no_tool_call")[0]).toBe("reduced_tool_set");
		expect(retryLadderForOutcome("timeout")).toContain("decompose");
	});
});
