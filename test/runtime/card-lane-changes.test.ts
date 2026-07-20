import { describe, expect, it } from "vitest";
import { diffCardLanes, type LaneSnapshot } from "../../src/core/card-lane-changes";

/**
 * N17b — the lane-change diff.
 *
 * This logic shipped inside `workspace-state.ts` with NO test, which is the same shape as N16's extraction
 * defect: the pure half of the trail was pinned and the half that actually produces the events was not. The
 * failure mode is identical too — a wrong diff does not throw, it writes a plausible lane history that is
 * missing or inventing transitions, and a trail nobody can distrust is worse than no trail.
 */

function board(lanes: Record<string, string[]>): LaneSnapshot {
	return { columns: Object.entries(lanes).map(([id, cards]) => ({ id, cards: cards.map((card) => ({ id: card })) })) };
}

describe("diffCardLanes", () => {
	it("reports a MOVE with both lanes", () => {
		const changes = diffCardLanes(board({ ready: ["c1"], review: [] }), board({ ready: [], review: ["c1"] }));
		expect(changes).toEqual([
			{ taskId: "c1", fromLane: "ready", toLane: "review", message: "Card c1 moved ready → review." },
		]);
	});

	it("distinguishes ENTERING the board from moving", () => {
		// A null `fromLane` is the difference between "a card was created here" and "a card arrived from nowhere".
		const changes = diffCardLanes(board({ ready: [] }), board({ ready: ["c1"] }));
		expect(changes[0]?.fromLane).toBeNull();
		expect(changes[0]?.message).toContain("entered the board");
	});

	it("reports LEAVING the board — the event nothing downstream will ever mention again", () => {
		const changes = diffCardLanes(board({ done: ["c1"] }), board({ done: [] }));
		expect(changes).toEqual([
			{ taskId: "c1", fromLane: "done", toLane: null, message: "Card c1 left the board (was in done)." },
		]);
	});

	it("emits NOTHING when no lane changed", () => {
		// Every board write calls this. Emitting on an unchanged board would bury real transitions in noise.
		const same = board({ ready: ["c1", "c2"], review: ["c3"] });
		expect(diffCardLanes(same, board({ ready: ["c1", "c2"], review: ["c3"] }))).toEqual([]);
	});

	it("is unaffected by a card's POSITION within its lane", () => {
		// Reordering within a column is not a lane change, and treating it as one would emit a transition every
		// time the board re-sorted.
		expect(diffCardLanes(board({ ready: ["c1", "c2"] }), board({ ready: ["c2", "c1"] }))).toEqual([]);
	});

	it("resolves a card listed in TWO columns deterministically, rather than emitting phantom changes", () => {
		// A malformed board must not make the diff unstable: an unstable read emits a lane change on every persist,
		// and a forensic tool that invents events is worse than one that misses them.
		const malformed = board({ ready: ["c1"], review: ["c1"] });
		expect(diffCardLanes(malformed, malformed)).toEqual([]);
		expect(diffCardLanes(board({ ready: ["c1"] }), malformed)[0]?.toLane).toBe("review");
	});

	it("reports several cards moving in one persist", () => {
		// Two moves between persists collapse into one event each — the documented cost of diffing results.
		const changes = diffCardLanes(
			board({ ready: ["c1", "c2"], review: [] }),
			board({ ready: [], review: ["c1", "c2"] }),
		);
		expect(changes).toHaveLength(2);
		expect(changes.every((change) => change.toLane === "review")).toBe(true);
	});

	it("keeps a STABLE order so a trail stays diffable between runs", () => {
		const before = board({ ready: ["a", "b"], review: ["gone"] });
		const after = board({ ready: [], review: ["a", "b"] });
		const first = diffCardLanes(before, after).map((change) => change.taskId);
		expect(diffCardLanes(before, after).map((change) => change.taskId)).toEqual(first);
		// Arrivals and moves precede departures.
		expect(first.indexOf("gone")).toBe(first.length - 1);
	});

	it("handles an empty board on either side without inventing events", () => {
		expect(diffCardLanes(board({}), board({}))).toEqual([]);
		expect(diffCardLanes(board({ ready: ["c1"] }), board({}))).toHaveLength(1);
	});
});
