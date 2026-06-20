import { describe, expect, it, vi } from "vitest";
import type { RuntimeBoardData } from "../../src/core/api-contract";
import {
	mergeTaskWorktreesInDependencyOrder,
	orderTaskWorktreeAutoMergeCandidates,
	type TaskWorktreeAutoMergeCandidate,
} from "../../src/workspace/task-worktree-auto-merge";

function createTask(id: string, baseRef = "main") {
	return {
		id,
		title: id,
		prompt: `Do ${id}`,
		startInPlanMode: false,
		autoReviewEnabled: true,
		autoReviewMode: "commit" as const,
		baseRef,
		createdAt: 1,
		updatedAt: 1,
	};
}

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [createTask("ui"), createTask("storage")],
			},
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [{ id: "dep-1", fromTaskId: "ui", toTaskId: "storage", createdAt: 1 }],
	};
}

describe("task worktree auto merge", () => {
	it("orders merge candidates by dependency prerequisites before dependents", () => {
		const board = createBoard();
		const candidates: TaskWorktreeAutoMergeCandidate[] = [
			{ task: createTask("ui"), columnId: "review", boardIndex: 0 },
			{ task: createTask("storage"), columnId: "review", boardIndex: 1 },
		];

		expect(orderTaskWorktreeAutoMergeCandidates(board, candidates).map((candidate) => candidate.task.id)).toEqual([
			"storage",
			"ui",
		]);
	});

	it("blocks when the base worktree is dirty", async () => {
		const runGit = vi.fn(async (_cwd: string, _args: string[]) => ({
			ok: true,
			stdout: " M src/app.ts",
			stderr: "",
			output: " M src/app.ts",
			error: null,
			exitCode: 0,
		}));

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			runGit,
		});

		expect(result.ok).toBe(false);
		expect(result.blocked?.taskId).toBeNull();
		expect(result.blocked?.reason).toContain("uncommitted changes");
		expect(runGit).toHaveBeenCalledWith("/repo", ["status", "--porcelain", "--", ".", ":(exclude).cline/nklein"]);
	});

	it("ignores project-local !Klein state while checking base worktree cleanliness", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).cline/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
			}
			if (key === "/repo merge-base --is-ancestor result-head HEAD") {
				return { ok: false, stdout: "", stderr: "", output: "", error: "not ancestor", exitCode: 1 };
			}
			if (key === "/repo merge --no-ff --no-edit result-head") {
				return { ok: true, stdout: "merged", stderr: "", output: "merged", error: null, exitCode: 0 };
			}
			throw new Error(`Unexpected git call: ${key}`);
		});

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskCwd: vi.fn(async () => "/worktrees/storage"),
			resolveTaskResultBranchCommit: vi.fn(async () => "result-head"),
		});

		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual(["storage"]);
	});

	it("aborts a conflicted merge and reports conflicted paths", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).cline/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
			}
			if (key === "/worktrees/storage rev-parse --verify HEAD") {
				return { ok: true, stdout: "storage-head", stderr: "", output: "storage-head", error: null, exitCode: 0 };
			}
			if (key === "/repo merge-base --is-ancestor storage-head HEAD") {
				return { ok: false, stdout: "", stderr: "", output: "", error: "not ancestor", exitCode: 1 };
			}
			if (key === "/repo merge --no-ff --no-edit storage-head") {
				return {
					ok: false,
					stdout: "",
					stderr: "CONFLICT (content): Merge conflict in src/storage.ts",
					output: "CONFLICT",
					error: "merge failed",
					exitCode: 1,
				};
			}
			if (key === "/repo diff --name-only --diff-filter=U -z") {
				return {
					ok: true,
					stdout: "src/storage.ts\0",
					stderr: "",
					output: "src/storage.ts",
					error: null,
					exitCode: 0,
				};
			}
			if (key === "/repo merge --abort") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			throw new Error(`Unexpected git call: ${key}`);
		});

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => null),
			resolveTaskCwd: vi.fn(async () => "/worktrees/storage"),
		});

		expect(result.ok).toBe(false);
		expect(result.conflict).toMatchObject({
			taskId: "storage",
			conflictedPaths: ["src/storage.ts"],
		});
		expect(runGit).toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("merges a task result branch without resolving a legacy worktree", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).cline/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
			}
			if (key === "/repo merge-base --is-ancestor result-head HEAD") {
				return { ok: false, stdout: "", stderr: "", output: "", error: "not ancestor", exitCode: 1 };
			}
			if (key === "/repo merge --no-ff --no-edit result-head") {
				return { ok: true, stdout: "merged", stderr: "", output: "merged", error: null, exitCode: 0 };
			}
			throw new Error(`Unexpected git call: ${key}`);
		});
		const resolveTaskCwd = vi.fn(async () => "/worktrees/storage");

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskCwd,
			resolveTaskResultBranchCommit: vi.fn(async () => "result-head"),
		});

		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual(["storage"]);
		expect(resolveTaskCwd).not.toHaveBeenCalled();
	});
});
