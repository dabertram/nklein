import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit as defaultRunGit, type RunGitOptions } from "./git-utils";

/**
 * F1.26b — the live `createResultWorktree` primitive for the replay-eval auto-capture: materialize a task's result
 * branch in a throwaway git worktree so the replay pass can run the aimock dev-test suite against the PATCHED tree
 * without touching the operator's working copy. Matches the `ReplayEvalAutoCaptureDeps.createResultWorktree` seam
 * (`src/core/replay-eval-orchestration.ts`) — the orchestrator supplies the branch, this returns the tree path plus a
 * `cleanup` the orchestrator ALWAYS calls (even when the replay run throws).
 *
 * A `--detach` checkout is used deliberately: the auto-capture only READS the tree, and a detached worktree neither
 * moves the branch ref nor collides with a second worktree that wants the same branch. `runGit` is injected (it never
 * throws — it returns `{ ok:false }`), so the add/remove/prune sequencing + guaranteed temp-dir removal is unit-tested
 * without a real git repo.
 */

type RunGit = (cwd: string, args: string[], options?: RunGitOptions) => ReturnType<typeof defaultRunGit>;

export interface CreateResultWorktreeInput {
	/** The repository the result branch lives in (the worktree is registered against it). */
	repoPath: string;
	/** The branch/ref to check out into the throwaway worktree (e.g. a task's result branch). */
	resultBranch: string;
	runGit?: RunGit;
	/** Make the isolated worktree dir; defaults to a fresh OS temp dir. Injected for tests. */
	makeTempDir?: () => Promise<string>;
	/** Remove the worktree dir on cleanup / failed add; defaults to `rm -rf`. Injected for tests. */
	removeDir?: (path: string) => Promise<void>;
}

export interface ResultWorktree {
	/** The checked-out tree path — where the replay pass runs the suite. */
	path: string;
	/** Remove the worktree registration + prune metadata + delete the dir. Safe to call once; never throws. */
	cleanup: () => Promise<void>;
}

export async function createResultWorktree(input: CreateResultWorktreeInput): Promise<ResultWorktree> {
	const runGit = input.runGit ?? defaultRunGit;
	const makeTempDir = input.makeTempDir ?? (() => mkdtemp(join(tmpdir(), "nklein-replay-wt-")));
	const removeDir = input.removeDir ?? ((path: string) => rm(path, { recursive: true, force: true }));

	const worktreePath = await makeTempDir();
	const add = await runGit(input.repoPath, ["worktree", "add", "--detach", worktreePath, input.resultBranch]);
	if (!add.ok) {
		// The add failed (e.g. unknown branch / dirty path) — the temp dir is empty or partial; remove it and surface.
		await removeDir(worktreePath).catch(() => {});
		throw new Error(`Failed to create result worktree for "${input.resultBranch}": ${add.error ?? add.stderr}`);
	}
	return {
		path: worktreePath,
		cleanup: async () => {
			// Mirror the legacy-worktree-sweep teardown: drop the worktree registration, prune stale metadata, then make
			// sure the dir is gone even if `git worktree remove` left it behind. runGit never throws; removeDir might.
			await runGit(input.repoPath, ["worktree", "remove", "--force", worktreePath]);
			await runGit(input.repoPath, ["worktree", "prune"]);
			await removeDir(worktreePath).catch(() => {});
		},
	};
}
