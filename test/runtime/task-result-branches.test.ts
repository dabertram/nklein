import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitProcessEnv } from "../../src/core/git-process-env";
import {
	applyTaskPatchToResultBranch,
	createTaskResultBranchName,
	deleteTaskResultBranch,
	deleteTaskResultBranchesForRepo,
	getTaskResultBranchDiff,
	resolveTaskResultBranchCommit,
} from "../../src/workspace/task-result-branches";

function runGit(cwd: string, args: string[]): string {
	return execFileSync("git", ["-c", "core.quotepath=false", ...args], {
		cwd,
		encoding: "utf8",
		env: createGitProcessEnv(),
	}).trim();
}

function createRepo(): { path: string; cleanup: () => void } {
	const path = mkdtempSync(join(tmpdir(), "nklein-task-result-branch-"));
	runGit(path, ["init", "-b", "main"]);
	runGit(path, ["config", "user.name", "Test User"]);
	runGit(path, ["config", "user.email", "test@example.com"]);
	writeFileSync(join(path, "README.md"), "base\n", "utf8");
	runGit(path, ["add", "README.md"]);
	runGit(path, ["commit", "-m", "initial"]);
	return {
		path,
		cleanup: () => rmSync(path, { force: true, recursive: true }),
	};
}

describe("task result branches", () => {
	it("applies a patch into a task branch without changing the checked-out worktree", async () => {
		const repo = createRepo();
		try {
			writeFileSync(join(repo.path, "README.md"), "changed\n", "utf8");
			writeFileSync(join(repo.path, "new.txt"), "new\n", "utf8");
			runGit(repo.path, ["add", "-N", "new.txt"]);
			const patch = runGit(repo.path, ["diff", "--binary", "HEAD", "--"]);
			runGit(repo.path, ["reset", "--hard", "HEAD"]);
			runGit(repo.path, ["clean", "-fd"]);

			const result = await applyTaskPatchToResultBranch({
				repoPath: repo.path,
				taskId: "Task Result/One",
				baseRef: "main",
				patch,
			});

			expect(result).toMatchObject({
				taskId: "Task Result/One",
				branchName: createTaskResultBranchName("Task Result/One"),
			});
			expect(await resolveTaskResultBranchCommit({ repoPath: repo.path, taskId: "Task Result/One" })).toBe(
				result?.headCommit,
			);
			expect(readFileSync(join(repo.path, "README.md"), "utf8")).toBe("base\n");
			expect(runGit(repo.path, ["status", "--porcelain"])).toBe("");
			expect(runGit(repo.path, ["show", `${result?.headCommit}:README.md`])).toBe("changed");
			expect(runGit(repo.path, ["show", `${result?.headCommit}:new.txt`])).toBe("new");
		} finally {
			repo.cleanup();
		}
	});

	it("returns the result branch diff against the base ref, and null when absent", async () => {
		const repo = createRepo();
		try {
			await expect(
				getTaskResultBranchDiff({ repoPath: repo.path, taskId: "diff-task", baseRef: "main" }),
			).resolves.toBeNull();

			writeFileSync(join(repo.path, "README.md"), "changed\n", "utf8");
			const patch = runGit(repo.path, ["diff", "--binary", "HEAD", "--"]);
			runGit(repo.path, ["reset", "--hard", "HEAD"]);
			await applyTaskPatchToResultBranch({ repoPath: repo.path, taskId: "diff-task", baseRef: "main", patch });

			const diff = await getTaskResultBranchDiff({ repoPath: repo.path, taskId: "diff-task", baseRef: "main" });
			expect(diff).toContain("README.md");
			expect(diff).toContain("+changed");
			expect(diff).toContain("-base");
		} finally {
			repo.cleanup();
		}
	});

	it("does not create a branch for an empty patch", async () => {
		const repo = createRepo();
		try {
			await expect(
				applyTaskPatchToResultBranch({
					repoPath: repo.path,
					taskId: "empty",
					baseRef: "main",
					patch: "\n",
				}),
			).resolves.toBeNull();
			await expect(resolveTaskResultBranchCommit({ repoPath: repo.path, taskId: "empty" })).resolves.toBeNull();
		} finally {
			repo.cleanup();
		}
	});

	it("deletes individual and repo-wide task result branches", async () => {
		const repo = createRepo();
		try {
			writeFileSync(join(repo.path, "README.md"), "changed\n", "utf8");
			const patch = runGit(repo.path, ["diff", "--binary", "HEAD", "--"]);
			runGit(repo.path, ["reset", "--hard", "HEAD"]);
			const first = await applyTaskPatchToResultBranch({
				repoPath: repo.path,
				taskId: "first",
				baseRef: "main",
				patch,
			});
			const second = await applyTaskPatchToResultBranch({
				repoPath: repo.path,
				taskId: "second",
				baseRef: "main",
				patch,
			});
			expect(first?.headCommit).toBeTruthy();
			expect(second?.headCommit).toBeTruthy();

			await expect(deleteTaskResultBranch({ repoPath: repo.path, taskId: "first" })).resolves.toBe(true);
			await expect(resolveTaskResultBranchCommit({ repoPath: repo.path, taskId: "first" })).resolves.toBeNull();
			await expect(resolveTaskResultBranchCommit({ repoPath: repo.path, taskId: "second" })).resolves.toBe(
				second?.headCommit,
			);

			await expect(deleteTaskResultBranchesForRepo({ repoPath: repo.path })).resolves.toBe(1);
			await expect(resolveTaskResultBranchCommit({ repoPath: repo.path, taskId: "second" })).resolves.toBeNull();
		} finally {
			repo.cleanup();
		}
	});
});
