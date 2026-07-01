import { describe, expect, it } from "vitest";
import { buildFailureCapsule } from "../../../src/core/failure-capsule";
import type { ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import { emptyModelBehaviorProfile } from "../../../src/core/model-behavior-profile";
import {
	decideNextRetryStrategy,
	planNextAttempt,
	raisedTokenBudget,
	retryLadderForOutcome,
} from "../../../src/core/retry-policy";

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

describe("planNextAttempt (unified §5.AA brain)", () => {
	it("picks the next un-tried rung, carries the do-not-repeat note, and reports the learned budget", () => {
		const profile = emptyModelBehaviorProfile("m", 0); // cold → budget = min (1)
		const capsules = [
			buildFailureCapsule({ strategy: "reduced_tool_set", outcome: "no_tool_call", evidence: "still no call" }),
		];
		const plan = planNextAttempt({ lastOutcome: "no_tool_call", attemptsSoFar: 0, profile, capsules });
		// reduced_tool_set already tried → next no_tool_call rung is constrained_schema.
		expect(plan.strategy).toBe("constrained_schema");
		expect(plan.parked).toBe(false);
		expect(plan.retryBudget).toBe(1);
		expect(plan.doNotRepeatNote).toContain("reduced_tool_set");
	});

	it("parks when the learned budget is spent", () => {
		const profile = emptyModelBehaviorProfile("m", 0); // budget 1
		const plan = planNextAttempt({ lastOutcome: "no_tool_call", attemptsSoFar: 1, profile, capsules: [] });
		expect(plan.strategy).toBe("park");
		expect(plan.parked).toBe(true);
	});

	it("empty capsules ⇒ empty do-not-repeat note + the first rung", () => {
		const profile = emptyModelBehaviorProfile("m", 0);
		const plan = planNextAttempt({ lastOutcome: "malformed", attemptsSoFar: 0, profile, capsules: [] });
		expect(plan.doNotRepeatNote).toBe("");
		expect(plan.strategy).toBe("constrained_schema"); // first malformed rung
	});
});

describe("raisedTokenBudget (§5.AA truncation-recovery escalation)", () => {
	it("doubles the budget per attempt", () => {
		expect(raisedTokenBudget({ current: 1024, attempt: 1 })).toBe(2048);
		expect(raisedTokenBudget({ current: 1024, attempt: 2 })).toBe(4096);
		expect(raisedTokenBudget({ current: 1024, attempt: 3 })).toBe(8192);
	});

	it("clamps to the ceiling and never returns below the current budget", () => {
		expect(raisedTokenBudget({ current: 1024, attempt: 4, ceiling: 3000 })).toBe(3000); // 16384 → clamped
		// A ceiling below `current` still returns at least `current` (never shrink the budget on a truncation retry).
		expect(raisedTokenBudget({ current: 2048, attempt: 1, ceiling: 100 })).toBe(2048);
	});

	it("guards degenerate inputs (attempt<1 floors to 1; non-integer current is truncated)", () => {
		expect(raisedTokenBudget({ current: 1000, attempt: 0 })).toBe(2000); // attempt floored to 1 → ×2
		expect(raisedTokenBudget({ current: 1000.9, attempt: 1 })).toBe(2000); // current truncated to 1000
	});

	it("caps the growth exponent so a huge attempt count can't overflow to nonsense", () => {
		// attempt 50 would be 2**50×; the exponent is capped at 10 (×1024), then the ceiling applies.
		expect(raisedTokenBudget({ current: 1024, attempt: 50 })).toBe(1024 * 1024);
		expect(raisedTokenBudget({ current: 1024, attempt: 50, ceiling: 40000 })).toBe(40000);
	});
});
