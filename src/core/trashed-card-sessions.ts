/**
 * P0.TRASHSTOP (v31 2026-09-07): a card moved to `trash` through a whole-state save kept its architect session
 * running — it held the legion host's single session slot for an hour while every start on that host was refused
 * ("another !Klein task on this host must finish first"). The same morning an already-`completed` card (completed
 * by the crash-recovery path while the controller revived its job) kept a second session running on the same slot.
 * A card in a terminal lane has nothing left to deliver, so its live session is pure occupancy. This pure selector
 * names the active sessions whose card sits ONLY in a terminal lane (a lane-shadow copy in a live lane keeps the
 * session), for the board-liveness watchdog to stop.
 *
 * 2026-09-08: the first cut skipped EVERY `::` session id as "derived, names no board card", and that blanket skip
 * was itself an occupancy leak. Trashing nine `clinical-*` cards left their `<card>::review` sessions running; they
 * queued on the rig's single shared endpoint and blocked every later task for hours ("Another !Klein task is already
 * running on shared endpoint ..."), with no card anywhere on the board to explain it. A derived session IS board-
 * owned when the segment before `::` names a card, so it follows its parent card into the trash. Only a derived id
 * whose parent names NO card (`main-branch-custodian::review`) is genuinely board-less and is left alone — and note
 * the absent-card rule below must NOT apply to those, or the custodian's own review would be stopped on sight.
 */

export interface TerminalLaneSessionBoard {
	columns: ReadonlyArray<{ id: string; cards: ReadonlyArray<{ id: string }> }>;
}

export interface TerminalLaneSession {
	taskId: string;
	columnId: string;
}

const TERMINAL_LANES: ReadonlySet<string> = new Set(["trash", "completed"]);

/** `<card>::review` / `<card>::spec` belong to the card named before `::`; a bare id is its own card. */
function parentCardIdOf(taskId: string): { cardId: string; derived: boolean } {
	const separator = taskId.indexOf("::");
	return separator < 0 ? { cardId: taskId, derived: false } : { cardId: taskId.slice(0, separator), derived: true };
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
		const { cardId, derived } = parentCardIdOf(taskId);
		if (seen.has(taskId) || live.has(cardId)) {
			continue;
		}
		const columnId = terminalLaneByTaskId.get(cardId);
		// A card deleted from the board outright (HITL 2026-09-07: a purged redecompose clone whose session the
		// context-overflow controller kept restarting on every nudge) is the same occupancy with no lane at all.
		// A DERIVED session is exempt from that rule: `main-branch-custodian::review` legitimately names no card,
		// so an absent parent means "not board-owned", not "orphaned".
		const terminalColumn = columnId ?? (!derived && board.columns.length > 0 ? "absent" : undefined);
		if (terminalColumn === undefined) {
			continue;
		}
		seen.add(taskId);
		stops.push({ taskId, columnId: terminalColumn });
	}
	return stops;
}
