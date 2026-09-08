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
			{ taskId: "t2::review", columnId: "trash" },
			{ taskId: "t2", columnId: "trash" },
			{ taskId: "done", columnId: "completed" },
			{ taskId: "unknown", columnId: "absent" },
		]);
	});

	it("follows a derived session into the trash with its parent card", () => {
		// Live 2026-09-08: nine trashed `clinical-*` cards left their `::review` sessions running, and those sessions
		// queued on the rig's single shared endpoint and blocked every later task for hours. Trashing the card has to
		// take its review down with it, or the board shows nothing while the endpoint stays occupied.
		expect(selectTrashedCardSessions(board, ["t1::review", "t1::spec", "done::review"])).toEqual([
			{ taskId: "t1::review", columnId: "trash" },
			{ taskId: "t1::spec", columnId: "trash" },
			{ taskId: "done::review", columnId: "completed" },
		]);
	});

	it("keeps a session whose card has a live-lane copy, and every derived session with a live or board-less parent", () => {
		expect(selectTrashedCardSessions(board, ["shadow", "shadow::review", "b", "b::review"])).toEqual([]);
		// The custodian's review names no card by design: an absent parent means "not board-owned", not "orphaned".
		expect(selectTrashedCardSessions(board, ["main-branch-custodian::review"])).toEqual([]);
	});

	it("stops a session whose card was deleted from the board outright (no lane at all)", () => {
		expect(selectTrashedCardSessions(board, ["gone-card"])).toEqual([{ taskId: "gone-card", columnId: "absent" }]);
		expect(selectTrashedCardSessions({ columns: [] }, ["gone-card"])).toEqual([]);
	});
});
