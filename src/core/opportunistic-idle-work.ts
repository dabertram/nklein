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
	/**
	 * Refs of recently-written §5.AR memory notes that still need a strong-model audit (empty ⇒ the `memory_audit`
	 * picker has no candidate). A ref is anything the dispatch can resolve back to a note (e.g. `permalink`/path).
	 */
	memoryAuditNoteRefs?: readonly string[];
}

export interface OpportunisticIdleWorkDecision {
	verdict: OpportunisticWorkVerdict;
	/** When `verdict.chosen === "review"`, the specific card to review (the first candidate); otherwise null. */
	reviewTaskId: string | null;
	/** When `verdict.chosen === "memory_audit"`, the specific note ref to audit (the first candidate); otherwise null. */
	memoryAuditNoteRef: string | null;
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

/**
 * STALLED reviews (pure) — the board-liveness watchdog's review rescue: review-lane cards whose review NEVER
 * landed (no recorded verdict on the card) and that have no live session driving them. Distinct from
 * {@link findReviewCandidateTaskIds} (the opportunistic picker, which also re-reviews verdict-carrying holds):
 * a verdict-less review card on an otherwise-idle board is a frozen pipeline, not an optimization opportunity —
 * cross-project endpoint contention can drop the review finalize with nothing left to retry it (live-found
 * 2026-07-10: a simulated project froze at 6 verdict-less review cards + 9 dep-blocked planning cards while a
 * sibling project drained the shared endpoint).
 */
export function findStalledReviewTaskIds(
	board: {
		columns: readonly {
			id: string;
			cards: readonly { id: string; review?: { status?: string } | null }[];
		}[];
	},
	activeSessionTaskIds: ReadonlySet<string>,
	alreadyDispatched: ReadonlySet<string>,
): string[] {
	const reviewColumn = board.columns.find((column) => column.id === "review");
	if (!reviewColumn) {
		return [];
	}
	// NO persisted review state at all = the review never even started for this card. A card whose review ran
	// (bounced/parked/held) carries a `review` object and is deliberately excluded — parked/held cards are the
	// operator's decision, not a stall.
	return reviewColumn.cards
		.filter((card) => !card.review && !activeSessionTaskIds.has(card.id) && !alreadyDispatched.has(card.id))
		.map((card) => card.id);
}

/**
 * The `memory_audit` picker (pure): note refs written/edited since their last audit that a strong idle model should
 * re-verify. `alreadyAudited` gives per-workspace idempotency (a ref whose current version was already audited is
 * skipped), so a tick never re-audits an unchanged note.
 */
export function findMemoryAuditCandidates(
	recentlyWrittenNoteRefs: readonly string[],
	alreadyAudited: ReadonlySet<string>,
): string[] {
	return recentlyWrittenNoteRefs.filter((ref) => !alreadyAudited.has(ref));
}

/** Compose the ranker with the available pickers into a concrete idle-work decision. Pure. */
export function decideOpportunisticIdleWork(input: OpportunisticIdleWorkInput): OpportunisticIdleWorkDecision {
	const available: OpportunisticWorkKind[] = [];
	if (input.reviewCandidateTaskIds.length > 0) {
		available.push("review");
	}
	const memoryAuditNoteRefs = input.memoryAuditNoteRefs ?? [];
	if (memoryAuditNoteRefs.length > 0) {
		available.push("memory_audit");
	}
	const verdict = rankOpportunisticWork({ hasRealQueuedWork: input.hasRealQueuedWork, available });
	return {
		verdict,
		reviewTaskId: verdict.chosen === "review" ? (input.reviewCandidateTaskIds[0] ?? null) : null,
		memoryAuditNoteRef: verdict.chosen === "memory_audit" ? (memoryAuditNoteRefs[0] ?? null) : null,
	};
}
