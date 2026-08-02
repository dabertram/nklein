/**
 * The consult stuck-gate's attempt counter — F3.37's `failedAttempts` input, PURE.
 *
 * ── WHY THIS IS NOT `outcome !== "success"` ──
 * The obvious predicate already exists (`buildAttemptRetryNoteFromLedger` uses it, correctly, for retry NOTES)
 * and reusing it here would MIS-GATE, measured on the live ledger 2026-08-01: 238 attempts split
 * **`aborted` 132 · `success` 89 · `other_failure` 17**. An abort is a CANCELLATION — the operator or the
 * harness withdrew the card, usually before the model did anything wrong — and `!== "success"` counts every one
 * of them. With `CONSULT_MIN_FAILED_ATTEMPTS = 2`, a card cancelled twice would admit a consult on evidence of
 * cancellation rather than of being stuck, burning a consultant turn and the per-card budget on a card nobody
 * was working on. The wrong count fires MORE often, which reads as the mechanism working — the same trap shape
 * as P15.3's join.
 *
 * ── WHAT COUNTS ──
 * Exactly the outcomes where the MODEL tried and failed: `no_tool_call`, `narrated`, `loop`, `timeout`,
 * `malformed`, `other_failure` (§5.AA `ModelOutcomeKind` minus `success` and `aborted`). `timeout` is included
 * deliberately: it is a per-attempt MODEL outcome recorded by the outcome classifier — an infrastructure retry
 * is `transient_retry` at the SCHEDULER level, a different stream that never reaches this counter. Anything
 * unrecognized (including a null/absent outcome, which the per-tool-call schema permits) does NOT count: a
 * missing classification is not evidence of failure.
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger";
import { isTransitionEvent, selectAttempts } from "./agent-ledger-selectors";

/** The attempt outcomes that mean "the model genuinely tried and failed" — the ONLY ones the stuck-gate counts. */
export const GENUINE_FAILURE_OUTCOMES: ReadonlySet<string> = new Set([
	"no_tool_call",
	"narrated",
	"loop",
	"timeout",
	"malformed",
	"other_failure",
]);

/**
 * Count a card's genuine failed attempts for `decideConsultAdmission`.
 *
 * `workflowId` is the CARD id — attempts are recorded with `workflowId = taskId` by the runtime (same exact-match
 * convention `buildAttemptRetryNoteFromLedger` uses; the session/card suffix boundary of P15.3 does not apply to
 * attempt events, which the service records under the card id itself).
 */
export function countGenuineFailedAttempts(events: readonly AgentLedgerEvent[], workflowId: string): number {
	return selectAttempts(events).filter(
		(attempt) =>
			attempt.workflowId === workflowId &&
			typeof attempt.outcome === "string" &&
			GENUINE_FAILURE_OUTCOMES.has(attempt.outcome),
	).length;
}

/**
 * The workflow-kernel command a review REJECTION dispatches; the command queue persists it verbatim as the
 * transition's `reason` (workflow-command-queue.ts appends `reason: command.kind`).
 */
export const REVIEW_REJECTION_REASON = "review_changes_requested";

/**
 * Count a card's review-rejection BOUNCES — the "bounced" half of `ConsultAdmissionInput`'s documented
 * "Failed/bounced attempts", and live-found MISSING on the first F3.37 pilot (2026-08-02): a weak model on a
 * real drain completed its attempt protocol-correctly (`outcome: "success"`, 18/18 tool results) and entered
 * review — so a card that loops work→review-reject→rework, the CENTRAL "confidently wrong" case a stronger
 * consultant exists for, would never have armed the gate on protocol failures alone.
 *
 * The two streams are DISJOINT by construction, so adding them cannot double-count one stuck event: a
 * protocol-failed attempt records a genuine failure outcome and never reaches review; a rejected attempt records
 * `outcome: "success"` plus exactly one `review_changes_requested` transition. Parked/escalated/blocked review
 * outcomes are deliberately NOT counted: parked awaits an operator (nobody re-drives, a consult would burn its
 * budget unheard) and escalation is the HARNESS already switching models — counting it would double-remedy.
 * Transitions match on the event's `taskId` (the workflow command queue records the CARD id there; `workflowId`
 * on those rows is the kernel workflow's own id — the P15.3 namespace lesson, applied at write-shape level).
 */
export function countReviewRejectionBounces(events: readonly AgentLedgerEvent[], cardTaskId: string): number {
	return events.filter(
		(event) => isTransitionEvent(event) && event.taskId === cardTaskId && event.reason === REVIEW_REJECTION_REASON,
	).length;
}

/**
 * The stuck-gate's actual input: genuine protocol failures PLUS review-rejection bounces. This is what
 * `decideConsultAdmission` should receive as `failedAttempts` — the core's own field doc says "Failed/bounced".
 */
export function countConsultStuckEvidence(events: readonly AgentLedgerEvent[], cardTaskId: string): number {
	return countGenuineFailedAttempts(events, cardTaskId) + countReviewRejectionBounces(events, cardTaskId);
}
