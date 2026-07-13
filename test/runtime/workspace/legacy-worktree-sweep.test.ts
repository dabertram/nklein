import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getRuntimeHomePath, getTaskWorktreesHomePath } from "../../../src/state/workspace-state";
import { sweepLegacyTaskWorktrees } from "../../../src/workspace/legacy-worktree-sweep";
import { createGitTestEnv } from "../../utilities/git-env";
import { createTempDir } from "../../utilities/temp-dir";

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-worktree-sweep-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

function runGitOrThrow(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8", env: createGitTestEnv() });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout;
}

function createCommittedRepo(path: string): void {
	mkdirSync(path, { recursive: true });
	runGitOrThrow(path, ["init"]);
	writeFileSync(join(path, "README.md"), "hello\n");
	runGitOrThrow(path, ["add", "-A"]);
	runGitOrThrow(path, ["commit", "-m", "initial"]);
}

describe("sweepLegacyTaskWorktrees (P0.9a)", () => {
	it("no-ops on a clean machine and still clears setup locks for registered repos", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-sweep-clean-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				createCommittedRepo(repoPath);
				const lockPath = join(repoPath, ".git", "kanban-task-worktree-setup.lock");
				writeFileSync(lockPath, "");

				const result = await sweepLegacyTaskWorktrees({ repoPaths: [repoPath] });

				expect(result).toEqual({ removedWorktrees: 0, warnings: [] });
				expect(existsSync(lockPath)).toBe(false);
				expect(existsSync(getTaskWorktreesHomePath())).toBe(false);
			} finally {
				cleanup();
			}
		});
	});

	it("removes a resolvable legacy worktree, snapshots its uncommitted work, and deletes the retired stores", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-sweep-live-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				createCommittedRepo(repoPath);
				const worktreesHome = getTaskWorktreesHomePath();
				const worktreePath = join(worktreesHome, "task-1", "repo");
				mkdirSync(join(worktreesHome, "task-1"), { recursive: true });
				runGitOrThrow(repoPath, ["worktree", "add", "-b", "legacy/task-1", worktreePath]);
				writeFileSync(join(worktreePath, "README.md"), "hello\nagent work in flight\n");
				writeFileSync(join(worktreePath, "notes.txt"), "untracked agent note\n");
				const syncStateDir = join(getRuntimeHomePath(), "worktree-sync-state");
				mkdirSync(syncStateDir, { recursive: true });
				writeFileSync(join(syncStateDir, "task-1.abc.json"), "{}");
				const lockPath = join(repoPath, ".git", "kanban-task-worktree-setup.lock");
				writeFileSync(lockPath, "");

				// No repoPaths passed: the lock repo must be discovered from the worktree's own .git file.
				const result = await sweepLegacyTaskWorktrees();

				expect(result.warnings).toEqual([]);
				expect(result.removedWorktrees).toBe(1);
				expect(existsSync(worktreePath)).toBe(false);
				expect(existsSync(worktreesHome)).toBe(false);
				expect(existsSync(syncStateDir)).toBe(false);
				expect(existsSync(lockPath)).toBe(false);
				expect(runGitOrThrow(repoPath, ["worktree", "list", "--porcelain"])).not.toContain("task-1");

				const patchesDir = join(getRuntimeHomePath(), "trashed-task-patches");
				const patchFiles = readdirSync(patchesDir).filter((name) => name.startsWith("task-1."));
				expect(patchFiles).toHaveLength(1);
				const patchFile = patchFiles[0] as string;
				const patchContent = readFileSync(join(patchesDir, patchFile), "utf8");
				expect(patchContent).toContain("agent work in flight");
				expect(patchContent).toContain("untracked agent note");
			} finally {
				cleanup();
			}
		});
	});

	it("raw-removes an unresolvable entry instead of leaving residue", async () => {
		await withTemporaryHome(async () => {
			const worktreesHome = getTaskWorktreesHomePath();
			const orphanPath = join(worktreesHome, "task-orphan", "gone-repo");
			mkdirSync(orphanPath, { recursive: true });
			writeFileSync(join(orphanPath, "leftover.txt"), "residue");

			const result = await sweepLegacyTaskWorktrees();

			expect(result.warnings).toEqual([]);
			expect(result.removedWorktrees).toBe(1);
			expect(existsSync(worktreesHome)).toBe(false);
		});
	});
});
