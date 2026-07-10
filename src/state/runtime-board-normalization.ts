import type { RuntimeBoardColumnId, RuntimeBoardData } from "../core/api-contract";

/** The canonical kanban columns, in their fixed display order. */
const BOARD_COLUMNS: Array<{ id: RuntimeBoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "planning", title: "Planning" },
	{ id: "ready", title: "Ready" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "review", title: "Review" },
	{ id: "completed", title: "Completed" },
	{ id: "trash", title: "Trash" },
];

/** A fresh board with the canonical columns (in order) and no cards or dependencies. */
export function createEmptyBoard(): RuntimeBoardData {
	return {
		columns: BOARD_COLUMNS.map((column) => ({
			id: column.id,
			title: column.title,
			cards: [],
		})),
		dependencies: [],
	};
}

/**
 * Canonicalize a board's columns: rebuild the exact {@link BOARD_COLUMNS} set in their fixed order,
 * redistribute each card into the column matching its id, and DROP any card whose column id is not
 * one of the canonical columns. Dependencies pass through unchanged. Extracted from workspace-state
 * (§5.U) so this load/save invariant is one focused, independently-tested function.
 */
export function normalizeRuntimeBoardData(board: RuntimeBoardData): RuntimeBoardData {
	const normalizedColumns: RuntimeBoardData["columns"] = BOARD_COLUMNS.map((column) => ({
		id: column.id,
		title: column.title,
		cards: [],
	}));
	const columnById = new Map(normalizedColumns.map((column) => [column.id, column]));
	for (const column of board.columns) {
		const normalizedColumn = columnById.get(column.id);
		if (!normalizedColumn) {
			continue;
		}
		normalizedColumn.cards.push(...column.cards);
	}
	return {
		columns: normalizedColumns,
		dependencies: board.dependencies,
	};
}
