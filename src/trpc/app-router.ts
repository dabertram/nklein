// Defines the typed TRPC boundary between the browser and the local runtime.
// Keep request and response contracts plus workspace-scoped procedures here,
// and delegate domain behavior to runtime-api.ts and lower-level services.
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { initTRPC, TRPCError } from "@trpc/server";
import type { TaskEscalationReport, TaskEscalationReportRequest } from "../core/agent-attempt-ledger.js";
import type {
	RuntimeCardMailboxCountsRequest,
	RuntimeCardMailboxCountsResponse,
	RuntimeCommandRunRequest,
	RuntimeCommandRunResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeDevTestCleanupResponse,
	RuntimeDevTestProjectRegistryResponse,
	RuntimeDevTestProjectRequest,
	RuntimeDevTestProjectResponse,
	RuntimeDirectoryListRequest,
	RuntimeDirectoryListResponse,
	RuntimeExpandNKleinPlanTaskRequest,
	RuntimeExpandNKleinPlanTaskResponse,
	RuntimeFeaturebaseTokenResponse,
	RuntimeFitnessTableResponse,
	RuntimeFleetStatusResponse,
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
	RuntimeMergeHistoryResponse,
	RuntimeModelBehaviorProfilesResponse,
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
	RuntimeRecordNKleinPlanGapRequest,
	RuntimeRecordNKleinPlanGapResponse,
	RuntimeRunUpdateResponse,
	RuntimeSelfImprovementProjectRequest,
	RuntimeSelfImprovementProjectResponse,
	RuntimeSetupPlanResponse,
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
import type {
	RuntimeChatAutonomousRunStatus,
	RuntimeChatAutonomousStatusRequest,
	RuntimeChatBoardStreamsResponse,
	RuntimeChatCreateSessionRequest,
	RuntimeChatFocusChainResponse,
	RuntimeChatMessage,
	RuntimeChatSendMessageRequest,
	RuntimeChatSendMessageResponse,
	RuntimeChatSession,
	RuntimeChatStartAutonomousRequest,
	RuntimeChatStartAutonomousResponse,
	RuntimeChatUpdateSessionRequest,
} from "../core/chat-api-contract.js";
import { LEGACY_WORKSPACE_ID_HEADER, WORKSPACE_ID_HEADER } from "../core/workspace-scope";
import { buildChatRouter } from "./routers/chat-router";
import { buildProjectsRouter } from "./routers/projects-router";
import { buildRuntimeRouter } from "./routers/runtime-router";
import { buildWorkspaceRouter } from "./routers/workspace-router";

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
		/** §5.AL fitness browser: the global per-(model × role × difficulty) fitness cells + failing-LLM projection. */
		getFitnessTable: () => Promise<RuntimeFitnessTableResponse>;
		/** §5.AA learned model behavior: the per-model ModelBehaviorProfile fold, read-only for Settings telemetry. */
		getModelBehaviorProfiles: () => Promise<RuntimeModelBehaviorProfilesResponse>;
		/** §5.AX: per-model machine names + prompt-shell warmth for the board's fleet strip. */
		getFleetStatus: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeFleetStatusResponse>;
		/** W3.4 mailbox badge: pending mailbox-note counts for the given cards (non-zero entries only). */
		getCardMailboxCounts: (input: RuntimeCardMailboxCountsRequest) => Promise<RuntimeCardMailboxCountsResponse>;
		/** §5.BA: the resolved GLOBAL setup-wizard plan (gathered facts → steps) + completion stamp. */
		getGlobalSetupPlan: () => Promise<RuntimeSetupPlanResponse>;
		/** §5.BA: the resolved PROJECT setup-wizard plan for a workspace + completion stamp. */
		getProjectSetupPlan: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeSetupPlanResponse>;
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
		getTaskEscalation: (
			scope: RuntimeTrpcWorkspaceScope,
			input: TaskEscalationReportRequest,
		) => Promise<TaskEscalationReport>;
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
		recordNKleinPlanGap: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeRecordNKleinPlanGapRequest,
		) => Promise<RuntimeRecordNKleinPlanGapResponse>;
		expandNKleinPlanTask: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeExpandNKleinPlanTaskRequest,
		) => Promise<RuntimeExpandNKleinPlanTaskResponse>;
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
		getMergeHistory: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeMergeHistoryResponse>;
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
		// Board-independent unified chat (todo §5.M) — session management + transcript reads.
		listChatSessions: () => Promise<RuntimeChatSession[]>;
		getChatSession: (id: string) => Promise<RuntimeChatSession | null>;
		createChatSession: (input: RuntimeChatCreateSessionRequest) => Promise<RuntimeChatSession>;
		updateChatSession: (input: RuntimeChatUpdateSessionRequest) => Promise<RuntimeChatSession | null>;
		deleteChatSession: (id: string) => Promise<boolean>;
		readChatTranscript: (sessionId: string, limit?: number) => Promise<RuntimeChatMessage[]>;
		/** §5.BB: the session's live focus chain (the agent's plan checklist), or null when none drafted. */
		getChatFocusChain: (sessionId: string) => Promise<RuntimeChatFocusChainResponse>;
		getChatBoardStreams: () => Promise<RuntimeChatBoardStreamsResponse>;
		sendChatMessage: (
			input: RuntimeChatSendMessageRequest,
			onToken?: (delta: string) => void,
			/** W3.1 (server-side only): live tool start/end activity for the composer's chips. */
			onToolEvent?: (event: { phase: "start" | "end"; toolName: string }) => void,
		) => Promise<RuntimeChatSendMessageResponse>;
		startAutonomousChatRun: (input: RuntimeChatStartAutonomousRequest) => Promise<RuntimeChatStartAutonomousResponse>;
		getAutonomousChatRunStatus: (input: RuntimeChatAutonomousStatusRequest) => RuntimeChatAutonomousRunStatus;
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
		listDevTestProjects: () => Promise<RuntimeDevTestProjectRegistryResponse>;
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

/** The shared tRPC builder type — sub-router modules (§5.AK) take this so they build on the same `t`/context. */
export type RuntimeTrpcBuilder = typeof t;

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

/** The workspace-scoped procedure type — sub-router modules (§5.AK) take this to build workspace endpoints. */
export type RuntimeWorkspaceProcedure = typeof workspaceProcedure;

export const runtimeAppRouter = t.router({
	runtime: buildRuntimeRouter(t, workspaceProcedure),
	// Board-independent unified chat (todo §5.M). Non-workspace procedures: chat sessions are not tied to a board.
	chat: buildChatRouter(t),
	workspace: buildWorkspaceRouter(t, workspaceProcedure),
	projects: buildProjectsRouter(t),
});

export type RuntimeAppRouter = typeof runtimeAppRouter;
export type RuntimeAppRouterInputs = inferRouterInputs<RuntimeAppRouter>;
export type RuntimeAppRouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
