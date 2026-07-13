import { deleteTasksFromBoard } from "../../core/task-board-mutations";
import { mutateWorkspaceState } from "../../state/workspace-state";
import { columnCanHaveLiveTaskSession, type ListTaskColumn } from "./task-command-types.js";
import { findTaskRecord, findTasksInColumn, formatTaskRecord, resolveTaskCommandTarget } from "./task-record-format.js";
import { deleteTaskArtifacts, stopTaskRuntimeSession } from "./task-runtime-actions.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	notifyRuntimeWorkspaceStateUpdated,
	resolveWorkspaceRepoPath,
} from "./task-runtime-workspace.js";

/**
 * The "delete task(s)" CLI command (§5.U-extracted from task.ts): delete a single task by id or every task in a column,
 * removing them from the board and then stopping any live sessions + deleting their workspace worktrees. A leaf command
 * — no dependency on the other task command implementations.
 */

type JsonRecord = Record<string, unknown>;

export async function deleteTaskCommand(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const target = resolveTaskCommandTarget(input, "task delete");
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const mutation = await mutateWorkspaceState(workspaceRepoPath, (latestState) => {
		const latestTargetRecords =
			target.kind === "task"
				? (() => {
						const record = findTaskRecord(latestState, target.taskId);
						if (!record) {
							throw new Error(`Task "${target.taskId}" was not found in workspace ${workspaceRepoPath}.`);
						}
						return [record];
					})()
				: findTasksInColumn(latestState, target.column);

		if (latestTargetRecords.length === 0) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deleted = deleteTasksFromBoard(
			latestState.board,
			latestTargetRecords.map(({ task }) => task.id),
		);
		if (!deleted.deleted) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deletedTasks = latestTargetRecords.map(({ task, columnId }) =>
			formatTaskRecord(latestState, task, columnId),
		);
		const taskIdsRequiringStop = latestTargetRecords
			.filter(({ columnId }) => columnCanHaveLiveTaskSession(columnId))
			.map(({ task }) => task.id);
		return {
			board: deleted.board,
			value: {
				deletedTaskIds: deleted.deletedTaskIds,
				taskIdsRequiringStop,
				deletedTasks,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	if (mutation.value.deletedTaskIds.length === 0) {
		return {
			ok: true,
			workspacePath: workspaceRepoPath,
			column: target.kind === "column" ? target.column : null,
			deletedTasks: [],
			count: 0,
		};
	}

	await Promise.all(
		mutation.value.taskIdsRequiringStop.map(async (taskId) => await stopTaskRuntimeSession(runtimeClient, taskId)),
	);

	const artifactCleanupResults = await Promise.all(
		mutation.value.deletedTaskIds.map(async (taskId) => ({
			taskId,
			...(await deleteTaskArtifacts(runtimeClient, taskId)),
		})),
	);

	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		column: target.kind === "column" ? target.column : null,
		deletedTasks: mutation.value.deletedTasks,
		count: mutation.value.deletedTaskIds.length,
		artifactCleanup: artifactCleanupResults,
	};
}
