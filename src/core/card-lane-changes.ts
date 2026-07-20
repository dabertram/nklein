/**
 * N17b — diff two board states into per-card LANE CHANGES. PURE core.
 *
 * The trail's other sources record what a card's machinery did; this records where the card WENT. Without it a
 * timeline shows only the lane a card ENDED in, so a card that reached Review, bounced to In Progress, and
 * returned looks identical to one that walked straight there — and in the 2026-07-20 investigation the bounce
 * count was the finding.
 *
 * ── WHY A DIFF AND NOT AN INTENT PARAMETER ──
 * The obvious design has each mover declare "I am moving card X to lane Y". That records what callers *meant*,
 * and a mover that forgets to declare leaves **no event at all** — a silent gap that reads as "nothing
 * happened", which is worse than no trail because it is trusted. Diffing two persisted board states cannot be
 * forgotten by a caller: if the board changed, the change is in the diff. It is the difference between a rail
 * every call site must remember and one it cannot escape.
 *
 * The cost is honest and worth stating: a diff sees the RESULT, not the reason. Two moves between one persist
 * collapse into one event, and the diff cannot say who moved the card or why. Both are acceptable — a lane
 * history that is complete-but-coarse beats one that is detailed-but-holed.
 */

export interface CardLaneChange {
	readonly taskId: string;
	/** null when the card was not on the board before — it ENTERED rather than moved. */
	readonly fromLane: string | null;
	/** null when the card is no longer on the board — it LEFT rather than moved. */
	readonly toLane: string | null;
	readonly message: string;
}

export interface LaneSnapshot {
	readonly columns: readonly { readonly id: string; readonly cards: readonly { readonly id: string }[] }[];
}

/**
 * Lane of each card.
 *
 * A malformed board listing one card in two columns resolves to the LAST column, deterministically. Which one
 * wins matters less than that the answer is stable: an unstable read would emit phantom lane changes on every
 * persist, and a forensic tool that invents events is worse than one that misses them.
 */
function laneByCard(board: LaneSnapshot): Map<string, string> {
	const lanes = new Map<string, string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			lanes.set(card.id, column.id);
		}
	}
	return lanes;
}

/**
 * Every card whose lane differs between two board states.
 *
 * Order is board order (arrivals and moves first, in column order, then departures). These events are
 * simultaneous, so no order is more *correct* — but a stable one keeps a trail diffable between runs.
 */
export function diffCardLanes(previous: LaneSnapshot, next: LaneSnapshot): CardLaneChange[] {
	const before = laneByCard(previous);
	const after = laneByCard(next);
	const changes: CardLaneChange[] = [];

	for (const [taskId, lane] of after) {
		const from = before.get(taskId);
		if (from === lane) {
			continue;
		}
		// A card APPEARING is a distinct event from a card MOVING. Conflating them would make a newly created card
		// look like it arrived from nowhere mid-run, and would hide the moment a card was actually added.
		changes.push({
			taskId,
			fromLane: from ?? null,
			toLane: lane,
			message: from ? `Card ${taskId} moved ${from} → ${lane}.` : `Card ${taskId} entered the board in ${lane}.`,
		});
	}

	for (const [taskId, lane] of before) {
		if (after.has(taskId)) {
			continue;
		}
		// A card LEAVING is the event most likely to matter in an investigation and the least likely to be logged
		// anywhere else — nothing downstream of a removed card will mention it again.
		changes.push({
			taskId,
			fromLane: lane,
			toLane: null,
			message: `Card ${taskId} left the board (was in ${lane}).`,
		});
	}

	return changes;
}
