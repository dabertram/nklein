import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCommitDiff, getGitLog, getGitRefs } from "../../src/workspace/git-history";
import { discardGitChanges, getGitSyncSummary } from "../../src/workspace/git-sync";
import { commitAllInTestRepository, initTestRepository, runTestGit } from "../utilities/git-repo";
import { createTempDir } from "../utilities/temp-dir";

describe.sequential("git history runtime", () => {
	it("returns correct metadata for root commit diffs", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-root-");
		try {
			initTestRepository(repoPath);
			writeFileSync(join(repoPath, "first.txt"), "hello\nworld\n", "utf8");
			const rootCommit = commitAllInTestRepository(repoPath, "first commit");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash: rootCommit,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: "first.txt",
				status: "added",
				additions: 2,
				deletions: 0,
			});
			expect(response.files[0]?.patch).toContain("+++ b/first.txt");
		} finally {
			cleanup();
		}
	});

	it("returns rename metadata for rename-only commits", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-rename-");
		try {
			initTestRepository(repoPath);
			writeFileSync(join(repoPath, "old.txt"), "hello\n", "utf8");
			commitAllInTestRepository(repoPath, "init");

			runTestGit(repoPath, ["mv", "old.txt", "new.txt"]);
			const renameCommit = commitAllInTestRepository(repoPath, "rename file");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash: renameCommit,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: "new.txt",
				previousPath: "old.txt",
				status: "renamed",
				additions: 0,
				deletions: 0,
			});
			expect(response.files[0]?.patch).toContain("rename from old.txt");
			expect(response.files[0]?.patch).toContain("rename to new.txt");
		} finally {
			cleanup();
		}
	});

	it("discards tracked, staged, and untracked working copy changes", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-discard-");
		try {
			initTestRepository(repoPath);
			writeFileSync(join(repoPath, "tracked.txt"), "original\n", "utf8");
			commitAllInTestRepository(repoPath, "init");

			writeFileSync(join(repoPath, "tracked.txt"), "changed\n", "utf8");
			runTestGit(repoPath, ["add", "tracked.txt"]);
			mkdirSync(join(repoPath, "scratch"), { recursive: true });
			writeFileSync(join(repoPath, "scratch", "note.txt"), "temp\n", "utf8");

			const response = await discardGitChanges({ cwd: repoPath });

			expect(response.ok).toBe(true);
			expect(response.summary.changedFiles).toBe(0);
			expect(readFileSync(join(repoPath, "tracked.txt"), "utf8").replace(/\r\n/gu, "\n")).toBe("original\n");
			expect(existsSync(join(repoPath, "scratch", "note.txt"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("returns correct UTF-8 paths for non-ASCII filenames", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-nonascii-");
		try {
			initTestRepository(repoPath);
			const dirName = "提出書類";
			const fileName = "設計書.md";
			const relativePath = `${dirName}/${fileName}`;
			mkdirSync(join(repoPath, dirName), { recursive: true });
			writeFileSync(join(repoPath, dirName, fileName), "# 設計書\n", "utf8");
			const commitHash = commitAllInTestRepository(repoPath, "add non-ASCII path");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: relativePath,
				status: "added",
			});
			expect(response.files[0]?.patch).toContain(`+++ b/${relativePath}`);
		} finally {
			cleanup();
		}
	});

	it("reads ahead and behind counts from tracked branches", { timeout: 15_000 }, async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-git-history-refs-");
		try {
			const remotePath = join(sandboxRoot, "remote.git");
			const localPath = join(sandboxRoot, "local");
			const peerPath = join(sandboxRoot, "peer");

			mkdirSync(remotePath, { recursive: true });
			runTestGit(remotePath, ["init", "--bare", "-q"]);

			mkdirSync(localPath, { recursive: true });
			initTestRepository(localPath);
			writeFileSync(join(localPath, "file.txt"), "base\n", "utf8");
			commitAllInTestRepository(localPath, "init");
			runTestGit(localPath, ["remote", "add", "origin", remotePath]);
			const currentBranch = runTestGit(localPath, ["symbolic-ref", "--short", "HEAD"]);
			runTestGit(localPath, ["push", "-u", "origin", currentBranch]);

			runTestGit(sandboxRoot, ["clone", "-q", remotePath, peerPath]);
			runTestGit(peerPath, ["config", "user.name", "Peer User"]);
			runTestGit(peerPath, ["config", "user.email", "peer@example.com"]);
			writeFileSync(join(peerPath, "peer.txt"), "remote\n", "utf8");
			commitAllInTestRepository(peerPath, "remote commit");
			runTestGit(peerPath, ["push", "origin", currentBranch]);

			writeFileSync(join(localPath, "local.txt"), "local\n", "utf8");
			commitAllInTestRepository(localPath, "local commit");
			runTestGit(localPath, ["fetch", "origin"]);

			const refsResponse = await getGitRefs(localPath);
			expect(refsResponse.ok).toBe(true);
			const headBranch = refsResponse.refs.find((ref) => ref.isHead);
			expect(headBranch).toMatchObject({
				name: currentBranch,
				type: "branch",
				upstreamName: `origin/${currentBranch}`,
				ahead: 1,
				behind: 1,
			});

			expect(refsResponse.refs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: `origin/${currentBranch}`,
						type: "remote",
					}),
				]),
			);

			const summary = await getGitSyncSummary(localPath);
			expect(summary.aheadCount).toBe(1);
			expect(summary.behindCount).toBe(1);

			const logResponse = await getGitLog({
				cwd: localPath,
				refs: [currentBranch, `origin/${currentBranch}`],
			});
			expect(logResponse.ok).toBe(true);
			expect(logResponse.commits).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						message: "local commit",
						relation: "selected",
					}),
					expect.objectContaining({
						message: "remote commit",
						relation: "upstream",
					}),
				]),
			);
		} finally {
			cleanup();
		}
	});
});
