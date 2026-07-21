import { describe, expect, it } from "vitest";
import {
	type AdaptiveAttemptResult,
	classifyTurnOutcome,
	runAdaptiveAttemptLoop,
} from "../../../src/core/adaptive-attempt-loop";
import { emptyModelBehaviorProfile, type ModelOutcomeKind } from "../../../src/core/model-behavior-profile";
import type { RetryStrategy } from "../../../src/core/retry-policy";
import {
	emptyStrategyEffectivenessLedger,
	recordStrategyOutcome,
} from "../../../src/core/strategy-effectiveness-ledger";

describe("classifyTurnOutcome", () => {
	it("is a success whenever a tool call was emitted, regardless of surrounding prose", () => {
		expect(classifyTurnOutcome({ toolCallsEmitted: 1, toolExpected: true, narratedCall: true, looped: true })).toBe(
			"success",
		);
	});

	it("maps the no-call failure modes by precedence (timeout → truncated → loop → malformed → narrated → no_tool_call)", () => {
		const base = { toolCallsEmitted: 0, toolExpected: true };
		expect(classifyTurnOutcome({ ...base, timedOut: true, truncated: true })).toBe("timeout");
		// A budget truncation (finish:length) is a transient `aborted` (re-run with more budget), NOT a no_tool_call.
		expect(classifyTurnOutcome({ ...base, truncated: true, looped: true })).toBe("aborted");
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
		// no_tool_call ladder: raise_token_budget → reduced_tool_set (thinking unsupported by default) → … .
		const { runAttempt } = scriptedAttempts(["no_tool_call", "no_tool_call", "success"]);
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			retryBudgetOptions: { minBudget: 6 },
		});
		expect(out.outcome).toBe("success");
		expect(out.attempts).toBe(3);
		expect(out.strategiesTried).toEqual(["raise_token_budget", "reduced_tool_set"]);
		// One capsule for the failed budget rung; the successful one is not capsuled.
		expect(out.capsules.map((c) => c.strategy)).toEqual(["raise_token_budget"]);
		expect(out.parkedReason).toBeNull();
	});

	it("carries the accumulated do-not-repeat note forward once prior rungs have failed", async () => {
		const { runAttempt, calls } = scriptedAttempts(["no_tool_call", "no_tool_call", "success"]);
		await runAdaptiveAttemptLoop({ profile: profile(), runAttempt, retryBudgetOptions: { minBudget: 6 } });
		expect(calls[0].note).toBe(""); // baseline attempt has no prior context
		expect(calls[1].note).toBe(""); // no capsules yet when planning rung #1
		expect(calls[2].note).toContain("raise_token_budget"); // capsule from rung #1 is now carried
	});

	it("runs thinking_disable after the budget rung only for a model that supports thinking control", async () => {
		const { runAttempt } = scriptedAttempts(["no_tool_call", "no_tool_call", "success"]);
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			supportsThinkingControl: true,
			retryBudgetOptions: { minBudget: 6 },
		});
		expect(out.strategiesTried).toEqual(["raise_token_budget", "thinking_disable"]);
	});

	it("counts the learned budget as retries, not total attempts", async () => {
		// A budget of 1 permits the documented one retry after the baseline, then parks.
		const { runAttempt } = scriptedAttempts(["other_failure"]);
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			retryBudgetOptions: { minBudget: 1 },
		});
		expect(out.outcome).toBe("other_failure");
		expect(out.attempts).toBe(2);
		expect(out.strategiesTried).toEqual(["same_model_retry"]);
		expect(out.parkedReason).toMatch(/budget/i);
		expect(out.result).toContain("other_failure"); // best partial still returned
	});

	it("selects only rungs the current attempt can execute", async () => {
		const calls: Array<RetryStrategy | null> = [];
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			retryBudgetOptions: { minBudget: 3 },
			runAttempt: async (strategy) => {
				calls.push(strategy);
				return {
					result: "partial",
					outcome: "no_tool_call",
					availableStrategies: ["prompt_variant"],
				};
			},
		});
		expect(calls).toEqual([null, "prompt_variant"]);
		expect(out.strategiesTried).toEqual(["prompt_variant"]);
		expect(out.parkedReason).toMatch(/no untried/i);
	});

	it("uses durable effectiveness to reorder executable rungs and reports the triggering outcome", async () => {
		let strategyLedger = emptyStrategyEffectivenessLedger("m", 0, "worker");
		for (let index = 0; index < 4; index += 1) {
			strategyLedger = recordStrategyOutcome(strategyLedger, {
				outcome: "no_tool_call",
				strategy: "reduced_tool_set",
				recovered: false,
			});
			strategyLedger = recordStrategyOutcome(strategyLedger, {
				outcome: "no_tool_call",
				strategy: "prompt_variant",
				recovered: true,
			});
		}
		const calls: Array<{ strategy: RetryStrategy | null; trigger: ModelOutcomeKind | null }> = [];
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			strategyEffectivenessLedger: strategyLedger,
			retryBudgetOptions: { minBudget: 3 },
			runAttempt: async (strategy, _note, context) => {
				calls.push({ strategy, trigger: context.triggerOutcome });
				return {
					result: strategy,
					outcome: strategy === "prompt_variant" ? "success" : "no_tool_call",
					availableStrategies: ["reduced_tool_set", "prompt_variant"],
				};
			},
		});
		expect(out.strategiesTried).toEqual(["prompt_variant"]);
		expect(calls).toEqual([
			{ strategy: null, trigger: null },
			{ strategy: "prompt_variant", trigger: "no_tool_call" },
		]);
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
		// Every malformed-output remedy fails, including endpoint and cross-model escalation, then the loop parks.
		const { runAttempt } = scriptedAttempts(["malformed"]);
		const out = await runAdaptiveAttemptLoop({
			profile: profile(),
			runAttempt,
			retryBudgetOptions: { minBudget: 20 },
		});
		expect(out.outcome).toBe("malformed");
		expect(out.strategiesTried).toEqual([
			"constrained_schema",
			"prompt_variant",
			"best_of_n",
			"alternate_endpoint",
			"cross_model_carry",
		]);
		expect(out.parkedReason).toMatch(/no untried/i);
	});
});
