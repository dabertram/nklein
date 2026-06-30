// Pure per-project task tallies by board column (extracted from workspace-registry.ts, §5.U). The registry
// reports how many cards sit in each column for a project; `countTasksByColumn` does the persisted tally and
// `applyLiveSessionStateToProjectTaskCounts` overlays in-flight session state so a card whose live session is
// already awaiting review counts under review even before the persisted board is rewritten.
import type {
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeProjectTaskCounts,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";

export function createEmptyProjectTaskCounts(): RuntimeProjectTaskCounts {
	return {
		backlog: 0,
		planning: 0,
		in_progress: 0,
		review: 0,
		completed: 0,
		trash: 0,
	};
}

export function countTasksByColumn(board: RuntimeBoardData): RuntimeProjectTaskCounts {
	const counts = createEmptyProjectTaskCounts();
	for (const column of board.columns) {
		const count = column.cards.length;
		switch (column.id) {
			case "backlog":
				counts.backlog += count;
				break;
			case "planning":
				counts.planning += count;
				break;
			case "in_progress":
				counts.in_progress += count;
				break;
			case "review":
				counts.review += count;
				break;
			case "completed":
				counts.completed += count;
				break;
			case "trash":
				counts.trash += count;
				break;
		}
	}
	return counts;
}

export function applyLiveSessionStateToProjectTaskCounts(
	counts: RuntimeProjectTaskCounts,
	board: RuntimeBoardData,
	sessionSummaries: RuntimeWorkspaceStateResponse["sessions"],
): RuntimeProjectTaskCounts {
	const taskColumnById = new Map<string, RuntimeBoardColumnId>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskColumnById.set(card.id, column.id);
		}
	}
	const next = {
		...counts,
	};
	for (const summary of Object.values(sessionSummaries)) {
		const columnId = taskColumnById.get(summary.taskId);
		if (!columnId) {
			continue;
		}
		if (summary.state === "awaiting_review" && (columnId === "in_progress" || columnId === "planning")) {
			if (columnId === "planning") {
				next.planning = Math.max(0, next.planning - 1);
			} else {
				next.in_progress = Math.max(0, next.in_progress - 1);
			}
			next.review += 1;
		}
	}
	return next;
}
