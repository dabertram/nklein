/**
 * F12.36 deterministic-verification-FIRST acceptance gate — PURE core.
 *
 * An LLM reviewer reading a diff whose tests/typecheck/lint are RED wastes its judgment on work that a machine
 * already rejected — and small local reviewers often wave red work through anyway. This gate orders the pipeline:
 * deterministic checks first; any red check SHORT-CIRCUITS the LLM review into a deterministic `request_changes`
 * carrying the machine's own failure summary (the repair prompt the worker actually needs), spending zero reviewer
 * tokens. All-green (or nothing-to-run) proceeds to the human-style review, which then judges QUALITY rather than
 * re-discovering red checks. Plugs into the existing `preReviewVerdict` seam. Pure + deterministic.
 */

export interface DeterministicCheckResult {
	/** "acceptance", "typecheck", "lint", "build", "tests" — whatever the caller ran. */
	readonly name: string;
	/** null = the check could not run (missing command) — treated as not-a-signal, never as red. */
	readonly passed: boolean | null;
	/** Short machine output for the repair prompt (first failing lines, never full logs). */
	readonly detail: string | null;
}

export type VerificationFirstDecision =
	| { readonly action: "proceed"; readonly note: string }
	| {
			readonly action: "deterministic_bounce";
			readonly submission: {
				verdict: "request_changes";
				summary: string;
				feedback: string;
				insight: null;
			};
	  };

/**
 * Decide the review path from the deterministic results. Red checks bounce with a repair-oriented feedback listing
 * EVERY failing check (one bounce carrying all of them beats serial single-failure rounds); green or no-signal
 * proceeds — the absence of checks is the reviewer's context, not a machine verdict.
 */
export function decideVerificationFirst(checks: readonly DeterministicCheckResult[]): VerificationFirstDecision {
	const failed = checks.filter((check) => check.passed === false);
	if (failed.length === 0) {
		const ran = checks.filter((check) => check.passed === true).length;
		return {
			action: "proceed",
			note:
				ran > 0
					? `${ran} deterministic check(s) green — the reviewer judges quality, not red checks.`
					: "no deterministic checks ran — the reviewer judges unaided.",
		};
	}
	const lines = failed.map(
		(check) => `- ${check.name} FAILED${check.detail ? `: ${check.detail.slice(0, 300)}` : ""}`,
	);
	return {
		action: "deterministic_bounce",
		submission: {
			verdict: "request_changes",
			summary: `${failed.length} deterministic check(s) failed — fix these before a reviewer looks at quality.`,
			feedback: [
				"The machine checks rejected this delivery; no reviewer judgment was spent. Fix each failure, re-run the checks locally, then resubmit:",
				...lines,
			].join("\n"),
			insight: null,
		},
	};
}
