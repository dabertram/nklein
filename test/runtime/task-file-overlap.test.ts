import { describe, expect, it } from "vitest";
import type { RuntimeBoardCard, RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import {
	findActiveTaskLikelyTouchedFileOverlap,
	tasksHaveLikelyTouchedFileOverlap,
} from "../../src/core/task-file-overlap";

function createTask(id: string, filesLikelyTouched?: string[]): RuntimeBoardCard {
	return {
		id,
		title: id,
		prompt: id,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		filesLikelyTouched,
		baseRef: "main",
		createdAt: 1,
		updatedAt: 1,
	};
}

function createSession(taskId: string, state: RuntimeTaskSessionSummary["state"]): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "cline",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

describe("task file overlap", () => {
	it("matches likely touched files with normalized relative paths", () => {
		expect(
			tasksHaveLikelyTouchedFileOverlap(createTask("a", ["./src/shared.ts"]), createTask("b", ["src/shared.ts"])),
		).toBe(true);
		expect(tasksHaveLikelyTouchedFileOverlap(createTask("a", ["src/a.ts"]), createTask("b", ["src/b.ts"]))).toBe(
			false,
		);
	});

	it("finds active overlapping tasks from board sessions", () => {
		const board: RuntimeBoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [createTask("candidate", ["src/shared.ts"])] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [createTask("active", ["src/shared.ts"])] },
				{ id: "review", title: "Review", cards: [createTask("idle-review", ["src/shared.ts"])] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};

		expect(
			findActiveTaskLikelyTouchedFileOverlap({
				board,
				sessions: {
					active: createSession("active", "running"),
					"idle-review": createSession("idle-review", "idle"),
				},
				task: createTask("candidate", ["src/shared.ts"]),
			})?.id,
		).toBe("active");
	});
});
