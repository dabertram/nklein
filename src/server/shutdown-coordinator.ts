import type {
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { moveTaskToColumn } from "../core/task-board-mutations";
import { listWorkspaceIndexEntries, loadWorkspaceState, saveWorkspaceState } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { deleteTaskWorktree, removeTaskWorktreeSetupLock } from "../workspace/task-worktree";
import type { WorkspaceRegistry } from "./workspace-registry";

export interface RuntimeShutdownCoordinatorDependencies {
	workspaceRegistry: Pick<WorkspaceRegistry, "listManagedWorkspaces">;
	warn: (message: string) => void;
	closeRuntimeServer: () => Promise<void>;
	skipSessionCleanup?: boolean;
}

const SHUTDOWN_ACTIVE_COLUMN_IDS = new Set<RuntimeBoardColumnId>(["planning", "in_progress", "review"]);

function collectActiveBoardTaskIdsForShutdown(board: RuntimeBoardData): string[] {
	const taskIds: string[] = [];
	for (const column of board.columns) {
		if (!SHUTDOWN_ACTIVE_COLUMN_IDS.has(column.id)) {
			continue;
		}
		for (const card of column.cards) {
			taskIds.push(card.id);
		}
	}
	return taskIds;
}

function moveActiveBoardTasksToTrash(board: RuntimeBoardData, taskIds: Iterable<string>): RuntimeBoardData {
	let nextBoard = board;
	for (const taskId of taskIds) {
		const moved = moveTaskToColumn(nextBoard, taskId, "trash");
		if (moved.moved) {
			nextBoard = moved.board;
		}
	}
	return nextBoard;
}

async function persistInterruptedSessions(
	workspacePath: string,
	interruptedTaskIds: string[],
	options?: {
		workspaceState?: RuntimeWorkspaceStateResponse;
		resolveSummary?: (taskId: string) => RuntimeTaskSessionSummary | null;
	},
): Promise<string[]> {
	const workspaceState = options?.workspaceState ?? (await loadWorkspaceState(workspacePath));
	const activeBoardTaskIds = collectActiveBoardTaskIdsForShutdown(workspaceState.board);
	const taskIdsToInterrupt = Array.from(new Set([...interruptedTaskIds, ...activeBoardTaskIds]));
	if (taskIdsToInterrupt.length === 0) {
		return [];
	}
	const now = Date.now();
	const nextSessions = {
		...workspaceState.sessions,
	};
	for (const taskId of taskIdsToInterrupt) {
		const summary = options?.resolveSummary?.(taskId) ?? workspaceState.sessions[taskId] ?? null;
		if (summary) {
			nextSessions[taskId] = {
				...summary,
				state: "interrupted",
				reviewReason: "interrupted",
				pid: null,
				updatedAt: now,
			};
		}
	}
	const nextBoard = moveActiveBoardTasksToTrash(workspaceState.board, activeBoardTaskIds);
	await saveWorkspaceState(workspacePath, {
		board: nextBoard,
		sessions: nextSessions,
	});
	return taskIdsToInterrupt;
}

async function cleanupInterruptedTaskWorktrees(
	repoPath: string,
	taskIds: string[],
	warn: (message: string) => void,
): Promise<void> {
	if (taskIds.length === 0) {
		return;
	}
	const deletions = await Promise.all(
		taskIds.map(async (taskId) => ({
			taskId,
			deleted: await deleteTaskWorktree({
				repoPath,
				taskId,
			}),
		})),
	);
	for (const { taskId, deleted } of deletions) {
		if (deleted.ok) {
			continue;
		}
		const message = deleted.error ?? `Could not delete task workspace for task "${taskId}" during shutdown.`;
		warn(message);
	}
}

async function cleanupTaskWorktreeSetupLocks(
	repoPaths: Iterable<string>,
	warn: (message: string) => void,
): Promise<void> {
	await Promise.all(
		Array.from(new Set(repoPaths)).map(async (repoPath) => {
			try {
				await removeTaskWorktreeSetupLock(repoPath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warn(`Could not remove task worktree setup lock for ${repoPath} during shutdown cleanup. ${message}`);
			}
		}),
	);
}

function shouldInterruptSessionOnShutdown(summary: RuntimeTaskSessionSummary): boolean {
	if (summary.state === "running") {
		return true;
	}
	return summary.state === "awaiting_review";
}

function collectShutdownInterruptedTaskIds(
	interruptedSummaries: RuntimeTaskSessionSummary[],
	terminalManager: TerminalSessionManager,
): string[] {
	const taskIds = new Set(interruptedSummaries.map((summary) => summary.taskId));
	for (const summary of terminalManager.listSummaries()) {
		if (!shouldInterruptSessionOnShutdown(summary)) {
			continue;
		}
		taskIds.add(summary.taskId);
	}
	return Array.from(taskIds);
}

export async function shutdownRuntimeServer(deps: RuntimeShutdownCoordinatorDependencies): Promise<void> {
	if (deps.skipSessionCleanup) {
		await deps.closeRuntimeServer();
		return;
	}

	const interruptedByWorkspace: Array<{
		workspacePath: string;
		interruptedTaskIds: string[];
		workspaceState?: RuntimeWorkspaceStateResponse;
		resolveSummary?: (taskId: string) => RuntimeTaskSessionSummary | null;
	}> = [];
	const managedWorkspacePaths = new Set<string>();

	for (const { workspacePath, terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
		const interrupted = terminalManager.markInterruptedAndStopAll();
		const interruptedTaskIds = new Set(collectShutdownInterruptedTaskIds(interrupted, terminalManager));
		if (!workspacePath) {
			continue;
		}
		managedWorkspacePaths.add(workspacePath);
		try {
			const workspaceState = await loadWorkspaceState(workspacePath);
			interruptedByWorkspace.push({
				workspacePath,
				interruptedTaskIds: Array.from(interruptedTaskIds),
				workspaceState,
				resolveSummary: (taskId) => terminalManager.getSummary(taskId),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not load workspace state for ${workspacePath} during shutdown cleanup. ${message}`);
		}
	}

	for (const indexedWorkspace of await listWorkspaceIndexEntries()) {
		if (managedWorkspacePaths.has(indexedWorkspace.repoPath)) {
			continue;
		}
		try {
			const workspaceState = await loadWorkspaceState(indexedWorkspace.repoPath);
			const activeTaskIds = collectActiveBoardTaskIdsForShutdown(workspaceState.board);
			if (activeTaskIds.length === 0) {
				continue;
			}
			interruptedByWorkspace.push({
				workspacePath: indexedWorkspace.repoPath,
				interruptedTaskIds: activeTaskIds,
				workspaceState,
			});
			managedWorkspacePaths.add(indexedWorkspace.repoPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(
				`Could not load indexed workspace state for ${indexedWorkspace.repoPath} during shutdown cleanup. ${message}`,
			);
		}
	}

	await Promise.all(
		interruptedByWorkspace.map(async (workspace) => {
			const worktreeTaskIds = await persistInterruptedSessions(
				workspace.workspacePath,
				workspace.interruptedTaskIds,
				{
					workspaceState: workspace.workspaceState,
					resolveSummary: workspace.resolveSummary,
				},
			);
			await cleanupInterruptedTaskWorktrees(workspace.workspacePath, worktreeTaskIds, deps.warn);
		}),
	);

	await deps.closeRuntimeServer();

	await cleanupTaskWorktreeSetupLocks(managedWorkspacePaths, deps.warn);
}
