import type { RuntimeTaskAcceptanceResult } from "./task-lifecycle-api-contract";

/**
 * FAIL-CLOSED delivery-gate evidence (audit 2026-07-02 W0.1). Derives the {@link decideDeliveryAction} gate inputs
 * from REAL outcomes instead of the prior hardcoded `reviewApproved:true, testsPassed:true` (which made acceptance a
 * non-gate and let skipped/errored reviews count as approval — errored/empty cards auto-merged as if cleanly done).
 *
 * Posture (product vision §5.-1 "sellable quality"; DECIDED 2026-07-02):
 * - "approved" means the reviewer actually DELIVERED a sign-off. A skipped review (disabled / no verdict / card not
 *   found) or an errored review is NOT approval — so disabling second-opinion review = manual-merge mode by design.
 * - "tests passed" means a FRESH acceptance run at the delivery seam reported present-and-passed. The worker's own
 *   claims never count (research: reward-hacking / false-complete). Absent command, failed run, or unavailable
 *   evidence all fail CLOSED.
 */

/** The subset of the second-opinion review outcome the gate cares about. */
export type DeliveryReviewOutcomeType = "delivered" | "skipped" | "bounced" | "parked";

export interface DeliveryGateEvidence {
	/** True only when the reviewer delivered an explicit sign-off. */
	reviewApproved: boolean;
	/** True only when a fresh acceptance check was present AND passed. */
	testsPassed: boolean;
	/** Human-readable reason when `testsPassed` is false (for the held-in-review log/UI). */
	testsDetail: string | null;
}

/**
 * Derive the fail-closed delivery-gate evidence. `acceptance` is the FRESH result from the delivery seam
 * (`verifyTaskAcceptanceInSandbox`), or null when the check could not run at all (no card / sandbox gone / error) —
 * null fails closed with an "unavailable" detail so the operator knows to verify manually.
 */
export function deriveDeliveryGateEvidence(input: {
	reviewOutcomeType: DeliveryReviewOutcomeType;
	acceptance: Pick<RuntimeTaskAcceptanceResult, "present" | "passed" | "exitCode"> | null;
}): DeliveryGateEvidence {
	const reviewApproved = input.reviewOutcomeType === "delivered";
	const acceptance = input.acceptance;
	const testsPassed = acceptance?.present === true && acceptance.passed === true;
	let testsDetail: string | null = null;
	if (!testsPassed) {
		testsDetail =
			acceptance === null
				? "acceptance evidence unavailable"
				: acceptance.present !== true
					? "no acceptance command on the card"
					: `acceptance failed (exit ${acceptance.exitCode ?? "?"})`;
	}
	return { reviewApproved, testsPassed, testsDetail };
}

/**
 * Should an `empty_patch` (no file changes) result be HELD in Review instead of auto-completing? A no-op result may
 * only complete — and release its dependents — on an explicit reviewer sign-off; an unreviewed empty patch is a red
 * flag (dead/errored session, bad planning), not a completion.
 */
export function shouldHoldEmptyPatchResult(input: { sandboxResult: string; reviewApproved: boolean }): boolean {
	return input.sandboxResult === "empty_patch" && !input.reviewApproved;
}
