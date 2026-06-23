import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { removeTaskWorktreeSetupLock } from "../../src/workspace/task-worktree";
import { createTempDir } from "../utilities/temp-dir";

// The worktree *creation* machinery (ensure/sync/submodule serialization) was retired in §5.A; native NKlein
// tasks run in Docker sandboxes. What remains is legacy on-disk cleanup, exercised here.
describe("task-worktree legacy cleanup", () => {
	it("removes the task worktree setup lock from the repository git directory", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-lock-cleanup-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const lockPath = join(repoPath, ".git", "kanban-task-worktree-setup.lock");
			mkdirSync(lockPath, { recursive: true });

			await expect(removeTaskWorktreeSetupLock(repoPath)).resolves.toBe(true);
			expect(existsSync(lockPath)).toBe(false);
			await expect(removeTaskWorktreeSetupLock(repoPath)).resolves.toBe(false);
		} finally {
			cleanup();
		}
	});
});
