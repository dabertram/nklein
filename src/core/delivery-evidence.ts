import type { RuntimeTaskAcceptanceResult } from "./task-lifecycle-api-contract";
import type { TestRegressionClassification } from "./test-regression-verdict";

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
export type DeliveryReviewOutcomeType = "delivered" | "skipped" | "bounced" | "parked" | "escalated";

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
 * The signed regression delta for the {@link decideDeliveryAction} `regressionDelta` gate, derived from a FRESH
 * {@link classifyTestRegression} result: `newlyFixed − newFailures`. `>0` means the change net-fixed tests (permits
 * merge), `<0` means it introduced more failures than it fixed (blocks merge), `0` is neutral. Returns `null` (unknown)
 * when there is NO baseline classification to measure against — an unmeasured delta the gate then self-merges only at
 * the most-open tier (`allowSelfMergeOnUnknownDelta`). Pure; never fabricates a measurement from a missing baseline.
 */
export function regressionDeltaFromClassification(
	classification: TestRegressionClassification | null | undefined,
): number | null {
	if (!classification) {
		return null;
	}
	return classification.counts.newlyFixed - classification.counts.newFailures;
}

/** The minimal acceptance-run shape the command-level delta reads (mirrors `AcceptanceResultLike`). */
export interface AcceptanceRunLike {
	present?: boolean | null;
	passed?: boolean | null;
}

/**
 * A MEASURED command-level regression delta from the acceptance runs the finalize seam already collects — the
 * delivered-tree run and the (conditionally sampled) base-tree run:
 *   - delivered ran + PASSED ⇒ `0`: the card's objective check is green, no regression at command granularity.
 *   - delivered FAILED + baseline FAILED ⇒ `0`: pre-existing breakage (the #39 waiver case), not a regression.
 *   - delivered FAILED + baseline PASSED ⇒ `-1`: a real measured regression vs base (blocks merge).
 *   - anything unmeasured (no delivered run; delivered failed with no baseline sample) ⇒ `null` (unknown).
 * This closes the "regressionDelta is always null" gap that made the `more_open` delivery tier unable to EVER
 * auto-merge (it disallows self-merge on an unknown delta). Coarser than the per-test
 * {@link regressionDeltaFromClassification} — command granularity — but honest: it only reports what was run.
 */
export function regressionDeltaFromAcceptanceRuns(
	delivered: AcceptanceRunLike | null | undefined,
	baseline: AcceptanceRunLike | null | undefined,
): number | null {
	if (delivered?.present !== true) {
		return null;
	}
	if (delivered.passed === true) {
		return 0;
	}
	// Delivered ran and failed — only a sampled baseline can attribute it.
	if (baseline?.present !== true) {
		return null;
	}
	return baseline.passed === true ? -1 : 0;
}

/**
 * Should an `empty_patch` (no file changes) result be HELD in Review instead of auto-completing? A no-op result may
 * only complete — and release its dependents — on an explicit reviewer sign-off; an unreviewed empty patch is a red
 * flag (dead/errored session, bad planning), not a completion.
 */
export function shouldHoldEmptyPatchResult(input: { sandboxResult: string; reviewApproved: boolean }): boolean {
	return input.sandboxResult === "empty_patch" && !input.reviewApproved;
}

/**
 * F12.53: fold an acceptance run into the persisted per-card verification snapshot (the badge + merge-warn source).
 * Pure; the caller stamps `checkedAt`. `acceptance` null = the check could not run (sandbox unavailable) — the badge
 * shows "unverified", never a false green.
 */
export function cardVerificationFromAcceptance(
	acceptance: {
		present: boolean;
		command: string | null;
		passed: boolean | null;
		failureHint: string | null;
	} | null,
	checkedAt: number,
): {
	acceptancePresent: boolean;
	acceptancePassed: boolean | null;
	detail: string | null;
	checkedAt: number;
} {
	if (acceptance === null) {
		return {
			acceptancePresent: false,
			acceptancePassed: null,
			detail: "The acceptance check could not run.",
			checkedAt,
		};
	}
	if (!acceptance.present) {
		return { acceptancePresent: false, acceptancePassed: null, detail: "No acceptance command defined.", checkedAt };
	}
	const command = acceptance.command ?? "acceptance";
	return {
		acceptancePresent: true,
		acceptancePassed: acceptance.passed,
		detail:
			acceptance.passed === true
				? `\`${command}\` passed.`
				: `\`${command}\` ${acceptance.passed === false ? "FAILED" : "did not run"}${acceptance.failureHint ? ` — ${acceptance.failureHint}` : ""}`,
		checkedAt,
	};
}
