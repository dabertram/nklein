import type { RuntimeTaskSessionSummary } from "./api-contract";
import { isHomeAgentSessionId } from "./home-agent-session";

/**
 * A task session summary that is awaiting review for a reason the runtime should act on: an agent hook handoff, a
 * process exit, an attention request, or an error. The single source of truth for "this summary is reviewable" —
 * shared by the runtime server (auto-review finalization) and the state hub (ready-for-review broadcast), which
 * previously each held a byte-for-byte copy (the systems-analysis pass flagged the duplication: a change to the set
 * of reviewable reasons needed two edits and could silently diverge).
 */
export function isReviewableNKleinSummary(summary: RuntimeTaskSessionSummary): boolean {
	return (
		summary.state === "awaiting_review" &&
		(summary.reviewReason === "hook" ||
			summary.reviewReason === "exit" ||
			summary.reviewReason === "attention" ||
			summary.reviewReason === "error")
	);
}

/**
 * Did a summary update transition a task INTO awaiting-review (i.e. it wasn't already there)? The pure
 * state-machine half of the sandbox-review-finalization trigger — extracted from
 * `nklein-task-session-service`'s `shouldFinalizeSandboxReview` so the transition rule is testable apart from the
 * sandbox-availability checks that gate the actual finalize. A type guard so callers narrow `next` to non-null.
 */
export function isEnteringAwaitingReview(
	previousSummary: RuntimeTaskSessionSummary,
	nextSummary: RuntimeTaskSessionSummary | null,
): nextSummary is RuntimeTaskSessionSummary {
	return (
		nextSummary !== null && previousSummary.state !== "awaiting_review" && nextSummary.state === "awaiting_review"
	);
}

/**
 * Should a summary update capture a review checkpoint? The pure decision half — a real workspace-backed (non home-agent)
 * task entering awaiting-review — extracted from `nklein-task-session-service`'s `shouldCaptureReviewCheckpoint`. It
 * shares the entering-awaiting-review transition rule with {@link isEnteringAwaitingReview} (no duplicated state check).
 * A type guard so callers narrow `next` to non-null.
 */
export function shouldCaptureReviewCheckpoint(
	previousSummary: RuntimeTaskSessionSummary,
	nextSummary: RuntimeTaskSessionSummary | null,
): nextSummary is RuntimeTaskSessionSummary {
	if (!nextSummary) {
		return false;
	}
	if (isHomeAgentSessionId(nextSummary.taskId) || !nextSummary.workspacePath) {
		return false;
	}
	return isEnteringAwaitingReview(previousSummary, nextSummary);
}

/**
 * Detect the EDGE where a session's latest hook activity just became a `credit_limit` notification — true only on the
 * transition INTO credit_limit (present now, absent on the previous summary), never on a repeat. The handler aborts the
 * run when this fires; keying on the edge (not the level) prevents re-aborting an already-credit-limited session on
 * every subsequent event. (todo §5.U — lifted from `handleTaskEvent` in nklein-task-session-service.ts.)
 */
export function didCreditLimitJustTrigger(
	previousSummary: RuntimeTaskSessionSummary,
	currentSummary: RuntimeTaskSessionSummary,
): boolean {
	return (
		currentSummary.latestHookActivity?.notificationType === "credit_limit" &&
		previousSummary.latestHookActivity?.notificationType !== "credit_limit"
	);
}
