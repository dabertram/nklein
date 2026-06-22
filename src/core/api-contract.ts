import { z } from "zod";
import { ACCEPTANCE_FAILURE_CATEGORIES } from "./acceptance-failure-taxonomy.js";
import { AGENT_CAPABILITY_TIERS, AGENT_DELIVERY_TIERS, AGENT_RULESET_ROLES } from "./agent-rulesets.js";
import { resolveTaskTitle } from "./task-title.js";

export const runtimeWorkspaceFileStatusSchema = z.enum([
	"modified",
	"added",
	"deleted",
	"renamed",
	"copied",
	"untracked",
	"unknown",
]);
export type RuntimeWorkspaceFileStatus = z.infer<typeof runtimeWorkspaceFileStatusSchema>;

export const runtimeWorkspaceFileChangeSchema = z.object({
	path: z.string(),
	previousPath: z.string().optional(),
	status: runtimeWorkspaceFileStatusSchema,
	additions: z.number(),
	deletions: z.number(),
	oldText: z.string().nullable(),
	newText: z.string().nullable(),
});
export type RuntimeWorkspaceFileChange = z.infer<typeof runtimeWorkspaceFileChangeSchema>;

export const runtimeWorkspaceChangesRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
	mode: z.enum(["working_copy", "last_turn"]).optional(),
});
export type RuntimeWorkspaceChangesRequest = z.infer<typeof runtimeWorkspaceChangesRequestSchema>;

export const runtimeWorkspaceChangesModeSchema = z.enum(["working_copy", "last_turn"]);
export type RuntimeWorkspaceChangesMode = z.infer<typeof runtimeWorkspaceChangesModeSchema>;

export const runtimeWorkspaceChangesResponseSchema = z.object({
	repoRoot: z.string(),
	generatedAt: z.number(),
	files: z.array(runtimeWorkspaceFileChangeSchema),
});
export type RuntimeWorkspaceChangesResponse = z.infer<typeof runtimeWorkspaceChangesResponseSchema>;

export const runtimeWorkspaceFileSearchRequestSchema = z.object({
	query: z.string(),
	limit: z.number().int().positive().optional(),
});
export type RuntimeWorkspaceFileSearchRequest = z.infer<typeof runtimeWorkspaceFileSearchRequestSchema>;

export const runtimeWorkspaceFileSearchMatchSchema = z.object({
	path: z.string(),
	name: z.string(),
	changed: z.boolean(),
});
export type RuntimeWorkspaceFileSearchMatch = z.infer<typeof runtimeWorkspaceFileSearchMatchSchema>;

export const runtimeWorkspaceFileSearchResponseSchema = z.object({
	query: z.string(),
	files: z.array(runtimeWorkspaceFileSearchMatchSchema),
});
export type RuntimeWorkspaceFileSearchResponse = z.infer<typeof runtimeWorkspaceFileSearchResponseSchema>;

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

export const runtimeAgentIdSchema = z.enum(["claude", "codex", "gemini", "opencode", "droid", "kiro", "nklein"]);
export type RuntimeAgentId = z.infer<typeof runtimeAgentIdSchema>;

const runtimeBoardColumnIdEnum = z.enum(["backlog", "planning", "in_progress", "review", "completed", "trash"]);
export const runtimeBoardColumnIdSchema = z.preprocess(
	(val) => (val === "done" ? "completed" : val),
	runtimeBoardColumnIdEnum,
);
export type RuntimeBoardColumnId = z.infer<typeof runtimeBoardColumnIdEnum>;

const runtimeTaskAutoReviewModeEnum = z.enum(["commit", "pr"]);
export const runtimeTaskAutoReviewModeSchema = z.preprocess(
	(val) => (val === "move_to_trash" || val === "move_to_done" ? "commit" : val),
	runtimeTaskAutoReviewModeEnum,
);
export type RuntimeTaskAutoReviewMode = z.infer<typeof runtimeTaskAutoReviewModeEnum>;

export const runtimeNKleinReasoningEffortSchema = z.enum(["low", "medium", "high", "xhigh"]);
export type RuntimeNKleinReasoningEffort = z.infer<typeof runtimeNKleinReasoningEffortSchema>;
export const RUNTIME_NKLEIN_MIN_CONTEXT_WINDOW_TOKENS = 32_000;
export const RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH = 12;
export const RUNTIME_NKLEIN_MAX_REPEATED_TOOL_CALLS_PER_TASK = 3;

export function clampRuntimeSwarmCardStartBatchSize(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.min(RUNTIME_SWARM_MAX_CARD_STARTS_PER_BATCH, Math.trunc(value));
}

export const runtimeAgentTimeoutModeSchema = z.preprocess(
	(value) => (value === "very_long" ? "extended" : value),
	z.enum(["normal", "long", "extended", "unlimited"]),
);
export type RuntimeAgentTimeoutMode = z.infer<typeof runtimeAgentTimeoutModeSchema>;
export const runtimeAgentTimeoutProfileSchema = z.enum(["cloud", "local", "custom"]);
export type RuntimeAgentTimeoutProfile = z.infer<typeof runtimeAgentTimeoutProfileSchema>;
export const runtimeLostHeartbeatPolicySchema = z.enum(["park", "keep_running"]);
export type RuntimeLostHeartbeatPolicy = z.infer<typeof runtimeLostHeartbeatPolicySchema>;
export const runtimeCodeEmbeddingProviderSchema = z.enum(["local_lexical", "openai_compatible", "local_gguf"]);
export type RuntimeCodeEmbeddingProvider = z.infer<typeof runtimeCodeEmbeddingProviderSchema>;
export const runtimeCodeEmbeddingSettingsSchema = z.object({
	provider: runtimeCodeEmbeddingProviderSchema,
	model: z.string().nullable(),
	baseUrl: z.string().nullable(),
});
export type RuntimeCodeEmbeddingSettings = z.infer<typeof runtimeCodeEmbeddingSettingsSchema>;
export const runtimeTaskNKleinContextScopeSchema = z.enum(["full", "smart", "minimal", "custom"]);
export type RuntimeTaskNKleinContextScope = z.infer<typeof runtimeTaskNKleinContextScopeSchema>;
export const runtimeTaskNKleinTimeoutModeSchema = z.preprocess(
	(value) => (value === "very_long" ? "extended" : value),
	z.enum(["normal", "long", "extended", "unlimited"]),
);
export type RuntimeTaskNKleinTimeoutMode = z.infer<typeof runtimeTaskNKleinTimeoutModeSchema>;
export const runtimeTimeoutMsSchema = z.number().int().nonnegative().nullable();
export const runtimeTaskNKleinSettingsSchema = z.object({
	providerId: z.string().optional(),
	modelId: z.string().optional(),
	reasoningEffort: runtimeNKleinReasoningEffortSchema.optional(),
	contextScope: runtimeTaskNKleinContextScopeSchema.optional(),
	timeoutMode: runtimeTaskNKleinTimeoutModeSchema.optional(),
	requestTimeoutMs: runtimeTimeoutMsSchema.optional(),
	streamTimeoutMs: runtimeTimeoutMsSchema.optional(),
	toolTimeoutMs: runtimeTimeoutMsSchema.optional(),
	agentTimeoutMs: runtimeTimeoutMsSchema.optional(),
	conversationTimeoutMs: runtimeTimeoutMsSchema.optional(),
});
export type RuntimeTaskNKleinSettings = z.infer<typeof runtimeTaskNKleinSettingsSchema>;
// A role's model config = its primary model settings plus an optional pool of `additionalModels`. When the pool
// is non-empty the role can run on more than one model; task-start fans out across the free, capability-feasible
// members (see #4). Empty/absent `additionalModels` = the historical single-model-per-role behavior, unchanged.
export const runtimeRoleModelSettingsSchema = runtimeTaskNKleinSettingsSchema.extend({
	additionalModels: z.array(runtimeTaskNKleinSettingsSchema).optional(),
});
export type RuntimeRoleModelSettings = z.infer<typeof runtimeRoleModelSettingsSchema>;
export const runtimeModelRolesSchema = z.record(z.string().min(1), runtimeRoleModelSettingsSchema);
export type RuntimeModelRoles = z.infer<typeof runtimeModelRolesSchema>;

// Per-role agent rulesets — two independent tiered dials (capability + delivery autonomy). Tier enums are
// derived from the pure core (src/core/agent-rulesets.ts) so the list lives in one place. `roleOverrides` keys
// are plain strings (the core resolver applies only known roles and ignores the rest), which sidesteps zod's
// exhaustive-enum-record requirement and stays forward-compatible if roles expand.
export const agentCapabilityTierSchema = z.enum(AGENT_CAPABILITY_TIERS);
export const agentDeliveryTierSchema = z.enum(AGENT_DELIVERY_TIERS);
export const agentRulesetRoleSchema = z.enum(AGENT_RULESET_ROLES);
export const agentCapabilityRulesetConfigSchema = z.object({
	globalPreset: agentCapabilityTierSchema,
	roleOverrides: z.record(z.string().min(1), agentCapabilityTierSchema).optional(),
});
export const agentDeliveryRulesetConfigSchema = z.object({
	globalPreset: agentDeliveryTierSchema,
	roleOverrides: z.record(z.string().min(1), agentDeliveryTierSchema).optional(),
});
export const agentRulesetsConfigSchema = z.object({
	capability: agentCapabilityRulesetConfigSchema,
	delivery: agentDeliveryRulesetConfigSchema,
});
export type AgentRulesetsConfigPayload = z.infer<typeof agentRulesetsConfigSchema>;
export { ACCEPTANCE_FAILURE_LABELS, acceptanceFailureCategoryLabel } from "./acceptance-failure-taxonomy.js";
// Re-export the ruleset value helpers so the web-ui (which reaches this module via the @runtime-contract alias)
// can render tier pickers without importing the runtime core directly.
export {
	AGENT_CAPABILITY_TIER_INFO,
	AGENT_DELIVERY_TIER_INFO,
	AGENT_RULESET_ROLES,
	DEFAULT_AGENT_RULESETS_CONFIG,
} from "./agent-rulesets.js";
export const runtimeTaskImageSchema = z.object({
	id: z.string(),
	data: z.string(),
	mimeType: z.string(),
	name: z.string().optional(),
});
export type RuntimeTaskImage = z.infer<typeof runtimeTaskImageSchema>;

export const runtimeGeneratedFromPlanSchema = z.object({
	artifactKind: z.enum(["decomposition", "buildout", "spec"]).default("decomposition"),
	planSlug: z.string().min(1),
	planTaskId: z.string().min(1),
	sourceTaskId: z.string().min(1).nullable().optional(),
});
export type RuntimeGeneratedFromPlan = z.infer<typeof runtimeGeneratedFromPlanSchema>;

const runtimeLegacyTaskNKleinReasoningEffortSchema = z.enum(["default", "low", "medium", "high", "xhigh"]);

function normalizeRuntimeTaskNKleinSettings(input: {
	nkleinSettings?: RuntimeTaskNKleinSettings;
	nkleinProviderId?: string;
	nkleinModelId?: string;
	nkleinReasoningEffort?: z.infer<typeof runtimeLegacyTaskNKleinReasoningEffortSchema>;
}): RuntimeTaskNKleinSettings | undefined {
	if (input.nkleinSettings !== undefined) {
		return input.nkleinSettings;
	}
	const providerId = input.nkleinProviderId?.trim();
	const modelId = input.nkleinModelId?.trim();
	if (!providerId && !modelId && input.nkleinReasoningEffort === undefined) {
		return undefined;
	}
	return {
		...(providerId ? { providerId } : {}),
		...(modelId ? { modelId } : {}),
		...(input.nkleinReasoningEffort && input.nkleinReasoningEffort !== "default"
			? { reasoningEffort: input.nkleinReasoningEffort }
			: {}),
	};
}

export const runtimeBoardCardSchema = z
	.object({
		id: z.string(),
		title: z.string().optional(),
		prompt: z.string(),
		startInPlanMode: z.boolean(),
		autoReviewEnabled: z.boolean().optional(),
		autoReviewMode: runtimeTaskAutoReviewModeSchema.optional(),
		autoReviewStatus: z.enum(["running", "failed"]).optional(),
		autoReviewMessage: z.string().optional(),
		images: z.array(runtimeTaskImageSchema).optional(),
		agentId: runtimeAgentIdSchema.optional(),
		nkleinSettings: runtimeTaskNKleinSettingsSchema.optional(),
		filesLikelyTouched: z.array(z.string()).optional(),
		generatedFromPlan: runtimeGeneratedFromPlanSchema.optional(),
		blockedKind: z.enum(["needs_decomposition", "local_model_required", "agent_sandbox_unavailable"]).optional(),
		blockedReason: z.string().optional(),
		nkleinProviderId: z.string().optional(),
		nkleinModelId: z.string().optional(),
		nkleinReasoningEffort: runtimeLegacyTaskNKleinReasoningEffortSchema.optional(),
		baseRef: z.string(),
		createdAt: z.number(),
		updatedAt: z.number(),
	})
	.transform(
		({
			nkleinProviderId: _legacyProviderId,
			nkleinModelId: _legacyModelId,
			nkleinReasoningEffort: _legacyReasoningEffort,
			...card
		}) => {
			const nkleinSettings = normalizeRuntimeTaskNKleinSettings({
				nkleinSettings: card.nkleinSettings,
				nkleinProviderId: _legacyProviderId,
				nkleinModelId: _legacyModelId,
				nkleinReasoningEffort: _legacyReasoningEffort,
			});
			return {
				...card,
				...(nkleinSettings !== undefined ? { nkleinSettings } : {}),
				title: resolveTaskTitle(card.title, card.prompt),
			};
		},
	);
export type RuntimeBoardCard = z.infer<typeof runtimeBoardCardSchema>;

export const runtimeBoardColumnSchema = z.object({
	id: runtimeBoardColumnIdSchema,
	title: z.string(),
	cards: z.array(runtimeBoardCardSchema),
});
export type RuntimeBoardColumn = z.infer<typeof runtimeBoardColumnSchema>;

export const runtimeBoardDependencySchema = z.object({
	id: z.string(),
	fromTaskId: z.string(),
	toTaskId: z.string(),
	createdAt: z.number(),
});
export type RuntimeBoardDependency = z.infer<typeof runtimeBoardDependencySchema>;

export const runtimeBoardDataSchema = z.object({
	columns: z.array(runtimeBoardColumnSchema),
	dependencies: z.array(runtimeBoardDependencySchema).default([]),
});
export type RuntimeBoardData = z.infer<typeof runtimeBoardDataSchema>;

export const runtimeGitRepositoryInfoSchema = z.object({
	currentBranch: z.string().nullable(),
	defaultBranch: z.string().nullable(),
	branches: z.array(z.string()),
});
export type RuntimeGitRepositoryInfo = z.infer<typeof runtimeGitRepositoryInfoSchema>;

export const runtimeGitSyncActionSchema = z.enum(["fetch", "pull", "push"]);
export type RuntimeGitSyncAction = z.infer<typeof runtimeGitSyncActionSchema>;

export const runtimeGitSyncSummarySchema = z.object({
	currentBranch: z.string().nullable(),
	upstreamBranch: z.string().nullable(),
	changedFiles: z.number(),
	additions: z.number(),
	deletions: z.number(),
	aheadCount: z.number(),
	behindCount: z.number(),
});
export type RuntimeGitSyncSummary = z.infer<typeof runtimeGitSyncSummarySchema>;

export const runtimeGitSummaryResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeGitSyncSummarySchema,
	error: z.string().optional(),
});
export type RuntimeGitSummaryResponse = z.infer<typeof runtimeGitSummaryResponseSchema>;

export const runtimeGitSyncResponseSchema = z.object({
	ok: z.boolean(),
	action: runtimeGitSyncActionSchema,
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitSyncResponse = z.infer<typeof runtimeGitSyncResponseSchema>;

export const runtimeGitCheckoutRequestSchema = z.object({
	branch: z.string(),
});
export type RuntimeGitCheckoutRequest = z.infer<typeof runtimeGitCheckoutRequestSchema>;

export const runtimeGitCheckoutResponseSchema = z.object({
	ok: z.boolean(),
	branch: z.string(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitCheckoutResponse = z.infer<typeof runtimeGitCheckoutResponseSchema>;

export const runtimeGitDiscardResponseSchema = z.object({
	ok: z.boolean(),
	summary: runtimeGitSyncSummarySchema,
	output: z.string(),
	error: z.string().optional(),
});
export type RuntimeGitDiscardResponse = z.infer<typeof runtimeGitDiscardResponseSchema>;

export const runtimeTaskSessionStateSchema = z.enum([
	"idle",
	"queued",
	"running",
	"paused",
	"awaiting_review",
	"failed",
	"interrupted",
]);
export type RuntimeTaskSessionState = z.infer<typeof runtimeTaskSessionStateSchema>;

export const runtimeTaskSessionModeSchema = z.enum(["act", "plan"]);
export type RuntimeTaskSessionMode = z.infer<typeof runtimeTaskSessionModeSchema>;

export const runtimeTaskSessionReviewReasonSchema = z
	.enum(["attention", "exit", "error", "interrupted", "hook"])
	.nullable();
export type RuntimeTaskSessionReviewReason = z.infer<typeof runtimeTaskSessionReviewReasonSchema>;

export const runtimeTaskHookActivitySchema = z.object({
	activityText: z.string().nullable().default(null),
	toolName: z.string().nullable().default(null),
	toolInputSummary: z.string().nullable().default(null),
	finalMessage: z.string().nullable().default(null),
	hookEventName: z.string().nullable().default(null),
	notificationType: z.string().nullable().default(null),
	source: z.string().nullable().default(null),
});
export type RuntimeTaskHookActivity = z.infer<typeof runtimeTaskHookActivitySchema>;

export const runtimeTaskTurnCheckpointSchema = z.object({
	turn: z.number().int().positive(),
	ref: z.string(),
	commit: z.string(),
	createdAt: z.number(),
});
export type RuntimeTaskTurnCheckpoint = z.infer<typeof runtimeTaskTurnCheckpointSchema>;

export const runtimeTaskSessionUsageSchema = z.object({
	inputTokens: z.number().int().nonnegative(),
	outputTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative().optional(),
	cacheWriteTokens: z.number().int().nonnegative().optional(),
});
export type RuntimeTaskSessionUsage = z.infer<typeof runtimeTaskSessionUsageSchema>;

export const runtimeContextBudgetBreakdownSchema = z.object({
	systemPromptTokens: z.number().int().nonnegative(),
	toolSchemaTokens: z.number().int().nonnegative(),
	taskPromptTokens: z.number().int().nonnegative(),
	userMessageTokens: z.number().int().nonnegative(),
	includedFileContentTokens: z.number().int().nonnegative(),
	otherHistoryTokens: z.number().int().nonnegative(),
	reservedPromptOverheadTokens: z.number().int().nonnegative(),
	reservedOutputTokens: z.number().int().nonnegative(),
	usedWorkingTokens: z.number().int().nonnegative(),
	freeWorkingTokens: z.number().int().nonnegative(),
	effectiveContextWindow: z.number().int().positive(),
	projectedTokens: z.number().int().nonnegative(),
});
export type RuntimeContextBudgetBreakdown = z.infer<typeof runtimeContextBudgetBreakdownSchema>;

export const runtimeTaskSessionSummarySchema = z.object({
	taskId: z.string(),
	state: runtimeTaskSessionStateSchema,
	mode: runtimeTaskSessionModeSchema.nullable().optional(),
	agentId: runtimeAgentIdSchema.nullable(),
	workspacePath: z.string().nullable(),
	pid: z.number().nullable(),
	startedAt: z.number().nullable(),
	updatedAt: z.number(),
	lastOutputAt: z.number().nullable(),
	paused: z.boolean().optional(),
	lastTokenAt: z.number().nullable().optional(),
	lastHeartbeatAt: z.number().nullable().optional(),
	heartbeatStatus: z.enum(["healthy", "stale", "lost"]).nullable().optional(),
	providerId: z.string().nullable().optional(),
	modelId: z.string().nullable().optional(),
	endpoint: z.string().nullable().optional(),
	sharedEndpointId: z.string().nullable().optional(),
	reviewReason: runtimeTaskSessionReviewReasonSchema,
	exitCode: z.number().nullable(),
	lastHookAt: z.number().nullable().default(null),
	latestHookActivity: runtimeTaskHookActivitySchema.nullable().default(null),
	warningMessage: z.string().nullable().optional(),
	latestUsage: runtimeTaskSessionUsageSchema.nullable().optional(),
	contextBudgetBreakdown: runtimeContextBudgetBreakdownSchema.nullable().optional(),
	latestTurnCheckpoint: runtimeTaskTurnCheckpointSchema.nullable().optional(),
	previousTurnCheckpoint: runtimeTaskTurnCheckpointSchema.nullable().optional(),
});
export type RuntimeTaskSessionSummary = z.infer<typeof runtimeTaskSessionSummarySchema>;

export const runtimeModelPerformanceRoleSchema = z.enum(["architect", "worker", "reviewer", "unknown"]);
export type RuntimeModelPerformanceRole = z.infer<typeof runtimeModelPerformanceRoleSchema>;

export const runtimeModelPerformanceOutcomeSchema = z.enum([
	"completed",
	"awaiting_review",
	"failed",
	"interrupted",
	"queued",
	"running",
	"idle",
	"unknown",
]);
export type RuntimeModelPerformanceOutcome = z.infer<typeof runtimeModelPerformanceOutcomeSchema>;

export const runtimeModelPerformanceObservationSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	recordedAt: z.number().int().nonnegative(),
	appVersion: z.string(),
	workspaceId: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	workspacePath: z.string().nullable(),
	projectName: z.string().nullable(),
	taskId: z.string(),
	taskTitle: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	roleSource: z.enum(["card", "model_roles", "default", "unknown"]),
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	endpoint: z.string().nullable(),
	sharedEndpointId: z.string().nullable(),
	outcome: runtimeModelPerformanceOutcomeSchema,
	sessionState: runtimeTaskSessionStateSchema,
	reviewReason: runtimeTaskSessionReviewReasonSchema,
	exitCode: z.number().nullable(),
	warningMessage: z.string().nullable(),
	startedAt: z.number().nullable(),
	updatedAt: z.number().int().nonnegative(),
	lastOutputAt: z.number().nullable(),
	lastTokenAt: z.number().nullable(),
	lastHeartbeatAt: z.number().nullable(),
	heartbeatStatus: z.enum(["healthy", "stale", "lost"]).nullable(),
	wallTimeMs: z.number().int().nonnegative().nullable(),
	timeToFirstTokenMs: z.number().int().nonnegative().nullable(),
	timeToLastOutputMs: z.number().int().nonnegative().nullable(),
	usage: runtimeTaskSessionUsageSchema.nullable(),
	contextBudgetBreakdown: runtimeContextBudgetBreakdownSchema.nullable(),
	contextPressure: z.number().nonnegative().nullable(),
	latestHookEvent: z.string().nullable(),
	latestHookToolName: z.string().nullable(),
});
export type RuntimeModelPerformanceObservation = z.infer<typeof runtimeModelPerformanceObservationSchema>;

export const runtimeModelPerformanceAggregateSchema = z.object({
	key: z.string(),
	scope: z.enum(["overall", "project", "version"]),
	appVersion: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	projectName: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	runs: z.number().int().nonnegative(),
	completedRuns: z.number().int().nonnegative(),
	failedRuns: z.number().int().nonnegative(),
	interruptedRuns: z.number().int().nonnegative(),
	awaitingReviewRuns: z.number().int().nonnegative(),
	successRate: z.number().nonnegative(),
	averageWallTimeMs: z.number().nonnegative().nullable(),
	averageTimeToFirstTokenMs: z.number().nonnegative().nullable(),
	averageInputTokens: z.number().nonnegative().nullable(),
	averageOutputTokens: z.number().nonnegative().nullable(),
	averageContextPressure: z.number().nonnegative().nullable(),
	lastObservedAt: z.number().int().nonnegative(),
});
export type RuntimeModelPerformanceAggregate = z.infer<typeof runtimeModelPerformanceAggregateSchema>;

export const runtimeModelPerformanceStatsResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	observations: z.array(runtimeModelPerformanceObservationSchema),
	aggregates: z.array(runtimeModelPerformanceAggregateSchema),
});
export type RuntimeModelPerformanceStatsResponse = z.infer<typeof runtimeModelPerformanceStatsResponseSchema>;

export const runtimeKnowledgeToolCategorySchema = z.enum([
	"architecture_knowledge",
	"external_fetch",
	"code_index",
	"codebase_retrieval",
	"file_discovery",
	"file_read",
	"planning_control",
	"other",
]);
export type RuntimeKnowledgeToolCategory = z.infer<typeof runtimeKnowledgeToolCategorySchema>;

export const runtimeKnowledgeToolOutcomeSchema = z.enum(["started", "succeeded", "failed"]);
export type RuntimeKnowledgeToolOutcome = z.infer<typeof runtimeKnowledgeToolOutcomeSchema>;

export const runtimeKnowledgeToolUsageObservationSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string(),
	recordedAt: z.number().int().nonnegative(),
	appVersion: z.string(),
	workspaceId: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	workspacePath: z.string().nullable(),
	projectName: z.string().nullable(),
	taskId: z.string(),
	taskTitle: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	roleSource: z.enum(["card", "model_roles", "default", "unknown"]),
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	toolName: z.string(),
	toolCategory: runtimeKnowledgeToolCategorySchema,
	outcome: runtimeKnowledgeToolOutcomeSchema,
	hookEventName: z.string(),
	toolInputSummary: z.string().nullable(),
	activityText: z.string().nullable(),
	lastHookAt: z.number().int().nonnegative().nullable(),
});
export type RuntimeKnowledgeToolUsageObservation = z.infer<typeof runtimeKnowledgeToolUsageObservationSchema>;

export const runtimeKnowledgeToolUsageAggregateSchema = z.object({
	key: z.string(),
	scope: z.enum(["overall", "project", "version"]),
	appVersion: z.string().nullable(),
	workspacePathHash: z.string().nullable(),
	projectName: z.string().nullable(),
	role: runtimeModelPerformanceRoleSchema,
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	toolName: z.string(),
	toolCategory: runtimeKnowledgeToolCategorySchema,
	calls: z.number().int().nonnegative(),
	startedCalls: z.number().int().nonnegative(),
	succeededCalls: z.number().int().nonnegative(),
	failedCalls: z.number().int().nonnegative(),
	successRate: z.number().nonnegative(),
	lastObservedAt: z.number().int().nonnegative(),
});
export type RuntimeKnowledgeToolUsageAggregate = z.infer<typeof runtimeKnowledgeToolUsageAggregateSchema>;

export const runtimeKnowledgeToolUsageStatsResponseSchema = z.object({
	generatedAt: z.number().int().nonnegative(),
	observations: z.array(runtimeKnowledgeToolUsageObservationSchema),
	aggregates: z.array(runtimeKnowledgeToolUsageAggregateSchema),
});
export type RuntimeKnowledgeToolUsageStatsResponse = z.infer<typeof runtimeKnowledgeToolUsageStatsResponseSchema>;

export const runtimeWorkspaceStateResponseSchema = z.object({
	repoPath: z.string(),
	statePath: z.string(),
	git: runtimeGitRepositoryInfoSchema,
	board: runtimeBoardDataSchema,
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema),
	revision: z.number(),
});
export type RuntimeWorkspaceStateResponse = z.infer<typeof runtimeWorkspaceStateResponseSchema>;

export const runtimeWorkspaceStateSaveRequestSchema = z.object({
	board: runtimeBoardDataSchema,
	sessions: z.record(z.string(), runtimeTaskSessionSummarySchema).optional(),
	expectedRevision: z.number().int().nonnegative().optional(),
});
export type RuntimeWorkspaceStateSaveRequest = z.infer<typeof runtimeWorkspaceStateSaveRequestSchema>;

export const runtimeWorkspaceStateConflictResponseSchema = z.object({
	error: z.string(),
	currentRevision: z.number(),
});
export type RuntimeWorkspaceStateConflictResponse = z.infer<typeof runtimeWorkspaceStateConflictResponseSchema>;

export const runtimeWorkspaceStateNotifyResponseSchema = z.object({
	ok: z.boolean(),
});
export type RuntimeWorkspaceStateNotifyResponse = z.infer<typeof runtimeWorkspaceStateNotifyResponseSchema>;

export const runtimeProjectTaskCountsSchema = z.object({
	backlog: z.number(),
	planning: z.number().default(0),
	in_progress: z.number(),
	review: z.number(),
	completed: z.number(),
	trash: z.number(),
});
export type RuntimeProjectTaskCounts = z.infer<typeof runtimeProjectTaskCountsSchema>;

export const runtimeProjectHealthIssueSchema = z.object({
	kind: z.enum([
		"task_worktree_project",
		"missing_parent_workspace",
		"pending_plan_artifacts",
		"lost_session_pending_artifacts",
	]),
	severity: z.enum(["warning", "error"]),
	title: z.string(),
	message: z.string(),
	taskId: z.string().nullable(),
	parentWorkspaceId: z.string().nullable(),
	parentWorkspacePath: z.string().nullable(),
	artifactCount: z.number().int().nonnegative(),
	canRemove: z.boolean(),
	canMigrateArtifacts: z.boolean(),
});
export type RuntimeProjectHealthIssue = z.infer<typeof runtimeProjectHealthIssueSchema>;

export const runtimeProjectSummarySchema = z.object({
	id: z.string(),
	path: z.string(),
	name: z.string(),
	taskCounts: runtimeProjectTaskCountsSchema,
	gitRepositoryCreatedByKanban: z.boolean().optional(),
	healthIssues: z.array(runtimeProjectHealthIssueSchema).optional(),
});
export type RuntimeProjectSummary = z.infer<typeof runtimeProjectSummarySchema>;

export const runtimeTaskWorkspaceMetadataSchema = z.object({
	taskId: z.string(),
	path: z.string(),
	exists: z.boolean(),
	baseRef: z.string(),
	branch: z.string().nullable(),
	isDetached: z.boolean(),
	headCommit: z.string().nullable(),
	changedFiles: z.number().nullable(),
	additions: z.number().nullable(),
	deletions: z.number().nullable(),
	stateVersion: z.number().int().nonnegative(),
});
export type RuntimeTaskWorkspaceMetadata = z.infer<typeof runtimeTaskWorkspaceMetadataSchema>;

export const runtimeWorkspaceMetadataSchema = z.object({
	homeGitSummary: runtimeGitSyncSummarySchema.nullable(),
	homeGitStateVersion: z.number().int().nonnegative(),
	taskWorkspaces: z.array(runtimeTaskWorkspaceMetadataSchema),
});
export type RuntimeWorkspaceMetadata = z.infer<typeof runtimeWorkspaceMetadataSchema>;

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

export const runtimeProjectsResponseSchema = z.object({
	currentProjectId: z.string().nullable(),
	projects: z.array(runtimeProjectSummarySchema),
});
export type RuntimeProjectsResponse = z.infer<typeof runtimeProjectsResponseSchema>;

export const runtimeProjectAddRequestSchema = z
	.object({
		path: z.string().optional(),
		gitUrl: z.string().optional(),
		ref: z.string().optional(),
		projectName: z.string().optional(),
		createDirectory: z.boolean().optional(),
		initializeGit: z.boolean().optional(),
		confirmSelfProject: z.boolean().optional(),
		allowTaskWorktreeProject: z.boolean().optional(),
	})
	.refine((data) => data.path || data.gitUrl, { message: "Either path or gitUrl is required" });
export type RuntimeProjectAddRequest = z.infer<typeof runtimeProjectAddRequestSchema>;

export const runtimeProjectAddResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	requiresGitInitialization: z.boolean().optional(),
	requiresSelfProjectConfirmation: z.boolean().optional(),
	requiresTaskWorktreeProjectConfirmation: z.boolean().optional(),
	error: z.string().optional(),
});
export type RuntimeProjectAddResponse = z.infer<typeof runtimeProjectAddResponseSchema>;

export const runtimeDevTestProjectScenarioSchema = z.object({
	id: z.string(),
	title: z.string(),
	prompt: z.string(),
	acceptanceCommand: z.string(),
	complexity: z.number().nullable(),
	filesLikelyTouched: z.array(z.string()),
});
export type RuntimeDevTestProjectScenario = z.infer<typeof runtimeDevTestProjectScenarioSchema>;

export const runtimeDevTestProjectPresetSchema = z.enum(["mid_task", "complex_dag", "audio_vst", "daw_foundation"]);
export type RuntimeDevTestProjectPreset = z.infer<typeof runtimeDevTestProjectPresetSchema>;

export const runtimeDevTestProjectRequestSchema = z
	.object({
		preset: runtimeDevTestProjectPresetSchema.optional(),
	})
	.optional();
export type RuntimeDevTestProjectRequest = z.infer<typeof runtimeDevTestProjectRequestSchema>;

export const runtimeDevTestProjectResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	task: runtimeBoardCardSchema.nullable(),
	tasks: z.array(runtimeBoardCardSchema).default([]),
	scenario: runtimeDevTestProjectScenarioSchema.nullable(),
	workspacePath: z.string().nullable(),
	evidenceRootPath: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeDevTestProjectResponse = z.infer<typeof runtimeDevTestProjectResponseSchema>;

export const runtimeSelfImprovementProjectRequestSchema = z
	.object({
		notes: z.string().optional(),
		evidenceBundlePath: z.string().optional(),
		confirmSelfProject: z.boolean().optional(),
	})
	.optional();
export type RuntimeSelfImprovementProjectRequest = z.infer<typeof runtimeSelfImprovementProjectRequestSchema>;

export const runtimeSelfImprovementProjectResponseSchema = z.object({
	ok: z.boolean(),
	project: runtimeProjectSummarySchema.nullable(),
	task: runtimeBoardCardSchema.nullable(),
	workspacePath: z.string().nullable(),
	source: z.literal("current_dev_checkout").nullable(),
	requiresSelfProjectConfirmation: z.boolean().optional(),
	error: z.string().optional(),
});
export type RuntimeSelfImprovementProjectResponse = z.infer<typeof runtimeSelfImprovementProjectResponseSchema>;

export const runtimeDevTestCleanupResponseSchema = z.object({
	ok: z.boolean(),
	removedProjects: z.number(),
	removedTaskWorktrees: z.number(),
	errors: z.array(z.string()).default([]),
	error: z.string().optional(),
});
export type RuntimeDevTestCleanupResponse = z.infer<typeof runtimeDevTestCleanupResponseSchema>;

export const runtimeProjectDirectoryPickerResponseSchema = z.object({
	ok: z.boolean(),
	path: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeProjectDirectoryPickerResponse = z.infer<typeof runtimeProjectDirectoryPickerResponseSchema>;

export const runtimeDirectoryListEntrySchema = z.object({
	name: z.string(),
	path: z.string(),
	isGitRepository: z.boolean(),
});
export type RuntimeDirectoryListEntry = z.infer<typeof runtimeDirectoryListEntrySchema>;

export const runtimeDirectoryListRequestSchema = z.object({
	path: z.string().optional(),
});
export type RuntimeDirectoryListRequest = z.infer<typeof runtimeDirectoryListRequestSchema>;

export const runtimeDirectoryListResponseSchema = z.object({
	ok: z.boolean(),
	currentPath: z.string(),
	parentPath: z.string().nullable(),
	rootPath: z.string(),
	entries: z.array(runtimeDirectoryListEntrySchema),
	error: z.string().optional(),
});
export type RuntimeDirectoryListResponse = z.infer<typeof runtimeDirectoryListResponseSchema>;

export const runtimeProjectRemoveRequestSchema = z.object({
	projectId: z.string(),
	deleteGitRepository: z.boolean().optional(),
});
export type RuntimeProjectRemoveRequest = z.infer<typeof runtimeProjectRemoveRequestSchema>;

export const runtimeProjectRemoveResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeProjectRemoveResponse = z.infer<typeof runtimeProjectRemoveResponseSchema>;

export const runtimeProjectArtifactMigrationRequestSchema = z.object({
	projectId: z.string().min(1),
});
export type RuntimeProjectArtifactMigrationRequest = z.infer<typeof runtimeProjectArtifactMigrationRequestSchema>;

export const runtimeProjectArtifactMigrationResponseSchema = z.object({
	ok: z.boolean(),
	migratedArtifacts: z.number().int().nonnegative(),
	skippedArtifacts: z.number().int().nonnegative(),
	parentWorkspaceId: z.string().nullable(),
	parentWorkspacePath: z.string().nullable(),
	errors: z.array(z.string()).default([]),
	error: z.string().optional(),
});
export type RuntimeProjectArtifactMigrationResponse = z.infer<typeof runtimeProjectArtifactMigrationResponseSchema>;

export const runtimeWorktreeEnsureRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
});
export type RuntimeWorktreeEnsureRequest = z.infer<typeof runtimeWorktreeEnsureRequestSchema>;

export const runtimeWorktreeEnsureResponseSchema = z.union([
	z.object({
		ok: z.literal(true),
		path: z.string(),
		baseRef: z.string(),
		baseCommit: z.string(),
		warning: z.string().optional(),
		error: z.string().optional(),
	}),
	z.object({
		ok: z.literal(false),
		path: z.null(),
		baseRef: z.string(),
		baseCommit: z.null(),
		error: z.string().optional(),
	}),
]);
export type RuntimeWorktreeEnsureResponse = z.infer<typeof runtimeWorktreeEnsureResponseSchema>;

export const runtimeWorktreeDeleteRequestSchema = z.object({
	taskId: z.string(),
	preserveChanges: z.boolean().optional(),
});
export type RuntimeWorktreeDeleteRequest = z.infer<typeof runtimeWorktreeDeleteRequestSchema>;

export const runtimeWorktreeDeleteResponseSchema = z.object({
	ok: z.boolean(),
	removed: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeWorktreeDeleteResponse = z.infer<typeof runtimeWorktreeDeleteResponseSchema>;

export const runtimeTaskWorkspaceInfoRequestSchema = z.object({
	taskId: z.string(),
	baseRef: z.string(),
});
export type RuntimeTaskWorkspaceInfoRequest = z.infer<typeof runtimeTaskWorkspaceInfoRequestSchema>;

export const runtimeTaskWorkspaceInfoResponseSchema = z.object({
	taskId: z.string(),
	path: z.string(),
	exists: z.boolean(),
	baseRef: z.string(),
	branch: z.string().nullable(),
	isDetached: z.boolean(),
	headCommit: z.string().nullable(),
});
export type RuntimeTaskWorkspaceInfoResponse = z.infer<typeof runtimeTaskWorkspaceInfoResponseSchema>;

export const runtimeProjectShortcutSchema = z.object({
	label: z.string(),
	command: z.string(),
	icon: z.string().optional(),
});
export type RuntimeProjectShortcut = z.infer<typeof runtimeProjectShortcutSchema>;

export const runtimeNKleinOauthProviderSchema = z.enum(["nklein", "oca", "openai-codex"]);
export type RuntimeNKleinOauthProvider = z.infer<typeof runtimeNKleinOauthProviderSchema>;

export const runtimeNKleinProviderSettingsSchema = z.object({
	providerId: z.string().nullable(),
	modelId: z.string().nullable(),
	baseUrl: z.string().nullable(),
	reasoningEffort: runtimeNKleinReasoningEffortSchema.nullable().optional(),
	apiKeyConfigured: z.boolean(),
	oauthProvider: runtimeNKleinOauthProviderSchema.nullable(),
	oauthAccessTokenConfigured: z.boolean(),
	oauthRefreshTokenConfigured: z.boolean(),
	oauthAccountId: z.string().nullable(),
	oauthExpiresAt: z.number().int().positive().nullable(),
});
export type RuntimeNKleinProviderSettings = z.infer<typeof runtimeNKleinProviderSettingsSchema>;

export const runtimeNKleinAccountProfileSchema = z.object({
	accountId: z.string().nullable(),
	email: z.string().nullable(),
	displayName: z.string().nullable(),
});
export type RuntimeNKleinAccountProfile = z.infer<typeof runtimeNKleinAccountProfileSchema>;

export const runtimeNKleinAccountProfileResponseSchema = z.object({
	profile: runtimeNKleinAccountProfileSchema.nullable(),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountProfileResponse = z.infer<typeof runtimeNKleinAccountProfileResponseSchema>;

export const runtimeNKleinKanbanAccessResponseSchema = z.object({
	enabled: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeNKleinKanbanAccessResponse = z.infer<typeof runtimeNKleinKanbanAccessResponseSchema>;

export const runtimeNKleinAccountOrganizationSchema = z.object({
	organizationId: z.string(),
	name: z.string(),
	active: z.boolean(),
	roles: z.array(z.string()),
});
export type RuntimeNKleinAccountOrganization = z.infer<typeof runtimeNKleinAccountOrganizationSchema>;

export const runtimeNKleinAccountOrganizationsResponseSchema = z.object({
	organizations: z.array(runtimeNKleinAccountOrganizationSchema),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountOrganizationsResponse = z.infer<typeof runtimeNKleinAccountOrganizationsResponseSchema>;

export const runtimeNKleinAccountBalanceResponseSchema = z.object({
	balance: z.number().nullable(),
	activeAccountLabel: z.string().nullable(),
	activeOrganizationId: z.string().nullable(),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountBalanceResponse = z.infer<typeof runtimeNKleinAccountBalanceResponseSchema>;

export const runtimeNKleinAccountSwitchRequestSchema = z.object({
	organizationId: z.string().nullable(),
});
export type RuntimeNKleinAccountSwitchRequest = z.infer<typeof runtimeNKleinAccountSwitchRequestSchema>;

export const runtimeNKleinAccountSwitchResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeNKleinAccountSwitchResponse = z.infer<typeof runtimeNKleinAccountSwitchResponseSchema>;

export const runtimeFeaturebaseTokenResponseSchema = z.object({
	featurebaseJwt: z.string(),
});
export type RuntimeFeaturebaseTokenResponse = z.infer<typeof runtimeFeaturebaseTokenResponseSchema>;

export const runtimeNKleinProviderCatalogItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	oauthSupported: z.boolean(),
	enabled: z.boolean(),
	defaultModelId: z.string().nullable(),
	baseUrl: z.string().nullable(),
	supportsBaseUrl: z.boolean(),
	env: z.array(z.string()).optional(),
});
export type RuntimeNKleinProviderCatalogItem = z.infer<typeof runtimeNKleinProviderCatalogItemSchema>;

export const runtimeNKleinProviderCatalogResponseSchema = z.object({
	providers: z.array(runtimeNKleinProviderCatalogItemSchema),
});
export type RuntimeNKleinProviderCatalogResponse = z.infer<typeof runtimeNKleinProviderCatalogResponseSchema>;

export const runtimeNKleinProviderModelsRequestSchema = z.object({
	providerId: z.string(),
});
export type RuntimeNKleinProviderModelsRequest = z.infer<typeof runtimeNKleinProviderModelsRequestSchema>;

export const runtimeNKleinProviderModelSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string().optional(),
	contextWindow: z.number().int().nonnegative().optional(),
	supportsVision: z.boolean().optional(),
	supportsAttachments: z.boolean().optional(),
	supportsReasoningEffort: z.boolean().optional(),
});
export type RuntimeNKleinProviderModel = z.infer<typeof runtimeNKleinProviderModelSchema>;

export const runtimeNKleinProviderModelsResponseSchema = z.object({
	providerId: z.string(),
	models: z.array(runtimeNKleinProviderModelSchema),
});
export type RuntimeNKleinProviderModelsResponse = z.infer<typeof runtimeNKleinProviderModelsResponseSchema>;

export const runtimeNKleinEndpointModelDiscoveryRequestSchema = z.object({
	baseUrl: z.string().min(1),
	apiKey: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	timeoutMs: z.number().int().positive().nullable().optional(),
});
export type RuntimeNKleinEndpointModelDiscoveryRequest = z.infer<
	typeof runtimeNKleinEndpointModelDiscoveryRequestSchema
>;

export const runtimeNKleinEndpointModelDiscoveryResponseSchema = z.object({
	modelSourceUrl: z.string(),
	models: z.array(runtimeNKleinProviderModelSchema),
});
export type RuntimeNKleinEndpointModelDiscoveryResponse = z.infer<
	typeof runtimeNKleinEndpointModelDiscoveryResponseSchema
>;

export const runtimeNKleinModelRegistryEntrySchema = z.object({
	key: z.string(),
	providerId: z.string(),
	modelId: z.string(),
	endpoint: z.string().nullable(),
	contextWindow: z.object({
		advertised: z.number().int().positive().nullable(),
		observed: z.number().int().positive().nullable(),
		userOverride: z.number().int().positive().nullable(),
		effective: z.number().int().positive().nullable(),
	}),
	speed: z.object({
		samples: z.number().int().nonnegative(),
		promptTokensEwma: z.number().nonnegative().nullable(),
		outputTokensEwma: z.number().nonnegative().nullable(),
		totalTokensEwma: z.number().nonnegative().nullable(),
		prefillTokensPerSecondEwma: z.number().nonnegative().nullable(),
		decodeTokensPerSecondEwma: z.number().nonnegative().nullable(),
		ttftMsEwma: z.number().nonnegative().nullable(),
		wallTimeMsEwma: z.number().nonnegative().nullable(),
		wallTimeMsPer1kPromptTokensEwma: z.number().nonnegative().nullable(),
		lastPromptTokens: z.number().int().nonnegative().nullable(),
		lastOutputTokens: z.number().int().nonnegative().nullable(),
		lastWallTimeMs: z.number().nonnegative().nullable(),
		lastObservedAt: z.number().int().nonnegative().nullable(),
	}),
	capability: z.object({
		samples: z.number().int().nonnegative(),
		staticPrior: z.number().min(0).max(100),
		evalScore: z.number().min(0).max(100).nullable(),
		externalScore: z.number().min(0).max(100).nullable(),
		observedPassRate: z.number().min(0).max(1).nullable(),
		effectiveScore: z.number().min(0).max(100),
		lastObservedAt: z.number().int().nonnegative().nullable(),
	}),
	constraints: z.object({
		sharedEndpointId: z.string().nullable(),
		inputCostPerMillionTokens: z.number().nonnegative().nullable(),
		outputCostPerMillionTokens: z.number().nonnegative().nullable(),
	}),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});
export type RuntimeNKleinModelRegistryEntry = z.infer<typeof runtimeNKleinModelRegistryEntrySchema>;

export const runtimeNKleinModelRegistryResponseSchema = z.object({
	schemaVersion: z.number().int().positive(),
	updatedAt: z.number().int().nonnegative(),
	models: z.array(runtimeNKleinModelRegistryEntrySchema),
});
export type RuntimeNKleinModelRegistryResponse = z.infer<typeof runtimeNKleinModelRegistryResponseSchema>;

export const runtimeNKleinModelContextWindowOverrideRequestSchema = z.object({
	providerId: z.string().min(1),
	modelId: z.string().min(1),
	endpoint: z.string().nullable().optional(),
	contextWindow: z.number().int().positive().nullable(),
});
export type RuntimeNKleinModelContextWindowOverrideRequest = z.infer<
	typeof runtimeNKleinModelContextWindowOverrideRequestSchema
>;

export const runtimeNKleinModelContextWindowOverrideResponseSchema = z.object({
	model: runtimeNKleinModelRegistryEntrySchema,
});
export type RuntimeNKleinModelContextWindowOverrideResponse = z.infer<
	typeof runtimeNKleinModelContextWindowOverrideResponseSchema
>;

export const runtimeNKleinModelRegistryRemoveRequestSchema = z.object({
	key: z.string().min(1),
});
export type RuntimeNKleinModelRegistryRemoveRequest = z.infer<typeof runtimeNKleinModelRegistryRemoveRequestSchema>;

export const runtimeNKleinModelRegistryRemoveResponseSchema = z.object({
	removed: z.boolean(),
});
export type RuntimeNKleinModelRegistryRemoveResponse = z.infer<typeof runtimeNKleinModelRegistryRemoveResponseSchema>;

export const runtimeNKleinModelRegistryPruneResponseSchema = z.object({
	removed: z.number().int().nonnegative(),
});
export type RuntimeNKleinModelRegistryPruneResponse = z.infer<typeof runtimeNKleinModelRegistryPruneResponseSchema>;

export const runtimeNKleinCodeIntelligenceStatusResponseSchema = z.object({
	codeEmbeddingSettings: z.object({
		globalDefaults: runtimeCodeEmbeddingSettingsSchema,
		projectOverride: runtimeCodeEmbeddingSettingsSchema.nullable(),
		effective: runtimeCodeEmbeddingSettingsSchema,
		source: z.enum(["global", "project"]),
	}),
	/** Status of the built-in GGUF embedding model file, when the effective provider is `local_gguf`. */
	embeddingModelFile: z
		.object({
			modelId: z.string(),
			label: z.string(),
			installed: z.boolean(),
			sizeBytes: z.number().int().nonnegative().nullable(),
			/** True when the Python core that serves this model is enabled; otherwise it runs as lexical. */
			coreEnabled: z.boolean(),
		})
		.nullable(),
	repoMap: z.object({
		filesScanned: z.number().int().nonnegative(),
		symbols: z.number().int().nonnegative(),
		tokenCount: z.number().int().nonnegative(),
		truncated: z.boolean(),
		available: z.boolean(),
		error: z.string().nullable(),
	}),
	codeIndex: z.object({
		cachePath: z.string().nullable(),
		cacheExists: z.boolean(),
		embeddingProvider: z.string().nullable(),
		embeddingModel: z.string().nullable(),
		updatedAt: z.number().int().nonnegative().nullable(),
		totalFiles: z.number().int().nonnegative(),
		totalChunks: z.number().int().nonnegative(),
		indexedFiles: z.number().int().nonnegative(),
		indexedChunks: z.number().int().nonnegative(),
		staleFiles: z.number().int().nonnegative(),
		missingFiles: z.number().int().nonnegative(),
		searchAvailable: z.boolean(),
		progress: z.object({
			phase: z.enum(["idle", "scanning", "embedding", "persisting", "complete", "error"]),
			startedAt: z.number().int().nonnegative().nullable(),
			updatedAt: z.number().int().nonnegative().nullable(),
			filesTotal: z.number().int().nonnegative(),
			filesProcessed: z.number().int().nonnegative(),
			chunksTotal: z.number().int().nonnegative(),
			chunksProcessed: z.number().int().nonnegative(),
			cacheHitCount: z.number().int().nonnegative(),
			cacheMissCount: z.number().int().nonnegative(),
			message: z.string().nullable(),
		}),
		error: z.string().nullable(),
	}),
});
export type RuntimeNKleinCodeIntelligenceStatusResponse = z.infer<
	typeof runtimeNKleinCodeIntelligenceStatusResponseSchema
>;

export const runtimeNKleinAdvisorKindSchema = z.enum([
	"model_freshness",
	"mcp_discovery",
	"config_explainer",
	"log_analysis",
	"task_failure",
]);
export type RuntimeNKleinAdvisorKind = z.infer<typeof runtimeNKleinAdvisorKindSchema>;

export const runtimeNKleinAdvisorRequestSchema = z.object({
	kind: runtimeNKleinAdvisorKindSchema,
	title: z.string(),
	prompt: z.string(),
	requiresWebResearch: z.boolean(),
	recommendedSources: z.array(z.string()),
});
export type RuntimeNKleinAdvisorRequest = z.infer<typeof runtimeNKleinAdvisorRequestSchema>;

export const runtimeNKleinAdvisorBuildRequestSchema = z.object({
	kind: runtimeNKleinAdvisorKindSchema,
	repoSummary: z.string().optional(),
	modelRegistrySummary: z.string().optional(),
	runtimeConfigSummary: z.string().optional(),
	telemetrySummary: z.string().optional(),
	taskSummary: z.string().optional(),
	userQuestion: z.string().optional(),
});
export type RuntimeNKleinAdvisorBuildRequest = z.infer<typeof runtimeNKleinAdvisorBuildRequestSchema>;

export const runtimeNKleinAdvisorSendRequestSchema = z.object({
	prompt: z.string().min(1),
	providerId: z.string().min(1),
	modelId: z.string().min(1),
});
export type RuntimeNKleinAdvisorSendRequest = z.infer<typeof runtimeNKleinAdvisorSendRequestSchema>;

export const runtimeNKleinAdvisorSendResponseSchema = z.object({
	providerId: z.string(),
	modelId: z.string(),
	output: z.string(),
	sentAt: z.number().int().nonnegative(),
	receivedAt: z.number().int().nonnegative(),
});
export type RuntimeNKleinAdvisorSendResponse = z.infer<typeof runtimeNKleinAdvisorSendResponseSchema>;

export const runtimeNKleinDogfoodBacklogRequestSchema = z.object({
	suggestion: z.string().optional(),
	slug: z.string().optional(),
});
export type RuntimeNKleinDogfoodBacklogRequest = z.infer<typeof runtimeNKleinDogfoodBacklogRequestSchema>;

export const runtimeNKleinDogfoodBacklogResponseSchema = z.object({
	rootPath: z.string(),
	specPath: z.string(),
	planPath: z.string(),
	questionsPath: z.string(),
	decisionsPath: z.string(),
	revisionsPath: z.string(),
	summaryPath: z.string(),
	taskGraphPath: z.string(),
	slug: z.string(),
	taskCount: z.number().int().nonnegative(),
	nextCommand: z.string(),
});
export type RuntimeNKleinDogfoodBacklogResponse = z.infer<typeof runtimeNKleinDogfoodBacklogResponseSchema>;

export const runtimeNKleinSmokeEvalResponseSchema = z.object({
	workspacePath: z.string(),
	evidenceBundlePath: z.string(),
	acceptanceCommand: z.string(),
	passed: z.boolean(),
	exitCode: z.number().int().nullable(),
	output: z.string(),
	providerId: z.string(),
	modelId: z.string(),
	endpoint: z.string().nullable(),
});
export type RuntimeNKleinSmokeEvalResponse = z.infer<typeof runtimeNKleinSmokeEvalResponseSchema>;

export const runtimeTaskEvidenceRequestSchema = z.object({
	taskId: z.string().min(1),
});
export type RuntimeTaskEvidenceRequest = z.infer<typeof runtimeTaskEvidenceRequestSchema>;

export const runtimeTaskEvidenceResponseSchema = z.object({
	bundlePath: z.string(),
	summaryPath: z.string(),
	files: z.object({
		summary: z.string(),
		telemetry: z.string(),
		configSnapshot: z.string(),
		evalResult: z.string(),
		diffPatch: z.string().nullable(),
		transcripts: z.array(z.string()),
	}),
	summaryText: z.string(),
	diffPatchText: z.string().nullable(),
	promptBlock: z.string(),
});
export type RuntimeTaskEvidenceResponse = z.infer<typeof runtimeTaskEvidenceResponseSchema>;

export const runtimeNKleinProviderCapabilitySchema = z.enum([
	"streaming",
	"tools",
	"reasoning",
	"vision",
	"prompt-cache",
]);
export type RuntimeNKleinProviderCapability = z.infer<typeof runtimeNKleinProviderCapabilitySchema>;

export const runtimeNKleinAddProviderRequestSchema = z.object({
	providerId: z.string(),
	name: z.string(),
	baseUrl: z.string(),
	apiKey: z.string().nullable().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	timeoutMs: z.number().int().positive().optional(),
	models: z.array(z.string()),
	defaultModelId: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	capabilities: z.array(runtimeNKleinProviderCapabilitySchema).optional(),
});
export type RuntimeNKleinAddProviderRequest = z.infer<typeof runtimeNKleinAddProviderRequestSchema>;

export const runtimeNKleinAddProviderResponseSchema = runtimeNKleinProviderSettingsSchema;
export type RuntimeNKleinAddProviderResponse = z.infer<typeof runtimeNKleinAddProviderResponseSchema>;

export const runtimeNKleinUpdateProviderRequestSchema = z.object({
	providerId: z.string(),
	name: z.string().optional(),
	baseUrl: z.string().optional(),
	apiKey: z.string().nullable().optional(),
	headers: z.record(z.string(), z.string()).nullable().optional(),
	timeoutMs: z.number().int().positive().nullable().optional(),
	models: z.array(z.string()).optional(),
	defaultModelId: z.string().nullable().optional(),
	modelsSourceUrl: z.string().nullable().optional(),
	capabilities: z.array(runtimeNKleinProviderCapabilitySchema).optional(),
});
export type RuntimeNKleinUpdateProviderRequest = z.infer<typeof runtimeNKleinUpdateProviderRequestSchema>;

export const runtimeNKleinUpdateProviderResponseSchema = runtimeNKleinProviderSettingsSchema;
export type RuntimeNKleinUpdateProviderResponse = z.infer<typeof runtimeNKleinUpdateProviderResponseSchema>;

export const runtimeNKleinOauthLoginRequestSchema = z.object({
	provider: runtimeNKleinOauthProviderSchema,
	baseUrl: z.string().nullable().optional(),
});
export type RuntimeNKleinOauthLoginRequest = z.infer<typeof runtimeNKleinOauthLoginRequestSchema>;

export const runtimeNKleinOauthLoginResponseSchema = z.object({
	ok: z.boolean(),
	provider: runtimeNKleinOauthProviderSchema,
	settings: runtimeNKleinProviderSettingsSchema.optional(),
	error: z.string().optional(),
});
export type RuntimeNKleinOauthLoginResponse = z.infer<typeof runtimeNKleinOauthLoginResponseSchema>;

export const runtimeNKleinDeviceAuthStartResponseSchema = z.object({
	deviceCode: z.string(),
	userCode: z.string(),
	verificationUrl: z.string(),
	expiresInSeconds: z.number(),
	pollIntervalSeconds: z.number(),
});
export type RuntimeNKleinDeviceAuthStartResponse = z.infer<typeof runtimeNKleinDeviceAuthStartResponseSchema>;

export const runtimeNKleinDeviceAuthCompleteRequestSchema = z.object({
	deviceCode: z.string(),
	expiresInSeconds: z.number(),
	pollIntervalSeconds: z.number(),
	baseUrl: z.string().nullable().optional(),
});
export type RuntimeNKleinDeviceAuthCompleteRequest = z.infer<typeof runtimeNKleinDeviceAuthCompleteRequestSchema>;

export const runtimeNKleinDeviceAuthCompleteResponseSchema = runtimeNKleinOauthLoginResponseSchema;
export type RuntimeNKleinDeviceAuthCompleteResponse = z.infer<typeof runtimeNKleinDeviceAuthCompleteResponseSchema>;

export const runtimeNKleinProviderSettingsSaveRequestSchema = z.object({
	providerId: z.string(),
	modelId: z.string().nullable().optional(),
	apiKey: z.string().nullable().optional(),
	baseUrl: z.string().nullable().optional(),
	reasoningEffort: runtimeNKleinReasoningEffortSchema.nullable().optional(),
	region: z.string().nullable().optional(),
	aws: z
		.object({
			accessKey: z.string().nullable().optional(),
			secretKey: z.string().nullable().optional(),
			sessionToken: z.string().nullable().optional(),
			region: z.string().nullable().optional(),
			profile: z.string().nullable().optional(),
			authentication: z.enum(["iam", "api-key", "profile"]).nullable().optional(),
			endpoint: z.string().nullable().optional(),
		})
		.optional(),
	gcp: z
		.object({
			projectId: z.string().nullable().optional(),
			region: z.string().nullable().optional(),
		})
		.optional(),
});
export type RuntimeNKleinProviderSettingsSaveRequest = z.infer<typeof runtimeNKleinProviderSettingsSaveRequestSchema>;

export const runtimeNKleinProviderSettingsSaveResponseSchema = runtimeNKleinProviderSettingsSchema;
export type RuntimeNKleinProviderSettingsSaveResponse = z.infer<typeof runtimeNKleinProviderSettingsSaveResponseSchema>;

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
	sandboxMaxContainers: z.number().int().positive(),
	sandboxAgentsPerContainer: z.number().int().nonnegative(),
	sandboxMemoryPerContainerMb: z.number().int().positive(),
	sandboxCpusPerContainer: z.number().positive(),
	sandboxIdleTimeoutMinutes: z.number().int().positive(),
	lostHeartbeatPolicy: runtimeLostHeartbeatPolicySchema,
	decompositionAutoApplyEnabled: z.boolean(),
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
	// Optional during rollout: the runtime omits it until the config loader populates it (consumers default to
	// DEFAULT_AGENT_RULESETS_CONFIG). See src/core/agent-rulesets.ts.
	agentRulesets: agentRulesetsConfigSchema.optional(),
	commitPromptTemplate: z.string(),
	openPrPromptTemplate: z.string(),
	commitPromptTemplateDefault: z.string(),
	openPrPromptTemplateDefault: z.string(),
});
export type RuntimeConfigResponse = z.infer<typeof runtimeConfigResponseSchema>;

export const runtimeConfigSaveRequestSchema = z.object({
	selectedAgentId: runtimeAgentIdSchema.optional(),
	selectedShortcutLabel: z.string().nullable().optional(),
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
	sandboxMaxContainers: z.number().int().positive().optional(),
	sandboxAgentsPerContainer: z.number().int().nonnegative().optional(),
	sandboxMemoryPerContainerMb: z.number().int().positive().optional(),
	sandboxCpusPerContainer: z.number().positive().optional(),
	sandboxIdleTimeoutMinutes: z.number().int().positive().optional(),
	lostHeartbeatPolicy: runtimeLostHeartbeatPolicySchema.optional(),
	decompositionAutoApplyEnabled: z.boolean().optional(),
	codeEmbeddingDefaults: runtimeCodeEmbeddingSettingsSchema.optional(),
	codeEmbeddingOverride: runtimeCodeEmbeddingSettingsSchema.nullable().optional(),
	shortcuts: z.array(runtimeProjectShortcutSchema).optional(),
	modelRoles: runtimeModelRolesSchema.optional(),
	agentRulesets: agentRulesetsConfigSchema.optional(),
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

export const runtimeHookEventSchema = z.enum(["to_review", "to_in_progress", "activity"]);
export type RuntimeHookEvent = z.infer<typeof runtimeHookEventSchema>;

export const runtimeHookIngestRequestSchema = z.object({
	taskId: z.string(),
	workspaceId: z.string(),
	event: runtimeHookEventSchema,
	metadata: runtimeTaskHookActivitySchema.partial().optional(),
});
export type RuntimeHookIngestRequest = z.infer<typeof runtimeHookIngestRequestSchema>;

export const runtimeHookIngestResponseSchema = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
});
export type RuntimeHookIngestResponse = z.infer<typeof runtimeHookIngestResponseSchema>;
