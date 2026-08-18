/**
 * #37 (dsh take #2 consumer, observe-first): on a review BOUNCE, would forking the worker session at its
 * last safe step boundary give a second retry candidate — a cheaper best-of-N arm than the ::spec
 * full-restart mirror? This is the PURE eligibility decision; the runtime records it as an observation
 * (`bounce_fork_retry_observed`) on every bounce, and only a later, evidence-gated flip
 * (NKLEIN_BOUNCE_FORK_RETRY, reserved) would act on it. Zero behavior change until then.
 */

export interface BounceForkRetryObservation {
	eligible: boolean;
	reason:
		| "boundary_found"
		| "no_safe_boundary"
		| "empty_transcript"
		| "no_persisted_transcript"
		| "already_escalated"
		| "spec_mirror_active";
	/** Last safe step boundary (every tool_use resolved in the prefix), when one exists. */
	boundaryIndex: number | null;
	messageCount: number;
	/** Messages the forked retry would rewind (everything after the boundary: the bounced claim's tail). */
	rewoundMessages: number;
}

export function planBounceForkRetry(input: {
	/** Persisted-transcript preview, or null when the session has no persisted transcript to fork. */
	preview: { messageCount: number; boundaryIndex: number | null } | null;
	/** The one-escalation rung already fired — that re-drive owns the retry; a fork would triple the work. */
	alreadyEscalated: boolean;
	/** A ::spec speculative mirror is active — best-of-N is already running through the restart shape. */
	specMirrorActive: boolean;
}): BounceForkRetryObservation {
	const ineligible = (
		reason: BounceForkRetryObservation["reason"],
		messageCount = input.preview?.messageCount ?? 0,
	): BounceForkRetryObservation => ({
		eligible: false,
		reason,
		boundaryIndex: null,
		messageCount,
		rewoundMessages: 0,
	});
	if (input.alreadyEscalated) {
		return ineligible("already_escalated");
	}
	if (input.specMirrorActive) {
		return ineligible("spec_mirror_active");
	}
	if (!input.preview) {
		return ineligible("no_persisted_transcript");
	}
	if (input.preview.messageCount === 0) {
		return ineligible("empty_transcript");
	}
	if (input.preview.boundaryIndex === null) {
		return ineligible("no_safe_boundary");
	}
	return {
		eligible: true,
		reason: "boundary_found",
		boundaryIndex: input.preview.boundaryIndex,
		messageCount: input.preview.messageCount,
		rewoundMessages: input.preview.messageCount - 1 - input.preview.boundaryIndex,
	};
}
