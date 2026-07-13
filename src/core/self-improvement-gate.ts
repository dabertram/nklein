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

import { type AgentLedgerEvent, type AgentTransitionEvent, buildTransitionEvent } from "./agent-attempt-ledger.js";
import { compareLedgerReplayDeterminism, type ReplayEventView } from "./ledger-replay-determinism.js";

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

// ---------------------------------------------------------------------------
// F1.25 — the effectful pipeline's SIGNAL COLLECTION + card identity (the gate above only classifies).
// ---------------------------------------------------------------------------

/** A self-improvement card is identified by its dogfood plan slug (the §5.AF dogfood engine's naming). */
export function isSelfImprovementPlanSlug(planSlug: string | null | undefined): boolean {
	return typeof planSlug === "string" && planSlug.startsWith("dogfood-");
}

export interface CollectSelfImprovementSignalsInput {
	/** The delivered result's ACTUAL changed files (the coverage-delta basis). */
	changedFiles: readonly string[];
	/** The FRESH full-suite acceptance verdict at the delivery seam. */
	fullSuitePassed: boolean;
	/** Deterministic replay/dev-test verdict; null = not run (a blocker — honest fail-closed). */
	replayEvalPass?: boolean | null;
	/** Taint labels the producing session accumulated (F1.21 terminal attempt record). */
	taintLabels: readonly string[];
	/** Whether the result violated its work-package bounds (F1.9b) — a capability red flag. */
	hadBoundaryViolations: boolean;
	/** Human decisions, when captured; absent = pending (a blocker). */
	humanReviewApproved?: boolean | null;
	humanMergeApproved?: boolean;
}

/**
 * Map the delivery seam's REAL evidence into the M4 gate's signals:
 *  - coverage delta = the patch touches at least one test file (a fix with no test is unproven);
 *  - the automated taint/capability check passes only when the session accumulated NO untrusted taint AND the
 *    result stayed inside its work-package bounds;
 *  - human review/merge approvals default to pending/missing — auto-delivery can never satisfy them, which is
 *    exactly M4's "never self-merges unsupervised" (the operator's reviewed MANUAL merge is the approval channel).
 */
export function collectSelfImprovementSignals(input: CollectSelfImprovementSignalsInput): SelfImprovementSignals {
	const touchesTests = input.changedFiles.some((path) => {
		const normalized = path.replace(/\\/g, "/");
		return /(^|\/)test(s)?\//.test(normalized) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized);
	});
	return {
		protectedTestsPass: input.fullSuitePassed,
		newTestCoverageAdded: touchesTests,
		replayEvalPass: input.replayEvalPass ?? null,
		securityCheckPass: input.taintLabels.length === 0 && !input.hadBoundaryViolations,
		humanReviewApproved: input.humanReviewApproved ?? null,
		humanMergeApproved: input.humanMergeApproved ?? false,
	};
}

// ---------------------------------------------------------------------------
// F1.26 — deterministic replay EVALUATION for a self-improvement patch, retained in the ledger.
// ---------------------------------------------------------------------------

export interface SelfImprovementReplayEvaluation {
	pass: boolean;
	divergenceIndex: number | null;
	summary: string;
}

/**
 * Evaluate a self-improvement proposal against its BASELINE fixtures: the captured (pre-patch fixture) run's
 * ledger vs the replayed (patched-tree) run's ledger, compared with the §5.AF determinism primitive. A
 * deterministic replay (same canonical state) passes; a drift fails with the first divergence localized.
 */
export function evaluateSelfImprovementReplay(input: {
	captured: readonly ReplayEventView[];
	replayed: readonly ReplayEventView[];
}): SelfImprovementReplayEvaluation {
	const report = compareLedgerReplayDeterminism(input.captured, input.replayed);
	if (report.deterministic) {
		return {
			pass: true,
			divergenceIndex: null,
			summary: `replay deterministic (${report.capturedCount} captured / ${report.replayedCount} replayed events, same canonical state)`,
		};
	}
	const divergence = report.firstDivergence;
	return {
		pass: false,
		divergenceIndex: divergence?.index ?? null,
		summary: divergence
			? `replay diverged at causal index ${divergence.index} (${divergence.kind})`
			: "replay state fingerprints differ",
	};
}

const REPLAY_EVAL_DECISION = "replay_eval";
const REPLAY_EVAL_PASS = "replay_eval_pass";
const REPLAY_EVAL_FAIL = "replay_eval_fail";

/** Retain the evaluation in the ledger — the M4 gate reads it back via {@link readRetainedReplayEvalVerdict}. */
export function buildReplayEvalRetentionEvent(input: {
	workflowId: string;
	taskId: string;
	workspacePathHash: string;
	evaluation: SelfImprovementReplayEvaluation;
	recordedAt?: number;
}): AgentTransitionEvent {
	return buildTransitionEvent({
		workflowId: input.workflowId,
		taskId: input.taskId,
		workspacePathHash: input.workspacePathHash,
		from: "review",
		to: input.evaluation.pass ? REPLAY_EVAL_PASS : REPLAY_EVAL_FAIL,
		reason: input.evaluation.summary.slice(0, 900),
		controllerDecision: REPLAY_EVAL_DECISION,
		...(input.recordedAt !== undefined ? { recordedAt: input.recordedAt } : {}),
	});
}

/** The task's LATEST retained replay-eval verdict from the ledger, or null when none was ever retained. */
export function readRetainedReplayEvalVerdict(events: readonly AgentLedgerEvent[], taskId: string): boolean | null {
	const retained = events
		.filter(
			(event): event is AgentTransitionEvent =>
				event.kind === "transition" &&
				event.taskId === taskId &&
				event.controllerDecision === REPLAY_EVAL_DECISION &&
				(event.to === REPLAY_EVAL_PASS || event.to === REPLAY_EVAL_FAIL),
		)
		.sort((left, right) => left.recordedAt - right.recordedAt)
		.at(-1);
	if (!retained) {
		return null;
	}
	return retained.to === REPLAY_EVAL_PASS;
}
