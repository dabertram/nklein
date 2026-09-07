/**
 * Auto-review card classification (todo §5.U — a pure decision lifted out of `finalizeHeadlessAutoReviewTask` in
 * runtime-server.ts). Given the board record for a task (its column + the relevant card flags), decide two things the
 * headless auto-review finalizer needs: whether the card should proceed to an auto-complete review, and whether it must
 * first be moved into the Review lane. Pure — no board mutation, no I/O — so the branchy classification is unit-testable
 * apart from the workspace-state mutation it drives.
 */

/** The card flags that decide auto-review eligibility (a subset of the board card). */
export interface AutoReviewCommitCardFields {
	autoReviewEnabled?: boolean | null;
	autoReviewMode?: string | null;
}

export interface AutoReviewCardRecord {
	columnId: string;
	card: AutoReviewCommitCardFields & {
		startInPlanMode?: boolean | null;
	};
}

/**
 * True iff a card opts into headless auto-completion: auto-review enabled AND in `commit` mode (the default when
 * unset) OR the P21.13a lower-trust `stage` mode (same headless pipeline; the DELIVERY step stages uncommitted
 * instead of merging — the finalize path branches on the mode there, not here). The single source of truth for
 * "auto-completable", shared by {@link decideAutoReviewCardAction} (the per-card finalize classification) and
 * {@link selectHeadlessAutoReviewReconcileCandidates} (the boot/reconcile sweep).
 */
export function isAutoReviewCommitCard(card: AutoReviewCommitCardFields): boolean {
	if (card.autoReviewEnabled !== true) {
		return false;
	}
	const mode = card.autoReviewMode ?? "commit";
	return mode === "commit" || mode === "stage";
}

/**
 * Select the cards a captured-auto-review reconcile pass should re-finalize: those in the in-progress or review lanes
 * that opt into auto-commit ({@link isAutoReviewCommitCard}). Pure board query — the caller checks each candidate's
 * result branch and drives the actual finalize. Generic over the card type so it stays decoupled from the board schema.
 */
export function selectHeadlessAutoReviewReconcileCandidates<C extends AutoReviewCommitCardFields>(board: {
	columns: ReadonlyArray<{ id: string; cards: ReadonlyArray<C> }>;
}): C[] {
	return board.columns
		.filter((column) => column.id === "in_progress" || column.id === "review")
		.flatMap((column) => [...column.cards])
		.filter((card) => isAutoReviewCommitCard(card));
}

export interface AutoReviewCardAction {
	/** The card is eligible for the auto-complete review path (auto-review on, commit mode). */
	shouldAutoComplete: boolean;
	/** The card must be moved into the Review lane before the review runs (it is not already there). */
	moveToReview: boolean;
}

const SKIP: AutoReviewCardAction = { shouldAutoComplete: false, moveToReview: false };

/**
 * Classify a task's card for headless auto-review finalization. A missing card, an already-`completed` card, or a
 * plan-mode card is skipped entirely (no auto-complete, no move). Otherwise the card is auto-completable iff auto-review
 * is enabled in `commit` mode; a card already in `review` stays put, any other lane is moved into review first.
 */
export function decideAutoReviewCardAction(record: AutoReviewCardRecord | undefined): AutoReviewCardAction {
	if (!record) {
		return SKIP;
	}
	if (record.columnId === "completed") {
		return SKIP;
	}
	if (record.card.startInPlanMode) {
		return SKIP;
	}
	const shouldAutoComplete = isAutoReviewCommitCard(record.card);
	if (record.columnId === "review") {
		return { shouldAutoComplete, moveToReview: false };
	}
	return { shouldAutoComplete, moveToReview: true };
}

/**
 * The observation the finalizer records when it SKIPS a review-lane card because the card opted out of
 * auto-review (N20). Skipping is correct — manual review belongs to an operator — but before this record the
 * skip was a bare `return`, and the difference between "waiting for an operator" and "review machinery dead"
 * was invisible: the N20 dead-stop produced a five-minute run with ZERO log lines, diagnosed only from board
 * archaeology. One record per hold (the caller dedups per card) makes the wait state a fact in telemetry and
 * the N18 timeline instead of an inference from silence.
 */
export function buildManualReviewHoldObservation(taskId: string): {
	signal: "custom";
	severity: "info";
	message: string;
	taskId: string;
	metadata: { category: "manual_review_hold" };
} {
	return {
		signal: "custom",
		severity: "info",
		message:
			`Card ${taskId} is in Review with auto-review OFF — holding for a MANUAL operator verdict. ` +
			"In a headless run this card will wait forever; seed it with autoReviewEnabled if that is not intended.",
		taskId,
		metadata: { category: "manual_review_hold" },
	};
}

export interface ParkedFinalizeHoldInput {
	/** The card's persisted review status at finalizer entry (`parked` is the only status that can hold). */
	reviewStatus: string | null | undefined;
	/** Worker turn generation recorded when the finalizer last parked this card; `undefined` = no in-process park. */
	parkedTurnGeneration: number | null | undefined;
	/** The worker's current turn generation. */
	currentTurnGeneration: number | null;
}

/**
 * P0.PARKEDLOOP (v31 2026-09-07): a card the review loop PARKED waits for a human or for new worker output. The
 * finalizer used to re-review it on every re-emitted `awaiting_review` summary — 2,465 identical rounds on one card
 * in one night, each re-park cancelling turns, re-probing escalation workers and re-writing the board. Hold when the
 * card is still parked AND the worker has produced no new turn since the park. An un-park (the status leaves
 * `parked`) or a new turn (the generation moves) re-admits the card; a restart forgets the generation, so the first
 * finalize after it runs once (the runner's persisted work-fingerprint hold makes that one cheap).
 */
export function shouldHoldParkedFinalize(input: ParkedFinalizeHoldInput): boolean {
	if (input.reviewStatus !== "parked" || input.parkedTurnGeneration === undefined) {
		return false;
	}
	return input.parkedTurnGeneration === input.currentTurnGeneration;
}

/** The single observation a held parked card records (the caller dedups per card until the park resolves). */
export function buildReviewParkedHoldObservation(
	taskId: string,
	detail: { round: number; parkedReason: string | null },
): {
	signal: "custom";
	severity: "info";
	message: string;
	taskId: string;
	metadata: { category: "review_parked_hold"; round: number; parkedReason: string | null };
} {
	return {
		signal: "custom",
		severity: "info",
		message:
			`Review of ${taskId} stays parked after round ${detail.round} (${detail.parkedReason ?? "parked"}): ` +
			"the work is unchanged, so it is not re-reviewed. Un-park it (runtime.unparkReview) or re-drive the worker to re-admit it.",
		taskId,
		metadata: { category: "review_parked_hold", round: detail.round, parkedReason: detail.parkedReason },
	};
}
