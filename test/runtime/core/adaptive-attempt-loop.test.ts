import { describe, expect, it } from "vitest";
import {
	type AdaptiveAttemptResult,
	classifyTurnOutcome,
	runAdaptiveAttemptLoop,
} from "../../../src/core/adaptive-attempt-loop";
import { emptyModelBehaviorProfile, type ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import type { RetryStrategy } from "../../../src/core/retry-policy";

describe("classifyTurnOutcome", () => {
	it("is a success whenever a tool call was emitted, regardless of surrounding prose", () => {
		expect(classifyTurnOutcome({ toolCallsEmitted: 1, toolExpected: true, narratedCall: true, looped: true })).toBe(
			"success",
		);
	});

	it("maps the no-call failure modes by precedence (timeout → loop → malformed → narrated → no_tool_call)", () => {
		const base = { toolCallsEmitted: 0, toolExpected: true };
		expect(classifyTurnOutcome({ ...base, timedOut: true, looped: true })).toBe("timeout");
		expect(classifyTurnOutcome({ ...base, looped: true, malformed: true })).toBe("loop");
		expect(classifyTurnOutcome({ ...base, malformed: true, narratedCall: true })).toBe("malformed");
		expect(classifyTurnOutcome({ ...base, narratedCall: true })).toBe("narrated");
		expect(classifyTurnOutcome(base)).toBe("no_tool_call");
	});

	it("treats a no-call turn as a legitimate success when no tool was expected (a plain answer)", () => {
		expect(classifyTurnOutcome({ toolCallsEmitted: 0, toolExpected: false })).toBe("success");
	});
});

describe("runAdaptiveAttemptLoop", () => {
	const profile = () => emptyModelBehaviorProfile("m", 0);

	function scriptedAttempts(outcomes: ModelOutcomeKind[]): {
		runAttempt: (s: RetryStrategy | null, note: string) => Promise<AdaptiveAttemptResult<string>>;
		calls: { strategy: RetryStrategy | null; note: string }[];
	} {
		const calls: { strategy: RetryStrategy | null; note: string }[] = [];
		let index = 0;
		const runAttempt = async (strategy: RetryStrategy | null, note: string) => {
			calls.push({ strategy, note });
			const outcome = outcomes[Math.min(index, outcomes.length - 1)];
			index += 1;
			return { result: `attempt-${index}-${outcome}`, outcome };
		};
		return { runAttempt, calls };
	}

	it("returns immediately on a first-attempt success (no ladder, no capsules)", async () => {
		const { runAttempt, calls } = scriptedAttempts(["success"]);
		const out = await runAdaptiveAttemptLoop({ profile: profile(), runAttempt });
		expect(out.outcome).toBe("success");
		expect(out.attempts).toBe(1);
		expect(out.strategiesTried).toEqual([]);
		expect(out.capsules).toEqual([]);
		expect(out.parkedReason).toBeNull();
		expect(calls).toHaveLength(1);
		expect(calls[0].strategy).toBeNull();
	});

	it("fires ladder rungs in the per-outcome order, skipping tried ones, until one succeeds", async () => {
		// no_tool_call ladder: reduced_tool_set → constrained_schema → … ; the 3rd attempt (constrained) succeeds.
		const { runAttempt } = scriptedAttempts(["no_tool_call", "no_tool_call", "success"]);
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			retryBudgetOptions: { minBudget: 6 },
		});
		expect(out.outcome).toBe("success");
		expect(out.attempts).toBe(3);
		expect(out.strategiesTried).toEqual(["reduced_tool_set", "constrained_schema"]);
		// One capsule for the failed `reduced_tool_set` rung; the successful one is not capsuled.
		expect(out.capsules.map((c) => c.strategy)).toEqual(["reduced_tool_set"]);
		expect(out.parkedReason).toBeNull();
	});

	it("carries the accumulated do-not-repeat note forward once prior rungs have failed", async () => {
		const { runAttempt, calls } = scriptedAttempts(["no_tool_call", "no_tool_call", "success"]);
		await runAdaptiveAttemptLoop({ profile: profile(), runAttempt, retryBudgetOptions: { minBudget: 6 } });
		expect(calls[0].note).toBe(""); // baseline attempt has no prior context
		expect(calls[1].note).toBe(""); // no capsules yet when planning rung #1
		expect(calls[2].note).toContain("reduced_tool_set"); // capsule from rung #1 is now carried
	});

	it("parks with the budget reason and returns the best partial when the budget is exhausted", async () => {
		// A budget of 1 means: after the first failure, the brain parks (attemptsSoFar already ≥ budget).
		const { runAttempt } = scriptedAttempts(["other_failure"]);
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			retryBudgetOptions: { minBudget: 1 },
		});
		expect(out.outcome).toBe("other_failure");
		expect(out.parkedReason).toMatch(/budget/i);
		expect(out.result).toContain("other_failure"); // best partial still returned
	});

	it("respects the hard maxAttempts safety cap even with a generous budget", async () => {
		const { runAttempt } = scriptedAttempts(["other_failure"]); // never succeeds
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			retryBudgetOptions: { minBudget: 99 },
			maxAttempts: 3,
		});
		expect(out.attempts).toBe(3);
		expect(out.parkedReason).toMatch(/cap/i);
	});

	it("parks when every relevant un-tried rung is exhausted", async () => {
		// malformed ladder is short: constrained_schema → prompt_variant → best_of_n; all fail → park (no untried rung).
		const { runAttempt } = scriptedAttempts(["malformed"]);
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			retryBudgetOptions: { minBudget: 20 },
		});
		expect(out.outcome).toBe("malformed");
		expect(out.strategiesTried).toEqual(["constrained_schema", "prompt_variant", "best_of_n"]);
		expect(out.parkedReason).toMatch(/no untried/i);
	});
});
