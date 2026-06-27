import type { RuntimeWorkspaceStateResponse } from "./api-contract";
import {
	buildOperatorBoardSummary,
	mapSessionSummaryToOperatorSignals,
	type OperatorBoardSummary,
	type OperatorColumnId,
	type OperatorInboxTask,
	type OperatorSessionSummaryView,
	type OperatorSignalOverrides,
} from "./operator-task-state";

export type { OperatorBoardSummary, OperatorSignalOverrides } from "./operator-task-state";

/**
 * The minimal board shape the rollup reads — columns of cards with ids. Structurally a subset of both the runtime's
 * `RuntimeBoardData` and the web-ui's `BoardData` (their column ids are the same `RuntimeBoardColumnId` enum), so a
 * caller passes either directly; kept inline so this module stays a dependency-free pure bridge.
 */
export interface BoardHealthBoardView {
	columns: ReadonlyArray<{ id: OperatorColumnId; cards: ReadonlyArray<{ id: string }> }>;
}

/**
 * §5.AG: derive the board-health rollup (healthy/stuck/risky/done counts + the risk/approval inbox) from a board +
 * its per-task session map. The single bridge from what the runtime + web-ui already hold onto the operator data
 * layer, so the `nklein task health` CLI and the web board-health header render the SAME tested rollup.
 *
 * Trash cards are excluded. A card with no live session maps to the `idle` session state (its column still drives
 * done/stuck/healthy). The off-summary signals (§5.L gate / §5.M ack / §5.S clarify / §5.A block) are not in the
 * board state; a caller that has them (e.g. from gate/clarify subsystems) supplies them via `resolveOverrides`.
 */
export function summarizeBoardHealth(
	board: BoardHealthBoardView,
	sessions: Record<string, OperatorSessionSummaryView>,
	resolveOverrides?: (taskId: string) => OperatorSignalOverrides,
): OperatorBoardSummary {
	const tasks: OperatorInboxTask[] = [];
	for (const column of board.columns) {
		if (column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			const summary = sessions[card.id] ?? { state: "idle" as const };
			tasks.push({
				taskId: card.id,
				signals: mapSessionSummaryToOperatorSignals(summary, column.id, resolveOverrides?.(card.id)),
			});
		}
	}
	return buildOperatorBoardSummary(tasks);
}

/** Convenience over {@link summarizeBoardHealth} for a full `RuntimeWorkspaceStateResponse` (the CLI/tRPC path). */
export function summarizeWorkspaceBoardHealth(
	state: RuntimeWorkspaceStateResponse,
	resolveOverrides?: (taskId: string) => OperatorSignalOverrides,
): OperatorBoardSummary {
	return summarizeBoardHealth(state.board, state.sessions, resolveOverrides);
}
