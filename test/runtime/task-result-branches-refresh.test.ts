import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitProcessEnv } from "../../src/core/git-process-env";
import {
	applyTaskPatchToResultBranch,
	refreshTaskResultOntoBase,
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
	const path = mkdtempSync(join(tmpdir(), "nklein-task-result-refresh-"));
	runGit(path, ["init", "-b", "main"]);
	runGit(path, ["config", "user.name", "Test User"]);
	runGit(path, ["config", "user.email", "test@example.com"]);
	writeFileSync(join(path, "README.md"), "base\n", "utf8");
	runGit(path, ["add", "README.md"]);
	runGit(path, ["commit", "-m", "initial"]);
	return { path, cleanup: () => rmSync(path, { force: true, recursive: true }) };
}

function commitFile(repoPath: string, file: string, content: string, message: string): string {
	mkdirSync(dirname(join(repoPath, file)), { recursive: true });
	writeFileSync(join(repoPath, file), content, "utf8");
	runGit(repoPath, ["add", file]);
	runGit(repoPath, ["commit", "-m", message]);
	return runGit(repoPath, ["rev-parse", "HEAD"]);
}

const CARD_PATCH = [
	"diff --git a/src/card.ts b/src/card.ts",
	"new file mode 100644",
	"index 0000000..3b18e51",
	"--- /dev/null",
	"+++ b/src/card.ts",
	"@@ -0,0 +1 @@",
	"+export const card = 1;",
	"",
].join("\n");

describe("refreshTaskResultOntoBase (P1.STALEBASE: a result captured on an older base head is re-captured onto the current one)", () => {
	it("replays the result's first-parent patch onto the moved base head and keeps the single-parent, own-files-only invariants", async () => {
		const repo = createRepo();
		try {
			const oldBase = runGit(repo.path, ["rev-parse", "HEAD"]);
			const stale = await applyTaskPatchToResultBranch({
				repoPath: repo.path,
				taskId: "s77",
				baseRef: "main",
				patch: CARD_PATCH,
				message: "Apply !Klein task result for s77",
			});
			expect(stale?.baseCommit).toBe(oldBase);
			// The base moves on: the dependency the card needs lands on main after the capture (s57 → s77).
			const newBase = commitFile(
				repo.path,
				"src/dependency.ts",
				"export const dep = 1;\n",
				"Apply !Klein task result for s57",
			);
			const outcome = await refreshTaskResultOntoBase({
				repoPath: repo.path,
				taskId: "s77",
				baseRef: "main",
				resultCommit: stale?.headCommit ?? "",
			});
			expect(outcome.status).toBe("refreshed");
			if (outcome.status !== "refreshed") {
				return;
			}
			expect(outcome.previousCommit).toBe(stale?.headCommit);
			expect(outcome.baseCommit).toBe(newBase);
			// The branch ref moved to the re-captured commit; its parent IS the current base head.
			expect(await resolveTaskResultBranchCommit({ repoPath: repo.path, taskId: "s77" })).toBe(outcome.commit);
			expect(runGit(repo.path, ["rev-parse", `${outcome.commit}^1`])).toBe(newBase);
			// First-parent diff = the card's own file only (what the boundary check judges), and the tree carries the dependency.
			expect(runGit(repo.path, ["diff", "--name-only", `${outcome.commit}^1`, outcome.commit])).toBe("src/card.ts");
			expect(runGit(repo.path, ["ls-tree", "--name-only", "-r", outcome.commit]).split("\n")).toEqual([
				"README.md",
				"src/card.ts",
				"src/dependency.ts",
			]);
			expect(runGit(repo.path, ["log", "-1", "--format=%s", outcome.commit])).toContain("(re-captured on base");
			// Idempotent: a result already on the base head is left exactly where it is.
			expect(
				await refreshTaskResultOntoBase({
					repoPath: repo.path,
					taskId: "s77",
					baseRef: "main",
					resultCommit: outcome.commit,
				}),
			).toEqual({ status: "current", commit: outcome.commit });
		} finally {
			repo.cleanup();
		}
	});

	it("reports a conflict and leaves the branch untouched when the patch no longer applies on the moved base", async () => {
		const repo = createRepo();
		try {
			const stale = await applyTaskPatchToResultBranch({
				repoPath: repo.path,
				taskId: "s63",
				baseRef: "main",
				patch: CARD_PATCH,
			});
			// Main gains a DIFFERENT src/card.ts: the card's "new file" patch cannot apply any more.
			commitFile(repo.path, "src/card.ts", "export const card = 2;\n", "conflicting change on main");
			const outcome = await refreshTaskResultOntoBase({
				repoPath: repo.path,
				taskId: "s63",
				baseRef: "main",
				resultCommit: stale?.headCommit ?? "",
			});
			expect(outcome.status).toBe("conflict");
			expect(await resolveTaskResultBranchCommit({ repoPath: repo.path, taskId: "s63" })).toBe(stale?.headCommit);
		} finally {
			repo.cleanup();
		}
	});

	it("fails soft on an unresolvable base or result instead of throwing into the delivery path", async () => {
		const repo = createRepo();
		try {
			const head = runGit(repo.path, ["rev-parse", "HEAD"]);
			expect(
				(await refreshTaskResultOntoBase({ repoPath: repo.path, taskId: "x", baseRef: "nope", resultCommit: head }))
					.status,
			).toBe("error");
			// The root commit has no parent: nothing to replay, not a crash.
			expect(
				(await refreshTaskResultOntoBase({ repoPath: repo.path, taskId: "x", baseRef: "main", resultCommit: head }))
					.status,
			).toBe("error");
		} finally {
			repo.cleanup();
		}
	});
});
