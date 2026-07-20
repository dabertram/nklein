import { describe, expect, it } from "vitest";
import { evaluateHiddenSplits, summarizeRepeatRuns } from "../../src/core/diagnostic-oracles";

/**
 * P20.2 / diagnostic-oracles wire — the diagnosis the `dev diagnose` command surfaces. The load-bearing property
 * is that only the unambiguous success is a pass: every failure mode AND the no-fail-to-pass labelling bug are
 * distinguished, so a green board over a fixture that measures nothing does not read as success.
 */

describe("dev diagnose verdicts", () => {
	it("names WHICH failure mode occurred, not just red", () => {
		expect(
			evaluateHiddenSplits({
				failToPass: [{ id: "t1", passed: false }],
				passToPass: [{ id: "r1", passed: true }],
			}).outcome,
		).toBe("behavior_missing");
		expect(
			evaluateHiddenSplits({
				failToPass: [{ id: "t1", passed: true }],
				passToPass: [{ id: "r1", passed: false }],
			}).outcome,
		).toBe("regression_introduced");
	});

	it("treats NO fail_to_pass tests as inconclusive, never a pass — a fixture that measures nothing", () => {
		expect(evaluateHiddenSplits({ failToPass: [], passToPass: [{ id: "r1", passed: true }] }).outcome).toBe(
			"inconclusive_no_fail_to_pass",
		);
	});

	it("flags repeats that DISAGREE as flaky, distinct from reliable fail", () => {
		expect(summarizeRepeatRuns([{ passed: true }, { passed: false }]).flaky).toBe(true);
		expect(summarizeRepeatRuns([{ passed: false }, { passed: false }]).flaky).toBe(false);
	});
});
