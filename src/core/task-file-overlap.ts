import type { RuntimeBoardCard, RuntimeBoardData, RuntimeTaskSessionSummary } from "./api-contract";

const ACTIVE_SESSION_STATES = new Set<RuntimeTaskSessionSummary["state"]>(["queued", "running", "awaiting_review"]);

function normalizeLikelyTouchedPath(path: string): string {
	return path
		.trim()
		.replace(/^\.\/+/, "")
		.toLowerCase();
}

function getLikelyTouchedPathSet(task: RuntimeBoardCard): Set<string> {
	return new Set((task.filesLikelyTouched ?? []).map(normalizeLikelyTouchedPath).filter((path) => path.length > 0));
}

export function tasksHaveLikelyTouchedFileOverlap(left: RuntimeBoardCard, right: RuntimeBoardCard): boolean {
	const leftPaths = getLikelyTouchedPathSet(left);
	if (leftPaths.size === 0) {
		return false;
	}
	for (const path of getLikelyTouchedPathSet(right)) {
		if (leftPaths.has(path)) {
			return true;
		}
	}
	return false;
}

export function findActiveTaskLikelyTouchedFileOverlap(input: {
	board: RuntimeBoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	task: RuntimeBoardCard;
}): RuntimeBoardCard | null {
	for (const session of Object.values(input.sessions)) {
		if (session.taskId === input.task.id || !ACTIVE_SESSION_STATES.has(session.state)) {
			continue;
		}
		for (const column of input.board.columns) {
			const activeTask = column.cards.find((card) => card.id === session.taskId) ?? null;
			if (activeTask && tasksHaveLikelyTouchedFileOverlap(input.task, activeTask)) {
				return activeTask;
			}
		}
	}
	return null;
}
