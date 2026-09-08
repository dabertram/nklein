import { boardCardIdOfTaskSessionId } from "./synthetic-task-id";

/**
 * P0.HEAP — which task sessions' in-process state can be released.
 *
 * The task-session service kept EVERY session it ever started for the life of the process: the transcript mirror
 * (every tool output and reasoning stream), the launch request (system prompt, tool policies), the per-session
 * focus/edit/progress records, the large-file workflow outputs, and a dozen per-task bookkeeping maps in the
 * runtime server — none of them had a release seam for a card that FINISHED. The persisted SDK session is the
 * durable truth; the in-memory copies are caches, and this selector names the ones whose card can no longer use
 * them: a card sitting only in a terminal lane (`completed` / `trash`), or deleted from the board outright, with
 * no live session behind it. Derived sessions (`<card>::review`, `<card>::spec`) follow their board card.
 *
 * A LIVE session (running / queued / paused) is never selected, whatever lane its card is in: the P0.TRASHSTOP
 * watchdog pass stops it first, and the next tick releases it. Same-tick correctness is not worth releasing a
 * session that is still emitting events.
 */
export interface ReleasableSessionBoard {
	columns: ReadonlyArray<{ id: string; cards: ReadonlyArray<{ id: string }> }>;
}

export interface ReleasableSessionSummary {
	taskId: string;
	state: string;
}

export type TaskSessionReleaseReason = "completed" | "trash" | "absent";

export interface ReleasableTaskSession {
	taskId: string;
	reason: TaskSessionReleaseReason;
}

const TERMINAL_LANES: ReadonlySet<string> = new Set(["completed", "trash"]);
const LIVE_SESSION_STATES: ReadonlySet<string> = new Set(["running", "queued", "paused"]);

export function selectReleasableTaskSessions(
	board: ReleasableSessionBoard,
	summaries: Iterable<ReleasableSessionSummary>,
): ReleasableTaskSession[] {
	if (board.columns.length === 0) {
		// An empty board snapshot is indistinguishable from a board that failed to load; release nothing on it.
		return [];
	}
	const terminalLaneByCardId = new Map<string, TaskSessionReleaseReason>();
	const liveCardIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (TERMINAL_LANES.has(column.id)) {
				terminalLaneByCardId.set(card.id, column.id as TaskSessionReleaseReason);
			} else {
				liveCardIds.add(card.id);
			}
		}
	}
	const releasable: ReleasableTaskSession[] = [];
	const seen = new Set<string>();
	for (const summary of summaries) {
		if (seen.has(summary.taskId) || LIVE_SESSION_STATES.has(summary.state)) {
			continue;
		}
		const cardId = boardCardIdOfTaskSessionId(summary.taskId);
		if (liveCardIds.has(cardId)) {
			continue;
		}
		seen.add(summary.taskId);
		releasable.push({ taskId: summary.taskId, reason: terminalLaneByCardId.get(cardId) ?? "absent" });
	}
	return releasable;
}
