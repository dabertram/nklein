/**
 * Suite 14 — workspace git + search procedures contract (todo §5.V)
 *
 * Drives the workspace.* git-query and search procedures over REAL HTTP against a
 * spawned server and asserts:
 *   - HTTP status codes
 *   - JSON response shapes (raw field checks, no Zod imports)
 *   - On-disk state fidelity (commits visible in log, commit diffs accurate, refs consistent)
 *
 * Covered procedures (all previously uncovered):
 *   workspace.getGitSummary  — git state summary (branch, ahead/behind counts, changed files)
 *   workspace.getGitLog      — commit history with hash/message/author fields
 *   workspace.getCommitDiff  — per-commit file diff with additions/deletions/patch
 *   workspace.getGitRefs     — branch refs including HEAD
 *   workspace.getWorkspaceChanges — working-copy changed files
 *   workspace.searchFiles    — fuzzy filename search over the workspace
 *   workspace.notifyStateUpdated — fires a board update notification (no side effects to assert; contract: returns ok)
 *
 * Excluded from this suite (need live infra or destructive side effects):
 *   workspace.runGitSyncAction  — push/pull/fetch to a remote → needs a real remote
 *   workspace.checkoutGitBranch — switches HEAD → destructive in test env; local git env is minimal
 *   workspace.discardGitChanges — destructive (discards working-tree modifications)
 *   workspace.deleteWorktree    — requires an existing worktree; agent infra only
 *   workspace.getChanges        — task-scoped diff (taskId + baseRef against a running task worktree)
 *
 * Model-free: all assertions are on deterministic git state seeded in beforeAll.
 * Port-resilient: each describe block allocates its own free port.
 * Language-agnostic: assertions target raw JSON, not TypeScript types.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackendUnderTest } from "./helpers";
import { commitAll, initGitRepository, requestJson, startTsBackend } from "./helpers";

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function cleanupDir(path: string): void {
	rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/**
 * Register the server's own cwd as a project (confirmSelfProject: true) and
 * return the assigned workspace ID.
 */
async function addSelfProject(baseUrl: string, cwdPath: string): Promise<string> {
	const res = await requestJson<{ ok: boolean; project: { id: string } | null }>({
		baseUrl,
		procedure: "projects.add",
		type: "mutation",
		payload: { path: cwdPath, confirmSelfProject: true },
	});
	if (!res.payload.ok || !res.payload.project) {
		throw new Error(`Failed to register self-project: ${JSON.stringify(res.payload)}`);
	}
	return res.payload.project.id;
}

// ---------------------------------------------------------------------------
// Shared git fixture — used across all suites in this file
// ---------------------------------------------------------------------------

/**
 * Seeds a minimal git repository with two commits so the log + diff procedures
 * have something deterministic to return.
 *
 *   commit A: add README.md (1 line)
 *   commit B: add src/main.ts (2 lines) + modify README.md (1 extra line)
 *
 * Returns the two commit hashes in chronological order (A, B).
 */
function seedGitHistory(cwd: string): { hashA: string; hashB: string } {
	initGitRepository(cwd);

	// Commit A — add README
	writeFileSync(join(cwd, "README.md"), "# Test repo\n");
	const hashA = commitAll(cwd, "chore: initial commit");

	// Commit B — add src/ tree + modify README
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src/main.ts"), "const x = 1;\nconst y = 2;\n");
	writeFileSync(join(cwd, "README.md"), "# Test repo\n\nSome extra line.\n");
	const hashB = commitAll(cwd, "feat: add main.ts and update README");

	return { hashA, hashB };
}

// ---------------------------------------------------------------------------
// Suite: workspace.getGitSummary
// ---------------------------------------------------------------------------

describe.sequential("Suite 14 — workspace.getGitSummary", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ws-git-summary-cwd-");
		homeDir = makeTempDir("kanban-ws-git-summary-home-");
		seedGitHistory(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.getGitSummary returns ok=true with a valid summary shape", async () => {
		const res = await requestJson<{
			ok: boolean;
			summary: {
				currentBranch: string | null;
				upstreamBranch: string | null;
				changedFiles: number;
				additions: number;
				deletions: number;
				aheadCount: number;
				behindCount: number;
			};
			error?: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitSummary",
			type: "query",
			workspaceId,
		});

		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.error).toBeUndefined();

		const { summary } = res.payload;
		expect(summary).toBeDefined();
		// currentBranch is a string (or null) — in a fresh isolated repo with no upstream it could be either
		expect(summary.currentBranch === null || typeof summary.currentBranch === "string").toBe(true);
		expect(typeof summary.changedFiles).toBe("number");
		expect(typeof summary.additions).toBe("number");
		expect(typeof summary.deletions).toBe("number");
		expect(typeof summary.aheadCount).toBe("number");
		expect(typeof summary.behindCount).toBe("number");
	});

	it("workspace.getGitSummary reports 0 changed files on a clean working copy", async () => {
		const res = await requestJson<{ ok: boolean; summary: { changedFiles: number } }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitSummary",
			type: "query",
			workspaceId,
		});

		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		// No uncommitted changes — seeded repo is fully committed
		expect(res.payload.summary.changedFiles).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Suite: workspace.getGitLog
// ---------------------------------------------------------------------------

describe.sequential("Suite 14 — workspace.getGitLog", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;
	let hashA: string;
	let hashB: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ws-git-log-cwd-");
		homeDir = makeTempDir("kanban-ws-git-log-home-");
		({ hashA, hashB } = seedGitHistory(cwd));
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.getGitLog returns ok=true with the expected commit fields", async () => {
		const res = await requestJson<{
			ok: boolean;
			commits: Array<{
				hash: string;
				shortHash: string;
				authorName: string;
				authorEmail: string;
				date: string;
				message: string;
				parentHashes: string[];
			}>;
			totalCount: number;
			error?: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitLog",
			type: "query",
			workspaceId,
			payload: { maxCount: 10 },
		});

		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.error).toBeUndefined();
		expect(Array.isArray(res.payload.commits)).toBe(true);
		expect(typeof res.payload.totalCount).toBe("number");
	});

	it("workspace.getGitLog returns exactly two commits for the seeded history", async () => {
		const res = await requestJson<{
			ok: boolean;
			commits: Array<{ hash: string; message: string }>;
			totalCount: number;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitLog",
			type: "query",
			workspaceId,
			payload: { maxCount: 50 },
		});

		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.commits).toHaveLength(2);
		// Most recent commit is first
		expect(res.payload.commits[0]?.hash).toBe(hashB);
		expect(res.payload.commits[1]?.hash).toBe(hashA);
	});

	it("workspace.getGitLog commit shape includes required fields", async () => {
		const res = await requestJson<{
			ok: boolean;
			commits: Array<{
				hash: string;
				shortHash: string;
				authorName: string;
				authorEmail: string;
				date: string;
				message: string;
				parentHashes: string[];
			}>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitLog",
			type: "query",
			workspaceId,
			payload: { maxCount: 1 },
		});

		expect(res.status).toBe(200);
		const commit = res.payload.commits[0];
		expect(commit).toBeDefined();
		expect(typeof commit?.hash).toBe("string");
		expect(commit?.hash.length).toBe(40); // full SHA-1
		expect(typeof commit?.shortHash).toBe("string");
		expect(commit?.shortHash.length).toBeGreaterThan(0);
		expect(typeof commit?.authorName).toBe("string");
		expect(typeof commit?.authorEmail).toBe("string");
		expect(typeof commit?.date).toBe("string");
		expect(typeof commit?.message).toBe("string");
		expect(Array.isArray(commit?.parentHashes)).toBe(true);
	});

	it("workspace.getGitLog maxCount=1 returns only the latest commit", async () => {
		const res = await requestJson<{
			ok: boolean;
			commits: Array<{ hash: string }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitLog",
			type: "query",
			workspaceId,
			payload: { maxCount: 1 },
		});

		expect(res.status).toBe(200);
		expect(res.payload.commits).toHaveLength(1);
		expect(res.payload.commits[0]?.hash).toBe(hashB);
	});
});

// ---------------------------------------------------------------------------
// Suite: workspace.getCommitDiff
// ---------------------------------------------------------------------------

describe.sequential("Suite 14 — workspace.getCommitDiff", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;
	let hashA: string;
	let hashB: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ws-git-diff-cwd-");
		homeDir = makeTempDir("kanban-ws-git-diff-home-");
		({ hashA, hashB } = seedGitHistory(cwd));
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.getCommitDiff returns ok=true with file-level diff for commit B", async () => {
		const res = await requestJson<{
			ok: boolean;
			commitHash: string;
			files: Array<{
				path: string;
				previousPath?: string;
				status: string;
				additions: number;
				deletions: number;
				patch: string;
			}>;
			error?: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getCommitDiff",
			type: "query",
			workspaceId,
			payload: { commitHash: hashB },
		});

		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.commitHash).toBe(hashB);
		expect(res.payload.error).toBeUndefined();
		expect(Array.isArray(res.payload.files)).toBe(true);
		// Commit B adds src/main.ts and modifies README.md → 2 files
		expect(res.payload.files.length).toBe(2);
	});

	it("workspace.getCommitDiff file shapes include required fields", async () => {
		const res = await requestJson<{
			ok: boolean;
			commitHash: string;
			files: Array<{
				path: string;
				status: string;
				additions: number;
				deletions: number;
				patch: string;
			}>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getCommitDiff",
			type: "query",
			workspaceId,
			payload: { commitHash: hashB },
		});

		expect(res.status).toBe(200);
		for (const file of res.payload.files) {
			expect(typeof file.path).toBe("string");
			expect(file.path.length).toBeGreaterThan(0);
			expect(["modified", "added", "deleted", "renamed"]).toContain(file.status);
			expect(typeof file.additions).toBe("number");
			expect(typeof file.deletions).toBe("number");
			expect(typeof file.patch).toBe("string");
		}
	});

	it("workspace.getCommitDiff shows src/main.ts as added in commit B", async () => {
		const res = await requestJson<{
			ok: boolean;
			files: Array<{ path: string; status: string; additions: number }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getCommitDiff",
			type: "query",
			workspaceId,
			payload: { commitHash: hashB },
		});

		expect(res.status).toBe(200);
		const mainTs = res.payload.files.find((f) => f.path === "src/main.ts");
		expect(mainTs).toBeDefined();
		expect(mainTs?.status).toBe("added");
		expect(mainTs?.additions).toBe(2); // 2 lines in src/main.ts
	});

	it("workspace.getCommitDiff for commit A shows README.md as added", async () => {
		const res = await requestJson<{
			ok: boolean;
			files: Array<{ path: string; status: string; additions: number }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getCommitDiff",
			type: "query",
			workspaceId,
			payload: { commitHash: hashA },
		});

		expect(res.status).toBe(200);
		expect(res.payload.files).toHaveLength(1);
		expect(res.payload.files[0]?.path).toBe("README.md");
		expect(res.payload.files[0]?.status).toBe("added");
	});
});

// ---------------------------------------------------------------------------
// Suite: workspace.getGitRefs
// ---------------------------------------------------------------------------

describe.sequential("Suite 14 — workspace.getGitRefs", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ws-git-refs-cwd-");
		homeDir = makeTempDir("kanban-ws-git-refs-home-");
		seedGitHistory(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.getGitRefs returns ok=true with a refs array", async () => {
		const res = await requestJson<{
			ok: boolean;
			refs: Array<{
				name: string;
				type: string;
				hash: string;
				isHead: boolean;
				upstreamName?: string;
				ahead?: number;
				behind?: number;
			}>;
			error?: string;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitRefs",
			type: "query",
			workspaceId,
		});

		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
		expect(res.payload.error).toBeUndefined();
		expect(Array.isArray(res.payload.refs)).toBe(true);
	});

	it("workspace.getGitRefs ref shapes include required fields", async () => {
		const res = await requestJson<{
			ok: boolean;
			refs: Array<{ name: string; type: string; hash: string; isHead: boolean }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitRefs",
			type: "query",
			workspaceId,
		});

		expect(res.status).toBe(200);
		expect(res.payload.refs.length).toBeGreaterThan(0);
		for (const ref of res.payload.refs) {
			expect(typeof ref.name).toBe("string");
			expect(ref.name.length).toBeGreaterThan(0);
			expect(["branch", "remote", "detached"]).toContain(ref.type);
			expect(typeof ref.hash).toBe("string");
			expect(ref.hash.length).toBe(40);
			expect(typeof ref.isHead).toBe("boolean");
		}
	});

	it("workspace.getGitRefs includes exactly one HEAD ref", async () => {
		const res = await requestJson<{
			ok: boolean;
			refs: Array<{ name: string; isHead: boolean }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getGitRefs",
			type: "query",
			workspaceId,
		});

		expect(res.status).toBe(200);
		const headRefs = res.payload.refs.filter((r) => r.isHead);
		expect(headRefs).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Suite: workspace.getWorkspaceChanges
// ---------------------------------------------------------------------------

describe.sequential("Suite 14 — workspace.getWorkspaceChanges", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ws-changes-cwd-");
		homeDir = makeTempDir("kanban-ws-changes-home-");
		seedGitHistory(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.getWorkspaceChanges returns an empty file list on a clean working copy", async () => {
		const res = await requestJson<{
			repoRoot: string;
			generatedAt: number;
			files: Array<{ path: string; status: string }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.getWorkspaceChanges",
			type: "query",
			workspaceId,
		});

		expect(res.status).toBe(200);
		expect(typeof res.payload.repoRoot).toBe("string");
		expect(typeof res.payload.generatedAt).toBe("number");
		expect(Array.isArray(res.payload.files)).toBe(true);
		// No uncommitted changes — the seeded repo is fully committed
		expect(res.payload.files).toHaveLength(0);
	});

	it("workspace.getWorkspaceChanges reports an untracked file after it is written", async () => {
		// Write a new file to create an uncommitted change
		writeFileSync(join(cwd, "uncommitted.txt"), "not committed yet\n");

		try {
			const res = await requestJson<{
				repoRoot: string;
				generatedAt: number;
				files: Array<{ path: string; status: string; additions: number; deletions: number }>;
			}>({
				baseUrl: server.baseUrl,
				procedure: "workspace.getWorkspaceChanges",
				type: "query",
				workspaceId,
			});

			expect(res.status).toBe(200);
			expect(res.payload.files.length).toBeGreaterThanOrEqual(1);

			const changedFile = res.payload.files.find((f) => f.path.includes("uncommitted.txt"));
			expect(changedFile).toBeDefined();
			expect(["untracked", "added", "modified"]).toContain(changedFile?.status);
		} finally {
			// Clean up the uncommitted file to avoid polluting other tests
			rmSync(join(cwd, "uncommitted.txt"), { force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// Suite: workspace.searchFiles
// ---------------------------------------------------------------------------

describe.sequential("Suite 14 — workspace.searchFiles", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ws-search-cwd-");
		homeDir = makeTempDir("kanban-ws-search-home-");
		seedGitHistory(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.searchFiles returns a valid response shape", async () => {
		const res = await requestJson<{
			query: string;
			files: Array<{ path: string; name: string; changed: boolean }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.searchFiles",
			type: "query",
			workspaceId,
			payload: { query: "main" },
		});

		expect(res.status).toBe(200);
		expect(res.payload.query).toBe("main");
		expect(Array.isArray(res.payload.files)).toBe(true);
	});

	it("workspace.searchFiles finds src/main.ts by filename query", async () => {
		const res = await requestJson<{
			query: string;
			files: Array<{ path: string; name: string; changed: boolean }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.searchFiles",
			type: "query",
			workspaceId,
			payload: { query: "main" },
		});

		expect(res.status).toBe(200);
		const mainTs = res.payload.files.find((f) => f.path.includes("main.ts") || f.name === "main.ts");
		expect(mainTs).toBeDefined();
		expect(mainTs?.name).toBe("main.ts");
		expect(typeof mainTs?.path).toBe("string");
		expect(typeof mainTs?.changed).toBe("boolean");
	});

	it("workspace.searchFiles finds README.md by partial name", async () => {
		const res = await requestJson<{
			query: string;
			files: Array<{ path: string; name: string; changed: boolean }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.searchFiles",
			type: "query",
			workspaceId,
			payload: { query: "README" },
		});

		expect(res.status).toBe(200);
		const readme = res.payload.files.find((f) => f.name === "README.md");
		expect(readme).toBeDefined();
	});

	it("workspace.searchFiles returns an empty array for a query matching nothing", async () => {
		const res = await requestJson<{
			query: string;
			files: Array<{ path: string; name: string }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.searchFiles",
			type: "query",
			workspaceId,
			payload: { query: "xyzzy_no_such_file_exists_123456" },
		});

		expect(res.status).toBe(200);
		expect(res.payload.files).toHaveLength(0);
	});

	it("workspace.searchFiles respects the optional limit parameter", async () => {
		const res = await requestJson<{
			query: string;
			files: Array<{ path: string; name: string }>;
		}>({
			baseUrl: server.baseUrl,
			procedure: "workspace.searchFiles",
			type: "query",
			workspaceId,
			payload: { query: "", limit: 1 },
		});

		expect(res.status).toBe(200);
		// With limit=1 the server must return at most 1 result
		expect(res.payload.files.length).toBeLessThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// Suite: workspace.notifyStateUpdated
// ---------------------------------------------------------------------------

describe.sequential("Suite 14 — workspace.notifyStateUpdated", () => {
	let server: BackendUnderTest;
	let cwd: string;
	let homeDir: string;
	let workspaceId: string;

	beforeAll(async () => {
		cwd = makeTempDir("kanban-ws-notify-cwd-");
		homeDir = makeTempDir("kanban-ws-notify-home-");
		seedGitHistory(cwd);
		server = await startTsBackend({ cwd, homeDir });
		workspaceId = await addSelfProject(server.baseUrl, cwd);
	}, 30_000);

	afterAll(async () => {
		await server.stop();
		cleanupDir(cwd);
		cleanupDir(homeDir);
	});

	it("workspace.notifyStateUpdated returns ok=true", async () => {
		const res = await requestJson<{ ok: boolean }>({
			baseUrl: server.baseUrl,
			procedure: "workspace.notifyStateUpdated",
			type: "mutation",
			workspaceId,
			payload: {},
		});

		expect(res.status).toBe(200);
		expect(res.payload.ok).toBe(true);
	});

	it("workspace.notifyStateUpdated is idempotent — calling twice returns ok=true both times", async () => {
		for (let i = 0; i < 2; i++) {
			const res = await requestJson<{ ok: boolean }>({
				baseUrl: server.baseUrl,
				procedure: "workspace.notifyStateUpdated",
				type: "mutation",
				workspaceId,
				payload: {},
			});
			expect(res.status).toBe(200);
			expect(res.payload.ok).toBe(true);
		}
	});
});
