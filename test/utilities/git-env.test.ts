import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	createGitProcessEnv,
	GIT_REPOSITORY_ENV_KEYS,
	purgeGitRepositoryEnv,
	stripGitRepositoryEnv,
} from "../../src/core/git-process-env";
import { createGitTestEnv } from "./git-env";
import { commitAllInTestRepository, initTestRepository, runTestGit } from "./git-repo";
import { createTempDir } from "./temp-dir";

/**
 * Regression cover for the pre-commit failure of 2026-09-08: the husky hook ran the suite with
 * `GIT_INDEX_FILE` pointing at the commit's temporary index, so `git add` inside a test's temp repo
 * staged an entry whose blob only existed in the temp repo. The hook passed; `git commit` then died
 * with "error: invalid object 100644 <oid> for 'src/lib.py' / error: Error building trees".
 */
describe("git test environment sanitising", () => {
	it("drops every repository-scoped variable from the spawned environment", () => {
		const hostile: NodeJS.ProcessEnv = {};
		for (const key of GIT_REPOSITORY_ENV_KEYS) {
			hostile[key] = `/tmp/hostile-${key}`;
		}
		const stripped = stripGitRepositoryEnv({ ...hostile, PATH: process.env.PATH });

		for (const key of GIT_REPOSITORY_ENV_KEYS) {
			expect(stripped[key]).toBeUndefined();
		}
		expect(stripped.PATH).toBe(process.env.PATH);
	});

	it("keeps GIT_CONFIG and GIT_CEILING_DIRECTORIES out of production git calls", () => {
		const env = createGitProcessEnv();

		expect(env.GIT_CONFIG).toBeUndefined();
		expect(env.GIT_CEILING_DIRECTORIES).toBeUndefined();
		expect(env.GIT_INDEX_FILE).toBeUndefined();
	});

	it("still honours an explicit override, so scratch-index callers keep working", () => {
		const env = createGitProcessEnv({ GIT_INDEX_FILE: "/tmp/deliberate-index" });

		expect(env.GIT_INDEX_FILE).toBe("/tmp/deliberate-index");
	});

	it("strips a superset of the repository-scoped keys and supplies a committer identity", () => {
		const env = createGitTestEnv();

		for (const key of GIT_REPOSITORY_ENV_KEYS) {
			expect(env[key]).toBeUndefined();
		}
		expect(env.GIT_COMMITTER_EMAIL).toBe("test@test.com");
	});

	it("leaves a foreign GIT_INDEX_FILE untouched when running git in a temp repo", () => {
		const { path: root, cleanup } = createTempDir("kanban-git-env-");
		const restore = process.env.GIT_INDEX_FILE;
		try {
			const repoPath = join(root, "repo");
			const scratchIndexPath = join(root, "outer-index");
			// Stands in for the index git hands a pre-commit hook. Not a real index — if git so much as
			// reads it the command fails with "index file smaller than expected".
			writeFileSync(scratchIndexPath, "sentinel", "utf8");
			// Exactly what the hook does: export the outer commit's index into the suite's environment.
			process.env.GIT_INDEX_FILE = scratchIndexPath;

			runTestGit(root, ["init", "-q", "--initial-branch=main", "repo"]);
			initTestRepository(repoPath);
			writeFileSync(join(repoPath, "lib.py"), "def add(a, b):\n    return a + b\n", "utf8");
			runTestGit(repoPath, ["add", "-A"]);
			const head = commitAllInTestRepository(repoPath, "seed");

			expect(readFileSync(scratchIndexPath, "utf8")).toBe("sentinel");
			expect(runTestGit(repoPath, ["ls-files"])).toBe("lib.py");
			expect(head).toMatch(/^[0-9a-f]{40}$/);
		} finally {
			process.env.GIT_INDEX_FILE = restore;
			if (restore === undefined) {
				delete process.env.GIT_INDEX_FILE;
			}
			cleanup();
		}
	});

	it("proves the sentinel would catch a regression: unsanitised git does write the foreign index", () => {
		const { path: root, cleanup } = createTempDir("kanban-git-env-leak-");
		const restore = process.env.GIT_INDEX_FILE;
		try {
			const repoPath = join(root, "repo");
			const scratchIndexPath = join(root, "outer-index");

			runTestGit(root, ["init", "-q", "--initial-branch=main", "repo"]);
			initTestRepository(repoPath);
			writeFileSync(join(repoPath, "lib.py"), "def add(a, b):\n    return a + b\n", "utf8");
			process.env.GIT_INDEX_FILE = scratchIndexPath;

			// Negative control: the pre-fix behaviour — git spawned with the raw inherited environment.
			const leaked = spawnSync("git", ["add", "-A"], { cwd: repoPath, encoding: "utf8" });

			expect(leaked.status).toBe(0);
			// The entry landed in the foreign index instead of the repo's own.
			expect(existsSync(scratchIndexPath)).toBe(true);
			expect(runTestGit(repoPath, ["ls-files"])).toBe("");
		} finally {
			process.env.GIT_INDEX_FILE = restore;
			if (restore === undefined) {
				delete process.env.GIT_INDEX_FILE;
			}
			cleanup();
		}
	});

	it("purges the variables from the worker's own environment", () => {
		// The vitest setup file already ran; a test spawning git without an explicit env inherits this.
		for (const key of GIT_REPOSITORY_ENV_KEYS) {
			expect(process.env[key]).toBeUndefined();
		}

		process.env.GIT_INDEX_FILE = "/tmp/re-added-index";
		const removed = purgeGitRepositoryEnv();

		expect(removed.GIT_INDEX_FILE).toBe("/tmp/re-added-index");
		expect(process.env.GIT_INDEX_FILE).toBeUndefined();
	});
});
