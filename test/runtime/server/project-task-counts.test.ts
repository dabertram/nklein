import { describe, expect, it } from "vitest";
import type { RuntimeBoardData, RuntimeWorkspaceStateResponse } from "../../../src/core/api-contract";
import {
	applyLiveSessionStateToProjectTaskCounts,
	countTasksByColumn,
	createEmptyProjectTaskCounts,
} from "../../../src/server/project-task-counts";

function board(cardsByColumn: Partial<Record<string, string[]>>): RuntimeBoardData {
	const columns = ["backlog", "planning", "in_progress", "review", "completed", "trash"].map((id) => ({
		id,
		cards: (cardsByColumn[id] ?? []).map((cardId) => ({ id: cardId })),
	}));
	return { columns } as unknown as RuntimeBoardData;
}

function sessions(entries: Array<{ taskId: string; state: string }>): RuntimeWorkspaceStateResponse["sessions"] {
	return Object.fromEntries(
		entries.map((entry) => [entry.taskId, entry]),
	) as unknown as RuntimeWorkspaceStateResponse["sessions"];
}

describe("createEmptyProjectTaskCounts", () => {
	it("starts every column at zero", () => {
		expect(createEmptyProjectTaskCounts()).toEqual({
			backlog: 0,
			planning: 0,
			in_progress: 0,
			review: 0,
			completed: 0,
			trash: 0,
		});
	});
});

describe("countTasksByColumn", () => {
	it("tallies the cards in each column", () => {
		const counts = countTasksByColumn(board({ planning: ["p1"], in_progress: ["t1", "t2"], completed: ["c1"] }));
		expect(counts).toEqual({ backlog: 0, planning: 1, in_progress: 2, review: 0, completed: 1, trash: 0 });
	});
});

describe("applyLiveSessionStateToProjectTaskCounts", () => {
	it("moves an awaiting_review card from in_progress or planning into review", () => {
		const b = board({ planning: ["p1"], in_progress: ["t1", "t2"] });
		const counts = countTasksByColumn(b);
		const next = applyLiveSessionStateToProjectTaskCounts(
			counts,
			b,
			sessions([
				{ taskId: "t1", state: "awaiting_review" },
				{ taskId: "p1", state: "awaiting_review" },
			]),
		);
		expect(next).toEqual({ backlog: 0, planning: 0, in_progress: 1, review: 2, completed: 0, trash: 0 });
	});

	it("leaves cards in other columns and non-awaiting states untouched", () => {
		const b = board({ in_progress: ["t1"], completed: ["c1"] });
		const counts = countTasksByColumn(b);
		const next = applyLiveSessionStateToProjectTaskCounts(
			counts,
			b,
			sessions([
				{ taskId: "t1", state: "running" }, // not awaiting_review
				{ taskId: "c1", state: "awaiting_review" }, // not in planning/in_progress
			]),
		);
		expect(next).toEqual(counts);
	});

	it("ignores a live session with no matching board card", () => {
		const b = board({ in_progress: ["t1"] });
		const counts = countTasksByColumn(b);
		const next = applyLiveSessionStateToProjectTaskCounts(
			counts,
			b,
			sessions([{ taskId: "ghost", state: "awaiting_review" }]),
		);
		expect(next).toEqual(counts);
	});

	it("does not mutate the input counts object", () => {
		const b = board({ in_progress: ["t1"] });
		const counts = countTasksByColumn(b);
		applyLiveSessionStateToProjectTaskCounts(counts, b, sessions([{ taskId: "t1", state: "awaiting_review" }]));
		expect(counts.in_progress).toBe(1);
		expect(counts.review).toBe(0);
	});
});
