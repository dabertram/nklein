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
