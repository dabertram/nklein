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

/**
 * The normalized paths two tasks both list in `filesLikelyTouched` (sorted, deduped) — the concrete reason an auto-start
 * is serialized. Returned so the runtime can LOG the culprit path(s): a single shared coarse file (e.g. a barrel index or
 * `package.json` the decompose model defensively listed for many cards) over-serializing a wide DAG is exactly the
 * signal we need to root-cause the C3/C5 throughput finding (todo §5.AF scout) before tuning the heuristic.
 */
export function getSharedLikelyTouchedPaths(left: RuntimeBoardCard, right: RuntimeBoardCard): string[] {
	const leftPaths = getLikelyTouchedPathSet(left);
	if (leftPaths.size === 0) {
		return [];
	}
	const shared = new Set<string>();
	for (const path of getLikelyTouchedPathSet(right)) {
		if (leftPaths.has(path)) {
			shared.add(path);
		}
	}
	return [...shared].sort();
}

export function tasksHaveLikelyTouchedFileOverlap(left: RuntimeBoardCard, right: RuntimeBoardCard): boolean {
	return getSharedLikelyTouchedPaths(left, right).length > 0;
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
