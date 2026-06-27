import { describe, expect, it } from "vitest";
import {
	type AgentStucknessSignals,
	classifyAgentStuckness,
	shouldRequestBiggerModelConsult,
} from "../../../src/core/agent-stuckness";

function signals(overrides: Partial<AgentStucknessSignals> = {}): AgentStucknessSignals {
	return {
		recentOutcomes: [],
		distinctApproachesTried: 0,
		loopUncleared: false,
		retryBudgetExhausted: false,
		hadProgressSinceStuck: false,
		...overrides,
	};
}

describe("classifyAgentStuckness", () => {
	it("is progressing on an empty history", () => {
		expect(classifyAgentStuckness(signals())).toBe("progressing");
	});

	it("is progressing when forward progress was observed, even amid failures", () => {
		expect(
			classifyAgentStuckness(
				signals({
					recentOutcomes: ["other_failure", "loop", "other_failure"],
					distinctApproachesTried: 5,
					loopUncleared: true,
					retryBudgetExhausted: true,
					hadProgressSinceStuck: true,
				}),
			),
		).toBe("progressing");
	});

	it("is progressing when the most recent outcome is a success (streak broken)", () => {
		expect(
			classifyAgentStuckness(
				signals({ recentOutcomes: ["loop", "other_failure", "success"], distinctApproachesTried: 3 }),
			),
		).toBe("progressing");
	});

	it("treats format-only slips as transient no matter how many, even with budget burned", () => {
		expect(
			classifyAgentStuckness(
				signals({
					recentOutcomes: ["malformed", "narrated", "no_tool_call", "malformed", "narrated"],
					distinctApproachesTried: 5,
					retryBudgetExhausted: true,
				}),
			),
		).toBe("transient");
	});

	it("is hard_stuck on an uncleared loop with enough failures across enough approaches", () => {
		expect(
			classifyAgentStuckness(
				signals({
					recentOutcomes: ["loop", "loop", "loop"],
					distinctApproachesTried: 2,
					loopUncleared: true,
				}),
			),
		).toBe("hard_stuck");
	});

	it("is hard_stuck when capability failures persist across approaches with the retry budget exhausted", () => {
		expect(
			classifyAgentStuckness(
				signals({
					recentOutcomes: ["other_failure", "timeout", "other_failure"],
					distinctApproachesTried: 3,
					retryBudgetExhausted: true,
				}),
			),
		).toBe("hard_stuck");
	});

	it("stays transient when capability failures exist but not enough approaches were tried yet", () => {
		expect(
			classifyAgentStuckness(
				signals({
					recentOutcomes: ["other_failure", "other_failure", "other_failure"],
					distinctApproachesTried: 1,
					retryBudgetExhausted: true,
				}),
			),
		).toBe("transient");
	});

	it("stays transient when recovery is not yet exhausted (no loop, budget left)", () => {
		expect(
			classifyAgentStuckness(
				signals({
					recentOutcomes: ["other_failure", "timeout", "other_failure"],
					distinctApproachesTried: 3,
					loopUncleared: false,
					retryBudgetExhausted: false,
				}),
			),
		).toBe("transient");
	});

	it("respects custom thresholds", () => {
		const eager = { minFailures: 1, minApproaches: 1 };
		expect(
			classifyAgentStuckness(
				signals({ recentOutcomes: ["other_failure"], distinctApproachesTried: 1, retryBudgetExhausted: true }),
				eager,
			),
		).toBe("hard_stuck");
	});
});

describe("shouldRequestBiggerModelConsult", () => {
	it("is true only for hard_stuck", () => {
		expect(
			shouldRequestBiggerModelConsult(
				signals({ recentOutcomes: ["loop", "loop", "loop"], distinctApproachesTried: 2, loopUncleared: true }),
			),
		).toBe(true);
		expect(shouldRequestBiggerModelConsult(signals({ recentOutcomes: ["malformed"] }))).toBe(false);
		expect(shouldRequestBiggerModelConsult(signals({ hadProgressSinceStuck: true }))).toBe(false);
	});
});
