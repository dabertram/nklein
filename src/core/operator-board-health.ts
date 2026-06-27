import type { RuntimeWorkspaceStateResponse } from "./api-contract";
import {
	buildOperatorBoardSummary,
	mapSessionSummaryToOperatorSignals,
	type OperatorBoardSummary,
	type OperatorColumnId,
	type OperatorInboxTask,
	type OperatorSessionSummaryView,
	type OperatorSignalOverrides,
	type OperatorTaskSignals,
} from "./operator-task-state";

export type { OperatorBoardSummary, OperatorSignalOverrides } from "./operator-task-state";

/**
 * The minimal board shape the rollup reads — columns of cards with an id and (optionally) the card's start-blocked
 * kind. Structurally a subset of both the runtime's `RuntimeBoardData` and the web-ui's `BoardData` (same
 * `RuntimeBoardColumnId` column ids, same `blockedKind` enum), so a caller passes either directly; kept inline so this
 * module stays a dependency-free pure bridge.
 */
export interface BoardHealthBoardView {
	columns: ReadonlyArray<{
		id: OperatorColumnId;
		cards: ReadonlyArray<{ id: string; blockedKind?: OperatorTaskSignals["blockedKind"] }>;
	}>;
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
			// The card's own `blockedKind` is board state — fold it into the signals (a caller override wins if it also
			// supplies one), so a sandbox-unavailable card reads `risky` and a needs-decomposition card reads `stuck`
			// straight from the board, without waiting on the §5.L/§5.S/§5.M subsystems to expose per-task state.
			const overrides: OperatorSignalOverrides = {
				...(card.blockedKind ? { blockedKind: card.blockedKind } : {}),
				...resolveOverrides?.(card.id),
			};
			tasks.push({
				taskId: card.id,
				signals: mapSessionSummaryToOperatorSignals(summary, column.id, overrides),
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
