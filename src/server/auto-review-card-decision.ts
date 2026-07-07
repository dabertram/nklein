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
 * True iff a card opts into headless auto-completion: auto-review enabled AND in `commit` mode (the default when unset).
 * The single source of truth for "auto-completable", shared by {@link decideAutoReviewCardAction} (the per-card
 * finalize classification) and {@link selectHeadlessAutoReviewReconcileCandidates} (the boot/reconcile sweep).
 */
export function isAutoReviewCommitCard(card: AutoReviewCommitCardFields): boolean {
	return card.autoReviewEnabled === true && (card.autoReviewMode ?? "commit") === "commit";
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
