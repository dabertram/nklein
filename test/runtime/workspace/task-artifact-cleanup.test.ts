import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitProcessEnv } from "../../../src/core/git-process-env";
import { getRuntimeHomePath } from "../../../src/state/workspace-state";
import {
	deleteTaskArtifacts,
	deleteTaskPatchFiles,
	deleteTaskPatchFilesForRepo,
	writeTrashedTaskPatch,
} from "../../../src/workspace/task-artifact-cleanup";
import { createTaskResultBranchName } from "../../../src/workspace/task-result-branches";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * Every export here DELETES, so the failure that matters is deleting too much. Two mechanisms stand between a
 * trashed card and someone else's data: a repo key mixed into each patch filename, so the same task id in two
 * projects does not cross-delete; and a task-id guard rejecting `/`, `\` and `..`, so an id can never address a
 * path outside the store. Neither is observable from a test that only checks the intended file disappeared —
 * that assertion passes just as happily when the neighbours went with it.
 */
let home: string;
let previousHome: string | undefined;

function patchesDir(): string {
	// Derived from the module's own resolver, never guessed: a wrong path here would make every "did not delete"
	// assertion below pass against an empty directory.
	return join(getRuntimeHomePath(), "trashed-task-patches");
}

function branch(repoPath: string, taskId: string): void {
	execFileSync("git", ["-C", repoPath, "branch", createTaskResultBranchName(taskId)], { env: createGitProcessEnv() });
}

function branchExists(repoPath: string, taskId: string): boolean {
	try {
		execFileSync("git", ["-C", repoPath, "rev-parse", "--verify", createTaskResultBranchName(taskId)], {
			env: createGitProcessEnv(),
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

function listPatches(): string[] {
	try {
		return readdirSync(patchesDir()).sort();
	} catch {
		return [];
	}
}

function repo(name: string): string {
	const path = join(home, name);
	mkdirSync(path, { recursive: true });
	const env = createGitProcessEnv();
	execFileSync("git", ["-C", path, "init", "-b", "main"], { env });
	execFileSync("git", ["-C", path, "config", "user.name", "Test"], { env });
	execFileSync("git", ["-C", path, "config", "user.email", "test@example.com"], { env });
	writeFileSync(join(path, "f.txt"), "x\n");
	execFileSync("git", ["-C", path, "add", "-A"], { env });
	execFileSync("git", ["-C", path, "commit", "-m", "initial"], { env });
	return path;
}

beforeEach(() => {
	previousHome = process.env.HOME;
	home = mkdtempSync(join(tmpdir(), "nklein-artifact-cleanup-"));
	process.env.HOME = home;
});

afterEach(() => {
	if (previousHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = previousHome;
	}
	rmSync(home, { force: true, recursive: true });
});

describe("writeTrashedTaskPatch / deleteTaskPatchFiles", () => {
	it("round-trips a snapshot: written, then removed by task id", async () => {
		const repoPath = repo("repo-a");
		await writeTrashedTaskPatch({ repoPath, taskId: "t1", headCommit: "abc123", patch: "diff --git a/f b/f\n" });
		// Anchored on the real name, so a store this test cannot see fails here rather than passing vacuously.
		expect(listPatches()).toEqual([expect.stringMatching(/^t1\..+\.abc123\.patch$/)]);

		await deleteTaskPatchFiles(repoPath, "t1");
		expect(listPatches()).toEqual([]);
	});

	it("does NOT delete another REPO's snapshot for the same task id", async () => {
		// THE probe. Task ids are unique per project, not globally, so `t1` exists in every workspace. The repo
		// key mixed into the filename is the only thing stopping a trash in one project from wiping the identically
		// named card's snapshot in another — and a test that just checks "my file is gone" cannot see that.
		const repoA = repo("repo-a");
		const repoB = repo("repo-b");
		await writeTrashedTaskPatch({ repoPath: repoA, taskId: "t1", headCommit: "aaa", patch: "A\n" });
		await writeTrashedTaskPatch({ repoPath: repoB, taskId: "t1", headCommit: "bbb", patch: "B\n" });
		expect(listPatches()).toHaveLength(2);

		await deleteTaskPatchFiles(repoA, "t1");
		const survivors = listPatches();
		expect(survivors).toHaveLength(1);
		expect(survivors[0]).toContain("bbb");
	});

	it("does NOT delete a DIFFERENT task's snapshot in the same repo", async () => {
		const repoPath = repo("repo-a");
		await writeTrashedTaskPatch({ repoPath, taskId: "t1", headCommit: "aaa", patch: "A\n" });
		await writeTrashedTaskPatch({ repoPath, taskId: "t2", headCommit: "bbb", patch: "B\n" });

		await deleteTaskPatchFiles(repoPath, "t1");
		expect(listPatches()).toHaveLength(1);
		expect(listPatches()[0]?.startsWith("t2.")).toBe(true);
	});

	it("does not treat `t1` as a prefix of `t10`", async () => {
		// Filenames are prefix-matched, so the separator has to be part of the prefix; without it, trashing `t1`
		// would take every card whose id merely starts with it.
		const repoPath = repo("repo-a");
		await writeTrashedTaskPatch({ repoPath, taskId: "t1", headCommit: "aaa", patch: "A\n" });
		await writeTrashedTaskPatch({ repoPath, taskId: "t10", headCommit: "bbb", patch: "B\n" });

		await deleteTaskPatchFiles(repoPath, "t1");
		expect(listPatches()).toHaveLength(1);
		expect(listPatches()[0]?.startsWith("t10.")).toBe(true);
	});

	it("still cleans up LEGACY un-keyed snapshots, which is a deliberate widening", () => {
		// Pre-repo-key files were named `<taskId>.<commit>.patch` with nothing identifying the project, so they
		// cannot be attributed and are swept on any repo's trash. Pinned because it is the one case where the
		// scoping above intentionally does not hold — someone tightening it would strand old files forever.
		const repoPath = repo("repo-a");
		mkdirSync(patchesDir(), { recursive: true });
		writeFileSync(join(patchesDir(), "t1.deadbeef.patch"), "legacy\n");

		return deleteTaskPatchFiles(repoPath, "t1").then(() => {
			expect(listPatches()).toEqual([]);
		});
	});

	it("is silent when the store does not exist at all", async () => {
		// Cleanup runs on cards that never wrote a snapshot; a missing directory is the normal case, not an error.
		await expect(deleteTaskPatchFiles(repo("repo-a"), "t1")).resolves.toBeUndefined();
	});

	it("REFUSES a task id that could address a path outside the store", async () => {
		// The traversal guard on a delete path. `..` or a separator in an id would let a card name a file anywhere
		// the process can reach, and cleanup would remove it.
		const repoPath = repo("repo-a");
		await writeTrashedTaskPatch({ repoPath, taskId: "t1", headCommit: "aaa", patch: "A\n" });
		for (const hostile of ["../escape", "a/b", "a\\b", "..", "  "]) {
			await expect(deleteTaskPatchFiles(repoPath, hostile)).rejects.toThrow(/Invalid task id/);
		}
	});
});

describe("deleteTaskPatchFilesForRepo", () => {
	it("removes only THIS repo's snapshots and reports how many", async () => {
		const repoA = repo("repo-a");
		const repoB = repo("repo-b");
		await writeTrashedTaskPatch({ repoPath: repoA, taskId: "t1", headCommit: "a1", patch: "A\n" });
		await writeTrashedTaskPatch({ repoPath: repoA, taskId: "t2", headCommit: "a2", patch: "A\n" });
		await writeTrashedTaskPatch({ repoPath: repoB, taskId: "t1", headCommit: "b1", patch: "B\n" });

		expect(await deleteTaskPatchFilesForRepo(repoA)).toBe(2);
		expect(listPatches()).toHaveLength(1);
		expect(listPatches()[0]).toContain("b1");
	});

	it("returns 0 rather than throwing when there is nothing to remove", async () => {
		expect(await deleteTaskPatchFilesForRepo(repo("repo-a"))).toBe(0);
	});
});

describe("deleteTaskArtifacts", () => {
	it("discards the patch snapshot AND the task's result branch", async () => {
		const repoPath = repo("repo-a");
		branch(repoPath, "t1");
		await writeTrashedTaskPatch({ repoPath, taskId: "t1", headCommit: "aaa", patch: "A\n" });
		expect(branchExists(repoPath, "t1")).toBe(true);

		expect(await deleteTaskArtifacts({ repoPath, taskId: "t1" })).toEqual({ ok: true });
		expect(listPatches()).toEqual([]);
		expect(branchExists(repoPath, "t1")).toBe(false);
	});

	it("also discards the `::spec` speculative candidate", async () => {
		// §5.AW: the card's speculative branch goes with the card. Leaving it behind orphans a candidate that
		// nothing will ever adopt or clean up.
		const repoPath = repo("repo-a");
		branch(repoPath, "t1");
		branch(repoPath, "t1::spec");
		expect(branchExists(repoPath, "t1::spec")).toBe(true);

		expect(await deleteTaskArtifacts({ repoPath, taskId: "t1" })).toEqual({ ok: true });
		expect(branchExists(repoPath, "t1::spec")).toBe(false);
	});

	it("succeeds when there is NO speculative candidate — the common case", async () => {
		// Most cards never speculate, so a missing `::spec` branch must not fail the whole cleanup and leave the
		// card looking un-trashable.
		const repoPath = repo("repo-a");
		branch(repoPath, "t1");
		expect(await deleteTaskArtifacts({ repoPath, taskId: "t1" })).toEqual({ ok: true });
	});

	it("succeeds when the card left nothing behind at all", async () => {
		expect(await deleteTaskArtifacts({ repoPath: repo("repo-a"), taskId: "never-ran" })).toEqual({ ok: true });
	});

	it("REPORTS a bad task id instead of throwing at the caller", async () => {
		// Trash and project-removal call this on ids they did not vet. A throw here would abort the surrounding
		// removal midway; a result object lets the caller record the failure and carry on.
		const result = await deleteTaskArtifacts({ repoPath: repo("repo-a"), taskId: "../escape" });
		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/Invalid task id/);
	});

	it("does not touch a NEIGHBOURING task's result branch", async () => {
		const repoPath = repo("repo-a");
		branch(repoPath, "t1");
		branch(repoPath, "t2");

		await deleteTaskArtifacts({ repoPath, taskId: "t1" });
		expect(branchExists(repoPath, "t2")).toBe(true);
	});
});
