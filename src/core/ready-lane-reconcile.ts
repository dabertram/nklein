// §5.B "Ready" lane promotion (todo 11116, increment 2) — the PURE lane logic that makes the queued-but-unblocked
// state visible as its own column. A card belongs in `ready` when it is IN-FLOW (already in planning), has all its
// dependencies met, and is NOT currently being worked/decomposed (no live session) — i.e. it is dep-free and just
// waiting for a slot. When it starts (gains a session) it moves on to in_progress; if a re-decompose re-blocks it,
// it falls back to planning.
//
// This returns the MOVES to apply; the runtime applies them inside its authoritative board mutation. Purity keeps it
// exhaustively unit-testable across the session lifecycle (the exact thing todo 11116's protection demands).

import type { RuntimeBoardColumnId, RuntimeBoardData } from "./api-contract";
import { listUnmetDependencyTaskIds } from "./task-board-ready-sweep";

export interface ReadyLaneMove {
	taskId: string;
	from: RuntimeBoardColumnId;
	to: RuntimeBoardColumnId;
}

export interface ReadyLaneReconcileInput {
	board: RuntimeBoardData;
	/** Cards with a live/queued/awaiting-review session — a card being decomposed or worked is one of these. */
	activeSessionTaskIds: ReadonlySet<string>;
	/**
	 * Cards the runtime is in the MIDDLE of starting (dispatched, session not yet attached). Excluded from promotion
	 * so a card just moved to the planning entry-lane to be started is never yanked to `ready` in the start window
	 * (the race the todo scopes). Default: empty.
	 */
	pendingStartTaskIds?: ReadonlySet<string>;
}

/**
 * Compute the Ready-lane moves for the board. Three transitions, keyed off the AUTHORITATIVE session set:
 *   - `planning → ready`   : a dep-free card with no live session and not mid-start (queued-but-unblocked).
 *   - `ready → in_progress`: a ready card that gained a session (it started).
 *   - `ready → planning`   : a ready card that became blocked again (a re-decompose added an unmet dep).
 * Backlog cards are never auto-promoted (backlog = the user hasn't chosen to start them). Returns [] when stable.
 */
export function resolveReadyLaneMoves(input: ReadyLaneReconcileInput): ReadyLaneMove[] {
	const active = input.activeSessionTaskIds;
	const pending = input.pendingStartTaskIds ?? new Set<string>();
	const moves: ReadyLaneMove[] = [];

	for (const column of input.board.columns) {
		if (column.id === "planning") {
			for (const card of column.cards) {
				if (active.has(card.id) || pending.has(card.id)) {
					continue; // being worked/decomposed, or mid-start — leave it in planning.
				}
				if (listUnmetDependencyTaskIds(input.board, card.id).length === 0) {
					moves.push({ taskId: card.id, from: "planning", to: "ready" });
				}
			}
		} else if (column.id === "ready") {
			for (const card of column.cards) {
				if (active.has(card.id)) {
					// It started — advance it to in_progress (the runtime's start flow may also do this; idempotent).
					moves.push({ taskId: card.id, from: "ready", to: "in_progress" });
				} else if (listUnmetDependencyTaskIds(input.board, card.id).length > 0) {
					// Re-blocked (e.g. a re-decompose added a dependency) — fall back to planning.
					moves.push({ taskId: card.id, from: "ready", to: "planning" });
				}
			}
		}
	}
	return moves;
}
