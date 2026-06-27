import type { RuntimeWorkspaceStateResponse } from "./api-contract";
import {
	buildOperatorBoardSummary,
	mapSessionSummaryToOperatorSignals,
	type OperatorBoardSummary,
	type OperatorInboxTask,
	type OperatorSignalOverrides,
} from "./operator-task-state";

export type { OperatorBoardSummary, OperatorSignalOverrides } from "./operator-task-state";

/**
 * §5.AG: derive the board-health rollup (healthy/stuck/risky/done counts + the risk/approval inbox) from a live
 * workspace-state response. The single bridge from what the runtime returns (`RuntimeWorkspaceStateResponse` — board
 * columns + the per-task session map) onto the operator data layer, so BOTH the `nklein` CLI status surface and a
 * future tRPC/UI endpoint render the same tested rollup.
 *
 * Trash cards are excluded. A card with no live session maps to the `idle` session state (its column still drives
 * done/stuck/healthy). The off-summary signals (§5.L gate / §5.M ack / §5.S clarify / §5.A block) are not in the
 * board state; a caller that has them (e.g. from gate/clarify subsystems) supplies them via `resolveOverrides`.
 */
export function summarizeWorkspaceBoardHealth(
	state: RuntimeWorkspaceStateResponse,
	resolveOverrides?: (taskId: string) => OperatorSignalOverrides,
): OperatorBoardSummary {
	const tasks: OperatorInboxTask[] = [];
	for (const column of state.board.columns) {
		if (column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			const summary = state.sessions[card.id] ?? { state: "idle" as const };
			tasks.push({
				taskId: card.id,
				signals: mapSessionSummaryToOperatorSignals(summary, column.id, resolveOverrides?.(card.id)),
			});
		}
	}
	return buildOperatorBoardSummary(tasks);
}
