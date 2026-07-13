// Worktree-free task-artifact cleanup (P0.9b). Replaces the retired `task-worktree.ts` cleanup surface: trashing or
// replaying a card discards its durable artifacts — the `nklein/tasks/<task>` result branch (+ the `::spec`
// speculative candidate) and any trashed-task patch snapshots — with no host worktree involved. The trashed-task
// patch store itself outlives the worktree subsystem: the legacy-worktree startup sweep still writes preserving
// snapshots into it, so the naming helpers live here and are shared with the sweep.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";
import { deleteTaskResultBranch } from "./task-result-branches";

const TRASHED_TASK_PATCHES_DIR_NAME = "trashed-task-patches";
const TASK_PATCH_FILE_SUFFIX = ".patch";

export interface TaskArtifactsDeleteResult {
	ok: boolean;
	error?: string;
}

function getTrashedTaskPatchesRootPath(): string {
	return join(getRuntimeHomePath(), TRASHED_TASK_PATCHES_DIR_NAME);
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

function normalizeTaskIdForPatchFile(taskId: string): string {
	const normalized = taskId.trim();
	if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
		throw new Error("Invalid task id for task artifact cleanup.");
	}
	return normalized;
}

function getTaskPatchFilePrefix(repoPath: string, taskId: string): string {
	return `${normalizeTaskIdForPatchFile(taskId)}.${getTaskPatchRepoKey(repoPath)}.`;
}

function isTaskPatchFile(repoPath: string, taskId: string, filename: string): boolean {
	if (!filename.endsWith(TASK_PATCH_FILE_SUFFIX)) {
		return false;
	}
	if (filename.startsWith(getTaskPatchFilePrefix(repoPath, taskId))) {
		return true;
	}
	// Pre-repo-key patch files were named `<taskId>.<commit>.patch`.
	const legacyPrefix = `${normalizeTaskIdForPatchFile(taskId)}.`;
	if (!filename.startsWith(legacyPrefix)) {
		return false;
	}
	return !filename.slice(legacyPrefix.length, -TASK_PATCH_FILE_SUFFIX.length).includes(".");
}

/** Write a preserving snapshot into the trashed-task-patches store (used by the legacy-worktree startup sweep). */
export async function writeTrashedTaskPatch(options: {
	repoPath: string;
	taskId: string;
	headCommit: string;
	patch: string;
}): Promise<void> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	await mkdir(patchesRootPath, { recursive: true });
	const patchPath = join(
		patchesRootPath,
		`${getTaskPatchFilePrefix(options.repoPath, options.taskId)}${options.headCommit}${TASK_PATCH_FILE_SUFFIX}`,
	);
	await lockedFileSystem.writeTextFileAtomic(patchPath, options.patch);
}

export async function deleteTaskPatchFiles(repoPath: string, taskId: string): Promise<void> {
	const patchesRootPath = getTrashedTaskPatchesRootPath();
	let entries: string[];
	try {
		entries = await readdir(patchesRootPath);
	} catch {
		return;
	}
	await Promise.all(
		entries
			.filter((entry) => isTaskPatchFile(repoPath, taskId, entry))
			.map((entry) => rm(join(patchesRootPath, entry), { force: true })),
	);
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

/**
 * Discard a task's durable artifacts: its result branch, its `::spec` speculative candidate branch (§5.AW — the
 * card's candidate goes with it), and any trashed-task patch snapshots. Used by trash/replay and project removal.
 */
export async function deleteTaskArtifacts(options: {
	repoPath: string;
	taskId: string;
}): Promise<TaskArtifactsDeleteResult> {
	try {
		const taskId = normalizeTaskIdForPatchFile(options.taskId);
		await deleteTaskPatchFiles(options.repoPath, taskId);
		await deleteTaskResultBranch({ repoPath: options.repoPath, taskId });
		await deleteTaskResultBranch({ repoPath: options.repoPath, taskId: `${taskId}::spec` }).catch(() => false);
		return { ok: true };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
