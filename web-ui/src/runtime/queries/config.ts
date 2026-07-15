// Browser-side query helpers: runtime config, telemetry/status reads, and misc runtime actions.
// Keep tRPC transport plumbing here so components and controller hooks focus on state orchestration.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeCardMailboxCountsResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeEvaluateConnectedModelsResponse,
	RuntimeFitnessTableResponse,
	RuntimeFleetStatusResponse,
	RuntimeKleinCorePyHealthResponse,
	RuntimeKnowledgeToolUsageStatsResponse,
	RuntimeLedgerAnalyticsResponse,
	RuntimeMemoryAuditResponse,
	RuntimeMergeHistoryResponse,
	RuntimeModelBehaviorProfilesResponse,
	RuntimeModelPerformanceStatsResponse,
	RuntimeModelTuningResponse,
	RuntimeModelVerdictBadgesResponse,
	RuntimeNKleinCodeIntelligenceStatusResponse,
	RuntimeRailControlRequest,
	RuntimeRailStatusResponse,
	RuntimeRailTunablesRequest,
	RuntimeRunUpdateResponse,
	RuntimeSetupPlanResponse,
	RuntimeTimeTrackingResponse,
	RuntimeUpdateStatusResponse,
} from "@/runtime/types";

export async function fetchRuntimeConfig(workspaceId: string | null): Promise<RuntimeConfigResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getConfig.query();
}

export async function saveRuntimeConfig(
	workspaceId: string | null,
	nextConfig: RuntimeConfigSaveRequest,
): Promise<RuntimeConfigResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveConfig.mutate(nextConfig);
}

export async function fetchModelPerformanceStats(
	workspaceId: string | null,
): Promise<RuntimeModelPerformanceStatsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getModelPerformanceStats.query();
}

/** §5.AA learned model behavior: the per-model ModelBehaviorProfile fold (Settings telemetry surface). */
export async function fetchModelBehaviorProfiles(
	workspaceId: string | null,
): Promise<RuntimeModelBehaviorProfilesResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getModelBehaviorProfiles.query();
}

/** §5.AL fitness browser: the global per-(model × role × difficulty) fitness cells + failing-LLM projection. */
export async function fetchFitnessTable(workspaceId: string | null): Promise<RuntimeFitnessTableResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getFitnessTable.query();
}

/** Ledger analytics: retrieval-usefulness + knowledge-outcome lift + opportunistic-value (read-only telemetry). */
export async function fetchLedgerAnalytics(workspaceId: string | null): Promise<RuntimeLedgerAnalyticsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getLedgerAnalytics.query();
}

/** F5.2 memory-corpus health: freshness audit over the on-disk basic-memory notes (read-only telemetry). */
export async function fetchMemoryAudit(workspaceId: string | null): Promise<RuntimeMemoryAuditResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getMemoryAudit.query();
}

/** Model-tuning recommendations: learned context cap / answer budget / retry budget per model (read-only telemetry). */
export async function fetchModelTuning(workspaceId: string | null): Promise<RuntimeModelTuningResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getModelTuning.query();
}

/** F1.35b: the background-eval rail controls/status snapshot (read-only). */
export async function fetchRailStatus(workspaceId: string | null): Promise<RuntimeRailStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getRailStatus.query();
}

/** F1.35b: apply an enable/disable/pause/resume rail control command; returns the fresh status. */
export async function setRailControl(
	workspaceId: string | null,
	input: RuntimeRailControlRequest,
): Promise<RuntimeRailStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.setRailControl.mutate(input);
}

/** F1.35b: persist new rail cadence/concurrency tunables; returns the fresh status. */
export async function setRailTunables(
	workspaceId: string | null,
	input: RuntimeRailTunablesRequest,
): Promise<RuntimeRailStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.setRailTunables.mutate(input);
}

/** §5.AL/§10c#11: degraded-model badges for the model selector (runtime-evidence penalties, badge-only). */
export async function fetchModelVerdictBadges(workspaceId: string | null): Promise<RuntimeModelVerdictBadgesResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getModelVerdictBadges.query();
}

export async function fetchFleetStatus(workspaceId: string | null): Promise<RuntimeFleetStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getFleetStatus.query();
}

/** F1.40: per-card + per-project time tracking (age / active / LLM-processing), read-only. */
export async function fetchTimeTracking(workspaceId: string | null): Promise<RuntimeTimeTrackingResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getTimeTracking.query();
}

/** §5.AB "Evaluate connected models" (todo 6544): eval every loaded model against the corpus + persist fitness. */
export async function evaluateConnectedModels(
	workspaceId: string | null,
): Promise<RuntimeEvaluateConnectedModelsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.evaluateConnectedModels.mutate();
}

/** W3.4 mailbox badge: pending mailbox-note counts for the board's cards (non-zero entries only). */
export async function fetchCardMailboxCounts(
	workspaceId: string | null,
	taskIds: string[],
): Promise<RuntimeCardMailboxCountsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getCardMailboxCounts.query({ taskIds });
}

export async function fetchGlobalSetupPlan(workspaceId: string | null): Promise<RuntimeSetupPlanResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getGlobalSetupPlan.query();
}

export async function fetchProjectSetupPlan(workspaceId: string | null): Promise<RuntimeSetupPlanResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getProjectSetupPlan.query();
}

export async function fetchKleinCorePyHealth(workspaceId: string | null): Promise<RuntimeKleinCorePyHealthResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getKleinCorePyHealth.query();
}

export async function fetchKnowledgeToolUsageStats(
	workspaceId: string | null,
): Promise<RuntimeKnowledgeToolUsageStatsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getKnowledgeToolUsageStats.query();
}

export async function fetchMergeHistory(workspaceId: string | null): Promise<RuntimeMergeHistoryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getMergeHistory.query();
}

export async function fetchNKleinCodeIntelligenceStatus(
	workspaceId: string | null,
): Promise<RuntimeNKleinCodeIntelligenceStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinCodeIntelligenceStatus.query();
}

export async function resetRuntimeDebugState(workspaceId: string | null): Promise<RuntimeDebugResetAllStateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.resetAllState.mutate();
}

export async function openFileOnHost(workspaceId: string | null, filePath: string): Promise<void> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	await trpcClient.runtime.openFile.mutate({ filePath });
}

export async function fetchRuntimeUpdateStatus(workspaceId: string | null): Promise<RuntimeUpdateStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getUpdateStatus.query();
}

export async function runRuntimeUpdateNow(workspaceId: string | null): Promise<RuntimeRunUpdateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runUpdateNow.mutate();
}
