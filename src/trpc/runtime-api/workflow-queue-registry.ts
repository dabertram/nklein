import { createWorkflowCommandQueue, type WorkflowCommandQueue } from "../../core/workflow-command-queue";
import { hashWorkspacePathForLedger } from "../../nklein-agent/nklein-ledger-attempt";
import { appendAgentLedgerEvent } from "../../state/agent-attempt-ledger-store";

/**
 * F1.27b — the runtime's per-workspace {@link WorkflowCommandQueue} instances: the live mount of the F1.27a
 * command/event seam. One queue per workspace path, created lazily, persisting every applied command to that
 * workspace's §5.AF ledger. Adapter paths migrate onto `getWorkspaceWorkflowQueue(...).dispatch(...)`
 * incrementally (leaf 1: the operator stop path); until every lifecycle seam emits commands, the phase mirror is
 * PARTIAL by design — consumers must treat it as an audit/observation stream, not the board's source of truth.
 */

const queueByWorkspacePath = new Map<string, WorkflowCommandQueue>();

export function getWorkspaceWorkflowQueue(workspacePath: string, workspaceId: string): WorkflowCommandQueue {
	const existing = queueByWorkspacePath.get(workspacePath);
	if (existing) {
		return existing;
	}
	const queue = createWorkflowCommandQueue({
		workflowId: workspaceId,
		workspacePathHash: hashWorkspacePathForLedger(workspacePath),
		appendEvent: (event) => appendAgentLedgerEvent(event),
	});
	queueByWorkspacePath.set(workspacePath, queue);
	return queue;
}

/** Test-only: drop all cached queues so isolated HOMEs never share a mirror across test files. */
export function resetWorkspaceWorkflowQueuesForTest(): void {
	queueByWorkspacePath.clear();
}
