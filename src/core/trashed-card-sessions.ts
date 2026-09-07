/**
 * P0.TRASHSTOP (v31 2026-09-07): a card moved to `trash` through a whole-state save kept its architect session
 * running — it held the legion host's single session slot for an hour while every start on that host was refused
 * ("another !Klein task on this host must finish first"). The same morning an already-`completed` card (completed
 * by the crash-recovery path while the controller revived its job) kept a second session running on the same slot.
 * A card in a terminal lane has nothing left to deliver, so its live session is pure occupancy. This pure selector
 * names the active sessions whose card sits ONLY in a terminal lane (a lane-shadow copy in a live lane keeps the
 * session), for the board-liveness watchdog to stop.
 */

export interface TerminalLaneSessionBoard {
	columns: ReadonlyArray<{ id: string; cards: ReadonlyArray<{ id: string }> }>;
}

export interface TerminalLaneSession {
	taskId: string;
	columnId: string;
}

const TERMINAL_LANES: ReadonlySet<string> = new Set(["trash", "completed"]);

/** Derived session ids (`<card>::review`, `<card>::spec`, `main-branch-custodian::review`) name no board card. */
function isDerivedSessionId(taskId: string): boolean {
	return taskId.includes("::");
}

export function selectTrashedCardSessions(
	board: TerminalLaneSessionBoard,
	activeSessionTaskIds: Iterable<string>,
): TerminalLaneSession[] {
	const terminalLaneByTaskId = new Map<string, string>();
	const live = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (TERMINAL_LANES.has(column.id)) {
				terminalLaneByTaskId.set(card.id, column.id);
			} else {
				live.add(card.id);
			}
		}
	}
	const stops: TerminalLaneSession[] = [];
	const seen = new Set<string>();
	for (const taskId of activeSessionTaskIds) {
		if (seen.has(taskId) || live.has(taskId) || isDerivedSessionId(taskId)) {
			continue;
		}
		const columnId = terminalLaneByTaskId.get(taskId);
		// A card deleted from the board outright (HITL 2026-09-07: a purged redecompose clone whose session the
		// context-overflow controller kept restarting on every nudge) is the same occupancy with no lane at all.
		const terminalColumn = columnId ?? (board.columns.length > 0 ? "absent" : undefined);
		if (terminalColumn === undefined) {
			continue;
		}
		seen.add(taskId);
		stops.push({ taskId, columnId: terminalColumn });
	}
	return stops;
}
