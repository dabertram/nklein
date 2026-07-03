// §5.0.5 W2.2 durability (STARTUP side) — the crash-recovery complement to the shutdown-coordinator's
// reconcile-don't-destroy parking. A clean shutdown parks in-progress cards into Review (W2.2a); a CRASH skips that,
// leaving cards sitting in the `in_progress` lane with NO live session after the restart — a "lying board" that shows
// agent activity behind cards nothing is working. On startup the session Maps are empty (sessions are in-memory), so
// every `in_progress` card is orphaned; this pure core moves those orphans to Review (the operator-attention lane),
// exactly like the clean-shutdown path, making the board honest and the work visible + resumable (the #21 salvage
// path then rebinds any that still carry a captured result branch). PRIME DIRECTIVE #1: DECIDES + returns a new board
// only — no I/O, no clock; the caller persists.

import type { RuntimeBoardData } from "./api-contract";
import { moveTaskToColumn } from "./task-board-mutations";

/**
 * Move every `in_progress` card WITHOUT a live session to the Review lane. `liveSessionTaskIds` are the tasks that
 * actually have a running/queued/awaiting session right now (empty on a fresh startup). Returns the new board + the
 * parked task ids (empty ⇒ nothing to reconcile, e.g. after a clean shutdown that already parked them).
 */
export function reconcileOrphanedInProgressCards(input: {
	board: RuntimeBoardData;
	liveSessionTaskIds: ReadonlySet<string>;
	/** Timestamp for the moved cards' `updatedAt`; injected for determinism (defaults to now). */
	now?: number;
}): { board: RuntimeBoardData; parkedTaskIds: string[] } {
	const inProgress = input.board.columns.find((column) => column.id === "in_progress");
	const orphanedTaskIds = (inProgress?.cards ?? [])
		.filter((card) => !input.liveSessionTaskIds.has(card.id))
		.map((card) => card.id);

	let nextBoard = input.board;
	const parkedTaskIds: string[] = [];
	for (const taskId of orphanedTaskIds) {
		const moved = moveTaskToColumn(nextBoard, taskId, "review", input.now ?? Date.now());
		if (moved.moved) {
			nextBoard = moved.board;
			parkedTaskIds.push(taskId);
		}
	}
	return { board: nextBoard, parkedTaskIds };
}
