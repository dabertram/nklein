// Defines the typed TRPC boundary between the browser and the local runtime.
// Keep request and response contracts plus workspace-scoped procedures here,
// and delegate domain behavior to runtime-api.ts and lower-level services.
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
	RuntimeCommandRunRequest,
	RuntimeCommandRunResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeDevTestCleanupResponse,
	RuntimeDevTestProjectRequest,
	RuntimeDevTestProjectResponse,
	RuntimeDirectoryListRequest,
	RuntimeDirectoryListResponse,
	RuntimeFeaturebaseTokenResponse,
	RuntimeGitCheckoutRequest,
	RuntimeGitCheckoutResponse,
	RuntimeGitCommitDiffRequest,
	RuntimeGitCommitDiffResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitLogRequest,
	RuntimeGitLogResponse,
	RuntimeGitRefsResponse,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeKleinCorePyHealthResponse,
	RuntimeKnowledgeToolUsageStatsResponse,
	RuntimeModelPerformanceStatsResponse,
	RuntimeNKleinAccountBalanceResponse,
	RuntimeNKleinAccountOrganizationsResponse,
	RuntimeNKleinAccountProfileResponse,
	RuntimeNKleinAccountSwitchRequest,
	RuntimeNKleinAccountSwitchResponse,
	RuntimeNKleinAddProviderRequest,
	RuntimeNKleinAddProviderResponse,
	RuntimeNKleinAdvisorBuildRequest,
	RuntimeNKleinAdvisorRequest,
	RuntimeNKleinAdvisorSendRequest,
	RuntimeNKleinAdvisorSendResponse,
	RuntimeNKleinCodeIntelligenceStatusResponse,
	RuntimeNKleinDeviceAuthCompleteRequest,
	RuntimeNKleinDeviceAuthCompleteResponse,
	RuntimeNKleinDeviceAuthStartResponse,
	RuntimeNKleinDogfoodBacklogRequest,
	RuntimeNKleinDogfoodBacklogResponse,
	RuntimeNKleinEndpointModelDiscoveryRequest,
	RuntimeNKleinEndpointModelDiscoveryResponse,
	RuntimeNKleinKanbanAccessResponse,
	RuntimeNKleinMcpAuthStatusResponse,
	RuntimeNKleinMcpOAuthRequest,
	RuntimeNKleinMcpOAuthResponse,
	RuntimeNKleinMcpSettingsResponse,
	RuntimeNKleinMcpSettingsSaveRequest,
	RuntimeNKleinMcpSettingsSaveResponse,
	RuntimeNKleinModelContextWindowOverrideRequest,
	RuntimeNKleinModelContextWindowOverrideResponse,
	RuntimeNKleinModelMaxConcurrentRequestsRequest,
	RuntimeNKleinModelMaxConcurrentRequestsResponse,
	RuntimeNKleinModelRegistryPruneResponse,
	RuntimeNKleinModelRegistryRemoveRequest,
	RuntimeNKleinModelRegistryRemoveResponse,
	RuntimeNKleinModelRegistryResponse,
	RuntimeNKleinOauthLoginRequest,
	RuntimeNKleinOauthLoginResponse,
	RuntimeNKleinPlanArtifactActionRequest,
	RuntimeNKleinPlanArtifactApplyResponse,
	RuntimeNKleinPlanArtifactRejectResponse,
	RuntimeNKleinPlanArtifactsRequest,
	RuntimeNKleinPlanArtifactsResponse,
	RuntimeNKleinProviderCatalogResponse,
	RuntimeNKleinProviderModelsRequest,
	RuntimeNKleinProviderModelsResponse,
	RuntimeNKleinProviderSettingsSaveRequest,
	RuntimeNKleinProviderSettingsSaveResponse,
	RuntimeNKleinSmokeEvalResponse,
	RuntimeNKleinUpdateProviderRequest,
	RuntimeNKleinUpdateProviderResponse,
	RuntimeOpenFileRequest,
	RuntimeOpenFileResponse,
	RuntimeProjectAddRequest,
	RuntimeProjectAddResponse,
	RuntimeProjectArtifactMigrationRequest,
	RuntimeProjectArtifactMigrationResponse,
	RuntimeProjectDirectoryPickerResponse,
	RuntimeProjectRemoveRequest,
	RuntimeProjectRemoveResponse,
	RuntimeProjectsResponse,
	RuntimeProtectedTestApprovalGrantRequest,
	RuntimeProtectedTestApprovalGrantResponse,
	RuntimeRunUpdateResponse,
	RuntimeSelfImprovementProjectRequest,
	RuntimeSelfImprovementProjectResponse,
	RuntimeShellSessionStartRequest,
	RuntimeShellSessionStartResponse,
	RuntimeSlashCommandsResponse,
	RuntimeSwarmStopRequest,
	RuntimeSwarmStopResponse,
	RuntimeTaskAcceptanceVerifyRequest,
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskChatAbortRequest,
	RuntimeTaskChatAbortResponse,
	RuntimeTaskChatCancelRequest,
	RuntimeTaskChatCancelResponse,
	RuntimeTaskChatMessagesRequest,
	RuntimeTaskChatMessagesResponse,
	RuntimeTaskChatReloadRequest,
	RuntimeTaskChatReloadResponse,
	RuntimeTaskChatSendRequest,
	RuntimeTaskChatSendResponse,
	RuntimeTaskContextImportRequest,
	RuntimeTaskContextImportResponse,
	RuntimeTaskDiagnosticsRequest,
	RuntimeTaskDiagnosticsResponse,
	RuntimeTaskEvidenceRequest,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskPauseRequest,
	RuntimeTaskPauseResponse,
	RuntimeTaskSessionInputRequest,
	RuntimeTaskSessionInputResponse,
	RuntimeTaskSessionStartRequest,
	RuntimeTaskSessionStartResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
	RuntimeTaskWorkspaceInfoRequest,
	RuntimeTaskWorktreeMergeRequest,
	RuntimeTaskWorktreeMergeResponse,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceChangesRequest,
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileSearchRequest,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateNotifyResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteRequest,
	RuntimeWorktreeDeleteResponse,
} from "../core/api-contract";
import {
	runtimeCommandRunRequestSchema,
	runtimeCommandRunResponseSchema,
	runtimeConfigResponseSchema,
	runtimeConfigSaveRequestSchema,
	runtimeDebugResetAllStateResponseSchema,
	runtimeDevTestCleanupResponseSchema,
	runtimeDevTestProjectRequestSchema,
	runtimeDevTestProjectResponseSchema,
	runtimeDirectoryListRequestSchema,
	runtimeDirectoryListResponseSchema,
	runtimeFeaturebaseTokenResponseSchema,
	runtimeGitCheckoutRequestSchema,
	runtimeGitCheckoutResponseSchema,
	runtimeGitCommitDiffRequestSchema,
	runtimeGitCommitDiffResponseSchema,
	runtimeGitDiscardResponseSchema,
	runtimeGitLogRequestSchema,
	runtimeGitLogResponseSchema,
	runtimeGitRefsResponseSchema,
	runtimeGitSummaryResponseSchema,
	runtimeGitSyncActionSchema,
	runtimeGitSyncResponseSchema,
	runtimeKleinCorePyHealthResponseSchema,
	runtimeKnowledgeToolUsageStatsResponseSchema,
	runtimeModelPerformanceStatsResponseSchema,
	runtimeNKleinAccountBalanceResponseSchema,
	runtimeNKleinAccountOrganizationsResponseSchema,
	runtimeNKleinAccountProfileResponseSchema,
	runtimeNKleinAccountSwitchRequestSchema,
	runtimeNKleinAccountSwitchResponseSchema,
	runtimeNKleinAddProviderRequestSchema,
	runtimeNKleinAddProviderResponseSchema,
	runtimeNKleinAdvisorBuildRequestSchema,
	runtimeNKleinAdvisorRequestSchema,
	runtimeNKleinAdvisorSendRequestSchema,
	runtimeNKleinAdvisorSendResponseSchema,
	runtimeNKleinCodeIntelligenceStatusResponseSchema,
	runtimeNKleinDeviceAuthCompleteRequestSchema,
	runtimeNKleinDeviceAuthCompleteResponseSchema,
	runtimeNKleinDeviceAuthStartResponseSchema,
	runtimeNKleinDogfoodBacklogRequestSchema,
	runtimeNKleinDogfoodBacklogResponseSchema,
	runtimeNKleinEndpointModelDiscoveryRequestSchema,
	runtimeNKleinEndpointModelDiscoveryResponseSchema,
	runtimeNKleinKanbanAccessResponseSchema,
	runtimeNKleinMcpAuthStatusResponseSchema,
	runtimeNKleinMcpOAuthRequestSchema,
	runtimeNKleinMcpOAuthResponseSchema,
	runtimeNKleinMcpSettingsResponseSchema,
	runtimeNKleinMcpSettingsSaveRequestSchema,
	runtimeNKleinMcpSettingsSaveResponseSchema,
	runtimeNKleinModelContextWindowOverrideRequestSchema,
	runtimeNKleinModelContextWindowOverrideResponseSchema,
	runtimeNKleinModelMaxConcurrentRequestsRequestSchema,
	runtimeNKleinModelMaxConcurrentRequestsResponseSchema,
	runtimeNKleinModelRegistryPruneResponseSchema,
	runtimeNKleinModelRegistryRemoveRequestSchema,
	runtimeNKleinModelRegistryRemoveResponseSchema,
	runtimeNKleinModelRegistryResponseSchema,
	runtimeNKleinOauthLoginRequestSchema,
	runtimeNKleinOauthLoginResponseSchema,
	runtimeNKleinPlanArtifactActionRequestSchema,
	runtimeNKleinPlanArtifactApplyResponseSchema,
	runtimeNKleinPlanArtifactRejectResponseSchema,
	runtimeNKleinPlanArtifactsRequestSchema,
	runtimeNKleinPlanArtifactsResponseSchema,
	runtimeNKleinProviderCatalogResponseSchema,
	runtimeNKleinProviderModelsRequestSchema,
	runtimeNKleinProviderModelsResponseSchema,
	runtimeNKleinProviderSettingsSaveRequestSchema,
	runtimeNKleinProviderSettingsSaveResponseSchema,
	runtimeNKleinSmokeEvalResponseSchema,
	runtimeNKleinUpdateProviderRequestSchema,
	runtimeNKleinUpdateProviderResponseSchema,
	runtimeOpenFileRequestSchema,
	runtimeOpenFileResponseSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectAddResponseSchema,
	runtimeProjectArtifactMigrationRequestSchema,
	runtimeProjectArtifactMigrationResponseSchema,
	runtimeProjectDirectoryPickerResponseSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeProjectRemoveResponseSchema,
	runtimeProjectsResponseSchema,
	runtimeProtectedTestApprovalGrantRequestSchema,
	runtimeProtectedTestApprovalGrantResponseSchema,
	runtimeRunUpdateResponseSchema,
	runtimeSelfImprovementProjectRequestSchema,
	runtimeSelfImprovementProjectResponseSchema,
	runtimeShellSessionStartRequestSchema,
	runtimeShellSessionStartResponseSchema,
	runtimeSlashCommandsResponseSchema,
	runtimeSwarmStopRequestSchema,
	runtimeSwarmStopResponseSchema,
	runtimeTaskAcceptanceVerifyRequestSchema,
	runtimeTaskAcceptanceVerifyResponseSchema,
	runtimeTaskChatAbortRequestSchema,
	runtimeTaskChatAbortResponseSchema,
	runtimeTaskChatCancelRequestSchema,
	runtimeTaskChatCancelResponseSchema,
	runtimeTaskChatMessagesRequestSchema,
	runtimeTaskChatMessagesResponseSchema,
	runtimeTaskChatReloadRequestSchema,
	runtimeTaskChatReloadResponseSchema,
	runtimeTaskChatSendRequestSchema,
	runtimeTaskChatSendResponseSchema,
	runtimeTaskContextImportRequestSchema,
	runtimeTaskContextImportResponseSchema,
	runtimeTaskDiagnosticsRequestSchema,
	runtimeTaskDiagnosticsResponseSchema,
	runtimeTaskEvidenceRequestSchema,
	runtimeTaskEvidenceResponseSchema,
	runtimeTaskPauseRequestSchema,
	runtimeTaskPauseResponseSchema,
	runtimeTaskSessionInputRequestSchema,
	runtimeTaskSessionInputResponseSchema,
	runtimeTaskSessionStartRequestSchema,
	runtimeTaskSessionStartResponseSchema,
	runtimeTaskSessionStopRequestSchema,
	runtimeTaskSessionStopResponseSchema,
	runtimeTaskWorkspaceInfoRequestSchema,
	runtimeTaskWorktreeMergeRequestSchema,
	runtimeTaskWorktreeMergeResponseSchema,
	runtimeUpdateStatusResponseSchema,
	runtimeWorkspaceChangesRequestSchema,
	runtimeWorkspaceChangesResponseSchema,
	runtimeWorkspaceFileSearchRequestSchema,
	runtimeWorkspaceFileSearchResponseSchema,
	runtimeWorkspaceStateNotifyResponseSchema,
	runtimeWorkspaceStateResponseSchema,
	runtimeWorkspaceStateSaveRequestSchema,
	runtimeWorktreeDeleteRequestSchema,
	runtimeWorktreeDeleteResponseSchema,
} from "../core/api-contract";
import { LEGACY_WORKSPACE_ID_HEADER, WORKSPACE_ID_HEADER } from "../core/workspace-scope";

export interface RuntimeTrpcWorkspaceScope {
	workspaceId: string;
	workspacePath: string;
}

export interface RuntimeTrpcContext {
	requestedWorkspaceId: string | null;
	workspaceScope: RuntimeTrpcWorkspaceScope | null;
	runtimeApi: {
		loadConfig: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeConfigResponse>;
		saveConfig: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeConfigSaveRequest,
		) => Promise<RuntimeConfigResponse>;
		getModelPerformanceStats: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeModelPerformanceStatsResponse>;
		getKnowledgeToolUsageStats: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeKnowledgeToolUsageStatsResponse>;
		saveNKleinProviderSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinProviderSettingsSaveRequest,
		) => Promise<RuntimeNKleinProviderSettingsSaveResponse>;
		addNKleinProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinAddProviderRequest,
		) => Promise<RuntimeNKleinAddProviderResponse>;
		updateNKleinProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinUpdateProviderRequest,
		) => Promise<RuntimeNKleinUpdateProviderResponse>;
		startTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStartRequest,
		) => Promise<RuntimeTaskSessionStartResponse>;
		stopTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStopRequest,
		) => Promise<RuntimeTaskSessionStopResponse>;
		pauseTask: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskPauseRequest,
		) => Promise<RuntimeTaskPauseResponse>;
		resumeTask: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskPauseRequest,
		) => Promise<RuntimeTaskPauseResponse>;
		getSwarmStop: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeSwarmStopResponse>;
		requestSwarmStop: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeSwarmStopRequest,
		) => Promise<RuntimeSwarmStopResponse>;
		clearSwarmStop: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeSwarmStopResponse>;
		getTaskDiagnostics: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskDiagnosticsRequest,
		) => Promise<RuntimeTaskDiagnosticsResponse>;
		listNKleinPlanArtifacts: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeNKleinPlanArtifactsRequest,
		) => Promise<RuntimeNKleinPlanArtifactsResponse>;
		applyNKleinPlanArtifact: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeNKleinPlanArtifactActionRequest,
		) => Promise<RuntimeNKleinPlanArtifactApplyResponse>;
		rejectNKleinPlanArtifact: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeNKleinPlanArtifactActionRequest,
		) => Promise<RuntimeNKleinPlanArtifactRejectResponse>;
		verifyTaskAcceptance: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskAcceptanceVerifyRequest,
		) => Promise<RuntimeTaskAcceptanceVerifyResponse>;
		mergeTaskWorktrees: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorktreeMergeRequest,
		) => Promise<RuntimeTaskWorktreeMergeResponse>;
		sendTaskSessionInput: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionInputRequest,
		) => Promise<RuntimeTaskSessionInputResponse>;
		getTaskChatMessages: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatMessagesRequest,
		) => Promise<RuntimeTaskChatMessagesResponse>;
		getNKleinSlashCommands: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeSlashCommandsResponse>;
		sendTaskChatMessage: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatSendRequest,
		) => Promise<RuntimeTaskChatSendResponse>;
		grantProtectedTestApproval: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeProtectedTestApprovalGrantRequest,
		) => Promise<RuntimeProtectedTestApprovalGrantResponse>;
		importTaskContext: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskContextImportRequest,
		) => Promise<RuntimeTaskContextImportResponse>;
		reloadTaskChatSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatReloadRequest,
		) => Promise<RuntimeTaskChatReloadResponse>;
		abortTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatAbortRequest,
		) => Promise<RuntimeTaskChatAbortResponse>;
		cancelTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatCancelRequest,
		) => Promise<RuntimeTaskChatCancelResponse>;
		getNKleinProviderCatalog: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinProviderCatalogResponse>;
		getNKleinAccountProfile: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinAccountProfileResponse>;
		getNKleinKanbanAccess: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeNKleinKanbanAccessResponse>;
		getFeaturebaseToken: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeFeaturebaseTokenResponse>;
		getNKleinAccountBalance: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinAccountBalanceResponse>;
		getNKleinAccountOrganizations: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinAccountOrganizationsResponse>;
		switchNKleinAccount: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinAccountSwitchRequest,
		) => Promise<RuntimeNKleinAccountSwitchResponse>;
		getNKleinProviderModels: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinProviderModelsRequest,
		) => Promise<RuntimeNKleinProviderModelsResponse>;
		discoverNKleinEndpointModels: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinEndpointModelDiscoveryRequest,
		) => Promise<RuntimeNKleinEndpointModelDiscoveryResponse>;
		getNKleinModelRegistry: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeNKleinModelRegistryResponse>;
		removeNKleinModelRegistryEntry: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinModelRegistryRemoveRequest,
		) => Promise<RuntimeNKleinModelRegistryRemoveResponse>;
		pruneNKleinModelRegistry: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinModelRegistryPruneResponse>;
		saveNKleinModelContextWindowOverride: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinModelContextWindowOverrideRequest,
		) => Promise<RuntimeNKleinModelContextWindowOverrideResponse>;
		saveNKleinModelMaxConcurrentRequests: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinModelMaxConcurrentRequestsRequest,
		) => Promise<RuntimeNKleinModelMaxConcurrentRequestsResponse>;
		getNKleinCodeIntelligenceStatus: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinCodeIntelligenceStatusResponse>;
		getKleinCorePyHealth: () => Promise<RuntimeKleinCorePyHealthResponse>;
		buildNKleinModelFreshnessAdvisor: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinAdvisorRequest>;
		buildNKleinAdvisor: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinAdvisorBuildRequest,
		) => Promise<RuntimeNKleinAdvisorRequest>;
		sendNKleinAdvisor: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinAdvisorSendRequest,
		) => Promise<RuntimeNKleinAdvisorSendResponse>;
		writeNKleinDogfoodBacklog: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinDogfoodBacklogRequest,
		) => Promise<RuntimeNKleinDogfoodBacklogResponse>;
		runNKleinSmokeEval: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeNKleinSmokeEvalResponse>;
		collectTaskEvidence: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeTaskEvidenceRequest,
		) => Promise<RuntimeTaskEvidenceResponse>;
		runNKleinProviderOAuthLogin: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinOauthLoginRequest,
		) => Promise<RuntimeNKleinOauthLoginResponse>;
		startNKleinDeviceAuth: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeNKleinDeviceAuthStartResponse>;
		completeNKleinDeviceAuth: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinDeviceAuthCompleteRequest,
		) => Promise<RuntimeNKleinDeviceAuthCompleteResponse>;
		getNKleinMcpAuthStatuses: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeNKleinMcpAuthStatusResponse>;
		runNKleinMcpServerOAuth: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinMcpOAuthRequest,
		) => Promise<RuntimeNKleinMcpOAuthResponse>;
		getNKleinMcpSettings: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeNKleinMcpSettingsResponse>;
		saveNKleinMcpSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeNKleinMcpSettingsSaveRequest,
		) => Promise<RuntimeNKleinMcpSettingsSaveResponse>;
		startShellSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeShellSessionStartRequest,
		) => Promise<RuntimeShellSessionStartResponse>;
		runCommand: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeCommandRunRequest,
		) => Promise<RuntimeCommandRunResponse>;
		resetAllState: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeDebugResetAllStateResponse>;
		openFile: (input: RuntimeOpenFileRequest) => Promise<RuntimeOpenFileResponse>;
		getUpdateStatus: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeUpdateStatusResponse>;
		runUpdateNow: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeRunUpdateResponse>;
	};
	workspaceApi: {
		loadGitSummary: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitSummaryResponse>;
		runGitSyncAction: (
			scope: RuntimeTrpcWorkspaceScope,
			input: { action: RuntimeGitSyncAction },
		) => Promise<RuntimeGitSyncResponse>;
		checkoutGitBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCheckoutRequest,
		) => Promise<RuntimeGitCheckoutResponse>;
		discardGitChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitDiscardResponse>;
		loadChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceChangesRequest,
		) => Promise<RuntimeWorkspaceChangesResponse>;
		deleteWorktree: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorktreeDeleteRequest,
		) => Promise<RuntimeWorktreeDeleteResponse>;
		searchFiles: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceFileSearchRequest,
		) => Promise<RuntimeWorkspaceFileSearchResponse>;
		loadState: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateResponse>;
		notifyStateUpdated: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateNotifyResponse>;
		saveState: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceStateSaveRequest,
		) => Promise<RuntimeWorkspaceStateResponse>;
		loadWorkspaceChanges: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceChangesResponse>;
		loadGitLog: (scope: RuntimeTrpcWorkspaceScope, input: RuntimeGitLogRequest) => Promise<RuntimeGitLogResponse>;
		loadGitRefs: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitRefsResponse>;
		loadCommitDiff: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCommitDiffRequest,
		) => Promise<RuntimeGitCommitDiffResponse>;
	};
	projectsApi: {
		listProjects: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectsResponse>;
		addProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectAddRequest,
		) => Promise<RuntimeProjectAddResponse>;
		createDevTestProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeDevTestProjectRequest,
		) => Promise<RuntimeDevTestProjectResponse>;
		createSelfImprovementProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeSelfImprovementProjectRequest,
		) => Promise<RuntimeSelfImprovementProjectResponse>;
		cleanupDevTestProjects: (preferredWorkspaceId: string | null) => Promise<RuntimeDevTestCleanupResponse>;
		removeProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectRemoveRequest,
		) => Promise<RuntimeProjectRemoveResponse>;
		migrateAccidentalProjectArtifacts: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectArtifactMigrationRequest,
		) => Promise<RuntimeProjectArtifactMigrationResponse>;
		pickProjectDirectory: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectDirectoryPickerResponse>;
		listDirectoryContents: (
			preferredWorkspaceId: string | null,
			input: RuntimeDirectoryListRequest,
		) => Promise<RuntimeDirectoryListResponse>;
	};
}

interface RuntimeTrpcContextWithWorkspaceScope extends RuntimeTrpcContext {
	workspaceScope: RuntimeTrpcWorkspaceScope;
}

function readConflictRevision(cause: unknown): number | null {
	if (!cause || typeof cause !== "object" || !("currentRevision" in cause)) {
		return null;
	}
	const revision = (cause as { currentRevision?: unknown }).currentRevision;
	if (typeof revision !== "number") {
		return null;
	}
	return Number.isFinite(revision) ? revision : null;
}

const t = initTRPC.context<RuntimeTrpcContext>().create({
	errorFormatter({ shape, error }) {
		const conflictRevision = error.code === "CONFLICT" ? readConflictRevision(error.cause) : null;
		return {
			...shape,
			data: {
				...shape.data,
				conflictRevision,
			},
		};
	},
});

const workspaceProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.requestedWorkspaceId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Missing workspace scope. Include ${WORKSPACE_ID_HEADER} header or workspaceId query parameter. ${LEGACY_WORKSPACE_ID_HEADER} is still accepted during the rename transition.`,
		});
	}
	if (!ctx.workspaceScope) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Unknown workspace ID: ${ctx.requestedWorkspaceId}`,
		});
	}
	return next({
		ctx: {
			...ctx,
			workspaceScope: ctx.workspaceScope,
		} satisfies RuntimeTrpcContextWithWorkspaceScope,
	});
});

const optionalTaskWorkspaceInfoRequestSchema = runtimeTaskWorkspaceInfoRequestSchema.nullable().optional();
const gitSyncActionInputSchema = z.object({
	action: runtimeGitSyncActionSchema,
});

export const runtimeAppRouter = t.router({
	runtime: t.router({
		getConfig: t.procedure.output(runtimeConfigResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.loadConfig(ctx.workspaceScope);
		}),
		saveConfig: t.procedure
			.input(runtimeConfigSaveRequestSchema)
			.output(runtimeConfigResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveConfig(ctx.workspaceScope, input);
			}),
		getModelPerformanceStats: t.procedure
			.output(runtimeModelPerformanceStatsResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getModelPerformanceStats(ctx.workspaceScope);
			}),
		getKnowledgeToolUsageStats: t.procedure
			.output(runtimeKnowledgeToolUsageStatsResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getKnowledgeToolUsageStats(ctx.workspaceScope);
			}),
		saveNKleinProviderSettings: t.procedure
			.input(runtimeNKleinProviderSettingsSaveRequestSchema)
			.output(runtimeNKleinProviderSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveNKleinProviderSettings(ctx.workspaceScope, input);
			}),
		addNKleinProvider: t.procedure
			.input(runtimeNKleinAddProviderRequestSchema)
			.output(runtimeNKleinAddProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.addNKleinProvider(ctx.workspaceScope, input);
			}),
		updateNKleinProvider: t.procedure
			.input(runtimeNKleinUpdateProviderRequestSchema)
			.output(runtimeNKleinUpdateProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.updateNKleinProvider(ctx.workspaceScope, input);
			}),
		startTaskSession: workspaceProcedure
			.input(runtimeTaskSessionStartRequestSchema)
			.output(runtimeTaskSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startTaskSession(ctx.workspaceScope, input);
			}),
		stopTaskSession: workspaceProcedure
			.input(runtimeTaskSessionStopRequestSchema)
			.output(runtimeTaskSessionStopResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.stopTaskSession(ctx.workspaceScope, input);
			}),
		pauseTask: workspaceProcedure
			.input(runtimeTaskPauseRequestSchema)
			.output(runtimeTaskPauseResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.pauseTask(ctx.workspaceScope, input);
			}),
		resumeTask: workspaceProcedure
			.input(runtimeTaskPauseRequestSchema)
			.output(runtimeTaskPauseResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.resumeTask(ctx.workspaceScope, input);
			}),
		getSwarmStop: workspaceProcedure.output(runtimeSwarmStopResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getSwarmStop(ctx.workspaceScope);
		}),
		requestSwarmStop: workspaceProcedure
			.input(runtimeSwarmStopRequestSchema)
			.output(runtimeSwarmStopResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.requestSwarmStop(ctx.workspaceScope, input);
			}),
		clearSwarmStop: workspaceProcedure.output(runtimeSwarmStopResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.clearSwarmStop(ctx.workspaceScope);
		}),
		getTaskDiagnostics: workspaceProcedure
			.input(runtimeTaskDiagnosticsRequestSchema)
			.output(runtimeTaskDiagnosticsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getTaskDiagnostics(ctx.workspaceScope, input);
			}),
		listNKleinPlanArtifacts: workspaceProcedure
			.input(runtimeNKleinPlanArtifactsRequestSchema)
			.output(runtimeNKleinPlanArtifactsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.listNKleinPlanArtifacts(ctx.workspaceScope, input);
			}),
		applyNKleinPlanArtifact: workspaceProcedure
			.input(runtimeNKleinPlanArtifactActionRequestSchema)
			.output(runtimeNKleinPlanArtifactApplyResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.applyNKleinPlanArtifact(ctx.workspaceScope, input);
			}),
		rejectNKleinPlanArtifact: workspaceProcedure
			.input(runtimeNKleinPlanArtifactActionRequestSchema)
			.output(runtimeNKleinPlanArtifactRejectResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.rejectNKleinPlanArtifact(ctx.workspaceScope, input);
			}),
		verifyTaskAcceptance: workspaceProcedure
			.input(runtimeTaskAcceptanceVerifyRequestSchema)
			.output(runtimeTaskAcceptanceVerifyResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.verifyTaskAcceptance(ctx.workspaceScope, input);
			}),
		mergeTaskWorktrees: workspaceProcedure
			.input(runtimeTaskWorktreeMergeRequestSchema)
			.output(runtimeTaskWorktreeMergeResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.mergeTaskWorktrees(ctx.workspaceScope, input);
			}),
		sendTaskSessionInput: workspaceProcedure
			.input(runtimeTaskSessionInputRequestSchema)
			.output(runtimeTaskSessionInputResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendTaskSessionInput(ctx.workspaceScope, input);
			}),
		getTaskChatMessages: workspaceProcedure
			.input(runtimeTaskChatMessagesRequestSchema)
			.output(runtimeTaskChatMessagesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getTaskChatMessages(ctx.workspaceScope, input);
			}),
		getNKleinSlashCommands: t.procedure.output(runtimeSlashCommandsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getNKleinSlashCommands(ctx.workspaceScope);
		}),
		reloadTaskChatSession: workspaceProcedure
			.input(runtimeTaskChatReloadRequestSchema)
			.output(runtimeTaskChatReloadResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.reloadTaskChatSession(ctx.workspaceScope, input);
			}),
		sendTaskChatMessage: workspaceProcedure
			.input(runtimeTaskChatSendRequestSchema)
			.output(runtimeTaskChatSendResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendTaskChatMessage(ctx.workspaceScope, input);
			}),
		grantProtectedTestApproval: workspaceProcedure
			.input(runtimeProtectedTestApprovalGrantRequestSchema)
			.output(runtimeProtectedTestApprovalGrantResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.grantProtectedTestApproval(ctx.workspaceScope, input);
			}),
		importTaskContext: workspaceProcedure
			.input(runtimeTaskContextImportRequestSchema)
			.output(runtimeTaskContextImportResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.importTaskContext(ctx.workspaceScope, input);
			}),
		abortTaskChatTurn: workspaceProcedure
			.input(runtimeTaskChatAbortRequestSchema)
			.output(runtimeTaskChatAbortResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.abortTaskChatTurn(ctx.workspaceScope, input);
			}),
		cancelTaskChatTurn: workspaceProcedure
			.input(runtimeTaskChatCancelRequestSchema)
			.output(runtimeTaskChatCancelResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.cancelTaskChatTurn(ctx.workspaceScope, input);
			}),
		getNKleinProviderCatalog: t.procedure
			.output(runtimeNKleinProviderCatalogResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getNKleinProviderCatalog(ctx.workspaceScope);
			}),
		getNKleinAccountProfile: t.procedure.output(runtimeNKleinAccountProfileResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getNKleinAccountProfile(ctx.workspaceScope);
		}),
		getNKleinKanbanAccess: t.procedure.output(runtimeNKleinKanbanAccessResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getNKleinKanbanAccess(ctx.workspaceScope);
		}),
		getFeaturebaseToken: t.procedure.output(runtimeFeaturebaseTokenResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getFeaturebaseToken(ctx.workspaceScope);
		}),
		getNKleinAccountBalance: t.procedure.output(runtimeNKleinAccountBalanceResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getNKleinAccountBalance(ctx.workspaceScope);
		}),
		getNKleinAccountOrganizations: t.procedure
			.output(runtimeNKleinAccountOrganizationsResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getNKleinAccountOrganizations(ctx.workspaceScope);
			}),
		switchNKleinAccount: t.procedure
			.input(runtimeNKleinAccountSwitchRequestSchema)
			.output(runtimeNKleinAccountSwitchResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.switchNKleinAccount(ctx.workspaceScope, input);
			}),
		getNKleinProviderModels: t.procedure
			.input(runtimeNKleinProviderModelsRequestSchema)
			.output(runtimeNKleinProviderModelsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getNKleinProviderModels(ctx.workspaceScope, input);
			}),
		discoverNKleinEndpointModels: t.procedure
			.input(runtimeNKleinEndpointModelDiscoveryRequestSchema)
			.output(runtimeNKleinEndpointModelDiscoveryResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.discoverNKleinEndpointModels(ctx.workspaceScope, input);
			}),
		getNKleinModelRegistry: t.procedure.output(runtimeNKleinModelRegistryResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getNKleinModelRegistry(ctx.workspaceScope);
		}),
		removeNKleinModelRegistryEntry: t.procedure
			.input(runtimeNKleinModelRegistryRemoveRequestSchema)
			.output(runtimeNKleinModelRegistryRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.removeNKleinModelRegistryEntry(ctx.workspaceScope, input);
			}),
		pruneNKleinModelRegistry: t.procedure
			.output(runtimeNKleinModelRegistryPruneResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.runtimeApi.pruneNKleinModelRegistry(ctx.workspaceScope);
			}),
		saveNKleinModelContextWindowOverride: t.procedure
			.input(runtimeNKleinModelContextWindowOverrideRequestSchema)
			.output(runtimeNKleinModelContextWindowOverrideResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveNKleinModelContextWindowOverride(ctx.workspaceScope, input);
			}),
		saveNKleinModelMaxConcurrentRequests: t.procedure
			.input(runtimeNKleinModelMaxConcurrentRequestsRequestSchema)
			.output(runtimeNKleinModelMaxConcurrentRequestsResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveNKleinModelMaxConcurrentRequests(ctx.workspaceScope, input);
			}),
		getNKleinCodeIntelligenceStatus: t.procedure
			.output(runtimeNKleinCodeIntelligenceStatusResponseSchema)
			.query(async ({ ctx }) => {
				return await ctx.runtimeApi.getNKleinCodeIntelligenceStatus(ctx.workspaceScope);
			}),
		getKleinCorePyHealth: t.procedure.output(runtimeKleinCorePyHealthResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getKleinCorePyHealth();
		}),
		buildNKleinModelFreshnessAdvisor: t.procedure.output(runtimeNKleinAdvisorRequestSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.buildNKleinModelFreshnessAdvisor(ctx.workspaceScope);
		}),
		buildNKleinAdvisor: t.procedure
			.input(runtimeNKleinAdvisorBuildRequestSchema)
			.output(runtimeNKleinAdvisorRequestSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.buildNKleinAdvisor(ctx.workspaceScope, input);
			}),
		sendNKleinAdvisor: t.procedure
			.input(runtimeNKleinAdvisorSendRequestSchema)
			.output(runtimeNKleinAdvisorSendResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.sendNKleinAdvisor(ctx.workspaceScope, input);
			}),
		writeNKleinDogfoodBacklog: t.procedure
			.input(runtimeNKleinDogfoodBacklogRequestSchema)
			.output(runtimeNKleinDogfoodBacklogResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.writeNKleinDogfoodBacklog(ctx.workspaceScope, input);
			}),
		runNKleinSmokeEval: t.procedure.output(runtimeNKleinSmokeEvalResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.runNKleinSmokeEval(ctx.workspaceScope);
		}),
		collectTaskEvidence: t.procedure
			.input(runtimeTaskEvidenceRequestSchema)
			.output(runtimeTaskEvidenceResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.collectTaskEvidence(ctx.workspaceScope, input);
			}),
		getNKleinMcpAuthStatuses: t.procedure.output(runtimeNKleinMcpAuthStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getNKleinMcpAuthStatuses(ctx.workspaceScope);
		}),
		runNKleinMcpServerOAuth: t.procedure
			.input(runtimeNKleinMcpOAuthRequestSchema)
			.output(runtimeNKleinMcpOAuthResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runNKleinMcpServerOAuth(ctx.workspaceScope, input);
			}),
		getNKleinMcpSettings: t.procedure.output(runtimeNKleinMcpSettingsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getNKleinMcpSettings(ctx.workspaceScope);
		}),
		saveNKleinMcpSettings: t.procedure
			.input(runtimeNKleinMcpSettingsSaveRequestSchema)
			.output(runtimeNKleinMcpSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveNKleinMcpSettings(ctx.workspaceScope, input);
			}),
		runNKleinProviderOAuthLogin: t.procedure
			.input(runtimeNKleinOauthLoginRequestSchema)
			.output(runtimeNKleinOauthLoginResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runNKleinProviderOAuthLogin(ctx.workspaceScope, input);
			}),
		startNKleinDeviceAuth: t.procedure
			.output(runtimeNKleinDeviceAuthStartResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.runtimeApi.startNKleinDeviceAuth(ctx.workspaceScope);
			}),
		completeNKleinDeviceAuth: t.procedure
			.input(runtimeNKleinDeviceAuthCompleteRequestSchema)
			.output(runtimeNKleinDeviceAuthCompleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.completeNKleinDeviceAuth(ctx.workspaceScope, input);
			}),
		startShellSession: workspaceProcedure
			.input(runtimeShellSessionStartRequestSchema)
			.output(runtimeShellSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startShellSession(ctx.workspaceScope, input);
			}),
		runCommand: workspaceProcedure
			.input(runtimeCommandRunRequestSchema)
			.output(runtimeCommandRunResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runCommand(ctx.workspaceScope, input);
			}),
		resetAllState: t.procedure.output(runtimeDebugResetAllStateResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.resetAllState(ctx.workspaceScope);
		}),
		openFile: t.procedure
			.input(runtimeOpenFileRequestSchema)
			.output(runtimeOpenFileResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.openFile(input);
			}),
		getUpdateStatus: t.procedure.output(runtimeUpdateStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getUpdateStatus(ctx.workspaceScope);
		}),
		runUpdateNow: t.procedure.output(runtimeRunUpdateResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.runUpdateNow(ctx.workspaceScope);
		}),
	}),
	workspace: t.router({
		getGitSummary: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitSummaryResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitSummary(ctx.workspaceScope, input ?? null);
			}),
		runGitSyncAction: workspaceProcedure
			.input(gitSyncActionInputSchema)
			.output(runtimeGitSyncResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.runGitSyncAction(ctx.workspaceScope, input);
			}),
		checkoutGitBranch: workspaceProcedure
			.input(runtimeGitCheckoutRequestSchema)
			.output(runtimeGitCheckoutResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.checkoutGitBranch(ctx.workspaceScope, input);
			}),
		discardGitChanges: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitDiscardResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.discardGitChanges(ctx.workspaceScope, input ?? null);
			}),
		getChanges: workspaceProcedure
			.input(runtimeWorkspaceChangesRequestSchema)
			.output(runtimeWorkspaceChangesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadChanges(ctx.workspaceScope, input);
			}),
		deleteWorktree: workspaceProcedure
			.input(runtimeWorktreeDeleteRequestSchema)
			.output(runtimeWorktreeDeleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.deleteWorktree(ctx.workspaceScope, input);
			}),
		searchFiles: workspaceProcedure
			.input(runtimeWorkspaceFileSearchRequestSchema)
			.output(runtimeWorkspaceFileSearchResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.searchFiles(ctx.workspaceScope, input);
			}),
		getState: workspaceProcedure.output(runtimeWorkspaceStateResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadState(ctx.workspaceScope);
		}),
		notifyStateUpdated: workspaceProcedure
			.output(runtimeWorkspaceStateNotifyResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.workspaceApi.notifyStateUpdated(ctx.workspaceScope);
			}),
		saveState: workspaceProcedure
			.input(runtimeWorkspaceStateSaveRequestSchema)
			.output(runtimeWorkspaceStateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.saveState(ctx.workspaceScope, input);
			}),
		getWorkspaceChanges: workspaceProcedure.output(runtimeWorkspaceChangesResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadWorkspaceChanges(ctx.workspaceScope);
		}),
		getGitLog: workspaceProcedure
			.input(runtimeGitLogRequestSchema)
			.output(runtimeGitLogResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitLog(ctx.workspaceScope, input);
			}),
		getGitRefs: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitRefsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitRefs(ctx.workspaceScope, input ?? null);
			}),
		getCommitDiff: workspaceProcedure
			.input(runtimeGitCommitDiffRequestSchema)
			.output(runtimeGitCommitDiffResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadCommitDiff(ctx.workspaceScope, input);
			}),
	}),
	projects: t.router({
		list: t.procedure.output(runtimeProjectsResponseSchema).query(async ({ ctx }) => {
			return await ctx.projectsApi.listProjects(ctx.requestedWorkspaceId);
		}),
		add: t.procedure
			.input(runtimeProjectAddRequestSchema)
			.output(runtimeProjectAddResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.addProject(ctx.requestedWorkspaceId, input);
			}),
		createDevTestProject: t.procedure
			.input(runtimeDevTestProjectRequestSchema)
			.output(runtimeDevTestProjectResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.createDevTestProject(ctx.requestedWorkspaceId, input);
			}),
		createSelfImprovementProject: t.procedure
			.input(runtimeSelfImprovementProjectRequestSchema)
			.output(runtimeSelfImprovementProjectResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.createSelfImprovementProject(ctx.requestedWorkspaceId, input);
			}),
		cleanupDevTestProjects: t.procedure.output(runtimeDevTestCleanupResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.cleanupDevTestProjects(ctx.requestedWorkspaceId);
		}),
		remove: t.procedure
			.input(runtimeProjectRemoveRequestSchema)
			.output(runtimeProjectRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.removeProject(ctx.requestedWorkspaceId, input);
			}),
		migrateAccidentalProjectArtifacts: t.procedure
			.input(runtimeProjectArtifactMigrationRequestSchema)
			.output(runtimeProjectArtifactMigrationResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.migrateAccidentalProjectArtifacts(ctx.requestedWorkspaceId, input);
			}),
		pickDirectory: t.procedure.output(runtimeProjectDirectoryPickerResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.pickProjectDirectory(ctx.requestedWorkspaceId);
		}),
		listDirectoryContents: t.procedure
			.input(runtimeDirectoryListRequestSchema)
			.output(runtimeDirectoryListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.projectsApi.listDirectoryContents(ctx.requestedWorkspaceId, input);
			}),
	}),
});

export type RuntimeAppRouter = typeof runtimeAppRouter;
export type RuntimeAppRouterInputs = inferRouterInputs<RuntimeAppRouter>;
export type RuntimeAppRouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
