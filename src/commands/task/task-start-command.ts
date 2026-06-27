import type { RuntimeBoardColumnId } from "../../core/api-contract";
import { getTaskColumnId, moveTaskToColumn } from "../../core/task-board-mutations";
import { findActiveTaskLikelyTouchedFileOverlap } from "../../core/task-file-overlap";
import { markTaskNeedsDecompositionOnBoard } from "./task-plan-gap-cards.js";
import { findTaskRecord } from "./task-record-format.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	resolveWorkspaceRepoPath,
	updateRuntimeWorkspaceState,
} from "./task-runtime-workspace.js";

/**
 * The "start a task" CLI command (§5.U-extracted from task.ts): validate the card's source column, guard against
 * file-overlap with an active task, start its native NKlein sandbox session (handling the queued-on-busy-endpoint and
 * needs-decomposition outcomes), then move the card to its active lane (Planning if it starts in plan mode, else In
 * Progress). Leaf command — no dependency on the other task command implementations.
 */

type JsonRecord = Record<string, unknown>;

export async function startTask(input: {
	cwd: string;
	taskId: string;
	projectPath?: string;
	queueOnEndpointBusy?: boolean;
	allowQueuedStart?: boolean;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const runtimeState = await runtimeClient.workspace.getState.query();
	const fromColumnId = getTaskColumnId(runtimeState.board, input.taskId);
	if (!fromColumnId) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}

	const currentRecord = findTaskRecord(runtimeState, input.taskId);
	const task = currentRecord?.task;
	if (!task) {
		throw new Error(`Task "${input.taskId}" could not be resolved.`);
	}
	const activeColumnId: RuntimeBoardColumnId = task.startInPlanMode ? "planning" : "in_progress";
	if (fromColumnId !== "backlog" && fromColumnId !== "planning" && fromColumnId !== activeColumnId) {
		throw new Error(
			`Task "${input.taskId}" is in "${fromColumnId}" and can only be started from backlog, planning, or ${activeColumnId}.`,
		);
	}

	const existingSession = runtimeState.sessions[task.id] ?? null;
	const shouldStartSession = existingSession?.state !== "running";

	if (shouldStartSession) {
		const overlappingTask = findActiveTaskLikelyTouchedFileOverlap({
			board: runtimeState.board,
			sessions: runtimeState.sessions,
			task,
		});
		if (overlappingTask) {
			throw new Error(
				`Task "${task.id}" likely touches the same files as active task "${overlappingTask.id}". Wait for the active task to finish before starting this one.`,
			);
		}
		// Native NKlein tasks start in their Docker sandbox — no host workspace to prepare (worktrees retired, §5.A).
		const started = await runtimeClient.runtime.startTaskSession.mutate({
			taskId: task.id,
			prompt: task.prompt,
			taskTitle: task.title,
			startInPlanMode: task.startInPlanMode,
			baseRef: task.baseRef,
			agentId: task.agentId,
			nkleinSettings: task.nkleinSettings,
			queueOnEndpointBusy: input.queueOnEndpointBusy,
		});
		if (!started.ok || !started.summary) {
			if (started.errorCode === "endpoint_busy" && started.queued && input.allowQueuedStart) {
				return {
					ok: false,
					queued: true,
					task: {
						id: task.id,
						prompt: task.prompt,
						column: fromColumnId,
						workspacePath: workspaceRepoPath,
					},
					error: started.error ?? "Task session is queued until its local model endpoint is available.",
					retryAfterMs: started.retryAfterMs ?? null,
				};
			}
			if (started.errorCode === "needs_decomposition") {
				await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (latestState) => ({
					board: markTaskNeedsDecompositionOnBoard(latestState.board, task.id, started.error),
					value: null,
				}));
			}
			throw new Error(started.error ?? "Could not start task session.");
		}
	}

	const moved = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (latestState) => {
		const movement = moveTaskToColumn(latestState.board, input.taskId, activeColumnId);
		if (!movement.task) {
			throw new Error(`Task "${input.taskId}" could not be resolved.`);
		}
		if (!movement.moved) {
			return {
				board: latestState.board,
				value: movement,
			};
		}
		return {
			board: movement.board,
			value: movement,
		};
	});

	if (!moved.moved) {
		return {
			ok: true,
			message: `Task "${input.taskId}" is already in progress.`,
			task: {
				id: task.id,
				prompt: task.prompt,
				column: activeColumnId,
				workspacePath: workspaceRepoPath,
			},
		};
	}

	return {
		ok: true,
		task: {
			id: task.id,
			prompt: task.prompt,
			column: activeColumnId,
			workspacePath: workspaceRepoPath,
		},
	};
}
