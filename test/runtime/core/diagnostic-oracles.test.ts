import { describe, expect, it } from "vitest";
import { evaluateHiddenSplits, summarizeRepeatRuns } from "../../../src/core/diagnostic-oracles";

describe("evaluateHiddenSplits (fail_to_pass / pass_to_pass hidden-split oracle)", () => {
	it("delivers behavior + no regressions when every fail_to_pass now passes and every pass_to_pass still passes", () => {
		const verdict = evaluateHiddenSplits({
			failToPass: [
				{ id: "adds-feature-x", passed: true },
				{ id: "handles-edge-y", passed: true },
			],
			passToPass: [{ id: "existing-flow", passed: true }],
		});
		expect(verdict.outcome).toBe("behavior_delivered_no_regressions");
		expect(verdict.failToPassFailures).toEqual([]);
		expect(verdict.passToPassFailures).toEqual([]);
	});

	it("reports behavior_missing when a fail_to_pass test still fails (requested behavior not delivered)", () => {
		const verdict = evaluateHiddenSplits({
			failToPass: [
				{ id: "adds-feature-x", passed: false },
				{ id: "handles-edge-y", passed: true },
			],
			passToPass: [{ id: "existing-flow", passed: true }],
		});
		expect(verdict.outcome).toBe("behavior_missing");
		expect(verdict.failToPassFailures).toEqual(["adds-feature-x"]);
	});

	it("reports regression_introduced when a pass_to_pass test broke, and both when both splits fail", () => {
		expect(
			evaluateHiddenSplits({
				failToPass: [{ id: "f", passed: true }],
				passToPass: [{ id: "p", passed: false }],
			}).outcome,
		).toBe("regression_introduced");
		const both = evaluateHiddenSplits({
			failToPass: [{ id: "f", passed: false }],
			passToPass: [{ id: "p", passed: false }],
		});
		expect(both.outcome).toBe("behavior_missing_and_regression");
		expect(both.passToPassFailures).toEqual(["p"]);
	});

	it("treats an empty fail_to_pass split as inconclusive (a fixture-labeling bug, not a pass)", () => {
		expect(evaluateHiddenSplits({ failToPass: [], passToPass: [{ id: "p", passed: true }] }).outcome).toBe(
			"inconclusive_no_fail_to_pass",
		);
	});
});

describe("summarizeRepeatRuns (repeat-run reliability — pass_all / pass_any / flake rate, not one-off pass/fail)", () => {
	it("summarizes a clean all-pass repeat set", () => {
		const summary = summarizeRepeatRuns([{ passed: true }, { passed: true }, { passed: true }]);
		expect(summary).toEqual({
			runs: 3,
			passes: 3,
			passRate: 1,
			passAll: true,
			passAny: true,
			flaky: false,
			terminalFailureStates: [],
		});
	});

	it("flags a mixed set as flaky with the measured pass rate and collects terminal failure states", () => {
		const summary = summarizeRepeatRuns([
			{ passed: true },
			{ passed: false, terminalState: "stagnant" },
			{ passed: true },
			{ passed: false, terminalState: "failed" },
		]);
		expect(summary.passRate).toBeCloseTo(0.5);
		expect(summary.passAll).toBe(false);
		expect(summary.passAny).toBe(true);
		expect(summary.flaky).toBe(true);
		expect(summary.terminalFailureStates).toEqual(["failed", "stagnant"]);
	});

	it("an all-fail set is NOT flaky (it is reliably failing) and an empty set summarizes to zero runs", () => {
		const allFail = summarizeRepeatRuns([{ passed: false }, { passed: false }]);
		expect(allFail.flaky).toBe(false);
		expect(allFail.passAny).toBe(false);
		const empty = summarizeRepeatRuns([]);
		expect(empty.runs).toBe(0);
		expect(empty.passAll).toBe(false);
	});
});
