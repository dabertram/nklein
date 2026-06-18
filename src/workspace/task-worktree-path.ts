import {
	NKLEIN_RUNTIME_HOME_DIR_NAME,
	TASK_WORKTREES_DIR_NAME,
	TASK_WORKTREES_HOME_DIR_NAME,
} from "../config/runtime-paths";

const WORKTREE_TASK_ID_INVALID_MESSAGE = "Invalid task id for worktree path.";

export const KANBAN_RUNTIME_HOME_DIR_NAME = NKLEIN_RUNTIME_HOME_DIR_NAME;
export const KANBAN_TASK_WORKTREES_HOME_DIR_NAME = TASK_WORKTREES_HOME_DIR_NAME;
export const KANBAN_TASK_WORKTREES_DIR_NAME = TASK_WORKTREES_DIR_NAME;
export const KANBAN_TASK_WORKTREES_DISPLAY_ROOT = `~/${KANBAN_TASK_WORKTREES_HOME_DIR_NAME}`;

function normalizePathForComparison(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

export function isPathInsideTaskWorktreesHome(path: string, taskWorktreesHomePath: string): boolean {
	const normalizedPath = normalizePathForComparison(path);
	const normalizedRoot = normalizePathForComparison(taskWorktreesHomePath);
	if (!normalizedPath || !normalizedRoot) {
		return false;
	}
	if (process.platform === "win32") {
		const lowerPath = normalizedPath.toLowerCase();
		const lowerRoot = normalizedRoot.toLowerCase();
		return lowerPath === lowerRoot || lowerPath.startsWith(`${lowerRoot}/`);
	}
	return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function normalizeTaskIdForWorktreePath(taskId: string): string {
	const normalized = taskId.trim();
	if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
		throw new Error(WORKTREE_TASK_ID_INVALID_MESSAGE);
	}
	return normalized;
}

export function getWorkspaceFolderLabelForWorktreePath(repoPath: string): string {
	const trimmed = repoPath.trim().replace(/[\\/]+$/g, "");
	const folder =
		trimmed
			.split(/[\\/]/g)
			.filter((segment) => segment.length > 0)
			.at(-1) ?? "workspace";
	const cleaned = [...folder]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.trim();
	return cleaned || "workspace";
}

export function buildTaskWorktreeDisplayPath(taskId: string, repoPath: string): string {
	const normalizedTaskId = normalizeTaskIdForWorktreePath(taskId);
	const workspaceLabel = getWorkspaceFolderLabelForWorktreePath(repoPath);
	return `${KANBAN_TASK_WORKTREES_DISPLAY_ROOT}/${normalizedTaskId}/${workspaceLabel}`;
}
