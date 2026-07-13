// The `runtime` tRPC sub-router (§5.AK app-router decomposition — the bulk). Extracted byte-for-byte from
// app-router.ts. Built from the shared `t` + `workspaceProcedure` (passed in; typed via type-only imports — no
// runtime cycle), so the router type composes identically.

import { taskEscalationReportRequestSchema, taskEscalationReportSchema } from "../../core/agent-attempt-ledger.js";
import {
	runtimeAnswerPlanQuestionRequestSchema,
	runtimeAnswerPlanQuestionResponseSchema,
	runtimeCardMailboxCountsRequestSchema,
	runtimeCardMailboxCountsResponseSchema,
	runtimeCommandRunResponseSchema,
	runtimeConfigResponseSchema,
	runtimeConfigSaveRequestSchema,
	runtimeDebugResetAllStateResponseSchema,
	runtimeEvaluateConnectedModelsResponseSchema,
	runtimeExpandNKleinPlanTaskRequestSchema,
	runtimeExpandNKleinPlanTaskResponseSchema,
	runtimeFeaturebaseTokenResponseSchema,
	runtimeFitnessTableResponseSchema,
	runtimeFleetStatusResponseSchema,
	runtimeFocusChainHistoryRequestSchema,
	runtimeFocusChainHistoryResponseSchema,
	runtimeKleinCorePyHealthResponseSchema,
	runtimeKnowledgeToolUsageStatsResponseSchema,
	runtimeListPlanQuestionsRequestSchema,
	runtimeListPlanQuestionsResponseSchema,
	runtimeLlmfitCatalogUpdateCheckResponseSchema,
	runtimeLlmfitCatalogUpdatePullResponseSchema,
	runtimeMergeHistoryResponseSchema,
	runtimeModelBehaviorProfilesResponseSchema,
	runtimeModelPerformanceStatsResponseSchema,
	runtimeModelVerdictBadgesResponseSchema,
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
	runtimeOpenWorkspaceInRequestSchema,
	runtimeProtectedTestApprovalGrantRequestSchema,
	runtimeProtectedTestApprovalGrantResponseSchema,
	runtimeRecordNKleinPlanGapRequestSchema,
	runtimeRecordNKleinPlanGapResponseSchema,
	runtimeRunUpdateResponseSchema,
	runtimeSetupPlanResponseSchema,
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
	runtimeTaskWorktreeMergeRequestSchema,
	runtimeTaskWorktreeMergeResponseSchema,
	runtimeUpdateStatusResponseSchema,
} from "../../core/api-contract";
import type { RuntimeTrpcBuilder, RuntimeWorkspaceProcedure } from "../app-router";

export function buildRuntimeRouter(t: RuntimeTrpcBuilder, workspaceProcedure: RuntimeWorkspaceProcedure) {
	return t.router({
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
		// §5.AA learned model behavior: per-model profile fold, read-only Settings telemetry (global store).
		getModelBehaviorProfiles: t.procedure
			.output(runtimeModelBehaviorProfilesResponseSchema)
			.query(async ({ ctx }) => ctx.runtimeApi.getModelBehaviorProfiles()),
		// §5.AL fitness browser: global fitness cells + failing-LLM projection (not workspace-scoped — the store is global).
		getFitnessTable: t.procedure
			.output(runtimeFitnessTableResponseSchema)
			.query(async ({ ctx }) => ctx.runtimeApi.getFitnessTable()),
		getModelVerdictBadges: t.procedure
			.output(runtimeModelVerdictBadgesResponseSchema)
			.query(async ({ ctx }) => ctx.runtimeApi.getModelVerdictBadges()),
		// §5.AX fleet-strip live status (machine names + warmth).
		getFleetStatus: workspaceProcedure.output(runtimeFleetStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getFleetStatus(ctx.workspaceScope);
		}),
		// W3.4 mailbox badge: pending mailbox-note counts for the board's cards.
		getCardMailboxCounts: t.procedure
			.input(runtimeCardMailboxCountsRequestSchema)
			.output(runtimeCardMailboxCountsResponseSchema)
			.query(async ({ ctx, input }) => ctx.runtimeApi.getCardMailboxCounts(input)),
		// §5.BA guided setup wizards.
		getGlobalSetupPlan: t.procedure.output(runtimeSetupPlanResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getGlobalSetupPlan();
		}),
		getProjectSetupPlan: workspaceProcedure.output(runtimeSetupPlanResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getProjectSetupPlan(ctx.workspaceScope);
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
		getTaskEscalation: workspaceProcedure
			.input(taskEscalationReportRequestSchema)
			.output(taskEscalationReportSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getTaskEscalation(ctx.workspaceScope, input);
			}),
		listNKleinPlanArtifacts: workspaceProcedure
			.input(runtimeNKleinPlanArtifactsRequestSchema)
			.output(runtimeNKleinPlanArtifactsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.listNKleinPlanArtifacts(ctx.workspaceScope, input);
			}),
		getTaskFocusChainHistory: workspaceProcedure
			.input(runtimeFocusChainHistoryRequestSchema)
			.output(runtimeFocusChainHistoryResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getTaskFocusChainHistory(ctx.workspaceScope, input);
			}),
		listNKleinPlanQuestions: workspaceProcedure
			.input(runtimeListPlanQuestionsRequestSchema)
			.output(runtimeListPlanQuestionsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.listNKleinPlanQuestions(ctx.workspaceScope, input);
			}),
		answerNKleinPlanQuestion: workspaceProcedure
			.input(runtimeAnswerPlanQuestionRequestSchema)
			.output(runtimeAnswerPlanQuestionResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.answerNKleinPlanQuestion(ctx.workspaceScope, input);
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
		recordNKleinPlanGap: workspaceProcedure
			.input(runtimeRecordNKleinPlanGapRequestSchema)
			.output(runtimeRecordNKleinPlanGapResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.recordNKleinPlanGap(ctx.workspaceScope, input);
			}),
		expandNKleinPlanTask: workspaceProcedure
			.input(runtimeExpandNKleinPlanTaskRequestSchema)
			.output(runtimeExpandNKleinPlanTaskResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.expandNKleinPlanTask(ctx.workspaceScope, input);
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
		checkLlmfitCatalogUpdate: t.procedure
			.output(runtimeLlmfitCatalogUpdateCheckResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.runtimeApi.checkLlmfitCatalogUpdate(ctx.workspaceScope);
			}),
		pullLlmfitCatalogUpdate: t.procedure
			.output(runtimeLlmfitCatalogUpdatePullResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.runtimeApi.pullLlmfitCatalogUpdate(ctx.workspaceScope);
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
		getMergeHistory: t.procedure.output(runtimeMergeHistoryResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getMergeHistory(ctx.workspaceScope);
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
		// §5.AB "Evaluate connected models" (todo 6544): eval every loaded model + persist fitness.
		evaluateConnectedModels: t.procedure
			.output(runtimeEvaluateConnectedModelsResponseSchema)
			.mutation(async ({ ctx }) => ctx.runtimeApi.evaluateConnectedModels()),
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
		openWorkspaceIn: workspaceProcedure
			.input(runtimeOpenWorkspaceInRequestSchema)
			.output(runtimeCommandRunResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.openWorkspaceIn(ctx.workspaceScope, input);
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
	});
}
