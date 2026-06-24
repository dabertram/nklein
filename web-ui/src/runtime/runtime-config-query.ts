// Browser-side query helpers for runtime settings and NKlein actions.
// Keep TRPC request details here so components and controller hooks can focus
// on state orchestration instead of transport plumbing.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeDevTestCleanupResponse,
	RuntimeDevTestProjectPreset,
	RuntimeDevTestProjectResponse,
	RuntimeFeaturebaseTokenResponse,
	RuntimeKleinCorePyHealthResponse,
	RuntimeKnowledgeToolUsageStatsResponse,
	RuntimeMergeHistoryResponse,
	RuntimeModelPerformanceStatsResponse,
	RuntimeNKleinAccountBalanceResponse,
	RuntimeNKleinAccountOrganizationsResponse,
	RuntimeNKleinAccountProfileResponse,
	RuntimeNKleinAccountSwitchResponse,
	RuntimeNKleinAddProviderResponse,
	RuntimeNKleinAdvisorBuildRequest,
	RuntimeNKleinAdvisorRequest,
	RuntimeNKleinAdvisorSendResponse,
	RuntimeNKleinCodeIntelligenceStatusResponse,
	RuntimeNKleinDeviceAuthCompleteRequest,
	RuntimeNKleinDeviceAuthCompleteResponse,
	RuntimeNKleinDeviceAuthStartResponse,
	RuntimeNKleinDogfoodBacklogResponse,
	RuntimeNKleinEndpointModelDiscoveryResponse,
	RuntimeNKleinKanbanAccessResponse,
	RuntimeNKleinMcpAuthStatusResponse,
	RuntimeNKleinMcpOAuthResponse,
	RuntimeNKleinMcpServer,
	RuntimeNKleinMcpSettingsResponse,
	RuntimeNKleinModelContextWindowOverrideResponse,
	RuntimeNKleinModelMaxConcurrentRequestsResponse,
	RuntimeNKleinModelRegistryPruneResponse,
	RuntimeNKleinModelRegistryRemoveResponse,
	RuntimeNKleinModelRegistryResponse,
	RuntimeNKleinOauthLoginResponse,
	RuntimeNKleinOauthProvider,
	RuntimeNKleinPlanArtifactApplyResponse,
	RuntimeNKleinPlanArtifactRejectResponse,
	RuntimeNKleinPlanArtifactsResponse,
	RuntimeNKleinProviderCapability,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderSettings,
	RuntimeNKleinReasoningEffort,
	RuntimeNKleinSmokeEvalResponse,
	RuntimeNKleinUpdateProviderResponse,
	RuntimeProjectArtifactMigrationResponse,
	RuntimeRunUpdateResponse,
	RuntimeSelfImprovementProjectResponse,
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskDiagnosticsResponse,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskPauseResponse,
	RuntimeTaskWorktreeMergeResponse,
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

export async function saveNKleinProviderSettings(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId?: string | null;
		apiKey?: string | null;
		baseUrl?: string | null;
		reasoningEffort?: RuntimeNKleinReasoningEffort | null;
		region?: string | null;
		aws?: {
			accessKey?: string | null;
			secretKey?: string | null;
			sessionToken?: string | null;
			region?: string | null;
			profile?: string | null;
			authentication?: "iam" | "api-key" | "profile" | null;
			endpoint?: string | null;
		};
		gcp?: {
			projectId?: string | null;
			region?: string | null;
		};
	},
): Promise<RuntimeNKleinProviderSettings> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinProviderSettings.mutate(input);
}

export async function addNKleinProvider(
	workspaceId: string | null,
	input: {
		providerId: string;
		name: string;
		baseUrl: string;
		apiKey?: string | null;
		headers?: Record<string, string>;
		timeoutMs?: number;
		models: string[];
		defaultModelId?: string | null;
		modelsSourceUrl?: string | null;
		capabilities?: RuntimeNKleinProviderCapability[];
	},
): Promise<RuntimeNKleinAddProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.addNKleinProvider.mutate(input);
}

export async function updateNKleinProvider(
	workspaceId: string | null,
	input: {
		providerId: string;
		name?: string;
		baseUrl?: string;
		apiKey?: string | null;
		headers?: Record<string, string> | null;
		timeoutMs?: number | null;
		models?: string[];
		defaultModelId?: string | null;
		modelsSourceUrl?: string | null;
		capabilities?: RuntimeNKleinProviderCapability[];
	},
): Promise<RuntimeNKleinUpdateProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.updateNKleinProvider.mutate(input);
}

export async function fetchNKleinProviderCatalog(
	workspaceId: string | null,
): Promise<RuntimeNKleinProviderCatalogItem[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getNKleinProviderCatalog.query();
	return response.providers;
}

export async function fetchNKleinAccountProfile(
	workspaceId: string | null,
): Promise<RuntimeNKleinAccountProfileResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinAccountProfile.query();
}

export async function fetchNKleinKanbanAccess(workspaceId: string | null): Promise<RuntimeNKleinKanbanAccessResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinKanbanAccess.query();
}

export async function fetchFeaturebaseToken(workspaceId: string | null): Promise<RuntimeFeaturebaseTokenResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getFeaturebaseToken.query();
}

/**
 * Discovering live provider models (e.g. LM Studio `/v1/models`) can hang if the local endpoint is slow or
 * unreachable. Bound it so the settings spinner can never spin forever — on timeout the caller surfaces an
 * error and stops loading instead of stalling.
 */
const NKLEIN_PROVIDER_MODELS_TIMEOUT_MS = 15_000;

export async function fetchNKleinProviderModels(
	workspaceId: string | null,
	providerId: string,
): Promise<RuntimeNKleinProviderModel[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getNKleinProviderModels.query(
		{ providerId },
		{ signal: AbortSignal.timeout(NKLEIN_PROVIDER_MODELS_TIMEOUT_MS) },
	);
	return response.models;
}

export async function discoverNKleinEndpointModels(
	workspaceId: string | null,
	input: {
		baseUrl: string;
		apiKey?: string | null;
		modelsSourceUrl?: string | null;
		timeoutMs?: number | null;
	},
): Promise<RuntimeNKleinEndpointModelDiscoveryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.discoverNKleinEndpointModels.query(input);
}

export async function fetchNKleinModelRegistry(
	workspaceId: string | null,
): Promise<RuntimeNKleinModelRegistryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinModelRegistry.query();
}

export async function saveNKleinModelContextWindowOverride(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId: string;
		endpoint?: string | null;
		contextWindow: number | null;
	},
): Promise<RuntimeNKleinModelContextWindowOverrideResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinModelContextWindowOverride.mutate(input);
}

export async function saveNKleinModelMaxConcurrentRequests(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId: string;
		endpoint?: string | null;
		maxConcurrentRequests: number | null;
	},
): Promise<RuntimeNKleinModelMaxConcurrentRequestsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinModelMaxConcurrentRequests.mutate(input);
}

export async function removeNKleinModelRegistryEntry(
	workspaceId: string | null,
	input: { key: string },
): Promise<RuntimeNKleinModelRegistryRemoveResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.removeNKleinModelRegistryEntry.mutate(input);
}

export async function pruneNKleinModelRegistry(
	workspaceId: string | null,
): Promise<RuntimeNKleinModelRegistryPruneResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.pruneNKleinModelRegistry.mutate();
}

export async function fetchNKleinCodeIntelligenceStatus(
	workspaceId: string | null,
): Promise<RuntimeNKleinCodeIntelligenceStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinCodeIntelligenceStatus.query();
}

export async function fetchTaskDiagnostics(
	workspaceId: string | null,
	taskId: string,
	limit?: number,
): Promise<RuntimeTaskDiagnosticsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getTaskDiagnostics.query({ taskId, limit });
}

export async function buildNKleinAdvisorRequest(
	workspaceId: string | null,
	input: RuntimeNKleinAdvisorBuildRequest,
): Promise<RuntimeNKleinAdvisorRequest> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.buildNKleinAdvisor.query(input);
}

export async function sendNKleinAdvisorRequest(
	workspaceId: string | null,
	input: { prompt: string; providerId: string; modelId: string },
): Promise<RuntimeNKleinAdvisorSendResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.sendNKleinAdvisor.mutate(input);
}

export async function writeNKleinDogfoodBacklog(
	workspaceId: string | null,
	input: { suggestion?: string; slug?: string },
): Promise<RuntimeNKleinDogfoodBacklogResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.writeNKleinDogfoodBacklog.mutate(input);
}

export async function runNKleinSmokeEval(workspaceId: string | null): Promise<RuntimeNKleinSmokeEvalResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runNKleinSmokeEval.mutate();
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

export async function createDevTestProject(
	workspaceId: string | null,
	input?: { preset?: RuntimeDevTestProjectPreset },
): Promise<RuntimeDevTestProjectResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.createDevTestProject.mutate(input);
}

export async function createSelfImprovementProject(
	workspaceId: string | null,
	input: { notes?: string; evidenceBundlePath?: string; confirmSelfProject: true },
): Promise<RuntimeSelfImprovementProjectResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.createSelfImprovementProject.mutate(input);
}

export async function cleanupDevTestProjects(workspaceId: string | null): Promise<RuntimeDevTestCleanupResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.cleanupDevTestProjects.mutate();
}

export async function migrateAccidentalProjectArtifacts(
	workspaceId: string | null,
	projectId: string,
): Promise<RuntimeProjectArtifactMigrationResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.projects.migrateAccidentalProjectArtifacts.mutate({ projectId });
}

export async function runNKleinProviderOauthLogin(
	workspaceId: string | null,
	input: {
		provider: RuntimeNKleinOauthProvider;
		baseUrl?: string | null;
	},
): Promise<RuntimeNKleinOauthLoginResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runNKleinProviderOAuthLogin.mutate(input);
}

export async function startNKleinDeviceAuth(workspaceId: string | null): Promise<RuntimeNKleinDeviceAuthStartResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.startNKleinDeviceAuth.mutate();
}

export async function completeNKleinDeviceAuth(
	workspaceId: string | null,
	input: RuntimeNKleinDeviceAuthCompleteRequest,
): Promise<RuntimeNKleinDeviceAuthCompleteResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.completeNKleinDeviceAuth.mutate(input);
}

export async function fetchNKleinMcpSettings(workspaceId: string | null): Promise<RuntimeNKleinMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinMcpSettings.query();
}

export async function fetchNKleinMcpAuthStatuses(
	workspaceId: string | null,
): Promise<RuntimeNKleinMcpAuthStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinMcpAuthStatuses.query();
}

export async function saveNKleinMcpSettings(
	workspaceId: string | null,
	input: {
		servers: RuntimeNKleinMcpServer[];
	},
): Promise<RuntimeNKleinMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveNKleinMcpSettings.mutate(input);
}

export async function runNKleinMcpServerOAuth(
	workspaceId: string | null,
	input: {
		serverName: string;
	},
): Promise<RuntimeNKleinMcpOAuthResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runNKleinMcpServerOAuth.mutate(input);
}

export async function resetRuntimeDebugState(workspaceId: string | null): Promise<RuntimeDebugResetAllStateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.resetAllState.mutate();
}

export async function openFileOnHost(workspaceId: string | null, filePath: string): Promise<void> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	await trpcClient.runtime.openFile.mutate({ filePath });
}

export async function fetchNKleinAccountBalance(
	workspaceId: string | null,
): Promise<RuntimeNKleinAccountBalanceResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinAccountBalance.query();
}

export async function fetchNKleinAccountOrganizations(
	workspaceId: string | null,
): Promise<RuntimeNKleinAccountOrganizationsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getNKleinAccountOrganizations.query();
}

export async function switchNKleinAccount(
	workspaceId: string | null,
	organizationId: string | null,
): Promise<RuntimeNKleinAccountSwitchResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.switchNKleinAccount.mutate({ organizationId });
}

export async function fetchRuntimeUpdateStatus(workspaceId: string | null): Promise<RuntimeUpdateStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getUpdateStatus.query();
}

export async function runRuntimeUpdateNow(workspaceId: string | null): Promise<RuntimeRunUpdateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runUpdateNow.mutate();
}

export async function fetchNKleinPlanArtifacts(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeNKleinPlanArtifactsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.listNKleinPlanArtifacts.query({ taskId });
}

export async function applyNKleinPlanArtifact(
	workspaceId: string | null,
	artifactId: string,
): Promise<RuntimeNKleinPlanArtifactApplyResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.applyNKleinPlanArtifact.mutate({ artifactId });
}

export async function rejectNKleinPlanArtifact(
	workspaceId: string | null,
	artifactId: string,
): Promise<RuntimeNKleinPlanArtifactRejectResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.rejectNKleinPlanArtifact.mutate({ artifactId });
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
