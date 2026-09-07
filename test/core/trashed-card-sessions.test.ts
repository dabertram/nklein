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
		]);
	});

	it("keeps a session whose card also has a live-lane copy, and derived/absent ids", () => {
		expect(selectTrashedCardSessions(board, ["shadow", "b", "main-branch-custodian::review"])).toEqual([]);
	});
});
