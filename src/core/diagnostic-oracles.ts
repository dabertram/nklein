/**
 * Diagnostic oracles (small-LLM research pass, 2026-06-27) — the two verdict cores that upgrade the dev-test rail
 * from one-off pass/fail GATES to diagnoses:
 *
 *  1. HIDDEN TEST SPLITS: a fixture keeps `fail_to_pass` (tests that MUST flip red→green — the requested behavior)
 *     and `pass_to_pass` (tests that MUST stay green — regressions) hidden from the agent, separate from the visible
 *     developer-ergonomics acceptance split. {@link evaluateHiddenSplits} folds both splits' results into one of four
 *     diagnostic outcomes — WHICH failure mode occurred, not just "red".
 *
 *  2. REPEAT-RUN RELIABILITY: a small local model's single run is a coin flip; the rail repeats each selected task
 *     3–5× and {@link summarizeRepeatRuns} reports `pass_all` / `pass_any` / pass rate / flakiness / terminal failure
 *     states — the shape reliability decisions are made from.
 *
 * DELIBERATELY DISTINCT from the neighbours: {@link ./model-eval-stability.ts} judges whether a MODEL's graded eval
 * verdict is settled across the (model, role, difficulty) matrix; {@link ./flake-quarantine.ts} scores one TEST's
 * pass/fail history; this module diagnoses one TASK ATTEMPT (hidden splits) and one task's repeat set. Pure +
 * deterministic — results are injected; the harness wires the real test commands around it.
 */

/** One hidden test's result after the agent's change was applied. */
export interface HiddenSplitTestResult {
	id: string;
	passed: boolean;
}

export interface HiddenSplitResults {
	/** Tests that failed BEFORE the change and must pass after it — the requested behavior. */
	failToPass: readonly HiddenSplitTestResult[];
	/** Tests that passed BEFORE the change and must still pass — the regression guard. */
	passToPass: readonly HiddenSplitTestResult[];
}

export type HiddenSplitOutcome =
	/** Every fail_to_pass flipped green and every pass_to_pass stayed green — the only success. */
	| "behavior_delivered_no_regressions"
	/** Requested behavior not delivered (fail_to_pass failures), existing behavior intact. */
	| "behavior_missing"
	/** Behavior delivered but existing tests broke — the change regressed the codebase. */
	| "regression_introduced"
	/** Both splits failed — wrong AND destructive. */
	| "behavior_missing_and_regression"
	/** No fail_to_pass tests supplied: the fixture cannot measure behavior delivery (labeling bug, not a pass). */
	| "inconclusive_no_fail_to_pass";

export interface HiddenSplitVerdict {
	outcome: HiddenSplitOutcome;
	/** Ids of fail_to_pass tests still failing (sorted). */
	failToPassFailures: string[];
	/** Ids of pass_to_pass tests that broke (sorted). */
	passToPassFailures: string[];
}

export function evaluateHiddenSplits(results: HiddenSplitResults): HiddenSplitVerdict {
	const failToPassFailures = results.failToPass
		.filter((test) => !test.passed)
		.map((test) => test.id)
		.sort();
	const passToPassFailures = results.passToPass
		.filter((test) => !test.passed)
		.map((test) => test.id)
		.sort();
	if (results.failToPass.length === 0) {
		return { outcome: "inconclusive_no_fail_to_pass", failToPassFailures, passToPassFailures };
	}
	const behaviorMissing = failToPassFailures.length > 0;
	const regressed = passToPassFailures.length > 0;
	const outcome: HiddenSplitOutcome =
		behaviorMissing && regressed
			? "behavior_missing_and_regression"
			: behaviorMissing
				? "behavior_missing"
				: regressed
					? "regression_introduced"
					: "behavior_delivered_no_regressions";
	return { outcome, failToPassFailures, passToPassFailures };
}

/** One repeat run of the same task: did it pass, and if not, which terminal state did it die in? */
export interface RepeatRunResult {
	passed: boolean;
	/** Terminal-state label for a failed run (e.g. a DevTestRunOutcome like "stagnant" / "failed" / "runtime_down"). */
	terminalState?: string;
}

export interface RepeatRunSummary {
	runs: number;
	passes: number;
	/** Pass rate in [0,1]; 0 for an empty set. */
	passRate: number;
	passAll: boolean;
	passAny: boolean;
	/** Flaky = the repeats DISAGREE (some pass, some fail). All-fail is reliably failing, not flaky. */
	flaky: boolean;
	/** Distinct terminal states of the failed runs (sorted) — where the failures die, not just that they do. */
	terminalFailureStates: string[];
}

export function summarizeRepeatRuns(runs: readonly RepeatRunResult[]): RepeatRunSummary {
	const passes = runs.filter((run) => run.passed).length;
	const terminalFailureStates = [
		...new Set(runs.filter((run) => !run.passed && run.terminalState).map((run) => run.terminalState as string)),
	].sort();
	return {
		runs: runs.length,
		passes,
		passRate: runs.length === 0 ? 0 : passes / runs.length,
		passAll: runs.length > 0 && passes === runs.length,
		passAny: passes > 0,
		flaky: passes > 0 && passes < runs.length,
		terminalFailureStates,
	};
}
