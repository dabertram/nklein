import { describe, expect, it } from "vitest";
import { createResultWorktree } from "../../../src/workspace/replay-eval-worktree";

type GitCall = { cwd: string; args: string[] };
type FakeGitResult = { ok: boolean; error?: string; stderr?: string };

// `results` is consumed in order; once exhausted every further call succeeds (the common all-ok case passes one).
function fakeRunGit(results: FakeGitResult[]) {
	const calls: GitCall[] = [];
	const queue = [...results];
	const runGit = async (cwd: string, args: string[]) => {
		calls.push({ cwd, args });
		const result: FakeGitResult = queue.shift() ?? { ok: true };
		return {
			ok: result.ok,
			stdout: "",
			stderr: result.stderr ?? "",
			output: "",
			error: result.error ?? null,
			exitCode: result.ok ? 0 : 1,
		};
	};
	return { runGit: runGit as never, calls };
}

describe("createResultWorktree (F1.26b live worktree primitive)", () => {
	it("adds a detached worktree for the result branch and returns the tree path", async () => {
		const { runGit, calls } = fakeRunGit([{ ok: true }]);
		const removed: string[] = [];
		const worktree = await createResultWorktree({
			repoPath: "/repo",
			resultBranch: "nklein/result/t-1",
			runGit,
			makeTempDir: async () => "/tmp/wt-1",
			removeDir: async (path) => {
				removed.push(path);
			},
		});
		expect(worktree.path).toBe("/tmp/wt-1");
		expect(calls[0]).toEqual({
			cwd: "/repo",
			args: ["worktree", "add", "--detach", "/tmp/wt-1", "nklein/result/t-1"],
		});
		// No teardown until cleanup is called.
		expect(removed).toEqual([]);
	});

	it("cleanup removes the worktree registration, prunes, then deletes the dir", async () => {
		const { runGit, calls } = fakeRunGit([{ ok: true }]);
		const removed: string[] = [];
		const worktree = await createResultWorktree({
			repoPath: "/repo",
			resultBranch: "b",
			runGit,
			makeTempDir: async () => "/tmp/wt-2",
			removeDir: async (path) => {
				removed.push(path);
			},
		});
		await worktree.cleanup();
		expect(calls.map((c) => c.args)).toEqual([
			["worktree", "add", "--detach", "/tmp/wt-2", "b"],
			["worktree", "remove", "--force", "/tmp/wt-2"],
			["worktree", "prune"],
		]);
		expect(removed).toEqual(["/tmp/wt-2"]);
	});

	it("a failed `git worktree add` removes the temp dir and throws (no leaked dir)", async () => {
		const { runGit } = fakeRunGit([{ ok: false, error: "fatal: invalid reference: nope" }]);
		const removed: string[] = [];
		await expect(
			createResultWorktree({
				repoPath: "/repo",
				resultBranch: "nope",
				runGit,
				makeTempDir: async () => "/tmp/wt-3",
				removeDir: async (path) => {
					removed.push(path);
				},
			}),
		).rejects.toThrow(/Failed to create result worktree for "nope".*invalid reference/s);
		expect(removed).toEqual(["/tmp/wt-3"]);
	});

	it("cleanup never throws even if the dir removal fails (best-effort teardown)", async () => {
		const { runGit } = fakeRunGit([{ ok: true }]);
		const worktree = await createResultWorktree({
			repoPath: "/repo",
			resultBranch: "b",
			runGit,
			makeTempDir: async () => "/tmp/wt-4",
			removeDir: async () => {
				throw new Error("EBUSY");
			},
		});
		await expect(worktree.cleanup()).resolves.toBeUndefined();
	});
});
