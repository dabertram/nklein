import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import {
	addTaskDependency,
	addTaskToColumn,
	canAddTaskDependency,
	deleteTasksFromBoard,
	findBoardCardWithColumn,
	getReadyLinkedTaskIdsForTaskInTrash,
	getTaskColumnId,
	moveTaskToColumn,
	removeTaskDependency,
	setCardStream,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
} from "../../src/core/task-board-mutations";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

describe("deleteTasksFromBoard", () => {
	it("removes a trashed task and any dependencies that reference it", () => {
		const createA = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(createA.board, "review", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, "bbbbb");
		const deleted = deleteTasksFromBoard(trashed.board, ["bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds).toEqual(["bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
		expect(deleted.board.dependencies).toEqual([]);
	});

	it("removes multiple trashed tasks at once", () => {
		const createA = addTaskToColumn(createBoard(), "trash", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const createB = addTaskToColumn(createA.board, "trash", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");

		const deleted = deleteTasksFromBoard(createB.board, ["aaaaa", "bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds.sort()).toEqual(["aaaaa", "bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
	});
});

describe("planning task dependencies", () => {
	it("allows planning-to-planning links and reorients them when one task starts", () => {
		const createA = addTaskToColumn(
			createBoard(),
			"planning",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(
			createA.board,
			"planning",
			{ prompt: "Task B", baseRef: "main" },
			() => "bbbbb111",
		);

		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		const movedA = moveTaskToColumn(linked.board, "aaaaa", "in_progress");

		expect(linked.added).toBe(true);
		expect(linked.dependency).toMatchObject({ fromTaskId: "aaaaa", toTaskId: "bbbbb" });
		expect(movedA.board.dependencies).toEqual([expect.objectContaining({ fromTaskId: "bbbbb", toTaskId: "aaaaa" })]);
	});

	it("reports planning children as ready when their prerequisite finishes review", () => {
		const createA = addTaskToColumn(
			createBoard(),
			"planning",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(
			createA.board,
			"planning",
			{ prompt: "Task B", baseRef: "main" },
			() => "bbbbb111",
		);
		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		const movedPrerequisite = moveTaskToColumn(linked.board, "bbbbb", "review");

		const trashed = trashTaskAndGetReadyLinkedTaskIds(movedPrerequisite.board, "bbbbb");

		expect(trashed.readyTaskIds).toEqual(["aaaaa"]);
	});
});

describe("task images", () => {
	it("preserves images when creating and updating tasks", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task with image",
				baseRef: "main",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			},
			() => "aaaaa111",
		);

		expect(created.task.images).toEqual([
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task with updated image",
			baseRef: "main",
			images: [
				{
					id: "img-2",
					data: "def456",
					mimeType: "image/jpeg",
				},
			],
		});

		expect(updated.task?.images).toEqual([
			{
				id: "img-2",
				data: "def456",
				mimeType: "image/jpeg",
			},
		]);
	});
});

describe("per-task agent/model/provider overrides", () => {
	it("persists agentId on the card when creating a task", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Smart task", baseRef: "main", agentId: "claude" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBe("claude");
	});

	it("persists task-level NKlein settings on the card when creating a task", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Dumb task",
				baseRef: "main",
				agentId: "nklein",
				nkleinSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "high",
				},
			},
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBe("nklein");
		expect(created.task.nkleinSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "high",
		});
	});

	it("leaves override fields undefined when not provided", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Default task", baseRef: "main" },
			() => "aaaaa111",
		);

		expect(created.task.agentId).toBeUndefined();
		expect(created.task.nkleinSettings).toBeUndefined();
	});

	it("updates agentId from undefined to a value", () => {
		const created = addTaskToColumn(createBoard(), "backlog", { prompt: "Task", baseRef: "main" }, () => "aaaaa111");
		expect(created.task.agentId).toBeUndefined();

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: "codex",
		});

		expect(updated.updated).toBe(true);
		expect(updated.task?.agentId).toBe("codex");
	});

	it("updates nkleinModelId", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task", baseRef: "main", nkleinSettings: { modelId: "old-model" } },
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			nkleinSettings: { modelId: "new-model" },
		});

		expect(updated.task?.nkleinSettings?.modelId).toBe("new-model");
	});

	it("preserves existing overrides when update input omits them (undefined)", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "claude",
				nkleinSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "low",
				},
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Updated prompt",
			baseRef: "main",
			// agentId and nkleinSettings are undefined, so existing overrides should persist
		});

		expect(updated.task?.agentId).toBe("claude");
		expect(updated.task?.nkleinSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "low",
		});
	});

	it("clears overrides when update input provides null", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
				agentId: "codex",
				nkleinSettings: {
					providerId: "openai",
					modelId: "gpt-4",
					reasoningEffort: "medium",
				},
			},
			() => "aaaaa111",
		);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task",
			baseRef: "main",
			agentId: null,
			nkleinSettings: null,
		});

		expect(updated.task?.agentId).toBeUndefined();
		expect(updated.task?.nkleinSettings).toBeUndefined();
	});

	it("preserves overrides across move operations", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Movable task",
				baseRef: "main",
				agentId: "claude",
				nkleinSettings: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-20250514",
					reasoningEffort: "high",
				},
			},
			() => "aaaaa111",
		);

		const moved = moveTaskToColumn(created.board, created.task.id, "in_progress");

		expect(moved.moved).toBe(true);
		expect(moved.task?.agentId).toBe("claude");
		expect(moved.task?.nkleinSettings).toEqual({
			providerId: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			reasoningEffort: "high",
		});
	});
});

describe("setCardStream (§5.AU)", () => {
	it("sets a card's streamId, clears it with null, and bumps updatedAt — leaving other cards untouched", () => {
		const withA = addTaskToColumn(
			createBoard(),
			"planning",
			{ taskId: "a", prompt: "A", baseRef: "main" },
			() => "a",
		);
		const withB = addTaskToColumn(withA.board, "planning", { taskId: "b", prompt: "B", baseRef: "main" }, () => "b");

		const set = setCardStream(withB.board, "a", "stream-x", 5000);
		expect(set.updated).toBe(true);
		expect(set.card?.streamId).toBe("stream-x");
		expect(set.card?.updatedAt).toBe(5000);
		const cards = set.board.columns.flatMap((c) => c.cards);
		expect(cards.find((c) => c.id === "a")?.streamId).toBe("stream-x");
		expect(cards.find((c) => c.id === "b")?.streamId).toBeUndefined();

		const cleared = setCardStream(set.board, "a", null, 6000);
		expect(cleared.card?.streamId).toBeUndefined();
	});

	it("returns updated:false for a missing card or blank id", () => {
		expect(setCardStream(createBoard(), "nope", "s").updated).toBe(false);
		expect(setCardStream(createBoard(), "  ", "s").updated).toBe(false);
	});
});

describe("getTaskColumnId / findBoardCardWithColumn", () => {
	it("returns the lane of an existing task and trims the lookup id", () => {
		const board = addTaskToColumn(
			createBoard(),
			"in_progress",
			{ taskId: "abcde", prompt: "P", baseRef: "main" },
			() => "x",
		).board;
		expect(getTaskColumnId(board, "abcde")).toBe("in_progress");
		expect(getTaskColumnId(board, "  abcde  ")).toBe("in_progress");
	});

	it("returns null for an unknown, empty, or whitespace id", () => {
		const board = createBoard();
		expect(getTaskColumnId(board, "missing")).toBeNull();
		expect(getTaskColumnId(board, "")).toBeNull();
		expect(getTaskColumnId(board, "   ")).toBeNull();
	});

	it("findBoardCardWithColumn returns the card + lane, or null when absent", () => {
		const board = addTaskToColumn(
			createBoard(),
			"review",
			{ taskId: "card1", prompt: "Hello", baseRef: "main" },
			() => "x",
		).board;
		const found = findBoardCardWithColumn(board, "card1");
		expect(found?.columnId).toBe("review");
		expect(found?.card.id).toBe("card1");
		expect(found?.card.prompt).toBe("Hello");
		expect(findBoardCardWithColumn(board, "nope")).toBeNull();
	});

	it("findBoardCardWithColumn matches the id EXACTLY — it does not trim like getTaskColumnId", () => {
		// Callers pass canonical task ids from board state, so exact-match is intended (characterization).
		const board = addTaskToColumn(
			createBoard(),
			"backlog",
			{ taskId: "card1", prompt: "P", baseRef: "main" },
			() => "x",
		).board;
		expect(getTaskColumnId(board, " card1 ")).toBe("backlog");
		expect(findBoardCardWithColumn(board, " card1 ")).toBeNull();
	});
});

describe("canAddTaskDependency", () => {
	function twoWaiting(): RuntimeBoardData {
		const a = addTaskToColumn(createBoard(), "backlog", { taskId: "aaaaa", prompt: "A", baseRef: "main" }, () => "x");
		return addTaskToColumn(a.board, "planning", { taskId: "bbbbb", prompt: "B", baseRef: "main" }, () => "x").board;
	}

	it("mirrors addTaskDependency's verdict without mutating the board", () => {
		const board = twoWaiting();
		expect(canAddTaskDependency(board, "aaaaa", "bbbbb")).toBe(true);
		// The predicate must not mutate: the real add still succeeds afterwards.
		const added = addTaskDependency(board, "aaaaa", "bbbbb");
		expect(added.added).toBe(true);
		expect(board.dependencies).toEqual([]);
	});

	it("is false for a blank id, the same id twice, or an unknown task", () => {
		const board = twoWaiting();
		expect(canAddTaskDependency(board, "  ", "bbbbb")).toBe(false);
		expect(canAddTaskDependency(board, "aaaaa", "aaaaa")).toBe(false);
		expect(canAddTaskDependency(board, "aaaaa", "ghost")).toBe(false);
	});

	it("is false once the dependency already exists; two waiting tasks keep the reverse as a distinct link", () => {
		const board = addTaskDependency(twoWaiting(), "aaaaa", "bbbbb").board;
		expect(canAddTaskDependency(board, "aaaaa", "bbbbb")).toBe(false);
		// Both tasks waiting → the FIRST arg is the blocker, so "b blocks a" is a genuinely different link.
		expect(canAddTaskDependency(board, "bbbbb", "aaaaa")).toBe(true);
	});

	it("canonicalizes a waiting↔active link so the reversed argument order is the same (duplicate)", () => {
		const w = addTaskToColumn(createBoard(), "backlog", { taskId: "wwwww", prompt: "W", baseRef: "main" }, () => "x");
		const r = addTaskToColumn(w.board, "review", { taskId: "rrrrr", prompt: "R", baseRef: "main" }, () => "x");
		const linked = addTaskDependency(r.board, "wwwww", "rrrrr");
		expect(linked.added).toBe(true);
		// The waiting task is always the blocker regardless of arg order → reversed args = same pair, not addable.
		expect(canAddTaskDependency(linked.board, "rrrrr", "wwwww")).toBe(false);
	});
});

describe("removeTaskDependency", () => {
	it("removes a dependency by id and reports removed:true", () => {
		const a = addTaskToColumn(createBoard(), "backlog", { taskId: "aaaaa", prompt: "A", baseRef: "main" }, () => "x");
		const b = addTaskToColumn(a.board, "planning", { taskId: "bbbbb", prompt: "B", baseRef: "main" }, () => "x");
		const linked = addTaskDependency(b.board, "aaaaa", "bbbbb");
		if (!linked.added || !linked.dependency) {
			throw new Error("Expected dependency to be created.");
		}
		const removed = removeTaskDependency(linked.board, linked.dependency.id);
		expect(removed.removed).toBe(true);
		expect(removed.board.dependencies).toEqual([]);
	});

	it("is a no-op (removed:false, same board reference) when the id is absent", () => {
		const board = createBoard();
		const result = removeTaskDependency(board, "does-not-exist");
		expect(result.removed).toBe(false);
		expect(result.board).toBe(board);
	});
});

describe("getReadyLinkedTaskIdsForTaskInTrash", () => {
	it("returns the waiting dependants of a task that is sitting in review", () => {
		// waiting task W (backlog) is linked to active task R (review); when R leaves review, W is ready.
		const w = addTaskToColumn(createBoard(), "backlog", { taskId: "wwwww", prompt: "W", baseRef: "main" }, () => "x");
		const r = addTaskToColumn(w.board, "review", { taskId: "rrrrr", prompt: "R", baseRef: "main" }, () => "x");
		const linked = addTaskDependency(r.board, "wwwww", "rrrrr");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		expect(getReadyLinkedTaskIdsForTaskInTrash(linked.board, "rrrrr")).toEqual(["wwwww"]);
	});

	it("returns [] when the task is not in review (the guard lane)", () => {
		const w = addTaskToColumn(createBoard(), "backlog", { taskId: "wwwww", prompt: "W", baseRef: "main" }, () => "x");
		const r = addTaskToColumn(w.board, "planning", { taskId: "rrrrr", prompt: "R", baseRef: "main" }, () => "x");
		const linked = addTaskDependency(r.board, "wwwww", "rrrrr");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		// rrrrr is in planning, not review → no ready dependants surfaced
		expect(getReadyLinkedTaskIdsForTaskInTrash(linked.board, "rrrrr")).toEqual([]);
	});

	it("returns [] for an unknown task or an empty board", () => {
		expect(getReadyLinkedTaskIdsForTaskInTrash(createBoard(), "ghost")).toEqual([]);
	});
});
