// Browser-side query helpers: runtime config, telemetry/status reads, and misc runtime actions.
// Keep tRPC transport plumbing here so components and controller hooks focus on state orchestration.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeKleinCorePyHealthResponse,
	RuntimeKnowledgeToolUsageStatsResponse,
	RuntimeMergeHistoryResponse,
	RuntimeModelPerformanceStatsResponse,
	RuntimeNKleinCodeIntelligenceStatusResponse,
	RuntimeRunUpdateResponse,
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
