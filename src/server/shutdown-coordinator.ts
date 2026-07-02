import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { usesLegacyHostTaskWorkspace } from "../core/agent-catalog";
import type {
	RuntimeAgentId,
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
	deleteTaskWorkspace?: typeof deleteTaskWorktree;
}

const SHUTDOWN_ACTIVE_COLUMN_IDS = new Set<RuntimeBoardColumnId>(["planning", "in_progress", "review"]);

function normalizeWorkspacePathForShutdown(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

interface ShutdownActiveBoardTask {
	taskId: string;
	agentId?: RuntimeAgentId;
}

interface ShutdownPersistenceResult {
	legacyHostWorkspaceTaskIds: string[];
}

function collectActiveBoardTasksForShutdown(board: RuntimeBoardData): ShutdownActiveBoardTask[] {
	const tasks: ShutdownActiveBoardTask[] = [];
	for (const column of board.columns) {
		if (!SHUTDOWN_ACTIVE_COLUMN_IDS.has(column.id)) {
			continue;
		}
		for (const card of column.cards) {
			tasks.push({
				taskId: card.id,
				...(card.agentId !== undefined ? { agentId: card.agentId } : {}),
			});
		}
	}
	return tasks;
}

/**
 * RECONCILE-DON'T-DESTROY (audit 2026-07-02 W2.2; supersedes the trash-everything shutdown): a restart must never
 * destroy queued or partially-done work. PLANNING cards are queued work with nothing in flight — they stay put and
 * simply run after the restart. IN_PROGRESS cards carry partial work + an interrupted session — they move to REVIEW
 * (the operator-attention lane) instead of trash so the work is visible and resumable. REVIEW cards stay where they
 * are. Live-found via run11's board autopsy: the old behavior trashed 3 perfectly-good queued cards on harness
 * shutdown, which read like a swarm bug until traced here.
 */
function parkInterruptedTasksForShutdown(board: RuntimeBoardData, taskIds: Iterable<string>): RuntimeBoardData {
	let nextBoard = board;
	const columnByTaskId = new Map<string, string>();
	for (const column of nextBoard.columns) {
		for (const card of column.cards) {
			columnByTaskId.set(card.id, column.id);
		}
	}
	for (const taskId of taskIds) {
		if (columnByTaskId.get(taskId) !== "in_progress") {
			continue; // planning/review cards survive in place
		}
		const moved = moveTaskToColumn(nextBoard, taskId, "review");
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
): Promise<ShutdownPersistenceResult> {
	const workspaceState = options?.workspaceState ?? (await loadWorkspaceState(workspacePath));
	const activeBoardTasks = collectActiveBoardTasksForShutdown(workspaceState.board);
	const activeBoardTaskById = new Map(activeBoardTasks.map((task) => [task.taskId, task]));
	const activeBoardTaskIds = activeBoardTasks.map((task) => task.taskId);
	const taskIdsToInterrupt = Array.from(new Set([...interruptedTaskIds, ...activeBoardTaskIds]));
	if (taskIdsToInterrupt.length === 0) {
		return {
			legacyHostWorkspaceTaskIds: [],
		};
	}
	const now = Date.now();
	const nextSessions = {
		...workspaceState.sessions,
	};
	const legacyHostWorkspaceTaskIds = new Set<string>();
	for (const taskId of taskIdsToInterrupt) {
		const summary = options?.resolveSummary?.(taskId) ?? workspaceState.sessions[taskId] ?? null;
		const activeBoardTask = activeBoardTaskById.get(taskId) ?? null;
		const agentId = summary?.agentId ?? activeBoardTask?.agentId ?? null;
		if (usesLegacyHostTaskWorkspace(agentId)) {
			legacyHostWorkspaceTaskIds.add(taskId);
		}
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
	const nextBoard = parkInterruptedTasksForShutdown(workspaceState.board, activeBoardTaskIds);
	await saveWorkspaceState(workspacePath, {
		board: nextBoard,
		sessions: nextSessions,
	});
	return {
		legacyHostWorkspaceTaskIds: Array.from(legacyHostWorkspaceTaskIds),
	};
}

async function cleanupInterruptedTaskWorktrees(
	repoPath: string,
	taskIds: string[],
	warn: (message: string) => void,
	deleteTaskWorkspace: typeof deleteTaskWorktree,
): Promise<void> {
	if (taskIds.length === 0) {
		return;
	}
	const deletions = await Promise.all(
		taskIds.map(async (taskId) => ({
			taskId,
			deleted: await deleteTaskWorkspace({
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
	const managedWorkspaceKeys = new Set<string>();

	for (const { workspacePath, terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
		const interrupted = terminalManager.markInterruptedAndStopAll();
		const interruptedTaskIds = new Set(collectShutdownInterruptedTaskIds(interrupted, terminalManager));
		if (!workspacePath) {
			continue;
		}
		managedWorkspacePaths.add(workspacePath);
		managedWorkspaceKeys.add(normalizeWorkspacePathForShutdown(workspacePath));
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
		const indexedWorkspaceKey = normalizeWorkspacePathForShutdown(indexedWorkspace.repoPath);
		if (managedWorkspaceKeys.has(indexedWorkspaceKey)) {
			continue;
		}
		try {
			const workspaceState = await loadWorkspaceState(indexedWorkspace.repoPath);
			const activeTaskIds = collectActiveBoardTasksForShutdown(workspaceState.board).map((task) => task.taskId);
			if (activeTaskIds.length === 0) {
				continue;
			}
			interruptedByWorkspace.push({
				workspacePath: indexedWorkspace.repoPath,
				interruptedTaskIds: activeTaskIds,
				workspaceState,
			});
			managedWorkspacePaths.add(indexedWorkspace.repoPath);
			managedWorkspaceKeys.add(indexedWorkspaceKey);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(
				`Could not load indexed workspace state for ${indexedWorkspace.repoPath} during shutdown cleanup. ${message}`,
			);
		}
	}

	await Promise.all(
		interruptedByWorkspace.map(async (workspace) => {
			const persisted = await persistInterruptedSessions(workspace.workspacePath, workspace.interruptedTaskIds, {
				workspaceState: workspace.workspaceState,
				resolveSummary: workspace.resolveSummary,
			});
			await cleanupInterruptedTaskWorktrees(
				workspace.workspacePath,
				persisted.legacyHostWorkspaceTaskIds,
				deps.warn,
				deps.deleteTaskWorkspace ?? deleteTaskWorktree,
			);
		}),
	);

	await deps.closeRuntimeServer();

	await cleanupTaskWorktreeSetupLocks(managedWorkspacePaths, deps.warn);
}
