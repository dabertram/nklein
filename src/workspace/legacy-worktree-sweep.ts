// Legacy host-task-worktree SWEEP (P0.9a). Pre-§5.A builds ran agents in host git worktrees under
// `~/<nklein home>/worktrees/<taskId>/<workspaceLabel>`; that subsystem is retired (task work runs in Docker
// sandboxes and is delivered via `nklein/tasks/<task>` result branches). This one-shot, presence-keyed startup sweep
// migrates a machine that still carries that directory: each entry's parent repository is resolved from the
// worktree's own `.git` file — never from board/agent-id predicates — uncommitted changes are snapshotted to the
// trashed-task-patches store first, the worktree is removed via git (with a prune + raw-remove fallback), stale
// setup locks and the retired sync-state store are deleted, and the empty worktrees home is removed last.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { access, mkdir, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath, getTaskWorktreesHomePath } from "../state/workspace-state";
import { getGitStdout, runGit } from "./git-utils";

const TRASHED_TASK_PATCHES_DIR_NAME = "trashed-task-patches";
const WORKTREE_SYNC_STATE_DIR_NAME = "worktree-sync-state";
const TASK_WORKTREE_SETUP_LOCKFILE_NAME = "kanban-task-worktree-setup.lock";
const TASK_PATCH_FILE_SUFFIX = ".patch";

export interface LegacyWorktreeSweepResult {
	removedWorktrees: number;
	warnings: string[];
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/** Resolve the parent repository of a legacy worktree from its own `.git` file (`gitdir: <repo>/.git/worktrees/x`). */
async function resolveWorktreeParentRepo(worktreePath: string): Promise<string | null> {
	let gitFileContent: string;
	try {
		gitFileContent = await readFile(join(worktreePath, ".git"), "utf8");
	} catch {
		return null;
	}
	const gitdirMatch = /^gitdir:\s*(.+)\s*$/m.exec(gitFileContent);
	if (!gitdirMatch?.[1]) {
		return null;
	}
	const gitdir = isAbsolute(gitdirMatch[1]) ? gitdirMatch[1] : resolve(worktreePath, gitdirMatch[1]);
	// `<repo>/.git/worktrees/<name>` → `<repo>`; anything else is not a linked-worktree gitdir.
	const segments = gitdir.split(sep);
	const worktreesIndex = segments.lastIndexOf("worktrees");
	if (worktreesIndex < 2 || segments[worktreesIndex - 1] !== ".git") {
		return null;
	}
	const repoPath = segments.slice(0, worktreesIndex - 1).join(sep) || sep;
	return (await pathExists(join(repoPath, ".git"))) ? repoPath : null;
}

function getTaskPatchRepoKey(repoPath: string): string {
	let canonicalRepoPath: string;
	try {
		canonicalRepoPath = realpathSync(repoPath);
	} catch {
		canonicalRepoPath = resolve(repoPath);
	}
	return createHash("sha256").update(canonicalRepoPath).digest("hex").slice(0, 12);
}

function ensureTrailingNewline(value: string): string {
	return value.endsWith("\n") ? value : `${value}\n`;
}

/**
 * Snapshot the worktree's uncommitted (tracked + untracked) changes into the trashed-task-patches store using the
 * same `<taskId>.<repoKey>.<headCommit>.patch` naming the trash/removal cleanup understands, so a migrated board's
 * in-flight work survives the sweep as an applyable patch.
 */
async function captureLegacyWorktreePatch(options: {
	repoPath: string;
	taskId: string;
	worktreePath: string;
}): Promise<void> {
	const headCommit = await getGitStdout(["rev-parse", "--verify", "HEAD"], options.worktreePath);
	const trackedResult = await runGit(options.worktreePath, ["diff", "--binary", "HEAD", "--"], { trimStdout: false });
	if (!trackedResult.ok && trackedResult.exitCode !== 1) {
		throw new Error(trackedResult.error ?? "Failed to capture tracked diff.");
	}
	const patchChunks = trackedResult.stdout.trim().length > 0 ? [ensureTrailingNewline(trackedResult.stdout)] : [];

	const untrackedOutput = await getGitStdout(
		["ls-files", "--others", "--exclude-standard", "-z"],
		options.worktreePath,
		{
			trimStdout: false,
		},
	);
	for (const relativePath of untrackedOutput.split("\0").filter((path) => path.trim().length > 0)) {
		const untrackedResult = await runGit(
			options.worktreePath,
			["diff", "--binary", "--no-index", "--", "/dev/null", relativePath],
			{ trimStdout: false },
		);
		if (!untrackedResult.ok && untrackedResult.exitCode !== 1) {
			throw new Error(untrackedResult.error ?? "Failed to capture untracked diff.");
		}
		if (untrackedResult.stdout.trim().length > 0) {
			patchChunks.push(ensureTrailingNewline(untrackedResult.stdout));
		}
	}
	if (patchChunks.length === 0) {
		return;
	}
	const patchesRootPath = join(getRuntimeHomePath(), TRASHED_TASK_PATCHES_DIR_NAME);
	await mkdir(patchesRootPath, { recursive: true });
	const patchPath = join(
		patchesRootPath,
		`${options.taskId}.${getTaskPatchRepoKey(options.repoPath)}.${headCommit}${TASK_PATCH_FILE_SUFFIX}`,
	);
	await lockedFileSystem.writeTextFileAtomic(patchPath, patchChunks.join(""));
}

async function removeWorktree(options: {
	repoPath: string | null;
	taskId: string;
	worktreePath: string;
}): Promise<void> {
	if (options.repoPath) {
		try {
			await captureLegacyWorktreePatch({
				repoPath: options.repoPath,
				taskId: options.taskId,
				worktreePath: options.worktreePath,
			});
		} catch {
			// Patch capture is best-effort: a corrupted or partially-created worktree is still removed.
		}
		const removeResult = await runGit(options.repoPath, ["worktree", "remove", "--force", options.worktreePath]);
		if (!removeResult.ok) {
			// Bad-state worktree: prune the stale registration so git forgets the path after the raw removal below.
			await runGit(options.repoPath, ["worktree", "prune"]);
		}
	}
	await rm(options.worktreePath, { recursive: true, force: true });
}

async function removeDirIfEmpty(path: string): Promise<void> {
	try {
		await rmdir(path);
	} catch {
		// Non-empty (a warned failure left residue) or already gone — leave it for the next startup sweep.
	}
}

/**
 * One-shot startup migration for machines that still carry the retired host-worktree subsystem on disk. Keyed purely
 * on directory presence; a clean machine returns after a single `access()` miss. `repoPaths` (the registered
 * workspaces) additionally get their pre-§5.A setup locks removed.
 */
export async function sweepLegacyTaskWorktrees(options?: {
	repoPaths?: readonly string[];
}): Promise<LegacyWorktreeSweepResult> {
	const warnings: string[] = [];
	let removedWorktrees = 0;
	const lockRepoPaths = new Set(options?.repoPaths ?? []);
	const worktreesHomePath = getTaskWorktreesHomePath();

	if (await pathExists(worktreesHomePath)) {
		let taskDirNames: string[] = [];
		try {
			taskDirNames = await readdir(worktreesHomePath);
		} catch (error) {
			warnings.push(
				`Could not list legacy task worktrees home: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		for (const taskDirName of taskDirNames) {
			const taskDirPath = join(worktreesHomePath, taskDirName);
			let labelDirNames: string[] = [];
			try {
				labelDirNames = await readdir(taskDirPath);
			} catch {
				// A stray file where a task directory is expected is retired-subsystem residue all the same.
				await rm(taskDirPath, { recursive: true, force: true });
				continue;
			}
			for (const labelDirName of labelDirNames) {
				const worktreePath = join(taskDirPath, labelDirName);
				try {
					const repoPath = await resolveWorktreeParentRepo(worktreePath);
					await removeWorktree({ repoPath, taskId: taskDirName, worktreePath });
					if (repoPath) {
						lockRepoPaths.add(repoPath);
					}
					removedWorktrees += 1;
				} catch (error) {
					warnings.push(
						`Could not remove legacy task worktree at ${worktreePath}: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
			}
			await removeDirIfEmpty(taskDirPath);
		}
		await removeDirIfEmpty(worktreesHomePath);
	}

	// The retired per-worktree sync-state store is residue wherever it exists; the patch snapshots above are NOT
	// touched — the trash/project-removal cleanup owns their lifecycle.
	await rm(join(getRuntimeHomePath(), WORKTREE_SYNC_STATE_DIR_NAME), { recursive: true, force: true }).catch(() => {});

	await Promise.all(
		Array.from(lockRepoPaths).map(async (repoPath) => {
			await rm(join(repoPath, ".git", TASK_WORKTREE_SETUP_LOCKFILE_NAME), { recursive: true, force: true }).catch(
				() => {},
			);
		}),
	);

	return { removedWorktrees, warnings };
}
