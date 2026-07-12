import { z } from "zod";
import { concurrencyConfigSchema, concurrencyOverrideSchema } from "./concurrency-config.js";
import { runtimeNKleinProviderSettingsSchema } from "./nklein-provider-api-contract.js";
import { runtimeProjectShortcutSchema } from "./projects-api-contract.js";
import {
	agentRulesetsConfigSchema,
	runtimeAgentIdSchema,
	runtimeAgentTimeoutModeSchema,
	runtimeAgentTimeoutProfileSchema,
	runtimeCodeEmbeddingSettingsSchema,
	runtimeFileOverlapParallelismSchema,
	runtimeLlmfitCatalogUpdateModeSchema,
	runtimeLostHeartbeatPolicySchema,
	runtimeModelRolesSchema,
	runtimeModelSuitabilityPolicySchema,
	runtimeSandboxIsolationProfileSchema,
	runtimeSkillDynamicsLevelSchema,
	runtimeSwarmGuardrailsSchema,
	runtimeTimeoutMsSchema,
} from "./runtime-config-api-contract.js";

// Runtime config + agents contract domain: the agent definition + sandbox status, and the full config
// response / save request (selected agent, model roles, guardrails, timeouts, rulesets, provider settings,
// shortcuts). Split out of api-contract.ts (§5.X #2). Imports the config primitives from runtime-config +
// provider-settings (nklein-provider) + project-shortcut (projects) — never the barrel.

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
	// §5.AB: machine-aware loader per-device RAM budget "name:GB,name:GB"; optional so older clients/fixtures omit it.
	deviceRamGb: z.string().nullable().optional(),
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
	sandboxMaxConcurrentExec: z.number().int().nonnegative(),
	sandboxIdleTimeoutMinutes: z.number().int().positive(),
	sandboxIsolationProfileDefault: runtimeSandboxIsolationProfileSchema,
	sandboxIsolationProfileOverride: runtimeSandboxIsolationProfileSchema.nullable(),
	effectiveSandboxIsolationProfile: runtimeSandboxIsolationProfileSchema,
	lostHeartbeatPolicy: runtimeLostHeartbeatPolicySchema,
	decompositionAutoApplyEnabled: z.boolean(),
	/** §5.AB routing policy for HARD tasks when the best qualified model is busy: wait for it, or attempt with the
	 *  best available now. Default attempt_with_available (today's behavior). */
	hardTaskRoutingMode: z.enum(["wait_for_best", "attempt_with_available"]),
	/** §5.V test-driven delivery: a change that touched no test file bounces back to the worker before review.
	 *  Ships default OFF until the live bounce-vs-deliver validation; the design intent is default ON after. */
	testDrivenModeEnabled: z.boolean(),
	secondOpinionReviewEnabled: z.boolean(),
	reviewMaxRounds: z.number().int().positive(),
	codeEmbeddingDefaults: runtimeCodeEmbeddingSettingsSchema,
	codeEmbeddingOverride: runtimeCodeEmbeddingSettingsSchema.nullable(),
	concurrencyDefaults: concurrencyConfigSchema,
	concurrencyOverride: concurrencyOverrideSchema.nullable(),
	effectiveCodeEmbeddingSettings: runtimeCodeEmbeddingSettingsSchema,
	modelSuitabilityPolicyDefaults: runtimeModelSuitabilityPolicySchema,
	modelSuitabilityPolicyOverride: runtimeModelSuitabilityPolicySchema.nullable(),
	effectiveModelSuitabilityPolicy: runtimeModelSuitabilityPolicySchema,
	skillDynamicsLevelDefault: runtimeSkillDynamicsLevelSchema,
	skillDynamicsLevelOverride: runtimeSkillDynamicsLevelSchema.nullable(),
	effectiveSkillDynamicsLevel: runtimeSkillDynamicsLevelSchema,
	// §5.AK file-overlap parallelism — optional for backward compatibility with older runtimes/config files.
	fileOverlapParallelism: runtimeFileOverlapParallelismSchema.optional(),
	fileOverlapParallelismOverride: runtimeFileOverlapParallelismSchema.nullable().optional(),
	effectiveFileOverlapParallelism: runtimeFileOverlapParallelismSchema.optional(),
	developerModeEnabled: z.boolean().optional(),
	replayCardsEnabled: z.boolean().optional(),
	knowsTodayEnabled: z.boolean().optional(),
	sandboxMcpServersEnabled: z.boolean().optional(),
	// §5.BB env-flag promotions — optional for backward compatibility with older runtimes/config files. Each still
	// composes with its env override at the consuming seam (env keeps working for scripts/harnesses).
	basicMemoryEnabled: z.boolean().optional(),
	chatAdaptiveTruncationEnabled: z.boolean().optional(),
	reasoningBudgetEnabled: z.boolean().optional(),
	reviewLensesEnabled: z.boolean().optional(),
	capabilityBrokerEnabled: z.boolean().optional(),
	// §5.AC egress-gated online retrieval — optional for backward compatibility with older runtimes/config files.
	retrievalEgressEnabled: z.boolean().optional(),
	retrievalSearchBackendUrl: z.string().nullable().optional(),
	llmfitCatalogUpdateMode: runtimeLlmfitCatalogUpdateModeSchema.optional(),
	// §5.AW opportunistic speculative best-of-N — optional for backward compatibility with older runtimes/config files.
	speculativeBestOfNEnabled: z.boolean().optional(),
	speculativeMaxConcurrentSpecs: z.number().int().positive().optional(),
	speculativeMaxSpecsPerRun: z.number().int().positive().optional(),
	setupWizardCompletedAt: z.number().nullable().optional(),
	projectSetupWizardCompletedAt: z.number().nullable().optional(),
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
	deviceRamGb: z.string().nullable().optional(),
	developerModeEnabled: z.boolean().optional(),
	replayCardsEnabled: z.boolean().optional(),
	setupWizardCompletedAt: z.number().nullable().optional(),
	projectSetupWizardCompletedAt: z.number().nullable().optional(),
	knowsTodayEnabled: z.boolean().optional(),
	sandboxMcpServersEnabled: z.boolean().optional(),
	basicMemoryEnabled: z.boolean().optional(),
	chatAdaptiveTruncationEnabled: z.boolean().optional(),
	reasoningBudgetEnabled: z.boolean().optional(),
	reviewLensesEnabled: z.boolean().optional(),
	capabilityBrokerEnabled: z.boolean().optional(),
	retrievalEgressEnabled: z.boolean().optional(),
	retrievalSearchBackendUrl: z.string().nullable().optional(),
	llmfitCatalogUpdateMode: runtimeLlmfitCatalogUpdateModeSchema.optional(),
	speculativeBestOfNEnabled: z.boolean().optional(),
	speculativeMaxConcurrentSpecs: z.number().int().positive().optional(),
	speculativeMaxSpecsPerRun: z.number().int().positive().optional(),
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
	sandboxMaxConcurrentExec: z.number().int().nonnegative().optional(),
	sandboxIdleTimeoutMinutes: z.number().int().positive().optional(),
	sandboxIsolationProfileDefault: runtimeSandboxIsolationProfileSchema.optional(),
	sandboxIsolationProfileOverride: runtimeSandboxIsolationProfileSchema.nullable().optional(),
	lostHeartbeatPolicy: runtimeLostHeartbeatPolicySchema.optional(),
	decompositionAutoApplyEnabled: z.boolean().optional(),
	hardTaskRoutingMode: z.enum(["wait_for_best", "attempt_with_available"]).optional(),
	testDrivenModeEnabled: z.boolean().optional(),
	secondOpinionReviewEnabled: z.boolean().optional(),
	reviewMaxRounds: z.number().int().positive().optional(),
	codeEmbeddingDefaults: runtimeCodeEmbeddingSettingsSchema.optional(),
	codeEmbeddingOverride: runtimeCodeEmbeddingSettingsSchema.nullable().optional(),
	modelSuitabilityPolicyDefaults: runtimeModelSuitabilityPolicySchema.optional(),
	modelSuitabilityPolicyOverride: runtimeModelSuitabilityPolicySchema.nullable().optional(),
	skillDynamicsLevelDefault: runtimeSkillDynamicsLevelSchema.optional(),
	skillDynamicsLevelOverride: runtimeSkillDynamicsLevelSchema.nullable().optional(),
	fileOverlapParallelism: runtimeFileOverlapParallelismSchema.optional(),
	fileOverlapParallelismOverride: runtimeFileOverlapParallelismSchema.nullable().optional(),
	concurrencyDefaults: concurrencyConfigSchema.optional(),
	concurrencyOverride: concurrencyOverrideSchema.nullable().optional(),
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

/**
 * §5.BA guided-setup wizard response. A resolved list of {@link SetupPlanStep}s (from the pure detection cores in
 * setup-detection.ts) plus the completion stamp, so the UI can render the wizard and know whether it should
 * auto-fire on first run. The `kind` disambiguates the global vs per-project plan a caller requested.
 */
export const runtimeSetupPlanStepSchema = z.object({
	stepId: z.string(),
	title: z.string(),
	recommendation: z.string(),
	detail: z.string(),
});
export type RuntimeSetupPlanStep = z.infer<typeof runtimeSetupPlanStepSchema>;

export const runtimeSetupPlanResponseSchema = z.object({
	kind: z.enum(["global", "project"]),
	steps: z.array(runtimeSetupPlanStepSchema),
	/** Completion stamp (epoch millis) — null = never completed, so the wizard auto-fires. */
	completedAt: z.number().nullable(),
});
export type RuntimeSetupPlanResponse = z.infer<typeof runtimeSetupPlanResponseSchema>;

/**
 * §5.AX fleet-strip live status: per-model machine names (from the LM-Link `lms ps` feed) + prompt-shell
 * warmth (the §5.AQ warmth ledger), keyed by the SERVED model id. Both maps are best-effort — an unavailable
 * `lms ps` or a not-yet-loaded session service yields empty maps and the strip falls back to endpoint labels /
 * plain "idle" rows.
 */
export const runtimeFleetStatusResponseSchema = z.object({
	/** served model id → owning machine id ("Local", "laptop", …). */
	machineByModelId: z.record(z.string(), z.string()),
	/** served model id → the last prompt-shell this model assembled (its warm cache). */
	warmthByModelId: z.record(
		z.string(),
		z.object({
			/** The shell's session kind ("worker" / "review" / "architect" / …). */
			kind: z.string(),
			/** When the shell was assembled (epoch ms) — the client decides freshness. */
			at: z.number(),
		}),
	),
});
export type RuntimeFleetStatusResponse = z.infer<typeof runtimeFleetStatusResponseSchema>;

/** W3.4 mailbox badge: pending §5.AU mailbox-note counts per card (only non-zero entries ride the wire). */
export const runtimeCardMailboxCountsRequestSchema = z.object({
	/** The board's card ids to check (bounded — a board is at most a few hundred cards). */
	taskIds: z.array(z.string()).max(500),
});
export type RuntimeCardMailboxCountsRequest = z.infer<typeof runtimeCardMailboxCountsRequestSchema>;

export const runtimeCardMailboxCountsResponseSchema = z.object({
	/** taskId → pending-note count; absent = zero. */
	counts: z.record(z.string(), z.number().int().nonnegative()),
});
export type RuntimeCardMailboxCountsResponse = z.infer<typeof runtimeCardMailboxCountsResponseSchema>;
