import { decideOperatorRedrive } from "../../core/operator-redrive.js";
import { getTaskColumnId, moveTaskToColumn } from "../../core/task-board-mutations.js";
import { findTaskRecord } from "./task-record-format.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	resolveWorkspaceRepoPath,
	updateRuntimeWorkspaceState,
} from "./task-runtime-workspace.js";
import { startTask } from "./task-start-command.js";

/**
 * `task redrive` — the operator's terminal-to-work transition for a PARKED review card (David 2026-08-22).
 *
 * A park is the review loop's deliberate stop ("the operator's decision"); until now the product had no
 * action that turned that decision back into work, so a board whose parked cards dam their dependents could
 * only be released by hand-editing board.json. This command runs the pure {@link decideOperatorRedrive}
 * rule, moves the card back to its start lane, clears the parked status (history stays — it is the evidence
 * the brief is built FROM), and starts the session on the composed re-work brief through the ordinary start
 * path, so every existing guard (file overlap, admission, plan gate) still applies.
 */
export async function redriveTask(input: {
	cwd: string;
	taskId: string;
	projectPath?: string;
	note?: string;
	queueOnEndpointBusy?: boolean;
	allowQueuedStart?: boolean;
}): Promise<Record<string, unknown>> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const runtimeState = await runtimeClient.workspace.getState.query();
	const columnId = getTaskColumnId(runtimeState.board, input.taskId);
	if (!columnId) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}
	const record = findTaskRecord(runtimeState, input.taskId);
	const task = record?.task;
	if (!task) {
		throw new Error(`Task "${input.taskId}" could not be resolved.`);
	}
	const review = task.review ?? null;
	const decision = decideOperatorRedrive({
		columnId,
		review: review
			? {
					status: review.status,
					round: review.round,
					lastVerdict: review.lastVerdict ?? null,
					lastSummary: review.lastSummary ?? null,
					lastFeedback: review.lastFeedback ?? null,
					parkedReason: review.parkedReason ?? null,
				}
			: null,
		objective: task.prompt,
		startInPlanMode: task.startInPlanMode === true,
		operatorNote: input.note ?? null,
	});
	if (!decision.redrive) {
		throw new Error(`Refusing to redrive "${input.taskId}": ${decision.reason}`);
	}

	// Move the card to its start lane and clear the parked status. Review HISTORY stays untouched — it is the
	// record the brief was built from, and the next review round must see the prior concerns.
	await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (latestState) => {
		const movement = moveTaskToColumn(latestState.board, input.taskId, decision.targetColumnId);
		if (!movement.moved || !movement.task) {
			throw new Error(`Task "${input.taskId}" could not be moved to ${decision.targetColumnId}.`);
		}
		if (movement.task.review) {
			movement.task.review.status = "changes_requested";
		}
		return { board: movement.board, value: null };
	});

	const started = await startTask({
		cwd: input.cwd,
		taskId: input.taskId,
		...(input.projectPath ? { projectPath: input.projectPath } : {}),
		...(input.queueOnEndpointBusy !== undefined ? { queueOnEndpointBusy: input.queueOnEndpointBusy } : {}),
		...(input.allowQueuedStart !== undefined ? { allowQueuedStart: input.allowQueuedStart } : {}),
		promptOverride: decision.brief,
	});
	return {
		...started,
		redrive: {
			reason: decision.reason,
			targetColumnId: decision.targetColumnId,
			briefChars: decision.brief.length,
		},
	};
}
