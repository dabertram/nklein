// §5.0.5 W2.2 durability (STARTUP side) — the crash-recovery complement to the shutdown-coordinator's
// reconcile-don't-destroy parking. A clean shutdown parks in-progress cards into Review (W2.2a); a CRASH skips that,
// leaving cards sitting in the `in_progress` lane with NO live session after the restart — a "lying board" that shows
// agent activity behind cards nothing is working. On startup the session Maps are empty (sessions are in-memory), so
// every `in_progress` card is orphaned; this pure core reconciles them. PRIME DIRECTIVE #1: DECIDES + returns a new
// board only — no I/O, no clock; the caller persists.
//
// ── WHY ORPHANS SPLIT BY RESULT-BRANCH EXISTENCE (N10 worker-phase forensics 2026-07-25) ──
// Review is only an honest destination when there is SOMETHING TO REVIEW. A worker killed mid-tool leaves no
// captured result branch, and a review of such a card can never deliver — the P0.8 capture gate correctly holds it
// forever ("capture has not settled", and the dead session guarantees it never will). Live-caught livelock: the
// board-liveness watchdog kept "rescuing" the unreviewable card with reviews that approved but could not deliver,
// while the durable controller's re-dispatch no-op'd against the Review lane and silently burned 5-minute leases in
// a reclaim loop. So: an orphan that KEPT a result branch goes to Review (the #21 salvage rebinds it — genuinely
// reviewable); an orphan with NO result branch goes back to READY for a clean re-drive (the path a crash-restart
// demonstrably completes end-to-end). Callers that cannot cheaply know branch existence omit the set and keep the
// conservative everything-to-Review behavior.

import type { RuntimeBoardData } from "./api-contract";
import { moveTaskToColumn } from "./task-board-mutations";

/**
 * Reconcile every `in_progress` card WITHOUT a live session. `liveSessionTaskIds` are the tasks that actually have
 * a running/queued/awaiting session right now (empty on a fresh startup). Orphans in `taskIdsWithResultBranch`
 * move to Review (reviewable, salvageable); the rest move back to Ready for a re-drive. When the set is omitted,
 * every orphan moves to Review (the pre-split behavior). Empty results ⇒ nothing to reconcile.
 */
export function reconcileOrphanedInProgressCards(input: {
	board: RuntimeBoardData;
	liveSessionTaskIds: ReadonlySet<string>;
	/** Orphans that kept a captured result branch (effectful to determine — the caller supplies it). */
	taskIdsWithResultBranch?: ReadonlySet<string>;
	/** Timestamp for the moved cards' `updatedAt`; injected for determinism (defaults to now). */
	now?: number;
}): { board: RuntimeBoardData; parkedTaskIds: string[]; requeuedTaskIds: string[] } {
	const inProgress = input.board.columns.find((column) => column.id === "in_progress");
	const orphanedTaskIds = (inProgress?.cards ?? [])
		.filter((card) => !input.liveSessionTaskIds.has(card.id))
		.map((card) => card.id);

	let nextBoard = input.board;
	const parkedTaskIds: string[] = [];
	const requeuedTaskIds: string[] = [];
	for (const taskId of orphanedTaskIds) {
		const reviewable = input.taskIdsWithResultBranch === undefined || input.taskIdsWithResultBranch.has(taskId);
		const moved = moveTaskToColumn(nextBoard, taskId, reviewable ? "review" : "ready", input.now ?? Date.now());
		if (moved.moved) {
			nextBoard = moved.board;
			(reviewable ? parkedTaskIds : requeuedTaskIds).push(taskId);
		}
	}
	return { board: nextBoard, parkedTaskIds, requeuedTaskIds };
}
