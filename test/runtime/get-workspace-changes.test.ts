import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getWorkspaceChanges } from "../../src/workspace/get-workspace-changes";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function initRepository(path: string): void {
	runGit(path, ["init", "-q"]);
	runGit(path, ["config", "user.name", "Test User"]);
	runGit(path, ["config", "user.email", "test@example.com"]);
}

describe.sequential("getWorkspaceChanges untracked filtering", () => {
	it("reports a real untracked file but never a directory-symlink phantom (git-view worktree follow-up (b))", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-ws-changes-symlink-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "tracked.txt"), "base\n", "utf8");
			runGit(repoPath, ["add", "."]);
			runGit(repoPath, ["commit", "-qm", "init"]);

			// A genuine untracked file — must appear.
			writeFileSync(join(repoPath, "new-file.txt"), "hello\nworld\n", "utf8");

			// A real (ignored-but-present) directory replaced by a symlink, the worktree symlinked-ignored-root case.
			// `git ls-files --others` surfaces the symlink as a single untracked entry; reading it as a file hits
			// EISDIR and used to render a fake +0 -0 phantom diff.
			const targetDir = join(repoPath, "real-deps");
			mkdirSync(targetDir);
			writeFileSync(join(targetDir, "dep.txt"), "dep\n", "utf8");
			symlinkSync(targetDir, join(repoPath, "node_modules"));

			// A bare untracked directory containing a file (the file is listed, the directory itself is not).
			mkdirSync(join(repoPath, "untracked-dir"));
			writeFileSync(join(repoPath, "untracked-dir", "inner.txt"), "inner\n", "utf8");

			const response = await getWorkspaceChanges(repoPath);
			const paths = response.files.map((file) => file.path);

			// The real untracked file (and the file inside the untracked dir) are reported.
			expect(paths).toContain("new-file.txt");
			expect(paths).toContain("untracked-dir/inner.txt");

			// The directory symlink is NOT reported as a phantom file diff.
			expect(paths).not.toContain("node_modules");
			const phantom = response.files.find((file) => file.path === "node_modules");
			expect(phantom).toBeUndefined();

			// No reported change is an empty +0 -0 phantom (every entry has real content or real stats).
			const emptyPhantoms = response.files.filter(
				(file) => file.additions === 0 && file.deletions === 0 && file.oldText == null && file.newText == null,
			);
			expect(emptyPhantoms).toEqual([]);
		} finally {
			cleanup();
		}
	});
});
