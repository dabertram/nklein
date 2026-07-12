import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertPathIsDirectory, hasGitRepository, pathIsDirectory } from "../../src/cli-path-checks";
import { createGitProcessEnv } from "../../src/core/git-process-env";

let dir = "";
let filePath = "";
let gitDir = "";

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "nklein-path-checks-"));
	filePath = join(dir, "a-file.txt");
	await writeFile(filePath, "x");
	gitDir = await mkdtemp(join(tmpdir(), "nklein-path-checks-git-"));
	// Scrubbed env (§4A): under a git hook (pre-commit runs this suite) an inherited GIT_DIR
	// would hijack this init into the OUTER repo — from a linked worktree it even flips
	// core.bare on the shared config (live incident 2026-07-13).
	execFileSync("git", ["init", "-q"], { cwd: gitDir, env: createGitProcessEnv() });
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(gitDir, { recursive: true, force: true });
});

describe("pathIsDirectory", () => {
	it("is true for a directory, false for a file or a missing path (never throws)", async () => {
		expect(await pathIsDirectory(dir)).toBe(true);
		expect(await pathIsDirectory(filePath)).toBe(false);
		expect(await pathIsDirectory(join(dir, "does-not-exist"))).toBe(false);
	});
});

describe("assertPathIsDirectory", () => {
	it("resolves for a directory and throws a descriptive error otherwise", async () => {
		await expect(assertPathIsDirectory(dir)).resolves.toBeUndefined();
		await expect(assertPathIsDirectory(filePath)).rejects.toThrow(/not a directory/);
	});
});

describe("hasGitRepository", () => {
	it("is true inside a git work tree and false in a plain directory", () => {
		expect(hasGitRepository(gitDir)).toBe(true);
		expect(hasGitRepository(dir)).toBe(false);
	});
});
