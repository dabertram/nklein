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
import { selectAttempts } from "./agent-ledger-selectors";

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
