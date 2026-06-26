import { z } from "zod";
import { ACCEPTANCE_FAILURE_CATEGORIES } from "./acceptance-failure-taxonomy.js";
import { planGapKindSchema } from "./plan-gap-kind.js";

export type { PlanGapKind } from "./plan-gap-kind.js";

// Board schemas the barrel's downstream schemas still reference directly (re-exported above via `export *`).
import { runtimeTaskImageSchema } from "./board-api-contract.js";
import { runtimeNKleinProviderSettingsSchema } from "./nklein-provider-api-contract.js";
import { runtimeProjectShortcutSchema, runtimeTaskWorkspaceInfoRequestSchema } from "./projects-api-contract.js";
// Config primitives the schemas below still reference directly (re-exported above via `export *`).
import {
	agentRulesetsConfigSchema,
	runtimeAgentIdSchema,
	runtimeAgentTimeoutModeSchema,
	runtimeAgentTimeoutProfileSchema,
	runtimeCodeEmbeddingSettingsSchema,
	runtimeLostHeartbeatPolicySchema,
	runtimeModelRolesSchema,
	runtimeNKleinReasoningEffortSchema,
	runtimeSwarmGuardrailsSchema,
	runtimeTaskNKleinSettingsSchema,
	runtimeTimeoutMsSchema,
} from "./runtime-config-api-contract.js";
import {
	runtimeModelPerformanceRoleSchema,
	runtimeTaskSessionModeSchema,
	runtimeTaskSessionSummarySchema,
} from "./task-session-api-contract.js";
import {
	runtimeProjectSummarySchema,
	runtimeWorkspaceMetadataSchema,
	runtimeWorkspaceStateResponseSchema,
} from "./workspace-projects-api-contract.js";

// Board contract domain (task images, generated-from-plan, card review, focus chains, cards/columns/deps/data) (§5.X #2).
export * from "./board-api-contract.js";
// Board-independent unified chat (todo §5.M) lives in its own contract module; re-exported here so the single
// `@runtime-contract` alias (and `@/runtime/types` in the web-ui) surfaces the chat wire types too.
export * from "./chat-api-contract.js";
// Git sync contract domain (repo info, fetch/pull/push sync, checkout, discard) (§5.X #2).
export * from "./git-sync-api-contract.js";
// NKlein misc-ops domain (core-py health, merge history, advisor, dogfood, smoke-eval, task-evidence) (§5.X #2).
export * from "./nklein-ops-api-contract.js";
// NKlein account/provider/model-registry domain (oauth/provider-settings/account/catalog/models/registry/code-intel) (§5.X #2).
export * from "./nklein-provider-api-contract.js";
// NKlein provider-mutation + auth domain (capability, add/update provider, oauth-login, device-auth, settings-save) (§5.X #2).
export * from "./nklein-provider-mutations-api-contract.js";
// Projects + dev-test contract domain (projects/dev-test/directory/remove/migration/worktree/task-scope/shortcuts) (§5.X #2).
export * from "./projects-api-contract.js";
// Runtime/agent configuration primitives (core enums, NKlein/swarm settings, model-roles, agent rulesets) (§5.X #2).
export * from "./runtime-config-api-contract.js";
// Task-session contract domain (state/mode/usage/context-budget/model-perf-role/summary, hook activity) (§5.X #2).
export * from "./task-session-api-contract.js";
// Telemetry stats contract domain (model-performance + knowledge-tool-usage stats) (§5.X #2).
export * from "./telemetry-stats-api-contract.js";
// Workspace file-operation contracts (status / change / changes / fuzzy search) live in their own module (§5.X #2).
export * from "./workspace-files-api-contract.js";
// Workspace + project state contract domain (workspace-state, projects, task/workspace metadata) (§5.X #2).
export * from "./workspace-projects-api-contract.js";

export const runtimeSlashCommandSchema = z.object({
	name: z.string(),
	instructions: z.string(),
	description: z.string().optional(),
});
export type RuntimeSlashCommand = z.infer<typeof runtimeSlashCommandSchema>;

export const runtimeSlashCommandsResponseSchema = z.object({
	commands: z.array(runtimeSlashCommandSchema),
});
export type RuntimeSlashCommandsResponse = z.infer<typeof runtimeSlashCommandsResponseSchema>;

export { ACCEPTANCE_FAILURE_LABELS, acceptanceFailureCategoryLabel } from "./acceptance-failure-taxonomy.js";
// Re-export the ruleset value helpers so the web-ui (which reaches this module via the @runtime-contract alias)
// can render tier pickers without importing the runtime core directly.
export {
	AGENT_CAPABILITY_TIER_INFO,
	AGENT_DELIVERY_TIER_INFO,
	AGENT_RULESET_ROLES,
	DEFAULT_AGENT_RULESETS_CONFIG,
} from "./agent-rulesets.js";

export const runtimeNKleinMcpServerAuthStatusSchema = z.object({
	serverName: z.string(),
	oauthSupported: z.boolean(),
	oauthConfigured: z.boolean(),
	lastError: z.string().nullable(),
	lastAuthenticatedAt: z.number().nullable(),
});
export type RuntimeNKleinMcpServerAuthStatus = z.infer<typeof runtimeNKleinMcpServerAuthStatusSchema>;

export const runtimeNKleinTeamProgressEventSchema = z.object({
	taskId: z.string(),
	teamName: z.string().nullable(),
	eventType: z.string(),
	agentId: z.string().nullable(),
	role: z.string().nullable(),
	runId: z.string().nullable(),
	status: z.string().nullable(),
	message: z.string(),
	createdAt: z.number(),
});
export type RuntimeNKleinTeamProgressEvent = z.infer<typeof runtimeNKleinTeamProgressEventSchema>;

export const runtimeStateStreamSnapshotMessageSchema = z.object({
	type: z.literal("snapshot"),
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
	workspaceState: runtimeWorkspaceStateResponseSchema.nullable(),
	workspaceMetadata: runtimeWorkspaceMetadataSchema.nullable(),
	nkleinSessionContextVersion: z.number().int().nonnegative(),
});
export type RuntimeStateStreamSnapshotMessage = z.infer<typeof runtimeStateStreamSnapshotMessageSchema>;

export const runtimeStateStreamWorkspaceStateMessageSchema = z.object({
	type: z.literal("workspace_state_updated"),
	workspaceId: z.string(),
	workspaceState: runtimeWorkspaceStateResponseSchema,
});
export type RuntimeStateStreamWorkspaceStateMessage = z.infer<typeof runtimeStateStreamWorkspaceStateMessageSchema>;

export const runtimeStateStreamTaskSessionsMessageSchema = z.object({
	type: z.literal("task_sessions_updated"),
	workspaceId: z.string(),
	summaries: z.array(runtimeTaskSessionSummarySchema),
});
export type RuntimeStateStreamTaskSessionsMessage = z.infer<typeof runtimeStateStreamTaskSessionsMessageSchema>;

export const runtimeStateStreamProjectsMessageSchema = z.object({
	type: z.literal("projects_updated"),
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
});
export type RuntimeStateStreamProjectsMessage = z.infer<typeof runtimeStateStreamProjectsMessageSchema>;

export const runtimeStateStreamWorkspaceMetadataMessageSchema = z.object({
	type: z.literal("workspace_metadata_updated"),
	workspaceId: z.string(),
	workspaceMetadata: runtimeWorkspaceMetadataSchema,
});
export type RuntimeStateStreamWorkspaceMetadataMessage = z.infer<
	typeof runtimeStateStreamWorkspaceMetadataMessageSchema
>;

export const runtimeStateStreamTaskReadyForReviewMessageSchema = z.object({
	type: z.literal("task_ready_for_review"),
	workspaceId: z.string(),
	taskId: z.string(),
	triggeredAt: z.number(),
});
export type RuntimeStateStreamTaskReadyForReviewMessage = z.infer<
	typeof runtimeStateStreamTaskReadyForReviewMessageSchema
>;

export const runtimeStateStreamTaskChatMessageSchema = z.object({
	type: z.literal("task_chat_message"),
	workspaceId: z.string(),
	taskId: z.string(),
	message: z.lazy(() => runtimeTaskChatMessageSchema),
});
export type RuntimeStateStreamTaskChatMessage = z.infer<typeof runtimeStateStreamTaskChatMessageSchema>;

export const runtimeStateStreamTaskChatClearedMessageSchema = z.object({
	type: z.literal("task_chat_cleared"),
	workspaceId: z.string(),
	taskId: z.string(),
});
export type RuntimeStateStreamTaskChatClearedMessage = z.infer<typeof runtimeStateStreamTaskChatClearedMessageSchema>;

export const runtimeStateStreamNKleinTeamProgressMessageSchema = z.object({
	type: z.literal("nklein_team_progress"),
	workspaceId: z.string(),
	taskId: z.string(),
	event: runtimeNKleinTeamProgressEventSchema,
});
export type RuntimeStateStreamNKleinTeamProgressMessage = z.infer<
	typeof runtimeStateStreamNKleinTeamProgressMessageSchema
>;

export const runtimeStateStreamMcpAuthUpdatedMessageSchema = z.object({
	type: z.literal("mcp_auth_updated"),
	statuses: z.array(runtimeNKleinMcpServerAuthStatusSchema),
});
export type RuntimeStateStreamMcpAuthUpdatedMessage = z.infer<typeof runtimeStateStreamMcpAuthUpdatedMessageSchema>;

export const runtimeStateStreamNKleinSessionContextUpdatedMessageSchema = z.object({
	type: z.literal("nklein_session_context_updated"),
	version: z.number().int().nonnegative(),
});
export type RuntimeStateStreamNKleinSessionContextUpdatedMessage = z.infer<
	typeof runtimeStateStreamNKleinSessionContextUpdatedMessageSchema
>;

export const runtimeStateStreamErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type RuntimeStateStreamErrorMessage = z.infer<typeof runtimeStateStreamErrorMessageSchema>;

export const runtimeStateStreamMessageSchema = z.discriminatedUnion("type", [
	runtimeStateStreamSnapshotMessageSchema,
	runtimeStateStreamWorkspaceStateMessageSchema,
	runtimeStateStreamTaskSessionsMessageSchema,
	runtimeStateStreamProjectsMessageSchema,
	runtimeStateStreamWorkspaceMetadataMessageSchema,
	runtimeStateStreamTaskReadyForReviewMessageSchema,
	runtimeStateStreamTaskChatMessageSchema,
	runtimeStateStreamTaskChatClearedMessageSchema,
	runtimeStateStreamNKleinTeamProgressMessageSchema,
	runtimeStateStreamMcpAuthUpdatedMessageSchema,
	runtimeStateStreamNKleinSessionContextUpdatedMessageSchema,
	runtimeStateStreamErrorMessageSchema,
]);
export type RuntimeStateStreamMessage = z.infer<typeof runtimeStateStreamMessageSchema>;

const runtimeNKleinMcpServerBaseSchema = z.object({
	name: z.string(),
	disabled: z.boolean(),
});

export const runtimeNKleinMcpServerSchema = z.discriminatedUnion("type", [
	runtimeNKleinMcpServerBaseSchema.extend({
		type: z.literal("stdio"),
		command: z.string(),
		args: z.array(z.string()).optional(),
		cwd: z.string().optional(),
		env: z.record(z.string(), z.string()).optional(),
	}),
	runtimeNKleinMcpServerBaseSchema.extend({
		type: z.literal("sse"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
	runtimeNKleinMcpServerBaseSchema.extend({
		type: z.literal("streamableHttp"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()).optional(),
	}),
]);
export type RuntimeNKleinMcpServer = z.infer<typeof runtimeNKleinMcpServerSchema>;

export const runtimeNKleinMcpSettingsResponseSchema = z.object({
	path: z.string(),
	servers: z.array(runtimeNKleinMcpServerSchema),
});
export type RuntimeNKleinMcpSettingsResponse = z.infer<typeof runtimeNKleinMcpSettingsResponseSchema>;

export const runtimeNKleinMcpSettingsSaveRequestSchema = z.object({
	servers: z.array(runtimeNKleinMcpServerSchema),
});
export type RuntimeNKleinMcpSettingsSaveRequest = z.infer<typeof runtimeNKleinMcpSettingsSaveRequestSchema>;

export const runtimeNKleinMcpSettingsSaveResponseSchema = runtimeNKleinMcpSettingsResponseSchema;
export type RuntimeNKleinMcpSettingsSaveResponse = z.infer<typeof runtimeNKleinMcpSettingsSaveResponseSchema>;

export const runtimeNKleinMcpAuthStatusResponseSchema = z.object({
	statuses: z.array(runtimeNKleinMcpServerAuthStatusSchema),
});
export type RuntimeNKleinMcpAuthStatusResponse = z.infer<typeof runtimeNKleinMcpAuthStatusResponseSchema>;

export const runtimeNKleinMcpOAuthRequestSchema = z.object({
	serverName: z.string(),
});
export type RuntimeNKleinMcpOAuthRequest = z.infer<typeof runtimeNKleinMcpOAuthRequestSchema>;

export const runtimeNKleinMcpOAuthResponseSchema = z.object({
	serverName: z.string(),
	authorized: z.literal(true),
	message: z.string(),
});
export type RuntimeNKleinMcpOAuthResponse = z.infer<typeof runtimeNKleinMcpOAuthResponseSchema>;

export const runtimeCommandRunRequestSchema = z.object({
	command: z.string(),
});
export type RuntimeCommandRunRequest = z.infer<typeof runtimeCommandRunRequestSchema>;

export const runtimeCommandRunResponseSchema = z.object({
	exitCode: z.number(),
	stdout: z.string(),
	stderr: z.string(),
	combinedOutput: z.string(),
	durationMs: z.number(),
});
export type RuntimeCommandRunResponse = z.infer<typeof runtimeCommandRunResponseSchema>;

export const runtimeTaskContextImportSourceSchema = z.enum(["github_issue", "github_pr_diff"]);
export type RuntimeTaskContextImportSource = z.infer<typeof runtimeTaskContextImportSourceSchema>;

export const runtimeTaskContextImportRequestSchema = z.object({
	source: runtimeTaskContextImportSourceSchema,
	target: z.string(),
});
export type RuntimeTaskContextImportRequest = z.infer<typeof runtimeTaskContextImportRequestSchema>;

export const runtimeTaskContextImportResponseSchema = z.object({
	ok: z.boolean(),
	sourceLabel: z.string().nullable(),
	title: z.string().nullable().optional(),
	content: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskContextImportResponse = z.infer<typeof runtimeTaskContextImportResponseSchema>;

export const runtimeOpenFileRequestSchema = z.object({
	filePath: z.string(),
});
export type RuntimeOpenFileRequest = z.infer<typeof runtimeOpenFileRequestSchema>;

export const runtimeOpenFileResponseSchema = z.object({
	ok: z.boolean(),
});
export type RuntimeOpenFileResponse = z.infer<typeof runtimeOpenFileResponseSchema>;

export const runtimeDebugResetAllStateResponseSchema = z.object({
	ok: z.boolean(),
	clearedPaths: z.array(z.string()),
});
export type RuntimeDebugResetAllStateResponse = z.infer<typeof runtimeDebugResetAllStateResponseSchema>;

export const runtimeUpdateStatusResponseSchema = z.object({
	currentVersion: z.string(),
	latestVersion: z.string().nullable(),
	updateAvailable: z.boolean(),
	updateTiming: z.enum(["startup", "shutdown"]).nullable(),
	installCommand: z.string().nullable(),
});
export type RuntimeUpdateStatusResponse = z.infer<typeof runtimeUpdateStatusResponseSchema>;

export const runtimeRunUpdateResponseSchema = z.object({
	status: z.enum([
		"updated",
		"already_up_to_date",
		"cache_refreshed",
		"unsupported_installation",
		"check_failed",
		"update_failed",
	]),
	currentVersion: z.string(),
	latestVersion: z.string().nullable(),
	message: z.string(),
});
export type RuntimeRunUpdateResponse = z.infer<typeof runtimeRunUpdateResponseSchema>;

export const runtimeAgentDefinitionSchema = z.object({
	id: runtimeAgentIdSchema,
	label: z.string(),
	binary: z.string(),
	command: z.string(),
	defaultArgs: z.array(z.string()),
	installed: z.boolean(),
	configured: z.boolean(),
});
export type RuntimeAgentDefinition = z.infer<typeof runtimeAgentDefinitionSchema>;

export const runtimeAgentSandboxStatusSchema = z.object({
	state: z.enum(["checking", "ready", "blocked"]),
	dockerAvailable: z.boolean().nullable(),
	imageAvailable: z.boolean().nullable(),
	image: z.string(),
	message: z.string().nullable(),
	checkedAt: z.number().nullable(),
});
export type RuntimeAgentSandboxStatus = z.infer<typeof runtimeAgentSandboxStatusSchema>;

export const runtimeConfigResponseSchema = z.object({
	selectedAgentId: runtimeAgentIdSchema,
	selectedShortcutLabel: z.string().nullable(),
	// §5.W: user-configured base directory for workspaces !Klein creates; null → home default.
	workspaceBaseDir: z.string().nullable(),
	cloudProviderSupportEnabled: z.boolean().optional(),
	agentAutonomousModeEnabled: z.boolean(),
	agentTimeoutMode: runtimeAgentTimeoutModeSchema,
	agentTimeoutProfile: runtimeAgentTimeoutProfileSchema,
	requestTimeoutMs: runtimeTimeoutMsSchema,
	streamTimeoutMs: runtimeTimeoutMsSchema,
	toolTimeoutMs: runtimeTimeoutMsSchema,
	agentTimeoutMs: runtimeTimeoutMsSchema,
	conversationTimeoutMs: runtimeTimeoutMsSchema,
	maxAgentWritableFileLines: z.number().int().positive(),
	maxConcurrentTasks: z.number().int().positive(),
	maxConcurrentTasksOverride: z.number().int().positive().nullable(),
	effectiveMaxConcurrentTasks: z.number().int().positive(),
	selectedAgentIdOverride: runtimeAgentIdSchema.nullable(),
	effectiveSelectedAgentId: runtimeAgentIdSchema,
	sandboxMaxContainers: z.number().int().positive(),
	sandboxAgentsPerContainer: z.number().int().nonnegative(),
	sandboxMemoryPerContainerMb: z.number().int().positive(),
	sandboxCpusPerContainer: z.number().positive(),
	sandboxIdleTimeoutMinutes: z.number().int().positive(),
	lostHeartbeatPolicy: runtimeLostHeartbeatPolicySchema,
	decompositionAutoApplyEnabled: z.boolean(),
	secondOpinionReviewEnabled: z.boolean(),
	reviewMaxRounds: z.number().int().positive(),
	codeEmbeddingDefaults: runtimeCodeEmbeddingSettingsSchema,
	codeEmbeddingOverride: runtimeCodeEmbeddingSettingsSchema.nullable(),
	effectiveCodeEmbeddingSettings: runtimeCodeEmbeddingSettingsSchema,
	developerModeEnabled: z.boolean().optional(),
	replayCardsEnabled: z.boolean().optional(),
	effectiveCommand: z.string().nullable(),
	globalConfigPath: z.string(),
	projectConfigPath: z.string().nullable(),
	readyForReviewNotificationsEnabled: z.boolean(),
	detectedCommands: z.array(z.string()),
	agents: z.array(runtimeAgentDefinitionSchema),
	agentSandboxStatus: runtimeAgentSandboxStatusSchema,
	shortcuts: z.array(runtimeProjectShortcutSchema),
	nkleinProviderSettings: runtimeNKleinProviderSettingsSchema,
	modelRoles: runtimeModelRolesSchema,
	modelRolesOverride: runtimeModelRolesSchema.nullable().optional(),
	effectiveModelRoles: runtimeModelRolesSchema.optional(),
	// Optional during rollout: the runtime omits it until the config loader populates it (consumers default to
	// DEFAULT_AGENT_RULESETS_CONFIG). See src/core/agent-rulesets.ts.
	agentRulesets: agentRulesetsConfigSchema.optional(),
	agentRulesetsOverride: agentRulesetsConfigSchema.nullable().optional(),
	effectiveAgentRulesets: agentRulesetsConfigSchema.optional(),
	swarmGuardrails: runtimeSwarmGuardrailsSchema,
	commitPromptTemplate: z.string(),
	openPrPromptTemplate: z.string(),
	commitPromptTemplateDefault: z.string(),
	openPrPromptTemplateDefault: z.string(),
});
export type RuntimeConfigResponse = z.infer<typeof runtimeConfigResponseSchema>;

export const runtimeConfigSaveRequestSchema = z.object({
	selectedAgentId: runtimeAgentIdSchema.optional(),
	selectedShortcutLabel: z.string().nullable().optional(),
	workspaceBaseDir: z.string().nullable().optional(),
	developerModeEnabled: z.boolean().optional(),
	replayCardsEnabled: z.boolean().optional(),
	agentAutonomousModeEnabled: z.boolean().optional(),
	agentTimeoutMode: runtimeAgentTimeoutModeSchema.optional(),
	agentTimeoutProfile: runtimeAgentTimeoutProfileSchema.optional(),
	requestTimeoutMs: runtimeTimeoutMsSchema.optional(),
	streamTimeoutMs: runtimeTimeoutMsSchema.optional(),
	toolTimeoutMs: runtimeTimeoutMsSchema.optional(),
	agentTimeoutMs: runtimeTimeoutMsSchema.optional(),
	conversationTimeoutMs: runtimeTimeoutMsSchema.optional(),
	maxAgentWritableFileLines: z.number().int().positive().optional(),
	maxConcurrentTasks: z.number().int().positive().optional(),
	maxConcurrentTasksOverride: z.number().int().positive().nullable().optional(),
	selectedAgentIdOverride: runtimeAgentIdSchema.nullable().optional(),
	sandboxMaxContainers: z.number().int().positive().optional(),
	sandboxAgentsPerContainer: z.number().int().nonnegative().optional(),
	sandboxMemoryPerContainerMb: z.number().int().positive().optional(),
	sandboxCpusPerContainer: z.number().positive().optional(),
	sandboxIdleTimeoutMinutes: z.number().int().positive().optional(),
	lostHeartbeatPolicy: runtimeLostHeartbeatPolicySchema.optional(),
	decompositionAutoApplyEnabled: z.boolean().optional(),
	secondOpinionReviewEnabled: z.boolean().optional(),
	reviewMaxRounds: z.number().int().positive().optional(),
	codeEmbeddingDefaults: runtimeCodeEmbeddingSettingsSchema.optional(),
	codeEmbeddingOverride: runtimeCodeEmbeddingSettingsSchema.nullable().optional(),
	shortcuts: z.array(runtimeProjectShortcutSchema).optional(),
	modelRoles: runtimeModelRolesSchema.optional(),
	modelRolesOverride: runtimeModelRolesSchema.nullable().optional(),
	agentRulesets: agentRulesetsConfigSchema.optional(),
	agentRulesetsOverride: agentRulesetsConfigSchema.nullable().optional(),
	swarmGuardrails: runtimeSwarmGuardrailsSchema.optional(),
	readyForReviewNotificationsEnabled: z.boolean().optional(),
	commitPromptTemplate: z.string().optional(),
	openPrPromptTemplate: z.string().optional(),
});
export type RuntimeConfigSaveRequest = z.infer<typeof runtimeConfigSaveRequestSchema>;

export const runtimeNKleinPlanArtifactSummarySchema = z.object({
	artifactId: z.string(),
	artifactKind: z.enum(["decomposition", "buildout", "spec"]),
	planSlug: z.string(),
	title: z.string(),
	sourceTaskId: z.string().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	validationStatus: z.enum(["valid", "invalid", "pending"]),
	applicationStatus: z.enum(["pending", "applied", "rejected"]),
	taskCount: z.number().int().nonnegative(),
	dependencyCount: z.number().int().nonnegative(),
	specPath: z.string(),
	planPath: z.string(),
	summaryPath: z.string(),
	taskGraphPath: z.string(),
});
export type RuntimeNKleinPlanArtifactSummary = z.infer<typeof runtimeNKleinPlanArtifactSummarySchema>;

export const runtimeNKleinPlanArtifactsRequestSchema = z.object({
	taskId: z.string().min(1),
});
export type RuntimeNKleinPlanArtifactsRequest = z.infer<typeof runtimeNKleinPlanArtifactsRequestSchema>;

export const runtimeNKleinPlanArtifactsResponseSchema = z.object({
	artifacts: z.array(runtimeNKleinPlanArtifactSummarySchema),
});
export type RuntimeNKleinPlanArtifactsResponse = z.infer<typeof runtimeNKleinPlanArtifactsResponseSchema>;

export const runtimeNKleinPlanArtifactActionRequestSchema = z.object({
	artifactId: z.string().min(1),
});
export type RuntimeNKleinPlanArtifactActionRequest = z.infer<typeof runtimeNKleinPlanArtifactActionRequestSchema>;

export const runtimeNKleinPlanArtifactApplyResponseSchema = z.object({
	ok: z.boolean(),
	artifact: runtimeNKleinPlanArtifactSummarySchema,
	createdTaskCount: z.number().int().nonnegative(),
	createdDependencyCount: z.number().int().nonnegative(),
	message: z.string(),
	workspaceState: runtimeWorkspaceStateResponseSchema,
});
export type RuntimeNKleinPlanArtifactApplyResponse = z.infer<typeof runtimeNKleinPlanArtifactApplyResponseSchema>;

export const runtimeNKleinPlanArtifactRejectResponseSchema = z.object({
	ok: z.boolean(),
	artifact: runtimeNKleinPlanArtifactSummarySchema,
	message: z.string(),
});
export type RuntimeNKleinPlanArtifactRejectResponse = z.infer<typeof runtimeNKleinPlanArtifactRejectResponseSchema>;

export const runtimeRecordNKleinPlanGapRequestSchema = z.object({
	taskId: z.string().min(1),
	kind: planGapKindSchema,
	description: z.string().min(1),
	evidence: z.string().optional(),
});
export type RuntimeRecordNKleinPlanGapRequest = z.infer<typeof runtimeRecordNKleinPlanGapRequestSchema>;

export const runtimeRecordNKleinPlanGapResponseSchema = z.object({
	ok: z.boolean(),
	taskId: z.string(),
	kind: planGapKindSchema,
	message: z.string(),
	workspaceState: runtimeWorkspaceStateResponseSchema.optional(),
});
export type RuntimeRecordNKleinPlanGapResponse = z.infer<typeof runtimeRecordNKleinPlanGapResponseSchema>;

// ---------------------------------------------------------------------------
// expand-plan-task — split one plan task into replacement tasks (web-ui path 2b:
// user-authored replacements; agent-discovery can layer on later once the model
// writes proposed replacements as a discoverable artifact type).
// ---------------------------------------------------------------------------

export const runtimeExpandNKleinPlanTaskItemSchema = z.object({
	id: z.string().min(1),
	title: z.string().min(1),
	prompt: z.string().min(1),
	dependsOn: z.array(z.string()).default([]),
	complexity: z.number().min(0).max(100).default(50),
	/** Shell command used to verify the task is done (required by the plan validator). */
	acceptanceCommand: z.string().min(1),
});
export type RuntimeExpandNKleinPlanTaskItem = z.infer<typeof runtimeExpandNKleinPlanTaskItemSchema>;

export const runtimeExpandNKleinPlanTaskRequestSchema = z.object({
	/** The board task ID whose plan task to replace. */
	taskId: z.string().min(1),
	/**
	 * The plan slug that contains the task. When omitted the server infers it
	 * from the taskId using the same heuristic as recordNKleinPlanGap.
	 */
	planSlug: z.string().optional(),
	/** The plan-task ID inside the task graph to replace (defaults to inferred from taskId). */
	planTaskId: z.string().optional(),
	/** The replacement tasks that will replace the target plan task. At least one required. */
	replacements: z.array(runtimeExpandNKleinPlanTaskItemSchema).min(1),
	/** Optional human-readable rationale written to the plan revisions log. */
	description: z.string().optional(),
});
export type RuntimeExpandNKleinPlanTaskRequest = z.infer<typeof runtimeExpandNKleinPlanTaskRequestSchema>;

export const runtimeExpandNKleinPlanTaskResponseSchema = z.object({
	ok: z.boolean(),
	taskId: z.string(),
	planSlug: z.string(),
	planTaskId: z.string(),
	replacementTaskIds: z.array(z.string()),
	entryTaskIds: z.array(z.string()),
	terminalTaskIds: z.array(z.string()),
	taskGraphPath: z.string(),
	revisionsPath: z.string(),
	message: z.string(),
});
export type RuntimeExpandNKleinPlanTaskResponse = z.infer<typeof runtimeExpandNKleinPlanTaskResponseSchema>;

export const runtimeTaskAcceptanceVerifyRequestSchema = z.object({
	taskId: z.string().min(1),
	ensureWorktree: z.boolean().optional(),
	timeoutMs: z.number().int().positive().optional(),
});
export type RuntimeTaskAcceptanceVerifyRequest = z.infer<typeof runtimeTaskAcceptanceVerifyRequestSchema>;

export const runtimeTaskAcceptanceResultSchema = z.object({
	present: z.boolean(),
	command: z.string().nullable(),
	passed: z.boolean().nullable(),
	exitCode: z.number().nullable(),
	output: z.string(),
	durationMs: z.number().int().nonnegative(),
	failureCategory: z.enum(ACCEPTANCE_FAILURE_CATEGORIES).nullable().default(null),
	failureHint: z.string().nullable().default(null),
});
export type RuntimeTaskAcceptanceResult = z.infer<typeof runtimeTaskAcceptanceResultSchema>;

export const runtimeTaskAcceptanceVerifyResponseSchema = z.object({
	ok: z.boolean(),
	taskId: z.string(),
	taskWorkspacePath: z.string().nullable(),
	acceptance: runtimeTaskAcceptanceResultSchema,
	message: z.string(),
});
export type RuntimeTaskAcceptanceVerifyResponse = z.infer<typeof runtimeTaskAcceptanceVerifyResponseSchema>;

export const runtimeTaskWorktreeMergeRequestSchema = z.object({
	taskId: z.string().min(1).optional(),
	column: z.enum(["review", "completed"]).default("review"),
});
export type RuntimeTaskWorktreeMergeRequest = z.infer<typeof runtimeTaskWorktreeMergeRequestSchema>;

const runtimeTaskWorktreeMergeSuccessStepSchema = z.object({
	type: z.enum(["merged", "skipped"]),
	taskId: z.string(),
	headCommit: z.string(),
	reason: z.string(),
});
const runtimeTaskWorktreeMergeConflictStepSchema = z.object({
	type: z.literal("conflict"),
	taskId: z.string(),
	headCommit: z.string(),
	conflictedPaths: z.array(z.string()),
	message: z.string(),
});
const runtimeTaskWorktreeMergeBlockedStepSchema = z.object({
	type: z.literal("blocked"),
	taskId: z.string().nullable(),
	reason: z.string(),
});
export const runtimeTaskWorktreeMergeStepSchema = z.discriminatedUnion("type", [
	runtimeTaskWorktreeMergeSuccessStepSchema,
	runtimeTaskWorktreeMergeConflictStepSchema,
	runtimeTaskWorktreeMergeBlockedStepSchema,
]);
export type RuntimeTaskWorktreeMergeStep = z.infer<typeof runtimeTaskWorktreeMergeStepSchema>;

export const runtimeTaskWorktreeMergeResponseSchema = z.object({
	ok: z.boolean(),
	column: z.enum(["review", "completed"]),
	mergedTaskIds: z.array(z.string()),
	skippedTaskIds: z.array(z.string()),
	steps: z.array(runtimeTaskWorktreeMergeStepSchema),
	conflict: runtimeTaskWorktreeMergeConflictStepSchema.nullable(),
	blocked: runtimeTaskWorktreeMergeBlockedStepSchema.nullable(),
	message: z.string(),
});
export type RuntimeTaskWorktreeMergeResponse = z.infer<typeof runtimeTaskWorktreeMergeResponseSchema>;

export const runtimeTaskSessionStartRequestSchema = z.object({
	taskId: z.string(),
	prompt: z.string(),
	/** Display title from the !Klein task card. Propagated to SDK session metadata as a convenience copy. */
	taskTitle: z.string().optional(),
	images: z.array(runtimeTaskImageSchema).optional(),
	filesLikelyTouched: z.array(z.string()).optional(),
	startInPlanMode: z.boolean().optional(),
	mode: runtimeTaskSessionModeSchema.optional(),
	resumeFromTrash: z.boolean().optional(),
	baseRef: z.string(),
	cols: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
	agentId: runtimeAgentIdSchema.optional(),
	nkleinSettings: runtimeTaskNKleinSettingsSchema.optional(),
	queueOnEndpointBusy: z.boolean().optional(),
});
export type RuntimeTaskSessionStartRequest = z.infer<typeof runtimeTaskSessionStartRequestSchema>;

export const runtimeTaskSessionStartResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
	errorCode: z
		.enum([
			"needs_decomposition",
			"routing_escalation",
			"cloud_provider_disabled",
			"endpoint_busy",
			"swarm_stopped",
			"agent_sandbox_unavailable",
		])
		.optional(),
	retryAfterMs: z.number().int().nonnegative().nullable().optional(),
	queued: z.boolean().optional(),
});
export type RuntimeTaskSessionStartResponse = z.infer<typeof runtimeTaskSessionStartResponseSchema>;

export const runtimeTaskSessionStopRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskSessionStopRequest = z.infer<typeof runtimeTaskSessionStopRequestSchema>;

export const runtimeTaskSessionStopResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskSessionStopResponse = z.infer<typeof runtimeTaskSessionStopResponseSchema>;

export const runtimeTaskPauseRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskPauseRequest = z.infer<typeof runtimeTaskPauseRequestSchema>;

export const runtimeTaskPauseResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	pausedTaskIds: z.array(z.string()),
	error: z.string().optional(),
});
export type RuntimeTaskPauseResponse = z.infer<typeof runtimeTaskPauseResponseSchema>;

export const runtimeSwarmStopSignalSchema = z.object({
	stopped: z.literal(true),
	reason: z.string(),
	createdAt: z.number(),
});
export type RuntimeSwarmStopSignal = z.infer<typeof runtimeSwarmStopSignalSchema>;

export const runtimeSwarmStopRequestSchema = z.object({
	reason: z.string().optional(),
});
export type RuntimeSwarmStopRequest = z.infer<typeof runtimeSwarmStopRequestSchema>;

export const runtimeSwarmStopResponseSchema = z.object({
	ok: z.boolean(),
	signal: runtimeSwarmStopSignalSchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeSwarmStopResponse = z.infer<typeof runtimeSwarmStopResponseSchema>;

export const runtimeTaskDiagnosticsRequestSchema = z.object({
	taskId: z.string(),
	limit: z.number().int().positive().max(100).optional(),
});
export type RuntimeTaskDiagnosticsRequest = z.infer<typeof runtimeTaskDiagnosticsRequestSchema>;

export const runtimeTaskDiagnosticEventSchema = z.object({
	schemaVersion: z.literal(1),
	signal: z.enum([
		"runtime_error",
		"provider_error",
		"tool_error",
		"context_overflow",
		"verification_failed",
		"slow_turn",
		"budget_wall",
		"repeated_read",
		"tool_argument_error",
		"task_abandoned",
		"task_escalated",
		"decomposition_rejected",
		"plan_gap",
		"eval_score",
		"custom",
	]),
	severity: z.enum(["debug", "info", "warning", "error"]),
	message: z.string(),
	taskId: z.string().nullable().optional(),
	runId: z.string().nullable().optional(),
	providerId: z.string().nullable().optional(),
	modelId: z.string().nullable().optional(),
	workspacePath: z.string().nullable().optional(),
	workspacePathHash: z.string().nullable().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.number(),
});
export type RuntimeTaskDiagnosticEvent = z.infer<typeof runtimeTaskDiagnosticEventSchema>;

export const runtimeTaskRunSummarySchema = z.object({
	schemaVersion: z.literal(1),
	taskId: z.string(),
	workspacePath: z.string().nullable(),
	state: z.enum(["awaiting_review", "failed", "interrupted"]),
	reviewReason: z.string().nullable(),
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	endpoint: z.string().nullable(),
	lastActivity: z.string().nullable(),
	warningMessage: z.string().nullable(),
	exitCode: z.number().nullable(),
	startedAt: z.number().nullable(),
	endedAt: z.number(),
	promptTokens: z.number().nullable(),
	completionTokens: z.number().nullable(),
	totalTokens: z.number().nullable(),
	timeoutReason: z.string().nullable(),
	timeoutSource: z.enum(["global_config", "role_override", "autonomous_default"]).nullable(),
	// Coarse agent role of the run (todo §5.C), so timeout outcomes can be broken down by role. Optional for
	// backward-compatibility with run-summary records written before this field existed.
	role: runtimeModelPerformanceRoleSchema.optional(),
	// Dev-test scenario id (todo §5.C), parsed from a `devtest-<scenario>-<ts>` task id, for by-scenario timeout
	// breakdowns during robustness sweeps (§5.O). Null/absent for ordinary (non-dev-test) runs.
	scenario: z.string().nullable().optional(),
	patchCaptureStatus: z.string().nullable(),
});
export type RuntimeTaskRunSummary = z.infer<typeof runtimeTaskRunSummarySchema>;

export const runtimeTaskDiagnosticsResponseSchema = z.object({
	ok: z.boolean(),
	events: z.array(runtimeTaskDiagnosticEventSchema),
	runSummaries: z.array(runtimeTaskRunSummarySchema).optional(),
	error: z.string().optional(),
});
export type RuntimeTaskDiagnosticsResponse = z.infer<typeof runtimeTaskDiagnosticsResponseSchema>;

export const runtimeTaskSessionInputRequestSchema = z.object({
	taskId: z.string(),
	text: z.string(),
	appendNewline: z.boolean().optional(),
});
export type RuntimeTaskSessionInputRequest = z.infer<typeof runtimeTaskSessionInputRequestSchema>;

export const runtimeTaskSessionInputResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskSessionInputResponse = z.infer<typeof runtimeTaskSessionInputResponseSchema>;

export const runtimeTaskChatMessageSchema = z.object({
	id: z.string(),
	role: z.enum(["user", "assistant", "system", "tool", "reasoning", "status"]),
	content: z.string(),
	images: z.array(runtimeTaskImageSchema).optional(),
	createdAt: z.number(),
	meta: z
		.object({
			toolName: z.string().nullable().optional(),
			hookEventName: z.string().nullable().optional(),
			toolCallId: z.string().nullable().optional(),
			streamType: z.string().nullable().optional(),
			messageKind: z.string().nullable().optional(),
			displayRole: z.string().nullable().optional(),
			reason: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
});
export type RuntimeTaskChatMessage = z.infer<typeof runtimeTaskChatMessageSchema>;

export const runtimeTaskChatMessagesRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatMessagesRequest = z.infer<typeof runtimeTaskChatMessagesRequestSchema>;

export const runtimeTaskChatMessagesResponseSchema = z.object({
	ok: z.boolean(),
	messages: z.array(runtimeTaskChatMessageSchema),
	error: z.string().optional(),
});
export type RuntimeTaskChatMessagesResponse = z.infer<typeof runtimeTaskChatMessagesResponseSchema>;

export const runtimeTaskChatSendRequestSchema = z.object({
	taskId: z.string(),
	text: z.string(),
	images: z.array(runtimeTaskImageSchema).optional(),
	mode: runtimeTaskSessionModeSchema.optional(),
	providerId: z.string().optional(),
	modelId: z.string().optional(),
	reasoningEffort: runtimeNKleinReasoningEffortSchema.nullable().optional(),
});
export type RuntimeTaskChatSendRequest = z.infer<typeof runtimeTaskChatSendRequestSchema>;

export const runtimeTaskChatSendResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	message: runtimeTaskChatMessageSchema.nullable().optional(),
	error: z.string().optional(),
});
export type RuntimeTaskChatSendResponse = z.infer<typeof runtimeTaskChatSendResponseSchema>;

export const runtimeProtectedTestApprovalPayloadSchema = z.object({
	intent: z.string(),
	diff: z.string(),
	reason: z.string(),
	expectedEffects: z.string(),
});
export type RuntimeProtectedTestApprovalPayload = z.infer<typeof runtimeProtectedTestApprovalPayloadSchema>;

export const runtimeProtectedTestApprovalGrantRequestSchema = z.object({
	taskId: z.string(),
	approval: runtimeProtectedTestApprovalPayloadSchema,
});
export type RuntimeProtectedTestApprovalGrantRequest = z.infer<typeof runtimeProtectedTestApprovalGrantRequestSchema>;

export const runtimeProtectedTestApprovalGrantResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeProtectedTestApprovalGrantResponse = z.infer<typeof runtimeProtectedTestApprovalGrantResponseSchema>;

export const runtimeTaskChatReloadRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatReloadRequest = z.infer<typeof runtimeTaskChatReloadRequestSchema>;

export const runtimeTaskChatReloadResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskChatReloadResponse = z.infer<typeof runtimeTaskChatReloadResponseSchema>;

export const runtimeTaskChatAbortRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatAbortRequest = z.infer<typeof runtimeTaskChatAbortRequestSchema>;

export const runtimeTaskChatAbortResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskChatAbortResponse = z.infer<typeof runtimeTaskChatAbortResponseSchema>;

export const runtimeTaskChatCancelRequestSchema = z.object({
	taskId: z.string(),
});
export type RuntimeTaskChatCancelRequest = z.infer<typeof runtimeTaskChatCancelRequestSchema>;

export const runtimeTaskChatCancelResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeTaskChatCancelResponse = z.infer<typeof runtimeTaskChatCancelResponseSchema>;

export const runtimeShellSessionStartRequestSchema = z.object({
	taskId: z.string(),
	cols: z.number().int().positive().optional(),
	rows: z.number().int().positive().optional(),
	workspaceTaskId: z.string().optional(),
	baseRef: z.string(),
});
export type RuntimeShellSessionStartRequest = z.infer<typeof runtimeShellSessionStartRequestSchema>;

export const runtimeShellSessionStartResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeTaskSessionSummarySchema.nullable(),
	shellBinary: z.string().nullable().optional(),
	error: z.string().optional(),
});
export type RuntimeShellSessionStartResponse = z.infer<typeof runtimeShellSessionStartResponseSchema>;

export const runtimeTerminalWsResizeMessageSchema = z.object({
	type: z.literal("resize"),
	cols: z.number().int().positive(),
	rows: z.number().int().positive(),
	pixelWidth: z.number().int().positive().optional(),
	pixelHeight: z.number().int().positive().optional(),
});
export type RuntimeTerminalWsResizeMessage = z.infer<typeof runtimeTerminalWsResizeMessageSchema>;

export const runtimeTerminalWsStopMessageSchema = z.object({
	type: z.literal("stop"),
});
export type RuntimeTerminalWsStopMessage = z.infer<typeof runtimeTerminalWsStopMessageSchema>;

export const runtimeTerminalWsOutputAckMessageSchema = z.object({
	type: z.literal("output_ack"),
	bytes: z.number().int().nonnegative(),
});
export type RuntimeTerminalWsOutputAckMessage = z.infer<typeof runtimeTerminalWsOutputAckMessageSchema>;

export const runtimeTerminalWsRestoreCompleteMessageSchema = z.object({
	type: z.literal("restore_complete"),
});
export type RuntimeTerminalWsRestoreCompleteMessage = z.infer<typeof runtimeTerminalWsRestoreCompleteMessageSchema>;

export const runtimeTerminalWsClientMessageSchema = z.discriminatedUnion("type", [
	runtimeTerminalWsResizeMessageSchema,
	runtimeTerminalWsStopMessageSchema,
	runtimeTerminalWsOutputAckMessageSchema,
	runtimeTerminalWsRestoreCompleteMessageSchema,
]);
export type RuntimeTerminalWsClientMessage = z.infer<typeof runtimeTerminalWsClientMessageSchema>;

export const runtimeTerminalWsStateMessageSchema = z.object({
	type: z.literal("state"),
	summary: runtimeTaskSessionSummarySchema,
});
export type RuntimeTerminalWsStateMessage = z.infer<typeof runtimeTerminalWsStateMessageSchema>;

export const runtimeTerminalWsErrorMessageSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type RuntimeTerminalWsErrorMessage = z.infer<typeof runtimeTerminalWsErrorMessageSchema>;

export const runtimeTerminalWsExitMessageSchema = z.object({
	type: z.literal("exit"),
	code: z.number().nullable(),
});
export type RuntimeTerminalWsExitMessage = z.infer<typeof runtimeTerminalWsExitMessageSchema>;

export const runtimeTerminalWsRestoreMessageSchema = z.object({
	type: z.literal("restore"),
	snapshot: z.string(),
	cols: z.number().int().positive().nullable().optional(),
	rows: z.number().int().positive().nullable().optional(),
});
export type RuntimeTerminalWsRestoreMessage = z.infer<typeof runtimeTerminalWsRestoreMessageSchema>;

export const runtimeTerminalWsServerMessageSchema = z.discriminatedUnion("type", [
	runtimeTerminalWsStateMessageSchema,
	runtimeTerminalWsErrorMessageSchema,
	runtimeTerminalWsExitMessageSchema,
	runtimeTerminalWsRestoreMessageSchema,
]);
export type RuntimeTerminalWsServerMessage = z.infer<typeof runtimeTerminalWsServerMessageSchema>;

export const runtimeGitCommitSchema = z.object({
	hash: z.string(),
	shortHash: z.string(),
	authorName: z.string(),
	authorEmail: z.string(),
	date: z.string(),
	message: z.string(),
	parentHashes: z.array(z.string()),
	relation: z.enum(["selected", "upstream", "shared"]).optional(),
});
export type RuntimeGitCommit = z.infer<typeof runtimeGitCommitSchema>;

export const runtimeGitRefSchema = z.object({
	name: z.string(),
	type: z.enum(["branch", "remote", "detached"]),
	hash: z.string(),
	isHead: z.boolean(),
	upstreamName: z.string().optional(),
	ahead: z.number().optional(),
	behind: z.number().optional(),
});
export type RuntimeGitRef = z.infer<typeof runtimeGitRefSchema>;

export const runtimeGitLogRequestSchema = z.object({
	ref: z.string().nullable().optional(),
	refs: z.array(z.string()).optional(),
	maxCount: z.number().int().positive().optional(),
	skip: z.number().int().nonnegative().optional(),
	taskScope: runtimeTaskWorkspaceInfoRequestSchema.nullable().optional(),
});
export type RuntimeGitLogRequest = z.infer<typeof runtimeGitLogRequestSchema>;

export const runtimeGitLogResponseSchema = z.object({
	ok: z.boolean(),
	commits: z.array(runtimeGitCommitSchema),
	totalCount: z.number(),
	error: z.string().optional(),
});
export type RuntimeGitLogResponse = z.infer<typeof runtimeGitLogResponseSchema>;

export const runtimeGitCommitDiffFileSchema = z.object({
	path: z.string(),
	previousPath: z.string().optional(),
	status: z.enum(["modified", "added", "deleted", "renamed"]),
	additions: z.number(),
	deletions: z.number(),
	patch: z.string(),
});
export type RuntimeGitCommitDiffFile = z.infer<typeof runtimeGitCommitDiffFileSchema>;

export const runtimeGitCommitDiffRequestSchema = z.object({
	commitHash: z.string(),
	taskScope: runtimeTaskWorkspaceInfoRequestSchema.nullable().optional(),
});
export type RuntimeGitCommitDiffRequest = z.infer<typeof runtimeGitCommitDiffRequestSchema>;

export const runtimeGitCommitDiffResponseSchema = z.object({
	ok: z.boolean(),
	commitHash: z.string(),
	files: z.array(runtimeGitCommitDiffFileSchema),
	error: z.string().optional(),
});
export type RuntimeGitCommitDiffResponse = z.infer<typeof runtimeGitCommitDiffResponseSchema>;

export const runtimeGitRefsResponseSchema = z.object({
	ok: z.boolean(),
	refs: z.array(runtimeGitRefSchema),
	error: z.string().optional(),
});
export type RuntimeGitRefsResponse = z.infer<typeof runtimeGitRefsResponseSchema>;
