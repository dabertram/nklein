import { describe, expect, it } from "vitest";
import {
	type AttemptProgressSnapshot,
	assessAttemptProgress,
	consecutiveNoProgressAttempts,
	hadProgressAcrossAttempts,
} from "../../../src/core/attempt-progress-tracker";

/** A snapshot builder — only `outcome` is required; every metric defaults to absent (unknown, never a phantom move). */
function snap(
	outcome: AttemptProgressSnapshot["outcome"],
	rest: Partial<AttemptProgressSnapshot> = {},
): AttemptProgressSnapshot {
	return { outcome, ...rest };
}

describe("assessAttemptProgress", () => {
	it("is a plateau when nothing measurable changes", () => {
		const verdict = assessAttemptProgress(snap("no_tool_call"), snap("no_tool_call"));
		expect(verdict.plateaued).toBe(true);
		expect(verdict.progressed).toBe(false);
		expect(verdict.regressed).toBe(false);
		expect(verdict.improvedDimensions).toEqual([]);
		expect(verdict.regressedDimensions).toEqual([]);
		expect(verdict.reason).toMatch(/plateau/i);
	});

	it("reports clean progress when the outcome moves toward success", () => {
		// no_tool_call (the model didn't try) → malformed (a call-shaped attempt landed, one recovery rung away).
		const verdict = assessAttemptProgress(snap("no_tool_call"), snap("malformed"));
		expect(verdict.progressed).toBe(true);
		expect(verdict.regressed).toBe(false);
		expect(verdict.plateaued).toBe(false);
		expect(verdict.improvedDimensions).toEqual(["outcome"]);
		expect(verdict.reason).toMatch(/progressed/i);
	});

	it("reaching success from any failure is progress on the outcome axis", () => {
		expect(assessAttemptProgress(snap("timeout"), snap("success")).progressed).toBe(true);
		expect(assessAttemptProgress(snap("other_failure"), snap("success")).improvedDimensions).toContain("outcome");
	});

	it("reports regression when the outcome slides back toward the floor", () => {
		const verdict = assessAttemptProgress(snap("narrated"), snap("other_failure"));
		expect(verdict.regressed).toBe(true);
		expect(verdict.progressed).toBe(false);
		expect(verdict.regressedDimensions).toEqual(["outcome"]);
		expect(verdict.reason).toMatch(/regressed/i);
	});

	it("counts more tool calls as forward progress", () => {
		const verdict = assessAttemptProgress(
			snap("no_tool_call", { toolCallsEmitted: 0 }),
			snap("malformed", { toolCallsEmitted: 1 }),
		);
		expect(verdict.progressed).toBe(true);
		expect(verdict.improvedDimensions).toEqual(["outcome", "tool_calls"]);
	});

	it("catches the repeated-same-call thrash: tool calls rise but DISTINCT tools stay flat is NOT clean progress", () => {
		// A weak model re-emits the same call every turn: toolCallsEmitted climbs, distinctToolsExercised does not.
		const verdict = assessAttemptProgress(
			snap("narrated", { toolCallsEmitted: 2, distinctToolsExercised: 1 }),
			snap("narrated", { toolCallsEmitted: 3, distinctToolsExercised: 1 }),
		);
		// tool_calls improved but nothing else — still counts as an improvement dimension (honest), yet a caller
		// watching distinct_tools sees it flat. It is progress on tool_calls only; distinct tools did not move.
		expect(verdict.improvedDimensions).toEqual(["tool_calls"]);
		expect(verdict.regressedDimensions).toEqual([]);
	});

	it("advancing through a chain (more distinct tools) is progress even at the same outcome kind", () => {
		const verdict = assessAttemptProgress(
			snap("success", { distinctToolsExercised: 1, checksPassed: 1 }),
			snap("success", { distinctToolsExercised: 2, checksPassed: 2 }),
		);
		expect(verdict.progressed).toBe(true);
		expect(verdict.improvedDimensions).toEqual(["distinct_tools", "checks_passed"]);
	});

	it("more usable output alone counts as progress when nothing else is tracked", () => {
		const verdict = assessAttemptProgress(
			snap("loop", { usableOutputBytes: 40 }),
			snap("loop", { usableOutputBytes: 120 }),
		);
		expect(verdict.progressed).toBe(true);
		expect(verdict.improvedDimensions).toEqual(["usable_output"]);
	});

	it("a mixed step (one axis up, another down) is neither clean progress nor a pure regression", () => {
		const verdict = assessAttemptProgress(
			snap("malformed", { toolCallsEmitted: 2, checksPassed: 3 }),
			snap("malformed", { toolCallsEmitted: 3, checksPassed: 1 }),
		);
		expect(verdict.progressed).toBe(false);
		expect(verdict.regressed).toBe(true);
		expect(verdict.improvedDimensions).toEqual(["tool_calls"]);
		expect(verdict.regressedDimensions).toEqual(["checks_passed"]);
		expect(verdict.reason).toMatch(/mixed/i);
	});

	it("ignores metrics missing on either side (no phantom moves)", () => {
		// current adds checksPassed the previous snapshot never had → not a comparison, so still a plateau.
		const verdict = assessAttemptProgress(snap("no_tool_call"), snap("no_tool_call", { checksPassed: 5 }));
		expect(verdict.plateaued).toBe(true);
		expect(verdict.improvedDimensions).toEqual([]);
	});

	it("reports improved dimensions in the canonical order regardless of input", () => {
		const verdict = assessAttemptProgress(
			snap("timeout", { toolCallsEmitted: 0, distinctToolsExercised: 0, checksPassed: 0, usableOutputBytes: 0 }),
			snap("success", { toolCallsEmitted: 4, distinctToolsExercised: 4, checksPassed: 4, usableOutputBytes: 500 }),
		);
		expect(verdict.improvedDimensions).toEqual([
			"outcome",
			"tool_calls",
			"distinct_tools",
			"checks_passed",
			"usable_output",
		]);
		expect(verdict.progressed).toBe(true);
	});

	it("echoes the current attempt's strategy (null for baseline)", () => {
		expect(
			assessAttemptProgress(snap("no_tool_call"), snap("no_tool_call", { strategy: "constrained_schema" })).strategy,
		).toBe("constrained_schema");
		expect(assessAttemptProgress(snap("no_tool_call"), snap("no_tool_call")).strategy).toBeNull();
	});

	it("treats the two terminal-ish recoverable kinds (narrated / malformed) as the same rank (a change, not movement)", () => {
		const verdict = assessAttemptProgress(snap("narrated"), snap("malformed"));
		expect(verdict.plateaued).toBe(true);
		expect(verdict.progressed).toBe(false);
		expect(verdict.regressed).toBe(false);
	});
});

describe("hadProgressAcrossAttempts", () => {
	it("is false for an empty or single-snapshot chain (no comparison to make)", () => {
		expect(hadProgressAcrossAttempts([])).toBe(false);
		expect(hadProgressAcrossAttempts([snap("no_tool_call")])).toBe(false);
	});

	it("is true when any consecutive step made clean forward progress", () => {
		const chain = [
			snap("no_tool_call", { toolCallsEmitted: 0 }),
			snap("no_tool_call", { toolCallsEmitted: 0 }),
			snap("malformed", { toolCallsEmitted: 1 }),
		];
		expect(hadProgressAcrossAttempts(chain)).toBe(true);
	});

	it("is false when every step plateaus (the model is spinning in place)", () => {
		const chain = [snap("no_tool_call"), snap("no_tool_call"), snap("no_tool_call")];
		expect(hadProgressAcrossAttempts(chain)).toBe(false);
	});

	it("does not count a mixed (up-and-down) step as progress", () => {
		const chain = [
			snap("malformed", { toolCallsEmitted: 2, checksPassed: 3 }),
			snap("malformed", { toolCallsEmitted: 3, checksPassed: 1 }),
		];
		expect(hadProgressAcrossAttempts(chain)).toBe(false);
	});
});

describe("consecutiveNoProgressAttempts", () => {
	it("is 0 for a chain too short to compare", () => {
		expect(consecutiveNoProgressAttempts([])).toBe(0);
		expect(consecutiveNoProgressAttempts([snap("loop")])).toBe(0);
	});

	it("counts the trailing run of non-progress steps", () => {
		// step1→2 progressed, then 2→3 and 3→4 plateaued → trailing no-progress streak of 2.
		const chain = [
			snap("no_tool_call", { toolCallsEmitted: 0 }),
			snap("malformed", { toolCallsEmitted: 1 }),
			snap("malformed", { toolCallsEmitted: 1 }),
			snap("malformed", { toolCallsEmitted: 1 }),
		];
		expect(consecutiveNoProgressAttempts(chain)).toBe(2);
	});

	it("resets to 0 when the most recent step made progress", () => {
		const chain = [
			snap("no_tool_call", { toolCallsEmitted: 0 }),
			snap("no_tool_call", { toolCallsEmitted: 0 }),
			snap("malformed", { toolCallsEmitted: 1 }),
		];
		expect(consecutiveNoProgressAttempts(chain)).toBe(0);
	});

	it("counts a regression toward the floor as a non-progress step", () => {
		const chain = [snap("narrated"), snap("no_tool_call"), snap("other_failure")];
		expect(consecutiveNoProgressAttempts(chain)).toBe(2);
	});

	it("counts the whole chain when nothing ever progressed", () => {
		const chain = [snap("loop"), snap("loop"), snap("loop"), snap("loop")];
		expect(consecutiveNoProgressAttempts(chain)).toBe(3);
	});
});
