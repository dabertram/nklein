import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	NKLEIN_HOME_DIR_NAME,
	NKLEIN_RUNTIME_DIR_NAME,
	TASK_WORKTREES_DIR_NAME,
} from "../config/runtime-path-constants";
import type { LockRequest } from "../fs/locked-file-system";

/**
 * Workspace on-disk LAYOUT + path/lock-request resolution (todo §5.U — extracted from workspace-state.ts as a cohesive
 * sibling module). The single source of truth for where !Klein's runtime home, the global workspace index/directories,
 * and a repo's `.nklein` local state live on disk, plus the lock-request descriptors that guard them. Pure (path joins
 * + one realpath), coupling is entirely imports — so the move is behavior-preserving; workspace-state imports these back.
 */

export const RUNTIME_HOME_PARENT_DIR = NKLEIN_HOME_DIR_NAME;
export const RUNTIME_HOME_DIR = NKLEIN_RUNTIME_DIR_NAME;
export const RUNTIME_WORKTREES_DIR = TASK_WORKTREES_DIR_NAME;
export const WORKSPACES_DIR = "workspaces";
export const INDEX_FILENAME = "index.json";
export const BOARD_FILENAME = "board.json";
export const SESSIONS_FILENAME = "sessions.json";
export const META_FILENAME = "meta.json";
export const WORKSPACE_LOCAL_STATE_DIR = "workspace";
export const WORKSPACE_IDENTITY_FILENAME = "identity.json";

export function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR);
}

export function getTaskWorktreesHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_WORKTREES_DIR);
}

export async function getCanonicalTaskWorktreesHomePath(): Promise<string> {
	const taskWorktreesHomePath = getTaskWorktreesHomePath();
	try {
		return await realpath(taskWorktreesHomePath);
	} catch {
		return taskWorktreesHomePath;
	}
}

export function getWorkspacesRootPath(): string {
	return join(getRuntimeHomePath(), WORKSPACES_DIR);
}

export function getWorkspaceIndexPath(): string {
	return join(getWorkspacesRootPath(), INDEX_FILENAME);
}

export function getWorkspaceDirectoryPath(workspaceId: string): string {
	return join(getWorkspacesRootPath(), workspaceId);
}

export function getWorkspaceBoardPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), BOARD_FILENAME);
}

export function getWorkspaceSessionsPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), SESSIONS_FILENAME);
}

export function getWorkspaceMetaPath(workspaceId: string): string {
	return join(getWorkspaceDirectoryPath(workspaceId), META_FILENAME);
}

export function getWorkspaceLocalStateDirectoryPath(repoPath: string): string {
	return join(repoPath, ".nklein", RUNTIME_HOME_DIR, WORKSPACE_LOCAL_STATE_DIR);
}

export function getWorkspaceLocalBoardPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), BOARD_FILENAME);
}

export function getWorkspaceLocalSessionsPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), SESSIONS_FILENAME);
}

export function getWorkspaceLocalMetaPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), META_FILENAME);
}

export function getWorkspaceLocalIdentityPath(repoPath: string): string {
	return join(getWorkspaceLocalStateDirectoryPath(repoPath), WORKSPACE_IDENTITY_FILENAME);
}

export function getWorkspaceIndexLockRequest(): LockRequest {
	return {
		path: getWorkspaceIndexPath(),
		type: "file",
	};
}

export function getWorkspaceDirectoryLockRequest(workspaceId: string): LockRequest {
	return {
		path: getWorkspaceDirectoryPath(workspaceId),
		type: "directory",
		lockfilePath: join(getWorkspacesRootPath(), `${workspaceId}.lock`),
	};
}

export function getWorkspacesRootLockRequest(): LockRequest {
	return {
		path: getWorkspacesRootPath(),
		type: "directory",
		lockfileName: ".workspaces.lock",
	};
}
