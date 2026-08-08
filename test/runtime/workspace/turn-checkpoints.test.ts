import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitProcessEnv } from "../../../src/core/git-process-env";
import { captureTaskTurnCheckpoint, deleteTaskTurnCheckpointRef } from "../../../src/workspace/turn-checkpoints";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * A turn checkpoint snapshots the WORKING TREE — uncommitted edits included — so a turn can be rewound. The
 * dangerous property is not what it captures but what it must NOT disturb: it runs `git add -A` against a
 * TEMPORARY index (`GIT_INDEX_FILE`), and if that redirection ever broke, every checkpoint would silently stage
 * the user's entire working tree in their real repo. That side effect would be invisible to any test asserting
 * only that a commit came back, so it is the first thing pinned below.
 */
function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: createGitProcessEnv() }).trim();
}

function repo(): { path: string; cleanup: () => void } {
	const path = mkdtempSync(join(tmpdir(), "nklein-checkpoint-test-"));
	git(path, ["init", "-b", "main"]);
	git(path, ["config", "user.name", "Test"]);
	git(path, ["config", "user.email", "test@example.com"]);
	return { path, cleanup: () => rmSync(path, { force: true, recursive: true }) };
}

describe("captureTaskTurnCheckpoint", () => {
	it("does NOT stage anything in the repo's own index", async () => {
		// THE probe. The capture runs `git add -A` under a temporary GIT_INDEX_FILE; losing that redirection
		// would stage the user's whole working tree as a side effect of taking a snapshot.
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "committed.txt"), "base\n");
			git(path, ["add", "-A"]);
			git(path, ["commit", "-m", "initial"]);
			writeFileSync(join(path, "untracked.txt"), "scratch\n");

			const before = git(path, ["status", "--porcelain"]);
			await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 1 });
			expect(git(path, ["status", "--porcelain"])).toBe(before);
			// `??` means still untracked — a leaked `git add` would have turned it into `A `.
			expect(git(path, ["status", "--porcelain"])).toMatch(/^\?\? untracked\.txt$/m);
		} finally {
			cleanup();
		}
	});

	it("captures UNCOMMITTED work — that is the whole point of a checkpoint", async () => {
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "a.txt"), "committed\n");
			git(path, ["add", "-A"]);
			git(path, ["commit", "-m", "initial"]);
			writeFileSync(join(path, "a.txt"), "EDITED but never committed\n");
			writeFileSync(join(path, "new.txt"), "brand new\n");

			const checkpoint = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 2 });
			expect(git(path, ["show", `${checkpoint.commit}:a.txt`])).toContain("EDITED but never committed");
			expect(git(path, ["show", `${checkpoint.commit}:new.txt`])).toContain("brand new");
		} finally {
			cleanup();
		}
	});

	it("works in a repo with NO commits yet", async () => {
		// The first turn of a fresh workspace has no HEAD to read a tree from; the empty-tree path must not throw.
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "first.txt"), "hello\n");
			const checkpoint = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 1 });
			expect(checkpoint.commit).toMatch(/^[0-9a-f]{40}$/);
			expect(git(path, ["show", `${checkpoint.commit}:first.txt`])).toContain("hello");
		} finally {
			cleanup();
		}
	});

	it("makes a ref-safe name from a task id containing characters git forbids", async () => {
		// Task ids are ids, not ref names: `a2a-…` ids and anything with `..`, `~`, `^`, spaces or a trailing dot
		// would be rejected by `update-ref`. The base64url encoding is what keeps arbitrary ids usable.
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "f.txt"), "x\n");
			const hostile = "task with spaces..and~weird^chars:";
			const checkpoint = await captureTaskTurnCheckpoint({ cwd: path, taskId: hostile, turn: 1 });
			expect(checkpoint.ref).toMatch(/^refs\/kanban\/checkpoints\/[A-Za-z0-9_-]+\/turn\/1$/);
			expect(git(path, ["rev-parse", checkpoint.ref])).toBe(checkpoint.commit);
		} finally {
			cleanup();
		}
	});

	it("keeps turns of one task separate, and tasks separate from each other", async () => {
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "f.txt"), "turn one\n");
			const first = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 1 });
			writeFileSync(join(path, "f.txt"), "turn two\n");
			const second = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 2 });
			const otherTask = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t2", turn: 1 });

			expect(new Set([first.ref, second.ref, otherTask.ref]).size).toBe(3);
			// The earlier turn must still resolve to its OWN snapshot — a checkpoint that gets overwritten by the
			// next turn cannot rewind anything.
			expect(git(path, ["show", `${first.commit}:f.txt`])).toContain("turn one");
			expect(git(path, ["show", `${second.commit}:f.txt`])).toContain("turn two");
		} finally {
			cleanup();
		}
	});

	it("records the turn it was asked for, and a plausible timestamp", async () => {
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "f.txt"), "x\n");
			const before = Date.now();
			const checkpoint = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 7 });
			expect(checkpoint.turn).toBe(7);
			expect(checkpoint.createdAt).toBeGreaterThanOrEqual(before);
			expect(checkpoint.ref).toMatch(/\/turn\/7$/);
		} finally {
			cleanup();
		}
	});

	it("resolves the repo ROOT, so a nested cwd still checkpoints the whole tree", async () => {
		// Cards work in subdirectories; a checkpoint anchored at the cwd rather than the repo root would snapshot
		// only part of the tree and rewind to a half-state.
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "root.txt"), "at root\n");
			execFileSync("mkdir", ["-p", join(path, "nested", "deep")]);
			writeFileSync(join(path, "nested", "deep", "leaf.txt"), "deep\n");

			const checkpoint = await captureTaskTurnCheckpoint({
				cwd: join(path, "nested", "deep"),
				taskId: "t1",
				turn: 1,
			});
			expect(git(path, ["show", `${checkpoint.commit}:root.txt`])).toContain("at root");
			expect(git(path, ["show", `${checkpoint.commit}:nested/deep/leaf.txt`])).toContain("deep");
		} finally {
			cleanup();
		}
	});
});

describe("deleteTaskTurnCheckpointRef", () => {
	it("removes the ref", async () => {
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "f.txt"), "x\n");
			const checkpoint = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 1 });
			await deleteTaskTurnCheckpointRef({ cwd: path, ref: checkpoint.ref });
			expect(() => git(path, ["rev-parse", "--verify", checkpoint.ref])).toThrow();
		} finally {
			cleanup();
		}
	});

	it("is idempotent and silent on a ref that is already gone", async () => {
		// Cleanup runs on paths that may have already cleaned up; throwing here would turn a tidy-up into a
		// failed turn.
		const { path, cleanup } = repo();
		try {
			writeFileSync(join(path, "f.txt"), "x\n");
			const checkpoint = await captureTaskTurnCheckpoint({ cwd: path, taskId: "t1", turn: 1 });
			await deleteTaskTurnCheckpointRef({ cwd: path, ref: checkpoint.ref });
			await expect(deleteTaskTurnCheckpointRef({ cwd: path, ref: checkpoint.ref })).resolves.toBeUndefined();
			await expect(
				deleteTaskTurnCheckpointRef({ cwd: path, ref: "refs/kanban/checkpoints/never/turn/9" }),
			).resolves.toBeUndefined();
		} finally {
			cleanup();
		}
	});
});
