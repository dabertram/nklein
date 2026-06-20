// Browser-side query helpers for runtime settings and Cline actions.
// Keep TRPC request details here so components and controller hooks can focus
// on state orchestration instead of transport plumbing.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeClineAccountBalanceResponse,
	RuntimeClineAccountOrganizationsResponse,
	RuntimeClineAccountProfileResponse,
	RuntimeClineAccountSwitchResponse,
	RuntimeClineAddProviderResponse,
	RuntimeClineAdvisorBuildRequest,
	RuntimeClineAdvisorRequest,
	RuntimeClineAdvisorSendResponse,
	RuntimeClineCodeIntelligenceStatusResponse,
	RuntimeClineDeviceAuthCompleteRequest,
	RuntimeClineDeviceAuthCompleteResponse,
	RuntimeClineDeviceAuthStartResponse,
	RuntimeClineDogfoodBacklogResponse,
	RuntimeClineEndpointModelDiscoveryResponse,
	RuntimeClineKanbanAccessResponse,
	RuntimeClineMcpAuthStatusResponse,
	RuntimeClineMcpOAuthResponse,
	RuntimeClineMcpServer,
	RuntimeClineMcpSettingsResponse,
	RuntimeClineModelContextWindowOverrideResponse,
	RuntimeClineModelRegistryPruneResponse,
	RuntimeClineModelRegistryRemoveResponse,
	RuntimeClineModelRegistryResponse,
	RuntimeClineOauthLoginResponse,
	RuntimeClineOauthProvider,
	RuntimeClinePlanArtifactApplyResponse,
	RuntimeClinePlanArtifactRejectResponse,
	RuntimeClinePlanArtifactsResponse,
	RuntimeClineProviderCapability,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineProviderSettings,
	RuntimeClineReasoningEffort,
	RuntimeClineSmokeEvalResponse,
	RuntimeClineUpdateProviderResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeDevTestCleanupResponse,
	RuntimeDevTestProjectPreset,
	RuntimeDevTestProjectResponse,
	RuntimeFeaturebaseTokenResponse,
	RuntimeModelPerformanceStatsResponse,
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

export async function saveClineProviderSettings(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId?: string | null;
		apiKey?: string | null;
		baseUrl?: string | null;
		reasoningEffort?: RuntimeClineReasoningEffort | null;
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
): Promise<RuntimeClineProviderSettings> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveClineProviderSettings.mutate(input);
}

export async function addClineProvider(
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
		capabilities?: RuntimeClineProviderCapability[];
	},
): Promise<RuntimeClineAddProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.addClineProvider.mutate(input);
}

export async function updateClineProvider(
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
		capabilities?: RuntimeClineProviderCapability[];
	},
): Promise<RuntimeClineUpdateProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.updateClineProvider.mutate(input);
}

export async function fetchClineProviderCatalog(
	workspaceId: string | null,
): Promise<RuntimeClineProviderCatalogItem[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getClineProviderCatalog.query();
	return response.providers;
}

export async function fetchClineAccountProfile(
	workspaceId: string | null,
): Promise<RuntimeClineAccountProfileResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineAccountProfile.query();
}

export async function fetchClineKanbanAccess(workspaceId: string | null): Promise<RuntimeClineKanbanAccessResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineKanbanAccess.query();
}

export async function fetchFeaturebaseToken(workspaceId: string | null): Promise<RuntimeFeaturebaseTokenResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getFeaturebaseToken.query();
}

export async function fetchClineProviderModels(
	workspaceId: string | null,
	providerId: string,
): Promise<RuntimeClineProviderModel[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getClineProviderModels.query({ providerId });
	return response.models;
}

export async function discoverClineEndpointModels(
	workspaceId: string | null,
	input: {
		baseUrl: string;
		apiKey?: string | null;
		modelsSourceUrl?: string | null;
		timeoutMs?: number | null;
	},
): Promise<RuntimeClineEndpointModelDiscoveryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.discoverClineEndpointModels.query(input);
}

export async function fetchClineModelRegistry(workspaceId: string | null): Promise<RuntimeClineModelRegistryResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineModelRegistry.query();
}

export async function saveClineModelContextWindowOverride(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId: string;
		endpoint?: string | null;
		contextWindow: number | null;
	},
): Promise<RuntimeClineModelContextWindowOverrideResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveClineModelContextWindowOverride.mutate(input);
}

export async function removeClineModelRegistryEntry(
	workspaceId: string | null,
	input: { key: string },
): Promise<RuntimeClineModelRegistryRemoveResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.removeClineModelRegistryEntry.mutate(input);
}

export async function pruneClineModelRegistry(
	workspaceId: string | null,
): Promise<RuntimeClineModelRegistryPruneResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.pruneClineModelRegistry.mutate();
}

export async function fetchClineCodeIntelligenceStatus(
	workspaceId: string | null,
): Promise<RuntimeClineCodeIntelligenceStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineCodeIntelligenceStatus.query();
}

export async function fetchTaskDiagnostics(
	workspaceId: string | null,
	taskId: string,
	limit?: number,
): Promise<RuntimeTaskDiagnosticsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getTaskDiagnostics.query({ taskId, limit });
}

export async function buildClineAdvisorRequest(
	workspaceId: string | null,
	input: RuntimeClineAdvisorBuildRequest,
): Promise<RuntimeClineAdvisorRequest> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.buildClineAdvisor.query(input);
}

export async function sendClineAdvisorRequest(
	workspaceId: string | null,
	input: { prompt: string; providerId: string; modelId: string },
): Promise<RuntimeClineAdvisorSendResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.sendClineAdvisor.mutate(input);
}

export async function writeClineDogfoodBacklog(
	workspaceId: string | null,
	input: { suggestion?: string; slug?: string },
): Promise<RuntimeClineDogfoodBacklogResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.writeClineDogfoodBacklog.mutate(input);
}

export async function runClineSmokeEval(workspaceId: string | null): Promise<RuntimeClineSmokeEvalResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runClineSmokeEval.mutate();
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

export async function runClineProviderOauthLogin(
	workspaceId: string | null,
	input: {
		provider: RuntimeClineOauthProvider;
		baseUrl?: string | null;
	},
): Promise<RuntimeClineOauthLoginResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runClineProviderOAuthLogin.mutate(input);
}

export async function startClineDeviceAuth(workspaceId: string | null): Promise<RuntimeClineDeviceAuthStartResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.startClineDeviceAuth.mutate();
}

export async function completeClineDeviceAuth(
	workspaceId: string | null,
	input: RuntimeClineDeviceAuthCompleteRequest,
): Promise<RuntimeClineDeviceAuthCompleteResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.completeClineDeviceAuth.mutate(input);
}

export async function fetchClineMcpSettings(workspaceId: string | null): Promise<RuntimeClineMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineMcpSettings.query();
}

export async function fetchClineMcpAuthStatuses(
	workspaceId: string | null,
): Promise<RuntimeClineMcpAuthStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineMcpAuthStatuses.query();
}

export async function saveClineMcpSettings(
	workspaceId: string | null,
	input: {
		servers: RuntimeClineMcpServer[];
	},
): Promise<RuntimeClineMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveClineMcpSettings.mutate(input);
}

export async function runClineMcpServerOAuth(
	workspaceId: string | null,
	input: {
		serverName: string;
	},
): Promise<RuntimeClineMcpOAuthResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runClineMcpServerOAuth.mutate(input);
}

export async function resetRuntimeDebugState(workspaceId: string | null): Promise<RuntimeDebugResetAllStateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.resetAllState.mutate();
}

export async function openFileOnHost(workspaceId: string | null, filePath: string): Promise<void> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	await trpcClient.runtime.openFile.mutate({ filePath });
}

export async function fetchClineAccountBalance(
	workspaceId: string | null,
): Promise<RuntimeClineAccountBalanceResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineAccountBalance.query();
}

export async function fetchClineAccountOrganizations(
	workspaceId: string | null,
): Promise<RuntimeClineAccountOrganizationsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineAccountOrganizations.query();
}

export async function switchClineAccount(
	workspaceId: string | null,
	organizationId: string | null,
): Promise<RuntimeClineAccountSwitchResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.switchClineAccount.mutate({ organizationId });
}

export async function fetchRuntimeUpdateStatus(workspaceId: string | null): Promise<RuntimeUpdateStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getUpdateStatus.query();
}

export async function runRuntimeUpdateNow(workspaceId: string | null): Promise<RuntimeRunUpdateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runUpdateNow.mutate();
}

export async function fetchClinePlanArtifacts(
	workspaceId: string | null,
	taskId: string,
): Promise<RuntimeClinePlanArtifactsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.listClinePlanArtifacts.query({ taskId });
}

export async function applyClinePlanArtifact(
	workspaceId: string | null,
	artifactId: string,
): Promise<RuntimeClinePlanArtifactApplyResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.applyClinePlanArtifact.mutate({ artifactId });
}

export async function rejectClinePlanArtifact(
	workspaceId: string | null,
	artifactId: string,
): Promise<RuntimeClinePlanArtifactRejectResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.rejectClinePlanArtifact.mutate({ artifactId });
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
