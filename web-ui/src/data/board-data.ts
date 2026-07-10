import type { BoardColumn, BoardColumnId, BoardData } from "@/types";

const columnOrder: Array<{ id: BoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "planning", title: "Planning" },
	// §5.B Ready lane (todo 11116): a dep-free card that couldn't grab a slot yet parks here between Planning and
	// In Progress. This canonical skeleton is what normalizeBoardData() fills and what drives render order, so a
	// missing `ready` entry silently drops the server's ready column and its cards (live-found 2026-07-10).
	{ id: "ready", title: "Ready" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "review", title: "Review" },
	{ id: "completed", title: "Completed" },
	{ id: "trash", title: "Trash" },
];

function createEmptyColumn(id: BoardColumnId, title: string): BoardColumn {
	return {
		id,
		title,
		cards: [],
	};
}

export function createInitialBoardData(): BoardData {
	return {
		columns: columnOrder.map((column) => createEmptyColumn(column.id, column.title)),
		dependencies: [],
	};
}
