import { clampRuntimeSwarmCardStartBatchSize, type RuntimeWorkspaceStateResponse } from "../../core/api-contract";
import {
	addTaskToColumn,
	completeTaskAndGetReadyLinkedTaskIds,
	trashTaskAndGetReadyLinkedTaskIds,
} from "../../core/task-board-mutations";
import { mutateWorkspaceState } from "../../state/workspace-state";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
import {
	mergeTaskWorktreesInDependencyOrder,
	type TaskWorktreeAutoMergeColumn,
	type TaskWorktreeAutoMergeConflict,
	type TaskWorktreeAutoMergeStep,
} from "../../workspace/task-worktree-auto-merge";
import { columnCanHaveLiveTaskSession, type ListTaskColumn } from "./task-command-types.js";
import { buildIntegrationCardPrompt } from "./task-plan-gap-prompts.js";
import { findTaskRecord, findTasksInColumn, formatTaskRecord, resolveTaskCommandTarget } from "./task-record-format.js";
import { stopTaskRuntimeSession } from "./task-runtime-actions.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	notifyRuntimeWorkspaceStateUpdated,
	resolveWorkspaceRepoPath,
} from "./task-runtime-workspace.js";
import { startTask } from "./task-start-command.js";

/**
 * The task-finish + worktree-merge CLI commands (§5.U-extracted from task.ts): `finishTask` moves a card — or every
 * card in a column — to completed/trash, stopping its session, auto-merging a completed result worktree, auto-starting
 * unblocked dependents, and cleaning up the worktree; `mergeTaskWorktreesCommand` merges a column's result worktrees on
 * demand. Helpers (`finishTaskById`, `autoMergeFinishedTaskWorktree`, `recordTaskWorktreeMergeObservations`,
 * `createIntegrationCardForMergeConflict`) stay private to this module.
 */

type JsonRecord = Record<string, unknown>;

type FinishedTaskColumn = "completed" | "trash";

interface FinishTaskExecutionResult {
	task: JsonRecord;
	taskId: string;
	previousColumnId: ListTaskColumn;
	readyTaskIds: string[];
	autoStartedTasks: JsonRecord[];
	autoMerge: JsonRecord | null;
	alreadyInTargetColumn: boolean;
}

interface FinishTaskMutationValue {
	task: JsonRecord;
	previousColumnId: ListTaskColumn;
	readyTaskIds: string[];
	alreadyInTargetColumn: boolean;
}

async function autoMergeFinishedTaskWorktree(input: {
	taskId: string;
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
}): Promise<JsonRecord> {
	const state = await input.runtimeClient.workspace.getState.query();
	const result = await mergeTaskWorktreesInDependencyOrder({
		repoPath: input.workspaceRepoPath,
		board: state.board,
		columns: ["completed"],
		taskIds: [input.taskId],
	});
	const integrationTask =
		result.conflict && state.git.currentBranch
			? await createIntegrationCardForMergeConflict({
					workspaceRepoPath: input.workspaceRepoPath,
					runtimeClient: input.runtimeClient,
					conflict: result.conflict,
					baseRef: state.git.currentBranch,
				})
			: null;
	recordTaskWorktreeMergeObservations({
		workspacePath: input.workspaceRepoPath,
		steps: result.steps,
		ok: result.ok,
	});
	return {
		ok: result.ok,
		mergedTaskIds: result.mergedTaskIds,
		skippedTaskIds: result.skippedTaskIds,
		steps: result.steps,
		integrationTask,
		conflict: result.conflict ?? null,
		blocked: result.blocked ?? null,
	};
}

function recordTaskWorktreeMergeObservations(input: {
	workspacePath: string;
	steps: readonly TaskWorktreeAutoMergeStep[];
	ok: boolean;
}): void {
	for (const step of input.steps) {
		if (!step.taskId) {
			continue;
		}
		const severity = step.type === "conflict" || step.type === "blocked" ? "warning" : "info";
		const message =
			step.type === "merged"
				? `Task result merged: ${step.taskId}`
				: step.type === "skipped"
					? `Task result merge skipped: ${step.taskId}`
					: step.type === "conflict"
						? `Task result merge conflict: ${step.taskId}`
						: `Task result merge blocked: ${step.reason}`;
		recordSelfObservation({
			signal: "custom",
			severity,
			message,
			taskId: step.taskId,
			workspacePath: input.workspacePath,
			metadata: {
				category: "task_worktree_merge",
				ok: input.ok,
				type: step.type,
				reason: "reason" in step ? step.reason : null,
				headCommit: "headCommit" in step ? step.headCommit : null,
				conflictedPaths: "conflictedPaths" in step ? step.conflictedPaths : null,
			},
		});
	}
}

async function finishTaskById(input: {
	cwd: string;
	taskId: string;
	targetColumn: FinishedTaskColumn;
	projectPath?: string;
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
}): Promise<FinishTaskExecutionResult> {
	const mutation = await mutateWorkspaceState<FinishTaskMutationValue>(input.workspaceRepoPath, (latestState) => {
		const latestRecord = findTaskRecord(latestState, input.taskId);
		if (!latestRecord) {
			throw new Error(`Task "${input.taskId}" was not found in workspace ${input.workspaceRepoPath}.`);
		}
		if (latestRecord.columnId === input.targetColumn) {
			return {
				board: latestState.board,
				value: {
					task: formatTaskRecord(latestState, latestRecord.task, latestRecord.columnId),
					previousColumnId: latestRecord.columnId,
					readyTaskIds: [] as string[],
					alreadyInTargetColumn: true,
				},
				save: false,
			};
		}

		const finished =
			input.targetColumn === "completed"
				? completeTaskAndGetReadyLinkedTaskIds(latestState.board, input.taskId)
				: trashTaskAndGetReadyLinkedTaskIds(latestState.board, input.taskId);
		if (!finished.moved || !finished.task) {
			throw new Error(`Task "${input.taskId}" could not be moved to ${input.targetColumn}.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...latestState,
			board: finished.board,
		};
		return {
			board: finished.board,
			value: {
				task: formatTaskRecord(nextState, finished.task, input.targetColumn),
				previousColumnId: latestRecord.columnId,
				readyTaskIds: finished.readyTaskIds,
				alreadyInTargetColumn: false,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
	}

	if (mutation.value.alreadyInTargetColumn) {
		return {
			task: mutation.value.task,
			taskId: input.taskId,
			previousColumnId: mutation.value.previousColumnId,
			readyTaskIds: [],
			autoStartedTasks: [],
			autoMerge: null,
			alreadyInTargetColumn: true,
		};
	}

	if (columnCanHaveLiveTaskSession(mutation.value.previousColumnId)) {
		await stopTaskRuntimeSession(input.runtimeClient, input.taskId);
	}

	const autoMerge =
		input.targetColumn === "completed" && mutation.value.previousColumnId === "review"
			? await autoMergeFinishedTaskWorktree({
					taskId: input.taskId,
					workspaceRepoPath: input.workspaceRepoPath,
					runtimeClient: input.runtimeClient,
				})
			: null;
	const canContinueAfterMerge = autoMerge === null || autoMerge.ok === true;
	const autoStartedTasks: JsonRecord[] = [];
	if (canContinueAfterMerge) {
		for (const readyTaskId of mutation.value.readyTaskIds.slice(
			0,
			clampRuntimeSwarmCardStartBatchSize(mutation.value.readyTaskIds.length),
		)) {
			const started = await startTask({
				cwd: input.cwd,
				taskId: readyTaskId,
				projectPath: input.projectPath,
				queueOnEndpointBusy: true,
				allowQueuedStart: true,
			});
			autoStartedTasks.push(started);
		}
	}

	// Finishing a task keeps its result branch (the merge just consumed it); nothing worktree-shaped remains to
	// clean up. Trash-side deletion is the flow that discards artifacts (deleteTaskArtifacts).
	return {
		task: mutation.value.task,
		taskId: input.taskId,
		previousColumnId: mutation.value.previousColumnId,
		readyTaskIds: mutation.value.readyTaskIds,
		autoStartedTasks,
		autoMerge,
		alreadyInTargetColumn: false,
	};
}

export async function finishTask(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	targetColumn: FinishedTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const commandName = input.targetColumn === "completed" ? "task done" : "task trash";
	const target = resolveTaskCommandTarget(input, commandName);
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);

	if (target.kind === "task") {
		const finished = await finishTaskById({
			cwd: input.cwd,
			taskId: target.taskId,
			targetColumn: input.targetColumn,
			projectPath: input.projectPath,
			workspaceRepoPath,
			runtimeClient,
		});
		if (finished.alreadyInTargetColumn) {
			return {
				ok: true,
				message: `Task "${target.taskId}" is already done.`,
				task: finished.task,
				workspacePath: workspaceRepoPath,
				readyTaskIds: [],
				autoStartedTasks: [],
				autoMerge: null,
			};
		}
		return {
			ok: true,
			task: finished.task,
			workspacePath: workspaceRepoPath,
			readyTaskIds: finished.readyTaskIds,
			autoStartedTasks: finished.autoStartedTasks,
			autoMerge: finished.autoMerge,
		};
	}

	const initialState = await runtimeClient.workspace.getState.query();
	const targetTasks = findTasksInColumn(initialState, target.column);
	if (targetTasks.length === 0) {
		return {
			ok: true,
			column: target.column,
			workspacePath: workspaceRepoPath,
			finishedTasks: [],
			alreadyFinishedTasks: [],
			readyTaskIds: [],
			autoStartedTasks: [],
			count: 0,
		};
	}

	const results: FinishTaskExecutionResult[] = [];
	for (const { task } of targetTasks) {
		results.push(
			await finishTaskById({
				cwd: input.cwd,
				taskId: task.id,
				targetColumn: input.targetColumn,
				projectPath: input.projectPath,
				workspaceRepoPath,
				runtimeClient,
			}),
		);
	}

	const finishedTasks = results.filter((result) => !result.alreadyInTargetColumn);
	const alreadyFinishedTasks = results.filter((result) => result.alreadyInTargetColumn);

	return {
		ok: true,
		column: target.column,
		workspacePath: workspaceRepoPath,
		finishedTasks: finishedTasks.map((result) => result.task),
		alreadyFinishedTasks: alreadyFinishedTasks.map((result) => result.task),
		readyTaskIds: [...new Set(finishedTasks.flatMap((result) => result.readyTaskIds))],
		autoStartedTasks: finishedTasks.flatMap((result) => result.autoStartedTasks),
		autoMerge: finishedTasks.map((result) => ({
			taskId: result.taskId,
			result: result.autoMerge,
		})),
		count: finishedTasks.length,
	};
}

async function createIntegrationCardForMergeConflict(input: {
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	conflict: TaskWorktreeAutoMergeConflict;
	baseRef: string;
}): Promise<JsonRecord> {
	const mutation = await mutateWorkspaceState<JsonRecord>(input.workspaceRepoPath, (latestState) => {
		const created = addTaskToColumn(
			latestState.board,
			"planning",
			{
				title: `Resolve merge conflict for ${input.conflict.taskId}`,
				prompt: buildIntegrationCardPrompt(input.conflict),
				startInPlanMode: true,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				agentId: "nklein",
				baseRef: input.baseRef,
				filesLikelyTouched: input.conflict.conflictedPaths,
			},
			() => globalThis.crypto.randomUUID(),
		);
		const nextState: RuntimeWorkspaceStateResponse = {
			...latestState,
			board: created.board,
		};
		return {
			board: created.board,
			value: formatTaskRecord(nextState, created.task, "planning"),
		};
	});
	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
	}
	return mutation.value;
}

export async function mergeTaskWorktreesCommand(input: {
	cwd: string;
	projectPath?: string;
	taskId?: string;
	column: TaskWorktreeAutoMergeColumn;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const state = await runtimeClient.workspace.getState.query();
	const result = await mergeTaskWorktreesInDependencyOrder({
		repoPath: workspaceRepoPath,
		board: state.board,
		columns: [input.column],
		taskIds: input.taskId ? [input.taskId] : undefined,
	});
	const integrationTask =
		result.conflict && state.git.currentBranch
			? await createIntegrationCardForMergeConflict({
					workspaceRepoPath,
					runtimeClient,
					conflict: result.conflict,
					baseRef: state.git.currentBranch,
				})
			: null;
	recordTaskWorktreeMergeObservations({
		workspacePath: workspaceRepoPath,
		steps: result.steps,
		ok: result.ok,
	});
	return {
		ok: result.ok,
		workspacePath: workspaceRepoPath,
		column: input.column,
		mergedTaskIds: result.mergedTaskIds,
		skippedTaskIds: result.skippedTaskIds,
		steps: result.steps,
		integrationTask,
		conflict: result.conflict ?? null,
		blocked: result.blocked ?? null,
	};
}
