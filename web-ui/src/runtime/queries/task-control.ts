// Browser-side query helpers: per-task actions — diagnostics, escalation, evidence, pause/resume, acceptance, merge.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskDiagnosticsResponse,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskPauseResponse,
	RuntimeTaskWorktreeMergeResponse,
} from "@/runtime/types";

export async function fetchTaskDiagnostics(
	workspaceId: string | null,
	taskId: string,
	limit?: number,
): Promise<RuntimeTaskDiagnosticsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getTaskDiagnostics.query({ taskId, limit });
}

/** §5.AG: the task's escalation report — the chronological attempt chain (rung × model × approach × outcome). */
export async function fetchTaskEscalation(workspaceId: string | null, taskId: string) {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getTaskEscalation.query({ taskId });
}

export async function collectTaskEvidence(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeTaskEvidenceResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.collectTaskEvidence.mutate({ taskId });
}

export async function pauseTask(workspaceId: string | null, taskId: string): Promise<RuntimeTaskPauseResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.pauseTask.mutate({ taskId });
}

export async function resumeTask(workspaceId: string | null, taskId: string): Promise<RuntimeTaskPauseResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.resumeTask.mutate({ taskId });
}

export async function verifyTaskAcceptance(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeTaskAcceptanceVerifyResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.verifyTaskAcceptance.mutate({ taskId, ensureWorktree: true });
}

export async function mergeTaskWorktrees(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeTaskWorktreeMergeResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.mergeTaskWorktrees.mutate({ taskId, column: "review" });
}
