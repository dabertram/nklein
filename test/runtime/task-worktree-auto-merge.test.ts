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

interface GitResponse {
	ok: boolean;
	stdout: string;
	stderr: string;
	output: string;
	error: string | null;
	exitCode: number;
}

const gitOk = (stdout = ""): GitResponse => ({
	ok: true,
	stdout,
	stderr: "",
	output: stdout,
	error: null,
	exitCode: 0,
});

const gitFail = (error: string, exitCode = 1, stderr = ""): GitResponse => ({
	ok: false,
	stdout: "",
	stderr,
	output: stderr,
	error,
	exitCode,
});

/** runGit mock pre-wired for the standard "storage conflicts on one path" flow; override per-key as needed. */
function createConflictedMergeRunGit(input: { conflictedPath?: string; responses?: Record<string, GitResponse> }) {
	const conflictedPath = input.conflictedPath ?? "src/storage.ts";
	const responses: Record<string, GitResponse> = {
		"/repo status --porcelain -- . :(exclude).nklein/nklein": gitOk(""),
		"/repo branch --show-current": gitOk("main"),
		"/repo merge-base --is-ancestor storage-head HEAD": gitFail("not ancestor"),
		"/repo merge --no-ff --no-edit storage-head": gitFail("merge failed", 1, "CONFLICT"),
		"/repo diff --name-only --diff-filter=U -z": gitOk(`${conflictedPath}\0`),
		"/repo rev-parse -q --verify MERGE_HEAD": gitOk("merge-head-sha"),
		"/repo merge --abort": gitOk(""),
		...(input.responses ?? {}),
	};
	return vi.fn(async (cwd: string, args: string[]) => {
		const key = `${cwd} ${args.join(" ")}`;
		const response = responses[key];
		if (!response) {
			throw new Error(`Unexpected git call: ${key}`);
		}
		return response;
	});
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
		expect(runGit).toHaveBeenCalledWith("/repo", ["status", "--porcelain", "--", ".", ":(exclude).nklein/nklein"]);
	});

	it("ignores project-local !Klein state while checking base worktree cleanliness", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
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
			resolveTaskResultBranchCommit: vi.fn(async () => "result-head"),
		});

		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual(["storage"]);
	});

	it("aborts a conflicted merge and reports conflicted paths", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
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
			if (key === "/repo rev-parse -q --verify MERGE_HEAD") {
				return {
					ok: true,
					stdout: "merge-head-sha",
					stderr: "",
					output: "merge-head-sha",
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
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
		});

		expect(result.ok).toBe(false);
		expect(result.conflict).toMatchObject({
			taskId: "storage",
			conflictedPaths: ["src/storage.ts"],
		});
		expect(runGit).toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("completes a conflicted merge with the agent's resolution instead of aborting (§5.AK Phase B)", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
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
			if (key === "/repo rev-parse -q --verify MERGE_HEAD") {
				return {
					ok: true,
					stdout: "merge-head-sha",
					stderr: "",
					output: "merge-head-sha",
					error: null,
					exitCode: 0,
				};
			}
			if (key === "/repo add -- src/storage.ts") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo diff --cached --check -- src/storage.ts") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo commit --no-edit") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			throw new Error(`Unexpected git call: ${key}`);
		});
		const writeResolvedFile = vi.fn(async () => undefined);
		const resolveConflict = vi.fn(async () => ({
			resolvedFiles: [{ path: "src/storage.ts", content: "export const storage = merged();\n" }],
		}));

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict,
			writeResolvedFile,
		});

		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual(["storage"]);
		expect(result.conflict).toBeUndefined();
		expect(result.steps).toContainEqual(
			expect.objectContaining({ type: "merged", taskId: "storage", resolvedByAgent: true }),
		);
		expect(resolveConflict).toHaveBeenCalledWith({
			taskId: "storage",
			headCommit: "storage-head",
			conflictedPaths: ["src/storage.ts"],
		});
		expect(writeResolvedFile).toHaveBeenCalledWith("/repo/src/storage.ts", "export const storage = merged();\n");
		// The conflicted merge state is COMPLETED (commit --no-edit), never aborted.
		expect(runGit).not.toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("aborts exactly as today when the resolution agent yields null", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
			}
			if (key === "/repo merge-base --is-ancestor storage-head HEAD") {
				return { ok: false, stdout: "", stderr: "", output: "", error: "not ancestor", exitCode: 1 };
			}
			if (key === "/repo merge --no-ff --no-edit storage-head") {
				return {
					ok: false,
					stdout: "",
					stderr: "CONFLICT",
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
			if (key === "/repo rev-parse -q --verify MERGE_HEAD") {
				return {
					ok: true,
					stdout: "merge-head-sha",
					stderr: "",
					output: "merge-head-sha",
					error: null,
					exitCode: 0,
				};
			}
			if (key === "/repo merge --abort") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			throw new Error(`Unexpected git call: ${key}`);
		});
		const writeResolvedFile = vi.fn(async () => undefined);

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict: vi.fn(async () => null),
			writeResolvedFile,
		});

		expect(result.ok).toBe(false);
		expect(result.conflict).toMatchObject({ taskId: "storage", conflictedPaths: ["src/storage.ts"] });
		expect(writeResolvedFile).not.toHaveBeenCalled();
		expect(runGit).toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("aborts when the agent's resolution still contains conflict markers (never committed)", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
			}
			if (key === "/repo merge-base --is-ancestor storage-head HEAD") {
				return { ok: false, stdout: "", stderr: "", output: "", error: "not ancestor", exitCode: 1 };
			}
			if (key === "/repo merge --no-ff --no-edit storage-head") {
				return {
					ok: false,
					stdout: "",
					stderr: "CONFLICT",
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
			if (key === "/repo rev-parse -q --verify MERGE_HEAD") {
				return {
					ok: true,
					stdout: "merge-head-sha",
					stderr: "",
					output: "merge-head-sha",
					error: null,
					exitCode: 0,
				};
			}
			if (key === "/repo merge --abort") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			throw new Error(`Unexpected git call: ${key}`);
		});
		const writeResolvedFile = vi.fn(async () => undefined);

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict: vi.fn(async () => ({
				resolvedFiles: [
					{
						path: "src/storage.ts",
						content: "<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> storage-head\n",
					},
				],
			})),
			writeResolvedFile,
		});

		expect(result.ok).toBe(false);
		expect(result.conflict).toMatchObject({ taskId: "storage" });
		// Marker-laden "resolutions" are rejected BEFORE any write reaches the host worktree.
		expect(writeResolvedFile).not.toHaveBeenCalled();
		expect(runGit).toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("accepts a sound resolution with a legitimate bare ======= line despite a --check complaint (setext underline)", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
			}
			if (key === "/repo merge-base --is-ancestor storage-head HEAD") {
				return { ok: false, stdout: "", stderr: "", output: "", error: "not ancestor", exitCode: 1 };
			}
			if (key === "/repo merge --no-ff --no-edit storage-head") {
				return {
					ok: false,
					stdout: "",
					stderr: "CONFLICT",
					output: "CONFLICT",
					error: "merge failed",
					exitCode: 1,
				};
			}
			if (key === "/repo diff --name-only --diff-filter=U -z") {
				return {
					ok: true,
					stdout: "docs/guide.md\0",
					stderr: "",
					output: "docs/guide.md",
					error: null,
					exitCode: 0,
				};
			}
			if (key === "/repo rev-parse -q --verify MERGE_HEAD") {
				return {
					ok: true,
					stdout: "merge-head-sha",
					stderr: "",
					output: "merge-head-sha",
					error: null,
					exitCode: 0,
				};
			}
			if (key === "/repo add -- docs/guide.md") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo diff --cached --check -- docs/guide.md") {
				// git flags ANY added line of exactly seven marker chars — including a legitimate setext
				// underline. The empirical repro: this exact complaint used to reject a sound resolution.
				return {
					ok: false,
					stdout: "docs/guide.md:2: leftover conflict marker",
					stderr: "",
					output: "docs/guide.md:2: leftover conflict marker",
					error: "check failed",
					exitCode: 2,
				};
			}
			if (key === "/repo commit --no-edit") {
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
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict: vi.fn(async () => ({
				// Bare `=======` (Markdown setext underline) is legitimate content, not a conflict marker.
				resolvedFiles: [{ path: "docs/guide.md", content: "Title\n=======\nmerged body\n" }],
			})),
			writeResolvedFile: vi.fn(async () => undefined),
		});

		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual(["storage"]);
		expect(result.steps).toContainEqual(
			expect.objectContaining({ type: "merged", taskId: "storage", resolvedByAgent: true }),
		);
		expect(runGit).toHaveBeenCalledWith("/repo", ["commit", "--no-edit"]);
		expect(runGit).not.toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("rejects a resolution whose host target is not a regular file (symlink lstat guard) without writing", async () => {
		const runGit = createConflictedMergeRunGit({});
		const writeResolvedFile = vi.fn(async () => undefined);
		// lstat says the host path is a symlink (or dir/fifo) — writeFile would follow it somewhere else entirely.
		const inspectResolvedFilePath = vi.fn(async () => "other" as const);

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict: vi.fn(async () => ({
				resolvedFiles: [{ path: "src/storage.ts", content: "export const storage = merged();\n" }],
			})),
			writeResolvedFile,
			inspectResolvedFilePath,
		});

		expect(result.ok).toBe(false);
		expect(result.conflict).toMatchObject({ taskId: "storage" });
		expect(inspectResolvedFilePath).toHaveBeenCalledWith("/repo/src/storage.ts");
		expect(writeResolvedFile).not.toHaveBeenCalled();
		expect(runGit).not.toHaveBeenCalledWith("/repo", ["commit", "--no-edit"]);
		expect(runGit).toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("rejects conflicted paths that escape the repo root (path traversal) before any write or lstat", async () => {
		const runGit = createConflictedMergeRunGit({ conflictedPath: "../../outside/evil.txt" });
		const writeResolvedFile = vi.fn(async () => undefined);
		const inspectResolvedFilePath = vi.fn(async () => "file" as const);

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict: vi.fn(async () => ({
				resolvedFiles: [{ path: "../../outside/evil.txt", content: "pwned\n" }],
			})),
			writeResolvedFile,
			inspectResolvedFilePath,
		});

		expect(result.ok).toBe(false);
		expect(result.conflict).toMatchObject({ taskId: "storage" });
		// Containment is checked FIRST: no filesystem probe, no write, no commit for an out-of-repo target.
		expect(inspectResolvedFilePath).not.toHaveBeenCalled();
		expect(writeResolvedFile).not.toHaveBeenCalled();
		expect(runGit).not.toHaveBeenCalledWith("/repo", ["commit", "--no-edit"]);
		expect(runGit).toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
	});

	it("returns conflict without writing or aborting when the host merge state is gone (MERGE_HEAD consumed)", async () => {
		const runGit = createConflictedMergeRunGit({
			responses: {
				"/repo rev-parse -q --verify MERGE_HEAD": gitFail("no merge in progress", 1),
			},
		});
		const writeResolvedFile = vi.fn(async () => undefined);
		const inspectResolvedFilePath = vi.fn(async () => "file" as const);

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict: vi.fn(async () => ({
				resolvedFiles: [{ path: "src/storage.ts", content: "export const storage = merged();\n" }],
			})),
			writeResolvedFile,
			inspectResolvedFilePath,
		});

		expect(result.ok).toBe(false);
		expect(result.conflict).toMatchObject({ taskId: "storage" });
		// Another actor consumed/aborted the merge during the agent window: never write into that state, and
		// never run `merge --abort` (it would stomp on THAT actor's in-flight merge).
		expect(writeResolvedFile).not.toHaveBeenCalled();
		expect(runGit).not.toHaveBeenCalledWith("/repo", ["merge", "--abort"]);
		expect(runGit).not.toHaveBeenCalledWith("/repo", ["commit", "--no-edit"]);
	});

	it("surfaces a failed merge --abort loudly in the conflict message without throwing", async () => {
		const runGit = createConflictedMergeRunGit({
			responses: {
				"/repo merge --abort": gitFail("abort failed", 128, "fatal: There is no merge to abort"),
				"/repo status --porcelain": gitOk("UU src/storage.ts\n M src/other.ts"),
			},
		});

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: "/repo",
			board: createBoard(),
			columns: ["review"],
			taskIds: ["storage"],
			runGit,
			resolveTaskResultBranchCommit: vi.fn(async () => "storage-head"),
			resolveConflict: vi.fn(async () => null),
			writeResolvedFile: vi.fn(async () => undefined),
		});

		expect(result.ok).toBe(false);
		expect(result.conflict?.message).toContain("`git merge --abort` FAILED");
		expect(result.conflict?.message).toContain("fatal: There is no merge to abort");
		// The operator sees what the repo actually looks like (status --porcelain head).
		expect(result.conflict?.message).toContain("UU src/storage.ts");
	});

	it("skips a task whose result branch is absent (nothing host-visible to merge)", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
				return { ok: true, stdout: "", stderr: "", output: "", error: null, exitCode: 0 };
			}
			if (key === "/repo branch --show-current") {
				return { ok: true, stdout: "main", stderr: "", output: "main", error: null, exitCode: 0 };
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
		});

		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual([]);
		expect(result.skippedTaskIds).toEqual(["storage"]);
		expect(runGit).not.toHaveBeenCalledWith("/repo", ["merge", "--no-ff", "--no-edit", expect.anything()]);
	});

	it("merges a task result branch without resolving a legacy worktree", async () => {
		const runGit = vi.fn(async (cwd: string, args: string[]) => {
			const key = `${cwd} ${args.join(" ")}`;
			if (key === "/repo status --porcelain -- . :(exclude).nklein/nklein") {
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
			resolveTaskResultBranchCommit: vi.fn(async () => "result-head"),
		});

		expect(result.ok).toBe(true);
		expect(result.mergedTaskIds).toEqual(["storage"]);
	});
});
