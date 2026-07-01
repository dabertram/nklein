// Pure merge of an update payload onto the current state for the global-scoped runtime-config fields
// (extracted from runtime-config.ts, §5.U). Both updateRuntimeConfig (project save) and
// updateGlobalRuntimeConfig built this same ~34-field block; they differ only in the project-override
// fields and `shortcuts`, which each caller composes on top of this result. Each field keeps the
// caller's update when provided (normalizing it) and otherwise retains the current value.
import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import { normalizeRuntimeSwarmGuardrails } from "../core/api-contract";
import { normalizeConcurrencyConfig } from "../core/concurrency-config";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../nklein-agent/nklein-agent-sandbox";
import {
	DEFAULT_CODE_EMBEDDING_SETTINGS,
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_KNOWS_TODAY_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "./runtime-config-defaults";
import {
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	normalizeAgentRulesets,
	normalizeBoolean,
	normalizeCodeEmbeddingSettings,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasks,
	normalizeModelRoles,
	normalizeModelSuitabilityPolicy,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
	normalizeSkillDynamicsLevel,
} from "./runtime-config-normalizers";
import type { RuntimeConfigState, RuntimeConfigUpdateInput } from "./runtime-config-types";
import { keepNormalizedValue, keepUpdatedValue } from "./runtime-config-value-helpers";

/** Merge the global-scoped fields of an update payload onto the current config (project overrides excluded). */
export function mergeGlobalRuntimeConfigFields(updates: RuntimeConfigUpdateInput, current: RuntimeConfigState) {
	return {
		selectedAgentId: keepUpdatedValue(updates.selectedAgentId, current.selectedAgentId),
		selectedShortcutLabel: keepUpdatedValue(updates.selectedShortcutLabel, current.selectedShortcutLabel),
		workspaceBaseDir: keepUpdatedValue(updates.workspaceBaseDir, current.workspaceBaseDir),
		developerModeEnabled: keepNormalizedValue(updates.developerModeEnabled, current.developerModeEnabled, (value) =>
			normalizeBoolean(value, DEFAULT_DEVELOPER_MODE_ENABLED),
		),
		replayCardsEnabled: keepNormalizedValue(updates.replayCardsEnabled, current.replayCardsEnabled, (value) =>
			normalizeBoolean(value, DEFAULT_REPLAY_CARDS_ENABLED),
		),
		knowsTodayEnabled: keepNormalizedValue(updates.knowsTodayEnabled, current.knowsTodayEnabled, (value) =>
			normalizeBoolean(value, DEFAULT_KNOWS_TODAY_ENABLED),
		),
		agentAutonomousModeEnabled: keepUpdatedValue(
			updates.agentAutonomousModeEnabled,
			current.agentAutonomousModeEnabled,
		),
		agentTimeoutMode: keepUpdatedValue(updates.agentTimeoutMode, current.agentTimeoutMode),
		agentTimeoutProfile: keepUpdatedValue(updates.agentTimeoutProfile, current.agentTimeoutProfile),
		requestTimeoutMs: keepUpdatedValue(updates.requestTimeoutMs, current.requestTimeoutMs),
		streamTimeoutMs: keepUpdatedValue(updates.streamTimeoutMs, current.streamTimeoutMs),
		toolTimeoutMs: keepUpdatedValue(updates.toolTimeoutMs, current.toolTimeoutMs),
		agentTimeoutMs: keepUpdatedValue(updates.agentTimeoutMs, current.agentTimeoutMs),
		conversationTimeoutMs: keepUpdatedValue(updates.conversationTimeoutMs, current.conversationTimeoutMs),
		maxAgentWritableFileLines: keepNormalizedValue(
			updates.maxAgentWritableFileLines,
			current.maxAgentWritableFileLines,
			normalizeMaxAgentWritableFileLines,
		),
		maxConcurrentTasks: keepNormalizedValue(
			updates.maxConcurrentTasks,
			current.maxConcurrentTasks,
			normalizeMaxConcurrentTasks,
		),
		sandboxMaxContainers: keepNormalizedValue(updates.sandboxMaxContainers, current.sandboxMaxContainers, (value) =>
			normalizePositiveInteger(value, DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS),
		),
		sandboxAgentsPerContainer: keepNormalizedValue(
			updates.sandboxAgentsPerContainer,
			current.sandboxAgentsPerContainer,
			(value) => normalizeNonNegativeInteger(value, DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER),
		),
		sandboxMemoryPerContainerMb: keepNormalizedValue(
			updates.sandboxMemoryPerContainerMb,
			current.sandboxMemoryPerContainerMb,
			(value) => normalizePositiveInteger(value, DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB),
		),
		sandboxCpusPerContainer: keepNormalizedValue(
			updates.sandboxCpusPerContainer,
			current.sandboxCpusPerContainer,
			(value) => normalizePositiveNumber(value, DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER),
		),
		sandboxIdleTimeoutMinutes: keepNormalizedValue(
			updates.sandboxIdleTimeoutMinutes,
			current.sandboxIdleTimeoutMinutes,
			(value) => normalizePositiveInteger(value, DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES),
		),
		lostHeartbeatPolicy: keepNormalizedValue(
			updates.lostHeartbeatPolicy,
			current.lostHeartbeatPolicy,
			normalizeLostHeartbeatPolicy,
		),
		decompositionAutoApplyEnabled: keepNormalizedValue(
			updates.decompositionAutoApplyEnabled,
			current.decompositionAutoApplyEnabled,
			(value) => normalizeBoolean(value, DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED),
		),
		secondOpinionReviewEnabled: keepNormalizedValue(
			updates.secondOpinionReviewEnabled,
			current.secondOpinionReviewEnabled,
			(value) => normalizeBoolean(value, DEFAULT_SECOND_OPINION_REVIEW_ENABLED),
		),
		reviewMaxRounds: keepNormalizedValue(updates.reviewMaxRounds, current.reviewMaxRounds, (value) =>
			normalizePositiveInteger(value, DEFAULT_REVIEW_MAX_ROUNDS),
		),
		readyForReviewNotificationsEnabled: keepUpdatedValue(
			updates.readyForReviewNotificationsEnabled,
			current.readyForReviewNotificationsEnabled,
		),
		codeEmbeddingDefaults: keepNormalizedValue(
			updates.codeEmbeddingDefaults,
			current.codeEmbeddingDefaults,
			(value) => normalizeCodeEmbeddingSettings(value, DEFAULT_CODE_EMBEDDING_SETTINGS),
		),
		modelSuitabilityPolicyDefaults: keepNormalizedValue(
			updates.modelSuitabilityPolicyDefaults,
			current.modelSuitabilityPolicyDefaults,
			(value) => normalizeModelSuitabilityPolicy(value, DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG),
		),
		skillDynamicsLevelDefault: keepNormalizedValue(
			updates.skillDynamicsLevelDefault,
			current.skillDynamicsLevelDefault,
			(value) => normalizeSkillDynamicsLevel(value, DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG),
		),
		concurrencyDefaults: keepNormalizedValue(
			updates.concurrencyDefaults,
			current.concurrencyDefaults,
			normalizeConcurrencyConfig,
		),
		modelRoles: keepNormalizedValue(updates.modelRoles, current.modelRoles, normalizeModelRoles),
		agentRulesets: keepNormalizedValue(updates.agentRulesets, current.agentRulesets, normalizeAgentRulesets),
		swarmGuardrails: keepNormalizedValue(
			updates.swarmGuardrails,
			current.swarmGuardrails,
			normalizeRuntimeSwarmGuardrails,
		),
		commitPromptTemplate: keepUpdatedValue(updates.commitPromptTemplate, current.commitPromptTemplate),
		openPrPromptTemplate: keepUpdatedValue(updates.openPrPromptTemplate, current.openPrPromptTemplate),
	};
}
