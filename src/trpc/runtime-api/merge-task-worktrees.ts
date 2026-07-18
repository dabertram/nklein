import { buildTransitionEvent } from "../../core/agent-attempt-ledger";
import type { RuntimeTaskWorktreeMergeRequest, RuntimeTaskWorktreeMergeResponse } from "../../core/api-contract";
import { hashWorkspacePathForLedger } from "../../nklein-agent/nklein-ledger-attempt";
import { appendAgentLedgerEvent } from "../../state/agent-attempt-ledger-store";
import { loadWorkspaceState } from "../../state/workspace-state";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
import {
	mergeTaskWorktreesInDependencyOrder,
	type TaskWorktreeAutoMergeStep,
} from "../../workspace/task-worktree-auto-merge";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { formatMergeMessage } from "../runtime-task-message-formatting";
import { getWorkspaceWorkflowQueue } from "./workflow-queue-registry";

/** Emit a self-observation per task-worktree merge step (conflict/blocked → warning, else info), extracted with the handler. */
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

/**
 * Merge completed task worktrees back into the project in dependency order (the runtime-api
 * `mergeTaskWorktrees` procedure handler, extracted from the factory — it captures no factory deps,
 * only module-level collaborators, so it is a behavior-preserving lift). Records per-step
 * observations and returns the merge tally + any conflict/blocked detail with a user-facing message.
 */
export async function handleMergeTaskWorktrees(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskWorktreeMergeRequest,
): Promise<RuntimeTaskWorktreeMergeResponse> {
	const state = await loadWorkspaceState(workspaceScope.workspacePath);
	const result = await mergeTaskWorktreesInDependencyOrder({
		repoPath: workspaceScope.workspacePath,
		board: state.board,
		columns: [input.column ?? "review"],
		taskIds: input.taskId ? [input.taskId] : undefined,
	});
	recordTaskWorktreeMergeObservations({
		workspacePath: workspaceScope.workspacePath,
		steps: result.steps,
		ok: result.ok,
	});
	// F1.27b (residue leaf): the OPERATOR merge is a completion path too — mirror it into the workflow kernel
	// (delivery_requested → delivered; holds absorb repeats when auto-delivery already walked the ladder) and
	// ledger an `operator_merge` transition per merged card, closing the F12.108 capture gap that made a manual
	// merge indistinguishable from an autonomous delivery. Best-effort: audit-mode mirrors never affect the merge.
	for (const mergedTaskId of result.mergedTaskIds) {
		const queue = getWorkspaceWorkflowQueue(workspaceScope.workspacePath, workspaceScope.workspaceId);
		void queue.dispatch(mergedTaskId, { kind: "delivery_requested" }).catch(() => {});
		void queue.dispatch(mergedTaskId, { kind: "delivered" }).catch(() => {});
		void appendAgentLedgerEvent(
			buildTransitionEvent({
				workflowId: mergedTaskId,
				taskId: mergedTaskId,
				workspacePathHash: hashWorkspacePathForLedger(workspaceScope.workspacePath),
				from: "review",
				to: "operator_merge",
				reason: "manual worktree merge",
				controllerDecision: "operator",
			}),
		).catch(() => {});
	}
	return {
		ok: result.ok,
		column: input.column ?? "review",
		mergedTaskIds: result.mergedTaskIds,
		skippedTaskIds: result.skippedTaskIds,
		steps: result.steps,
		conflict: result.conflict ?? null,
		blocked: result.blocked ?? null,
		message: formatMergeMessage(result),
	};
}
