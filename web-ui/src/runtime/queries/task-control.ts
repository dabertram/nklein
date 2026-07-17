// Browser-side query helpers: per-task actions — diagnostics, escalation, evidence, pause/resume, acceptance, merge.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeFocusChainHistoryResponse,
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskActionTrailResponse,
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

/** F2.18c: queue an operator note onto a card's mailbox (drained into the next redrive's prompt). */
export async function sendCardMailboxNote(workspaceId: string | null, taskId: string, text: string): Promise<number> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const result = await trpcClient.runtime.sendCardMailboxNote.mutate({ taskId, text });
	return result.pending;
}

/** F2.12b: the host-action audit history for a chat session (newest first). Chat is workspace-agnostic → null client. */
export async function fetchChatHostActionAudit(sessionId: string, limit = 100) {
	const trpcClient = getRuntimeTrpcClient(null);
	return (await trpcClient.runtime.getChatHostActionAudit.query({ sessionId, limit })).entries;
}

/** F2.9b: the session's unified memory (records with provenance + a typed delete control). */
export async function fetchSessionMemory(sessionId: string) {
	const trpcClient = getRuntimeTrpcClient(null);
	return (await trpcClient.chat.getSessionMemory.query({ sessionId })).records;
}

export type SessionMemoryRecord = Awaited<ReturnType<typeof fetchSessionMemory>>[number];

/** F2.9b: delete a memory via its typed control (chat-memory / basic-memory); returns the outcome string. */
export async function deleteSessionMemory(control: SessionMemoryRecord["deleteControl"]): Promise<string> {
	const trpcClient = getRuntimeTrpcClient(null);
	return (await trpcClient.chat.deleteSessionMemory.mutate({ control })).outcome;
}

/** F2.2b/F2.12b: the host-action confirmations a chat turn parked awaiting the operator's OK. */
export async function fetchPendingHostActionConfirms() {
	const trpcClient = getRuntimeTrpcClient(null);
	return (await trpcClient.runtime.getPendingHostActionConfirms.query({})).pending;
}

/** F2.2b/F2.12b: approve or deny a pending host-action confirmation (bound to its exact identity). */
export async function resolveHostActionConfirm(
	confirm: { attemptId: string; sessionId: string; action: string; target: string },
	approve: boolean,
): Promise<string> {
	const trpcClient = getRuntimeTrpcClient(null);
	return (await trpcClient.runtime.resolveHostActionConfirm.mutate({ ...confirm, approve })).outcome;
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
	return await trpcClient.runtime.verifyTaskAcceptance.mutate({ taskId });
}

export async function mergeTaskWorktrees(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeTaskWorktreeMergeResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.mergeTaskWorktrees.mutate({ taskId, column: "review" });
}

/** F1.6 — the focus-chain audit history (durable per-step transitions from the attempt ledger). */
export async function fetchTaskFocusChainHistory(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeFocusChainHistoryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getTaskFocusChainHistory.query({ taskId });
}

/** F12.55 — the per-card plain-language action trail (ledger projection; presentation of buildCardActionTrail). */
export async function fetchTaskActionTrail(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeTaskActionTrailResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getTaskActionTrail.query({ taskId });
}
