/**
 * §5.AW opportunistic idle-work decision (pure) — composes the approved {@link rankOpportunisticWork} priority chooser
 * with the currently-available PICKERS into a concrete decision the live idle path can act on.
 *
 * Today only the `review` picker is wired (a review-lane card needing a review has both a candidate signal and a
 * reusable dispatch — `runSecondOpinionReviewForTask`). The other four kinds (work_ahead, deliberation_seed,
 * spec_mirror, context_prep) have no producer yet, so they are simply never available; as each picker's producer lands,
 * add its candidate set to the input and to the `available` computation below — the ranker's priority order + hard veto
 * are already settled. The effectful edges (computing `hasRealQueuedWork` from board/session state, and dispatching the
 * chosen task) stay at the call site; this stays pure + total + deterministic + testable.
 */

import {
	type OpportunisticWorkKind,
	type OpportunisticWorkVerdict,
	rankOpportunisticWork,
} from "./opportunistic-work-ranker.js";

export interface OpportunisticIdleWorkInput {
	/**
	 * The HARD veto signal: true when real queued/active work exists — a queued start, an overlap-deferred card, a
	 * ready card awaiting a slot, OR a running worker session. When true, no opportunistic work runs (real work wins).
	 */
	hasRealQueuedWork: boolean;
	/** Card ids in the review lane still needing a review dispatched (empty ⇒ the `review` picker has no candidate). */
	reviewCandidateTaskIds: readonly string[];
}

export interface OpportunisticIdleWorkDecision {
	verdict: OpportunisticWorkVerdict;
	/** When `verdict.chosen === "review"`, the specific card to review (the first candidate); otherwise null. */
	reviewTaskId: string | null;
}

/**
 * The `review` picker (pure): card ids sitting in the review lane that haven't already had an idle review dispatched.
 * `alreadyDispatched` gives per-workspace idempotency so the sweep never re-reviews the same card each tick. A card
 * still in the review lane hasn't been reviewed-and-advanced, so it's a genuine candidate.
 */
export function findReviewCandidateTaskIds(
	board: { columns: readonly { id: string; cards: readonly { id: string }[] }[] },
	alreadyDispatched: ReadonlySet<string>,
): string[] {
	const reviewColumn = board.columns.find((column) => column.id === "review");
	if (!reviewColumn) {
		return [];
	}
	return reviewColumn.cards.map((card) => card.id).filter((taskId) => !alreadyDispatched.has(taskId));
}

/** Compose the ranker with the available pickers into a concrete idle-work decision. Pure. */
export function decideOpportunisticIdleWork(input: OpportunisticIdleWorkInput): OpportunisticIdleWorkDecision {
	const available: OpportunisticWorkKind[] = [];
	if (input.reviewCandidateTaskIds.length > 0) {
		available.push("review");
	}
	const verdict = rankOpportunisticWork({ hasRealQueuedWork: input.hasRealQueuedWork, available });
	return {
		verdict,
		reviewTaskId: verdict.chosen === "review" ? (input.reviewCandidateTaskIds[0] ?? null) : null,
	};
}
