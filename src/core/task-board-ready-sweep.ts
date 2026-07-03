import type { RuntimeBoardData } from "./api-contract";
import type { CardExecutionState } from "./card-message-effect";

/**
 * The READY-SWEEP (live-found across fleet runs 12/14/15, 2026-07-02): list every waiting card that is startable
 * RIGHT NOW — in backlog/planning, all dependencies satisfied (or none), and no live session.
 *
 * Why this exists: the cascade's start triggers each cover one path — the decompose event starts the PLAN's roots,
 * a completion "releases" the cards LINKED to the completed one, and failed starts join the deferred set. But a card
 * can become dependency-free OUTSIDE those paths (edge reorientation when a sibling starts, a prerequisite trashed,
 * a plan whose rootTaskIds missed a root) and then falls through every crack: run15's board autopsy found two
 * dependency-free planning cards sitting unstarted for 15 minutes while the completion handler ran twice — the
 * "release" set never contains a card the completion wasn't linked to. Sweeping the WHOLE board on each completion
 * is a strict superset of the release set and closes the class of stall, not just the instances.
 *
 * Pure. `activeSessionTaskIds` must contain every task with a live/queued session — started cards PARK IN PLANNING
 * while they run (STARTED_CARD_ENTRY_LANE), so lane alone cannot distinguish waiting from working. The caller's
 * `autoStartTaskIds` re-checks lane, overlap, and concurrency per card, so over-reporting here is safe.
 */
export function listStartableUnstartedTaskIds(
	board: RuntimeBoardData,
	activeSessionTaskIds: ReadonlySet<string>,
): string[] {
	const laneByTaskId = indexLanesByTaskId(board);
	const unmetDependencyCounts = countUnmetDependencies(board, laneByTaskId);
	const startable: string[] = [];
	for (const column of board.columns) {
		if (column.id !== "backlog" && column.id !== "planning") {
			continue;
		}
		for (const card of column.cards) {
			if (activeSessionTaskIds.has(card.id)) {
				continue; // already running (started cards park in planning)
			}
			if ((unmetDependencyCounts.get(card.id) ?? 0) > 0) {
				continue; // still blocked
			}
			startable.push(card.id);
		}
	}
	return startable;
}

function indexLanesByTaskId(board: RuntimeBoardData): Map<string, string> {
	const laneByTaskId = new Map<string, string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			laneByTaskId.set(card.id, column.id);
		}
	}
	return laneByTaskId;
}

/** A dependency edge `fromTaskId -> toTaskId` means FROM depends on TO; TO must be completed to release FROM. */
function countUnmetDependencies(board: RuntimeBoardData, laneByTaskId: Map<string, string>): Map<string, number> {
	const unmetDependencyCounts = new Map<string, number>();
	for (const dependency of board.dependencies) {
		const prerequisiteLane = laneByTaskId.get(dependency.toTaskId);
		if (prerequisiteLane === "completed") {
			continue;
		}
		unmetDependencyCounts.set(dependency.fromTaskId, (unmetDependencyCounts.get(dependency.fromTaskId) ?? 0) + 1);
	}
	return unmetDependencyCounts;
}

/**
 * §5.AU — the card's EXECUTION state as it bears on a message's effect (`resolveCardMessageEffect`), from the same
 * board facts the ready-sweep uses: a live/queued session ⇒ `running`; the completed lane ⇒ `done`; an explicit
 * `blockedKind` or an unmet dependency ⇒ `blocked`; anything else waiting ⇒ `ready`. Null for an unknown card
 * (trashed/never existed). Pure; `activeSessionTaskIds` as in the sweep above.
 */
export function resolveCardExecutionState(
	board: RuntimeBoardData,
	activeSessionTaskIds: ReadonlySet<string>,
	taskId: string,
): CardExecutionState | null {
	const laneByTaskId = indexLanesByTaskId(board);
	const lane = laneByTaskId.get(taskId);
	if (lane === undefined || lane === "trash") {
		return null;
	}
	if (activeSessionTaskIds.has(taskId)) {
		return "running";
	}
	if (lane === "completed") {
		return "done";
	}
	const card = board.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === taskId);
	const unmetDependencyCounts = countUnmetDependencies(board, laneByTaskId);
	if (card?.blockedKind || (unmetDependencyCounts.get(taskId) ?? 0) > 0) {
		return "blocked";
	}
	return "ready";
}

/** The unmet-prerequisite card ids for a task (for the suggest-unblock message), completed-lane deps excluded. */
export function listUnmetDependencyTaskIds(board: RuntimeBoardData, taskId: string): string[] {
	const laneByTaskId = indexLanesByTaskId(board);
	return board.dependencies
		.filter((dependency) => dependency.fromTaskId === taskId && laneByTaskId.get(dependency.toTaskId) !== "completed")
		.map((dependency) => dependency.toTaskId);
}
