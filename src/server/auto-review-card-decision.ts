/**
 * Auto-review card classification (todo §5.U — a pure decision lifted out of `finalizeHeadlessAutoReviewTask` in
 * runtime-server.ts). Given the board record for a task (its column + the relevant card flags), decide two things the
 * headless auto-review finalizer needs: whether the card should proceed to an auto-complete review, and whether it must
 * first be moved into the Review lane. Pure — no board mutation, no I/O — so the branchy classification is unit-testable
 * apart from the workspace-state mutation it drives.
 */

export interface AutoReviewCardRecord {
	columnId: string;
	card: {
		startInPlanMode?: boolean | null;
		autoReviewEnabled?: boolean | null;
		autoReviewMode?: string | null;
	};
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
	const shouldAutoComplete =
		record.card.autoReviewEnabled === true && (record.card.autoReviewMode ?? "commit") === "commit";
	if (record.columnId === "review") {
		return { shouldAutoComplete, moveToReview: false };
	}
	return { shouldAutoComplete, moveToReview: true };
}
