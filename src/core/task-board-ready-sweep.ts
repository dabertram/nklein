import type { RuntimeBoardData } from "./api-contract";

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
	const laneByTaskId = new Map<string, string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			laneByTaskId.set(card.id, column.id);
		}
	}
	// A dependency edge `fromTaskId -> toTaskId` means FROM depends on TO; TO must be completed to release FROM.
	const unmetDependencyCounts = new Map<string, number>();
	for (const dependency of board.dependencies) {
		const prerequisiteLane = laneByTaskId.get(dependency.toTaskId);
		if (prerequisiteLane === "completed") {
			continue;
		}
		unmetDependencyCounts.set(dependency.fromTaskId, (unmetDependencyCounts.get(dependency.fromTaskId) ?? 0) + 1);
	}
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
