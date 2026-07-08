/**
 * §5.AF M4 self-improvement quarantine — the SAFETY KEYSTONE: the fail-closed approval gate for an auto-generated
 * patch that would modify !Klein itself. A self-modifying agent must NEVER merge its own change on faith; a proposed
 * patch is approved ONLY when EVERY required gate passes:
 *   - protected-tests gate (#1.5): the full suite passes AND the patch adds NEW test coverage (a fix with no test is
 *     unproven — it can regress silently);
 *   - replay-eval: the patch runs the deterministic replay/dev-test suite green (no live-model flakiness in the gate);
 *   - security review (§5.Y): the automated taint/capability check AND a human security review both pass;
 *   - human approval: a human explicitly approved the merge (M4 never self-merges unsupervised).
 *
 * Fail-closed by construction: any gate that FAILS or has NOT RUN blocks approval, and the blockers are enumerated for
 * the operator. Pure + total + deterministic — the effectful pipeline (running the suites, the security scan, capturing
 * the human decision) feeds these signals in; this only classifies. Parallels the §5.AE procedural-skill "never
 * auto-activate" keystone.
 */

export interface SelfImprovementSignals {
	/** The full protected + fast suite passed on the patched tree. */
	protectedTestsPass: boolean;
	/** The patch ADDS new test coverage for the change (a fix without a test is unproven). */
	newTestCoverageAdded: boolean;
	/** The deterministic replay/dev-test suite passed. null = not yet run. */
	replayEvalPass: boolean | null;
	/** The automated §5.Y taint/capability security check passed. null = not yet run. */
	securityCheckPass: boolean | null;
	/** A human security/code review approved the change. null = not yet reviewed. */
	humanReviewApproved: boolean | null;
	/** A human explicitly approved the MERGE (M4 never self-merges unsupervised). */
	humanMergeApproved: boolean;
}

export interface SelfImprovementDecision {
	approve: boolean;
	/** Every gate that is failing or not-yet-run (empty only when approve is true). */
	blockers: string[];
	reason: string;
}

/**
 * Decide whether an auto-generated self-modifying patch may be merged. Fail-closed: approve ONLY when every required
 * gate is affirmatively satisfied; a failing OR unrun gate is a blocker. Pure + total.
 */
export function decideSelfImprovementApproval(signals: SelfImprovementSignals): SelfImprovementDecision {
	const blockers: string[] = [];
	if (!signals.protectedTestsPass) {
		blockers.push("protected/full test suite not green");
	}
	if (!signals.newTestCoverageAdded) {
		blockers.push("no new test coverage for the change (unproven fix)");
	}
	if (signals.replayEvalPass !== true) {
		blockers.push(signals.replayEvalPass === false ? "replay-eval FAILED" : "replay-eval not run");
	}
	if (signals.securityCheckPass !== true) {
		blockers.push(
			signals.securityCheckPass === false ? "automated security check FAILED" : "automated security check not run",
		);
	}
	if (signals.humanReviewApproved !== true) {
		blockers.push(
			signals.humanReviewApproved === false ? "human security review REJECTED" : "human security review pending",
		);
	}
	if (!signals.humanMergeApproved) {
		blockers.push("human merge approval missing (M4 never self-merges unsupervised)");
	}
	if (blockers.length === 0) {
		return {
			approve: true,
			blockers,
			reason:
				"All M4 gates passed (protected tests + new coverage + replay-eval + security check + human review + human merge approval) — patch may merge.",
		};
	}
	return {
		approve: false,
		blockers,
		reason: `M4 self-improvement patch BLOCKED (fail-closed) — unmet gate(s): ${blockers.join("; ")}.`,
	};
}
