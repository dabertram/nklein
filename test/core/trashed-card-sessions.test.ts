import { describe, expect, it } from "vitest";
import { selectTrashedCardSessions } from "../../src/core/trashed-card-sessions";

const board = {
	columns: [
		{ id: "planning", cards: [{ id: "a" }, { id: "shadow" }] },
		{ id: "review", cards: [{ id: "b" }] },
		{ id: "completed", cards: [{ id: "done" }] },
		{ id: "trash", cards: [{ id: "t1" }, { id: "t2" }, { id: "shadow" }] },
	],
};

describe("selectTrashedCardSessions (P0.TRASHSTOP)", () => {
	it("names active sessions whose card sits only in a terminal lane (trash or completed)", () => {
		expect(selectTrashedCardSessions(board, ["a", "t1", "t2::review", "t2", "done", "unknown", "t1"])).toEqual([
			{ taskId: "t1", columnId: "trash" },
			{ taskId: "t2", columnId: "trash" },
			{ taskId: "done", columnId: "completed" },
			{ taskId: "unknown", columnId: "absent" },
		]);
	});

	it("keeps a session whose card has a live-lane copy and every derived session id", () => {
		expect(selectTrashedCardSessions(board, ["shadow", "b", "main-branch-custodian::review", "b::review"])).toEqual(
			[],
		);
	});

	it("stops a session whose card was deleted from the board outright (no lane at all)", () => {
		expect(selectTrashedCardSessions(board, ["gone-card"])).toEqual([{ taskId: "gone-card", columnId: "absent" }]);
		expect(selectTrashedCardSessions({ columns: [] }, ["gone-card"])).toEqual([]);
	});
});
