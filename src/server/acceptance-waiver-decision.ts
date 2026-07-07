/**
 * Acceptance base-red waiver decision (todo §5.U — pure predicates lifted out of `finalizeHeadlessAutoReviewTask` in
 * runtime-server.ts). Encodes the #39 "scope-vs-acceptance trap" rule (runs 32/35/36/38, run19's base-red lesson): when
 * a card's acceptance command fails on the DELIVERED tree, sample it once on the BASE tree — an identical baseline
 * failure means the breakage predates this card (broken infra / a sibling's debt) that the worker can never fix inside
 * its declared file scope, so the delivery is WAIVED and the reviewer's verdict alone gates it. Pure — no sandbox run,
 * no I/O — so the rule is unit-testable apart from the (expensive, conditional) sandbox acceptance runs it gates.
 */

/** The minimal shape of a sandbox acceptance result this decision reads. */
export interface AcceptanceResultLike {
	present?: boolean | null;
	passed?: boolean | null;
}

/**
 * True iff an acceptance run actually RAN (`present`) and FAILED (`!passed`). Used both to gate the (expensive) base-tree
 * baseline sample and, applied to that baseline, to confirm a pre-existing breakage. A missing/absent run is not a
 * failure (fail-closed elsewhere handles the no-evidence case; this predicate is specifically "ran and failed").
 */
export function acceptancePresentAndFailed<T extends AcceptanceResultLike>(
	result: T | null | undefined,
): result is T & { present: true; passed: false } {
	return result?.present === true && result.passed === false;
}

/**
 * True iff the acceptance failure should be WAIVED as pre-existing: the delivered-tree run failed AND the same command
 * fails identically on the base tree. When true, the caller marks acceptance passed and lets the review verdict gate
 * delivery (a failure NOT present at baseline stays the worker's to fix).
 */
export function shouldWaiveAcceptanceAsPreexisting(
	acceptance: AcceptanceResultLike | null | undefined,
	baseline: AcceptanceResultLike | null | undefined,
): boolean {
	return acceptancePresentAndFailed(acceptance) && acceptancePresentAndFailed(baseline);
}
