import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readlink, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { lockedFileSystem } from "../fs/locked-file-system";
import { getRuntimeHomePath } from "../state/workspace-state";
import { getGitStdout, runGit } from "./git-utils";
import { normalizeTaskIdForWorktreePath } from "./task-worktree-path";

const KANBAN_WORKTREE_SYNC_STATE_DIR_NAME = "worktree-sync-state";

function parseNullSeparatedPaths(output: string): string[] {
	return output.split("\0").filter((path) => path.length > 0);
}

async function tryRunGit(cwd: string, args: string[]): Promise<string | null> {
	const result = await runGit(cwd, args);
	return result.ok ? result.stdout : null;
}

async function listWorkingChangePaths(repoPath: string): Promise<string[]> {
	const [unstaged, staged, untracked] = await Promise.all([
		getGitStdout(["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"], repoPath, {
			trimStdout: false,
		}),
		getGitStdout(["diff", "--cached", "--name-only", "--no-renames", "-z", "HEAD", "--"], repoPath, {
			trimStdout: false,
		}),
		getGitStdout(["ls-files", "--others", "--exclude-standard", "-z"], repoPath, {
			trimStdout: false,
		}),
	]);
	return Array.from(
		new Set([
			...parseNullSeparatedPaths(unstaged),
			...parseNullSeparatedPaths(staged),
			...parseNullSeparatedPaths(untracked),
		]),
	);
}

function getTaskWorktreeSyncStatePath(repoPath: string, taskId: string): string {
	let canonicalRepoPath: string;
	try {
		canonicalRepoPath = realpathSync(repoPath);
	} catch {
		canonicalRepoPath = resolve(repoPath);
	}
	const repoKey = createHash("sha256").update(canonicalRepoPath).digest("hex").slice(0, 12);
	return join(
		getRuntimeHomePath(),
		KANBAN_WORKTREE_SYNC_STATE_DIR_NAME,
		`${normalizeTaskIdForWorktreePath(taskId)}.${repoKey}.json`,
	);
}

async function loadTaskWorktreeSyncState(repoPath: string, taskId: string): Promise<Record<string, string>> {
	try {
		const parsed = JSON.parse(await readFile(getTaskWorktreeSyncStatePath(repoPath, taskId), "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
		);
	} catch {
		return {};
	}
}

async function saveTaskWorktreeSyncState(
	repoPath: string,
	taskId: string,
	state: Record<string, string>,
): Promise<void> {
	const statePath = getTaskWorktreeSyncStatePath(repoPath, taskId);
	if (Object.keys(state).length === 0) {
		await rm(statePath, { force: true });
		return;
	}
	await mkdir(dirname(statePath), { recursive: true });
	await lockedFileSystem.writeTextFileAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function fingerprintPath(path: string): Promise<string> {
	const pathStat = await lstat(path).catch(() => null);
	if (!pathStat) {
		return "missing";
	}
	const hash = createHash("sha256");
	if (pathStat.isSymbolicLink()) {
		hash.update("symlink:");
		hash.update(await readlink(path));
		return hash.digest("hex");
	}
	if (pathStat.isDirectory()) {
		return "directory";
	}
	hash.update("file:");
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk);
	}
	return hash.digest("hex");
}

async function copyWorkspacePathState(repoPath: string, worktreePath: string, relativePath: string): Promise<void> {
	const sourcePath = join(repoPath, relativePath);
	const targetPath = join(worktreePath, relativePath);
	const sourceStat = await lstat(sourcePath).catch(() => null);
	if (!sourceStat) {
		await rm(targetPath, { recursive: true, force: true });
		return;
	}
	await rm(targetPath, { recursive: true, force: true });
	await mkdir(dirname(targetPath), { recursive: true });
	await cp(sourcePath, targetPath, {
		recursive: sourceStat.isDirectory(),
		force: true,
		preserveTimestamps: true,
		verbatimSymlinks: true,
	});
}

function formatPathWarning(prefix: string, paths: readonly string[]): string {
	const visiblePaths = paths.slice(0, 5);
	const remainder = paths.length - visiblePaths.length;
	return `${prefix}: ${visiblePaths.join(", ")}${remainder > 0 ? ` (+${remainder} more)` : ""}.`;
}

export async function deleteTaskWorktreeSyncState(repoPath: string, taskId: string): Promise<void> {
	await rm(getTaskWorktreeSyncStatePath(repoPath, taskId), { force: true });
}

export async function syncWorkspaceChangesIntoTaskWorktree(options: {
	repoPath: string;
	worktreePath: string;
	taskId: string;
	requestedBaseRef: string;
	requestedBaseCommit: string;
}): Promise<string | undefined> {
	const repoHead = await getGitStdout(["rev-parse", "--verify", "HEAD"], options.repoPath);
	if (repoHead !== options.requestedBaseCommit) {
		return `Project folder HEAD is ${repoHead.slice(0, 12)}, but task base ${options.requestedBaseRef} is ${options.requestedBaseCommit.slice(0, 12)}. External folder changes were not copied because they belong to a different checkout.`;
	}

	const workspaceChangePaths = await listWorkingChangePaths(options.repoPath);
	const taskHead = await getGitStdout(["rev-parse", "--verify", "HEAD"], options.worktreePath);
	const mergeBase =
		(await tryRunGit(options.worktreePath, ["merge-base", taskHead, options.requestedBaseCommit])) ?? taskHead;
	const [taskCommittedOutput, taskWorkingPaths, baseChangedOutput, syncState] = await Promise.all([
		getGitStdout(["diff", "--name-only", "--no-renames", "-z", mergeBase, taskHead, "--"], options.worktreePath, {
			trimStdout: false,
		}),
		listWorkingChangePaths(options.worktreePath),
		getGitStdout(
			["diff", "--name-only", "--no-renames", "-z", mergeBase, options.requestedBaseCommit, "--"],
			options.repoPath,
			{ trimStdout: false },
		),
		loadTaskWorktreeSyncState(options.repoPath, options.taskId),
	]);

	const taskChangedPaths = new Set([...parseNullSeparatedPaths(taskCommittedOutput), ...taskWorkingPaths]);
	for (const [relativePath, syncedFingerprint] of Object.entries(syncState)) {
		if (
			taskChangedPaths.has(relativePath) &&
			(await fingerprintPath(join(options.worktreePath, relativePath))) === syncedFingerprint
		) {
			taskChangedPaths.delete(relativePath);
		}
	}

	const currentExternalPaths = new Set([...workspaceChangePaths, ...parseNullSeparatedPaths(baseChangedOutput)]);
	const candidatePaths = Array.from(new Set([...currentExternalPaths, ...Object.keys(syncState)]));
	const conflictingPaths = candidatePaths.filter((path) => taskChangedPaths.has(path));
	const syncablePaths = candidatePaths.filter((path) => !taskChangedPaths.has(path));
	await Promise.all(
		syncablePaths.map(async (relativePath) => {
			await copyWorkspacePathState(options.repoPath, options.worktreePath, relativePath);
		}),
	);

	for (const relativePath of syncablePaths) {
		if (currentExternalPaths.has(relativePath)) {
			syncState[relativePath] = await fingerprintPath(join(options.worktreePath, relativePath));
		} else {
			delete syncState[relativePath];
		}
	}
	for (const relativePath of conflictingPaths) {
		delete syncState[relativePath];
	}
	await saveTaskWorktreeSyncState(options.repoPath, options.taskId, syncState);

	const warnings: string[] = [];
	if (conflictingPaths.length > 0) {
		warnings.push(
			formatPathWarning(
				"External project changes overlap agent workspace changes and were not copied",
				conflictingPaths,
			),
		);
	}
	if (taskHead !== options.requestedBaseCommit) {
		warnings.push(
			`Task workspace is based on ${taskHead.slice(0, 12)}, while ${options.requestedBaseRef} is ${options.requestedBaseCommit.slice(0, 12)}. Review or merge the newer base changes before integrating the task.`,
		);
	}
	return warnings.length > 0 ? warnings.join(" ") : undefined;
}
