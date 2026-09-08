import { describe, expect, it } from "vitest";
import { selectReleasableTaskSessions } from "../../../src/core/settled-task-session-release";

/**
 * P0.HEAP. The task-session service kept EVERY session it ever started for the life of the process — the
 * transcript mirror, the launch request, the per-session focus/edit records, and a dozen bookkeeping maps — with
 * no release seam for a card that finished. The persisted SDK session is the durable truth; these are caches.
 *
 * The two rules that keep releasing them safe: a LIVE session is never released whatever lane its card is in, and
 * an empty board snapshot releases nothing, because "the board failed to load" and "the board is empty" look
 * identical from here.
 */
const board = {
	columns: [
		{ id: "planning", cards: [{ id: "live" }] },
		{ id: "in_progress", cards: [{ id: "working" }] },
		{ id: "completed", cards: [{ id: "done" }] },
		{ id: "trash", cards: [{ id: "binned" }] },
	],
};

describe("selectReleasableTaskSessions", () => {
	it("releases a settled session whose card sits in a terminal lane, naming which", () => {
		expect(
			selectReleasableTaskSessions(board, [
				{ taskId: "done", state: "completed" },
				{ taskId: "binned", state: "failed" },
			]),
		).toEqual([
			{ taskId: "done", reason: "completed" },
			{ taskId: "binned", reason: "trash" },
		]);
	});

	it("never releases a LIVE session, whatever lane its card is in", () => {
		for (const state of ["running", "queued", "paused"]) {
			expect(selectReleasableTaskSessions(board, [{ taskId: "done", state }])).toEqual([]);
		}
	});

	it("keeps a session whose card is still in a working lane", () => {
		expect(selectReleasableTaskSessions(board, [{ taskId: "live", state: "completed" }])).toEqual([]);
		expect(selectReleasableTaskSessions(board, [{ taskId: "working", state: "failed" }])).toEqual([]);
	});

	it("releases a session whose card has been deleted from the board outright", () => {
		expect(selectReleasableTaskSessions(board, [{ taskId: "gone", state: "completed" }])).toEqual([
			{ taskId: "gone", reason: "absent" },
		]);
	});

	it("follows a derived session to its board card", () => {
		expect(
			selectReleasableTaskSessions(board, [
				{ taskId: "done::review", state: "completed" },
				{ taskId: "live::review", state: "completed" },
			]),
		).toEqual([{ taskId: "done::review", reason: "completed" }]);
	});

	it("releases NOTHING on an empty board — a snapshot that failed to load looks exactly like an empty one", () => {
		expect(selectReleasableTaskSessions({ columns: [] }, [{ taskId: "done", state: "completed" }])).toEqual([]);
	});

	it("reports each session once even when the summaries repeat", () => {
		expect(
			selectReleasableTaskSessions(board, [
				{ taskId: "done", state: "completed" },
				{ taskId: "done", state: "failed" },
			]),
		).toEqual([{ taskId: "done", reason: "completed" }]);
	});
});
