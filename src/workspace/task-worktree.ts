// Legacy host-task-worktree CLEANUP surface (§5.A). The worktree *creation* machinery
// (ensure/resolve/sync/symlink-mirroring) was retired once native NKlein tasks moved fully into Docker sandboxes
// delivered via `nklein/tasks/<task>` result branches. What remains here removes any worktree, setup lock, or
// saved task patch left on disk by pre-§5.A builds — used by project removal, shutdown cleanup, and the
// `deleteWorktree` tRPC (a no-op for tasks that never created a host worktree). Patch capture is retained because
// `deleteTaskWorktree({ preserveChanges: true })` still snapshots an existing legacy worktree before removing it.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { RuntimeWorktreeDeleteResponse } from "../core/api-contract";
import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath, getTaskWorktreesHomePath } from "../state/workspace-state";
import { getGitStdout, runGit } from "./git-utils";
import { deleteTaskResultBranch } from "./task-result-branches";
import { getWorkspaceFolderLabelForWorktreePath, normalizeTaskIdForWorktreePath } from "./task-worktree-path";
import { deleteTaskWorktreeSyncState } from "./task-worktree-sync";

const KANBAN_TRASHED_TASK_PATCHES_DIR_NAME = "trashed-task-patches";
const KANBAN_TASK_WORKTREE_SETUP_LOCKFILE_NAME = "kanban-task-worktree-setup.lock";
const TASK_PATCH_FILE_SUFFIX = ".patch";

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function removeTaskWorktreeSetupLock(repoPath: string): Promise<boolean> {
	const lockPath = join(repoPath, ".git", KANBAN_TASK_WORKTREE_SETUP_LOCKFILE_NAME);
	const existed = await pathExists(lockPath);
	await rm(lockPath, { force: true, recursive: true });
	return existed;
}

function getWorktreesRootPath(taskId: string): string {
	const normalizedTaskId = normalizeTaskIdForWorktreePath(taskId);
	return join(getTaskWorktreesHomePath(), normalizedTaskId);
}

function getWorktreesBaseRootPath(): string {
	return getTaskWorktreesHomePath();
}

function getTrashedTaskPatchesRootPath(): string {
	return join(getRuntimeHomePath(), KANBAN_TRASHED_TASK_PATCHES_DIR_NAME);
}

function getTaskWorktreePath(repoPath: string, taskId: string): string {
	const workspaceLabel = getWorkspaceFolderLabelForWorktreePath(repoPath);
	return join(getWorktreesRootPath(taskId), workspaceLabel);
}

function getTaskPatchFilePrefix(repoPath: string, taskId: string): string {
	return `${normalizeTaskIdForWorktreePath(taskId)}.${getTaskPatchRepoKey(repoPath)}.`;
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

function parseTaskPatchCommit(repoPath: string, taskId: string, filename: string): string | null {
	if (!filename.endsWith(TASK_PATCH_FILE_SUFFIX)) {
		return null;
	}
	const scopedPrefix = getTaskPatchFilePrefix(repoPath, taskId);
	if (filename.startsWith(scopedPrefix)) {
		const commit = filename.slice(scopedPrefix.length, -TASK_PATCH_FILE_SUFFIX.length).trim();
		return commit.length > 0 ? commit : null;
	}
	const legacyPrefix = `${normalizeTaskIdForWorktreePath(taskId)}.`;
	if (!filename.startsWith(legacyPrefix)) {
		return null;
	}
	const commit = filename.slice(legacyPrefix.length, -TASK_PATCH_FILE_SUFFIX.length).trim();
	if (commit.includes(".")) {
		return null;
	}
	return commit.length > 0 ? commit : null;
}

async function listTaskPatchFiles(repoPath: string, taskId: string): Promise<string[]> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	try {
		const entries = await readdir(patchesRootPath);
		return entries.filter((entry) => parseTaskPatchCommit(repoPath, taskId, entry) !== null);
	} catch {
		return [];
	}
}

async function deleteTaskPatchFiles(repoPath: string, taskId: string): Promise<void> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	const filenames = await listTaskPatchFiles(repoPath, taskId);
	await Promise.all(filenames.map((filename) => rm(join(patchesRootPath, filename), { force: true })));
}

export async function deleteTaskPatchFilesForRepo(repoPath: string): Promise<number> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	const repoKey = getTaskPatchRepoKey(repoPath);
	try {
		const entries = await readdir(patchesRootPath);
		const scopedFilenames = entries.filter(
			(entry) => entry.endsWith(TASK_PATCH_FILE_SUFFIX) && entry.includes(`.${repoKey}.`),
		);
		await Promise.all(scopedFilenames.map((filename) => rm(join(patchesRootPath, filename), { force: true })));
		return scopedFilenames.length;
	} catch {
		return 0;
	}
}

function ensureTrailingNewline(value: string): string {
	return value.endsWith("\n") ? value : `${value}\n`;
}

async function listUntrackedPaths(worktreePath: string): Promise<string[]> {
	const output = await getGitStdout(["ls-files", "--others", "--exclude-standard", "-z"], worktreePath, {
		trimStdout: false,
	});
	return output
		.split("\0")
		.map((path) => path.trim())
		.filter((path) => path.length > 0);
}

async function captureTaskPatch(options: { repoPath: string; taskId: string; worktreePath: string }): Promise<void> {
	const headCommit = await getGitStdout(["rev-parse", "--verify", "HEAD"], options.worktreePath);

	const trackedResult = await runGit(options.worktreePath, ["diff", "--binary", "HEAD", "--"], { trimStdout: false });
	if (!trackedResult.ok && trackedResult.exitCode !== 1) {
		throw new Error(trackedResult.error ?? "Failed to capture tracked diff.");
	}
	const trackedPatch = trackedResult.stdout;
	const patchChunks = trackedPatch.trim().length > 0 ? [ensureTrailingNewline(trackedPatch)] : [];

	for (const relativePath of await listUntrackedPaths(options.worktreePath)) {
		const untrackedResult = await runGit(
			options.worktreePath,
			["diff", "--binary", "--no-index", "--", "/dev/null", relativePath],
			{ trimStdout: false },
		);
		if (!untrackedResult.ok && untrackedResult.exitCode !== 1) {
			throw new Error(untrackedResult.error ?? "Failed to capture untracked diff.");
		}
		const untrackedPatch = untrackedResult.stdout;
		if (untrackedPatch.trim().length > 0) {
			patchChunks.push(ensureTrailingNewline(untrackedPatch));
		}
	}

	await deleteTaskPatchFiles(options.repoPath, options.taskId);
	if (patchChunks.length === 0) {
		return;
	}

	const patchesRootPath = getTrashedTaskPatchesRootPath();
	await mkdir(patchesRootPath, { recursive: true });
	const patchPath = join(
		patchesRootPath,
		`${getTaskPatchFilePrefix(options.repoPath, options.taskId)}${headCommit}${TASK_PATCH_FILE_SUFFIX}`,
	);
	await lockedFileSystem.writeTextFileAtomic(patchPath, patchChunks.join(""));
}

async function removeTaskWorktreeInternal(repoPath: string, worktreePath: string): Promise<boolean> {
	const existed = await pathExists(worktreePath);
	const removeResult = await runGit(repoPath, ["worktree", "remove", "--force", worktreePath]);
	if (!removeResult.ok) {
		// If remove failed (e.g. worktree in bad state), prune stale registrations
		// so git doesn't think the path is still registered after we rm it.
		await runGit(repoPath, ["worktree", "prune"]);
	}
	await rm(worktreePath, { recursive: true, force: true });
	return existed;
}

async function pruneEmptyParents(rootPath: string, fromPath: string): Promise<void> {
	let current = fromPath;
	while (current.startsWith(rootPath) && current !== rootPath) {
		try {
			const entries = await readdir(current);
			if (entries.length > 0) {
				return;
			}
			await rm(current, { recursive: true, force: true });
			current = dirname(current);
		} catch {
			return;
		}
	}
}

export async function deleteTaskWorktree(options: {
	repoPath: string;
	taskId: string;
	preserveChanges?: boolean;
}): Promise<RuntimeWorktreeDeleteResponse> {
	try {
		const taskId = normalizeTaskIdForWorktreePath(options.taskId);
		const preserveChanges = options.preserveChanges ?? true;
		const rootPath = getWorktreesBaseRootPath();
		const worktreePath = getTaskWorktreePath(options.repoPath, taskId);
		if (!(await pathExists(worktreePath))) {
			if (!preserveChanges) {
				await deleteTaskPatchFiles(options.repoPath, taskId);
				await deleteTaskResultBranch({ repoPath: options.repoPath, taskId });
				// §5.AW: the card's speculative candidate branch (if any) goes with it.
				await deleteTaskResultBranch({ repoPath: options.repoPath, taskId: `${taskId}::spec` }).catch(() => false);
			}
			await deleteTaskWorktreeSyncState(options.repoPath, taskId);
			await pruneEmptyParents(rootPath, dirname(worktreePath));
			return {
				ok: true,
				removed: false,
			};
		}

		if (preserveChanges) {
			try {
				await captureTaskPatch({
					repoPath: options.repoPath,
					taskId,
					worktreePath,
				});
			} catch {
				// Patch capture is best-effort. A corrupted or partially-created
				// worktree (e.g. plain directory, no git init) should still be removed.
			}
		} else {
			await deleteTaskPatchFiles(options.repoPath, taskId);
			await deleteTaskResultBranch({ repoPath: options.repoPath, taskId });
			// §5.AW: the card's speculative candidate branch (if any) goes with it.
			await deleteTaskResultBranch({ repoPath: options.repoPath, taskId: `${taskId}::spec` }).catch(() => false);
		}
		const removed = await removeTaskWorktreeInternal(options.repoPath, worktreePath);
		await deleteTaskWorktreeSyncState(options.repoPath, taskId);
		await pruneEmptyParents(rootPath, dirname(worktreePath));

		return {
			ok: true,
			removed,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			removed: false,
			error: message,
		};
	}
}
