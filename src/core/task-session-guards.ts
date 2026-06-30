import type { RuntimeTaskSessionSummary } from "./api-contract";

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
