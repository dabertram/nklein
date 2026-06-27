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
	runtimeLostHeartbeatPolicySchema,
	runtimeModelRolesSchema,
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
	concurrencyDefaults: concurrencyConfigSchema,
	concurrencyOverride: concurrencyOverrideSchema.nullable(),
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
