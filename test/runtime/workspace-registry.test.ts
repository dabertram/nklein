import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import { collectProjectWorktreeTaskIdsForRemoval } from "../../src/server/workspace-registry";

describe("collectProjectWorktreeTaskIdsForRemoval", () => {
	it("includes tasks from every board column during project cleanup", () => {
		const board = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [{ id: "backlog-task" }] },
				{ id: "in_progress", title: "In Progress", cards: [{ id: "active-task" }] },
				{ id: "review", title: "Review", cards: [{ id: "review-task" }] },
				{ id: "trash", title: "Trash", cards: [{ id: "trash-task" }] },
			],
			dependencies: [],
		} as unknown as RuntimeBoardData;

		expect(Array.from(collectProjectWorktreeTaskIdsForRemoval(board)).sort()).toEqual([
			"active-task",
			"backlog-task",
			"review-task",
			"trash-task",
		]);
	});
});
