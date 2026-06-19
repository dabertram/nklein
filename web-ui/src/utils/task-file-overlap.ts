import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { findCardSelection } from "@/state/board-state";
import type { BoardCard, BoardData } from "@/types";

const ACTIVE_SESSION_STATES = new Set<RuntimeTaskSessionSummary["state"]>(["queued", "running", "awaiting_review"]);
const ACTIVE_BOARD_COLUMN_IDS = new Set(["in_progress", "review"]);

function normalizeLikelyTouchedPath(path: string): string {
	return path
		.trim()
		.replace(/^\.\/+/, "")
		.toLowerCase();
}

function getLikelyTouchedPathSet(task: BoardCard): Set<string> {
	return new Set((task.filesLikelyTouched ?? []).map(normalizeLikelyTouchedPath).filter((path) => path.length > 0));
}

export function tasksHaveLikelyTouchedFileOverlap(left: BoardCard, right: BoardCard): boolean {
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

export function hasLikelyTouchedFileOverlap(task: BoardCard, candidates: readonly BoardCard[]): boolean {
	return candidates.some(
		(candidate) => candidate.id !== task.id && tasksHaveLikelyTouchedFileOverlap(task, candidate),
	);
}

export function getSessionActiveTaskCardsForFileOverlap(
	board: BoardData,
	sessions: Record<string, RuntimeTaskSessionSummary>,
	excludeTaskIds: ReadonlySet<string> = new Set(),
): BoardCard[] {
	const activeCards: BoardCard[] = [];
	for (const session of Object.values(sessions)) {
		if (!ACTIVE_SESSION_STATES.has(session.state) || excludeTaskIds.has(session.taskId)) {
			continue;
		}
		const selection = findCardSelection(board, session.taskId);
		if (selection) {
			activeCards.push(selection.card);
		}
	}
	return activeCards;
}

export function getBoardActiveTaskCardsForFileOverlap(
	board: BoardData,
	excludeTaskIds: ReadonlySet<string> = new Set(),
): BoardCard[] {
	return board.columns.flatMap((column) => {
		if (!ACTIVE_BOARD_COLUMN_IDS.has(column.id)) {
			return [];
		}
		return column.cards.filter((card) => !excludeTaskIds.has(card.id));
	});
}
