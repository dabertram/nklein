import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeBoardData } from "../../../src/core/api-contract";
import { createGitProcessEnv } from "../../../src/core/git-process-env";
import { mergeTaskWorktreesInDependencyOrder } from "../../../src/workspace/task-worktree-auto-merge";

/**
 * The wedge, staged for real: an interrupted delivery merge leaves the base workspace mid-conflict, and from that
 * moment every later delivery refuses with "Base workspace has uncommitted changes". Live 2026-09-08 this stopped
 * project 38 dead while the board kept delivering into a merge that could never happen.
 *
 * A mocked `runGit` cannot prove this — the whole defect lives in real index state — so this test builds an actual
 * repository, conflicts a merge, kills the process's chance to abort (by simply not aborting), and then asks the
 * merger to run.
 */
let repo: string;

function git(args: string[], cwd = repo): string {
	return execFileSync("git", args, { cwd, encoding: "utf8", env: createGitProcessEnv() });
}

function commit(file: string, content: string, message: string): string {
	writeFileSync(join(repo, file), content, "utf8");
	git(["add", "-A"]);
	git(["commit", "-m", message]);
	return git(["rev-parse", "HEAD"]).trim();
}

function board(taskId: string, baseRef: string): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: taskId,
						title: taskId,
						prompt: taskId,
						startInPlanMode: false,
						autoReviewEnabled: true,
						autoReviewMode: "commit",
						baseRef,
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "nklein-wedge-"));
	git(["init", "-b", "main"]);
	git(["config", "user.email", "test@example.com"]);
	git(["config", "user.name", "Test"]);
	commit("manifest.json", '{"killed":[]}\n', "base");
});

afterEach(() => {
	rmSync(repo, { recursive: true, force: true });
});

describe("an interrupted delivery merge does not wedge the base workspace forever", () => {
	it("aborts the abandoned merge it can prove it started, and the next delivery goes through", () => {
		const base = git(["rev-parse", "HEAD"]).trim();

		// Every branch is built BEFORE the wedge — once the index is conflicted, git refuses to check anything out,
		// which is itself part of why an abandoned merge is so total.
		git(["checkout", "-q", "-b", "result-a"]);
		const resultA = commit("manifest.json", '{"killed":["m1"]}\n', "result a");
		git(["checkout", "-q", base, "-b", "result-b"]);
		const resultB = commit("manifest.json", '{"killed":["m2"]}\n', "result b");
		git(["checkout", "-q", base, "-b", "result-c"]);
		const resultC = commit("notes.md", "notes\n", "result c");
		git(["checkout", "-q", "main"]);
		git(["merge", "--no-ff", "--no-edit", resultA]);

		// Now stage the wedge exactly as it happened: a conflicting merge started, and the process died before its
		// fail-safe abort could run. The mark is what the merger writes before every merge.
		expect(() => git(["merge", "--no-ff", "--no-edit", resultB])).toThrow();
		expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(true);
		mkdirSync(join(repo, ".nklein", "nklein"), { recursive: true });
		writeFileSync(
			join(repo, ".nklein", "nklein", "merge-in-flight.json"),
			JSON.stringify({ mergeHead: resultB, taskId: "kill-m2", startedAt: Date.now() }),
			"utf8",
		);

		return mergeTaskWorktreesInDependencyOrder({
			repoPath: repo,
			board: board("kill-m3", "main"),
			columns: ["review"],
			resolveTaskResultBranchCommit: async () => resultC,
		}).then((result) => {
			expect(result.blocked, result.blocked?.reason).toBeUndefined();
			expect(result.mergedTaskIds).toEqual(["kill-m3"]);
			// The wedge is gone: no merge in progress, clean tree, and the mark did not survive.
			expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(false);
			expect(git(["status", "--porcelain"]).trim()).toBe("");
			expect(existsSync(join(repo, ".nklein", "nklein", "merge-in-flight.json"))).toBe(false);
		});
	});

	it("refuses to touch a merge it did not start — an operator's own merge survives", async () => {
		const base = git(["rev-parse", "HEAD"]).trim();
		git(["checkout", "-q", "-b", "theirs"]);
		const theirs = commit("manifest.json", '{"killed":["x"]}\n', "theirs");
		git(["checkout", "-q", base, "-b", "result-d"]);
		const resultD = commit("notes.md", "notes\n", "result d");
		git(["checkout", "-q", "main"]);
		commit("manifest.json", '{"killed":["y"]}\n', "ours");
		expect(() => git(["merge", "--no-ff", "--no-edit", theirs])).toThrow();

		const result = await mergeTaskWorktreesInDependencyOrder({
			repoPath: repo,
			board: board("kill-m4", "main"),
			columns: ["review"],
			resolveTaskResultBranchCommit: async () => resultD,
		});

		// No mark ⇒ not ours ⇒ still blocked, and the operator's conflict is exactly where they left it.
		expect(result.blocked?.reason).toContain("never abort someone else's merge");
		expect(existsSync(join(repo, ".git", "MERGE_HEAD"))).toBe(true);
	});
});
