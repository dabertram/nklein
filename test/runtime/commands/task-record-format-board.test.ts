import { describe, expect, it } from "vitest";
import {
	findTaskRecord,
	findTasksInColumn,
	formatDependencyRecord,
	formatTaskRecord,
} from "../../../src/commands/task/task-record-format";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "../../../src/core/api-contract";

function card(id: string, overrides: Partial<RuntimeBoardCard> = {}): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: `prompt ${id}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	} as RuntimeBoardCard;
}

function session(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId: "nklein",
		workspacePath: null,
		pid: 4242,
		startedAt: 10,
		updatedAt: 20,
		lastOutputAt: 15,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

function stateWith(
	board: RuntimeBoardData,
	sessions: Record<string, RuntimeTaskSessionSummary> = {},
): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/repo",
		statePath: "/repo/.nklein",
		git: { currentBranch: "main", defaultBranch: "main", branches: ["main"] },
		board,
		sessions,
		revision: 1,
	};
}

function board(cardsByColumn: Array<{ columnId: string; card: RuntimeBoardCard }>): RuntimeBoardData {
	const columnIds = ["backlog", "planning", "in_progress", "review", "completed", "trash"] as const;
	return {
		columns: columnIds.map((id) => ({
			id,
			title: id,
			cards: cardsByColumn.filter((entry) => entry.columnId === id).map((entry) => entry.card),
		})),
		dependencies: [],
	};
}

describe("findTaskRecord", () => {
	it("locates a card and its column, or returns null", () => {
		const state = stateWith(board([{ columnId: "in_progress", card: card("a") }]));
		expect(findTaskRecord(state, "a")).toEqual({
			task: expect.objectContaining({ id: "a" }),
			columnId: "in_progress",
		});
		expect(findTaskRecord(state, "missing")).toBeNull();
	});
});

describe("findTasksInColumn", () => {
	it("returns every card in the requested column, tagged with the column id", () => {
		const state = stateWith(
			board([
				{ columnId: "backlog", card: card("a") },
				{ columnId: "backlog", card: card("b") },
				{ columnId: "review", card: card("c") },
			]),
		);
		expect(findTasksInColumn(state, "backlog").map((entry) => entry.task.id)).toEqual(["a", "b"]);
		expect(findTasksInColumn(state, "review").map((entry) => entry.columnId)).toEqual(["review"]);
		expect(findTasksInColumn(state, "completed")).toEqual([]);
	});
});

describe("formatTaskRecord", () => {
	it("emits the core fields, defaulting autoReviewMode and omitting an absent agentId/session", () => {
		const state = stateWith(board([{ columnId: "planning", card: card("a") }]));
		const record = formatTaskRecord(state, card("a"), "planning");
		expect(record).toMatchObject({
			id: "a",
			column: "planning",
			baseRef: "main",
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			session: null,
		});
		expect(record).not.toHaveProperty("agentId");
	});

	it("includes agentId and the session summary when present", () => {
		const state = stateWith(board([{ columnId: "in_progress", card: card("a") }]), { a: session("a") });
		const record = formatTaskRecord(state, card("a", { agentId: "nklein" }), "in_progress");
		expect(record.agentId).toBe("nklein");
		expect(record.session).toMatchObject({ state: "running", pid: 4242, reviewReason: null });
	});
});

describe("formatDependencyRecord", () => {
	it("maps a dependency to its from/to ids and resolves each task's column", () => {
		const state = stateWith(
			board([
				{ columnId: "backlog", card: card("from") },
				{ columnId: "in_progress", card: card("to") },
			]),
		);
		const record = formatDependencyRecord(state, { id: "d1", fromTaskId: "from", toTaskId: "to", createdAt: 5 });
		expect(record).toMatchObject({
			id: "d1",
			backlogTaskId: "from",
			backlogTaskColumn: "backlog",
			linkedTaskId: "to",
			linkedTaskColumn: "in_progress",
			createdAt: 5,
		});
	});
});
