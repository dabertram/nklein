/**
 * F1.28 — the runtime-config SAVE payload assembly, extracted verbatim from the `saveRuntimeConfig` facade (the
 * last inline WRITE concern): the typed save input plus the three pure builders that shape it into the global
 * config file payload, the project config file payload, and the saved in-memory state values. Zero semantics
 * change — every normalization and default is byte-identical to the pre-split literals; the facade owns only
 * locking, path resolution, and the writes.
 */

import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeFileOverlapParallelism,
	RuntimeLlmfitCatalogUpdateMode,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeModelSuitabilityPolicy,
	RuntimeProjectShortcut,
	RuntimeSandboxIsolationProfile,
	RuntimeSkillDynamicsLevel,
	RuntimeSwarmGuardrails,
} from "../core/api-contract";
import { normalizeRuntimeSwarmGuardrails } from "../core/api-contract";
import type { ConcurrencyConfig, ConcurrencyOverride } from "../core/concurrency-config";
import { DEFAULT_CONCURRENCY_CONFIG } from "../core/concurrency-config";
import type { ModelStatsTrackingLevel } from "../core/model-stats-tracking-level";
import { normalizeModelStatsTrackingLevel } from "../core/model-stats-tracking-level";

import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../nklein-agent/nklein-agent-sandbox";

import {
	DEFAULT_BASIC_MEMORY_ENABLED,
	DEFAULT_CAPABILITY_BROKER_ENABLED,
	DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED,
	DEFAULT_CODE_EMBEDDING_SETTINGS,
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_KNOWS_TODAY_ENABLED,
	DEFAULT_LLMFIT_CATALOG_UPDATE_MODE,
	DEFAULT_REASONING_BUDGET_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
	DEFAULT_REVIEW_LENSES_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
	DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "./runtime-config-defaults";

import {
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	normalizeAgentRulesets,
	normalizeBoolean,
	normalizeLlmfitCatalogUpdateMode,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasks,
	normalizeModelRoles,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
} from "./runtime-config-normalizers";

import { normalizeFileOverlapParallelism } from "./runtime-config-overlap-resolver";

import {
	normalizeRetrievalEgressEnabled,
	normalizeRetrievalSearchBackendUrl,
} from "./runtime-config-retrieval-resolver";

import { normalizeRuntimeSandboxIsolationProfileOverride } from "./runtime-config-sandbox-resolver";

import { normalizeSetupWizardCompletedAt } from "./runtime-config-setup-wizard-resolver";

import {
	normalizeSpeculativeBestOfNEnabled,
	normalizeSpeculativeMaxConcurrentSpecs,
	normalizeSpeculativeMaxSpecsPerRun,
} from "./runtime-config-speculative-resolver";

export interface SaveRuntimeConfigInput {
	selectedAgentId: RuntimeAgentId;
	selectedShortcutLabel: string | null;
	workspaceBaseDir: string | null;
	deviceRamGb: string | null;
	sandboxEgressProxyEnabled?: boolean;
	sandboxEgressAllowlist: string | null;
	developerModeEnabled?: boolean;
	replayCardsEnabled?: boolean;
	setupWizardCompletedAt?: number | null;
	projectSetupWizardCompletedAt?: number | null;
	knowsTodayEnabled?: boolean;
	sandboxMcpServersEnabled?: boolean;
	basicMemoryEnabled?: boolean;
	chatAdaptiveTruncationEnabled?: boolean;
	reasoningBudgetEnabled?: boolean;
	reviewLensesEnabled?: boolean;
	capabilityBrokerEnabled?: boolean;
	modelStatsTrackingLevel?: ModelStatsTrackingLevel;
	retrievalEgressEnabled?: boolean;
	retrievalSearchBackendUrl?: string | null;
	llmfitCatalogUpdateMode?: RuntimeLlmfitCatalogUpdateMode;
	speculativeBestOfNEnabled?: boolean;
	speculativeMaxConcurrentSpecs?: number;
	speculativeMaxSpecsPerRun?: number;
	agentAutonomousModeEnabled: boolean;
	agentTimeoutMode: RuntimeAgentTimeoutMode;
	agentTimeoutProfile: RuntimeAgentTimeoutProfile;
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	maxAgentWritableFileLines?: number;
	maxConcurrentTasks?: number;
	sandboxMaxContainers?: number;
	sandboxAgentsPerContainer?: number;
	sandboxMemoryPerContainerMb?: number;
	sandboxCpusPerContainer?: number;
	sandboxMaxConcurrentExec?: number;
	sandboxIdleTimeoutMinutes?: number;
	sandboxIsolationProfileDefault?: RuntimeSandboxIsolationProfile;
	sandboxIsolationProfileOverride?: RuntimeSandboxIsolationProfile | null;
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
	hardTaskRoutingMode?: "wait_for_best" | "attempt_with_available";
	testDrivenModeEnabled?: boolean;
	testDrivenModeOverride?: boolean | null;
	secondOpinionReviewEnabled?: boolean;
	reviewMaxRounds?: number;
	readyForReviewNotificationsEnabled: boolean;
	codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
	modelSuitabilityPolicyDefaults?: RuntimeModelSuitabilityPolicy;
	modelSuitabilityPolicyOverride?: RuntimeModelSuitabilityPolicy | null;
	skillDynamicsLevelDefault?: RuntimeSkillDynamicsLevel;
	skillDynamicsLevelOverride?: RuntimeSkillDynamicsLevel | null;
	fileOverlapParallelism?: RuntimeFileOverlapParallelism;
	fileOverlapParallelismOverride?: RuntimeFileOverlapParallelism | null;
	concurrencyDefaults?: ConcurrencyConfig;
	concurrencyOverride?: ConcurrencyOverride | null;
	maxConcurrentTasksOverride?: number | null;
	selectedAgentIdOverride?: RuntimeAgentId | null;
	agentRulesetsOverride?: AgentRulesetsConfigPayload | null;
	modelRoles?: RuntimeModelRoles;
	modelRolesOverride?: RuntimeModelRoles | null;
	agentRulesets?: AgentRulesetsConfigPayload;
	swarmGuardrails?: RuntimeSwarmGuardrails;
	shortcuts: RuntimeProjectShortcut[];
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
}

/** The global-config-file payload for one save (verbatim normalization). */
export function buildGlobalConfigFilePayload(config: SaveRuntimeConfigInput) {
	return {
		selectedAgentId: config.selectedAgentId,
		selectedShortcutLabel: config.selectedShortcutLabel,
		workspaceBaseDir: config.workspaceBaseDir,
		deviceRamGb: config.deviceRamGb,
		sandboxEgressProxyEnabled: normalizeBoolean(
			config.sandboxEgressProxyEnabled,
			DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
		),
		sandboxEgressAllowlist: config.sandboxEgressAllowlist,
		developerModeEnabled: normalizeBoolean(config.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED),
		replayCardsEnabled: normalizeBoolean(config.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED),
		setupWizardCompletedAt: normalizeSetupWizardCompletedAt(config.setupWizardCompletedAt),
		knowsTodayEnabled: normalizeBoolean(config.knowsTodayEnabled, DEFAULT_KNOWS_TODAY_ENABLED),
		sandboxMcpServersEnabled: normalizeBoolean(config.sandboxMcpServersEnabled, DEFAULT_SANDBOX_MCP_SERVERS_ENABLED),
		basicMemoryEnabled: normalizeBoolean(config.basicMemoryEnabled, DEFAULT_BASIC_MEMORY_ENABLED),
		chatAdaptiveTruncationEnabled: normalizeBoolean(
			config.chatAdaptiveTruncationEnabled,
			DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED,
		),
		reasoningBudgetEnabled: normalizeBoolean(config.reasoningBudgetEnabled, DEFAULT_REASONING_BUDGET_ENABLED),
		reviewLensesEnabled: normalizeBoolean(config.reviewLensesEnabled, DEFAULT_REVIEW_LENSES_ENABLED),
		capabilityBrokerEnabled: normalizeBoolean(config.capabilityBrokerEnabled, DEFAULT_CAPABILITY_BROKER_ENABLED),
		modelStatsTrackingLevel: normalizeModelStatsTrackingLevel(config.modelStatsTrackingLevel),
		retrievalEgressEnabled: normalizeRetrievalEgressEnabled(config.retrievalEgressEnabled),
		retrievalSearchBackendUrl: normalizeRetrievalSearchBackendUrl(config.retrievalSearchBackendUrl),
		llmfitCatalogUpdateMode: normalizeLlmfitCatalogUpdateMode(config.llmfitCatalogUpdateMode),
		speculativeBestOfNEnabled: normalizeSpeculativeBestOfNEnabled(config.speculativeBestOfNEnabled),
		speculativeMaxConcurrentSpecs: normalizeSpeculativeMaxConcurrentSpecs(config.speculativeMaxConcurrentSpecs),
		speculativeMaxSpecsPerRun: normalizeSpeculativeMaxSpecsPerRun(config.speculativeMaxSpecsPerRun),
		fileOverlapParallelism: normalizeFileOverlapParallelism(config.fileOverlapParallelism),
		agentAutonomousModeEnabled: config.agentAutonomousModeEnabled,
		agentTimeoutMode: config.agentTimeoutMode,
		agentTimeoutProfile: config.agentTimeoutProfile,
		requestTimeoutMs: config.requestTimeoutMs,
		streamTimeoutMs: config.streamTimeoutMs,
		toolTimeoutMs: config.toolTimeoutMs,
		agentTimeoutMs: config.agentTimeoutMs,
		conversationTimeoutMs: config.conversationTimeoutMs,
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(config.maxAgentWritableFileLines),
		maxConcurrentTasks: normalizeMaxConcurrentTasks(config.maxConcurrentTasks),
		sandboxMaxContainers: normalizePositiveInteger(config.sandboxMaxContainers, DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS),
		sandboxAgentsPerContainer: normalizeNonNegativeInteger(
			config.sandboxAgentsPerContainer,
			DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
		),
		sandboxMemoryPerContainerMb: normalizePositiveInteger(
			config.sandboxMemoryPerContainerMb,
			DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
		),
		sandboxCpusPerContainer: normalizePositiveNumber(
			config.sandboxCpusPerContainer,
			DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
		),
		sandboxMaxConcurrentExec: normalizeNonNegativeInteger(
			config.sandboxMaxConcurrentExec,
			DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
		),
		sandboxIdleTimeoutMinutes: normalizePositiveInteger(
			config.sandboxIdleTimeoutMinutes,
			DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
		),
		sandboxIsolationProfileDefault: config.sandboxIsolationProfileDefault,
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy),
		decompositionAutoApplyEnabled: normalizeBoolean(
			config.decompositionAutoApplyEnabled,
			DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
		),
		hardTaskRoutingMode:
			config.hardTaskRoutingMode === "wait_for_best"
				? ("wait_for_best" as const)
				: ("attempt_with_available" as const),
		testDrivenModeEnabled: config.testDrivenModeEnabled === true,
		secondOpinionReviewEnabled: normalizeBoolean(
			config.secondOpinionReviewEnabled,
			DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
		),
		reviewMaxRounds: normalizePositiveInteger(config.reviewMaxRounds, DEFAULT_REVIEW_MAX_ROUNDS),
		readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
		codeEmbeddingDefaults: config.codeEmbeddingDefaults,
		modelSuitabilityPolicyDefaults: config.modelSuitabilityPolicyDefaults,
		skillDynamicsLevelDefault: config.skillDynamicsLevelDefault,
		modelRoles: config.modelRoles,
		agentRulesets: config.agentRulesets,
		swarmGuardrails: config.swarmGuardrails,
		commitPromptTemplate: config.commitPromptTemplate,
		openPrPromptTemplate: config.openPrPromptTemplate,
	};
}

/** The project-config-file payload for one save (verbatim). */
export function buildProjectConfigFilePayload(config: SaveRuntimeConfigInput) {
	return {
		shortcuts: config.shortcuts,
		projectSetupWizardCompletedAt: config.projectSetupWizardCompletedAt,
		codeEmbeddingOverride: config.codeEmbeddingOverride,
		modelSuitabilityPolicyOverride: config.modelSuitabilityPolicyOverride,
		skillDynamicsLevelOverride: config.skillDynamicsLevelOverride,
		testDrivenModeOverride: config.testDrivenModeOverride ?? null,
		fileOverlapParallelismOverride: config.fileOverlapParallelismOverride,
		maxConcurrentTasksOverride: config.maxConcurrentTasksOverride,
		selectedAgentIdOverride: config.selectedAgentIdOverride,
		agentRulesetsOverride: config.agentRulesetsOverride,
		modelRolesOverride: config.modelRolesOverride,
		sandboxIsolationProfileOverride: config.sandboxIsolationProfileOverride,
	};
}

/** The saved in-memory state values (verbatim; the facade adds the resolved paths). */
export function buildSavedRuntimeConfigStateValues(config: SaveRuntimeConfigInput) {
	return {
		selectedAgentId: config.selectedAgentId,
		selectedShortcutLabel: config.selectedShortcutLabel,
		workspaceBaseDir: config.workspaceBaseDir,
		deviceRamGb: config.deviceRamGb,
		sandboxEgressProxyEnabled: normalizeBoolean(
			config.sandboxEgressProxyEnabled,
			DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
		),
		sandboxEgressAllowlist: config.sandboxEgressAllowlist,
		developerModeEnabled: normalizeBoolean(config.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED),
		replayCardsEnabled: normalizeBoolean(config.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED),
		setupWizardCompletedAt: normalizeSetupWizardCompletedAt(config.setupWizardCompletedAt),
		projectSetupWizardCompletedAt: normalizeSetupWizardCompletedAt(config.projectSetupWizardCompletedAt),
		knowsTodayEnabled: normalizeBoolean(config.knowsTodayEnabled, DEFAULT_KNOWS_TODAY_ENABLED),
		sandboxMcpServersEnabled: normalizeBoolean(config.sandboxMcpServersEnabled, DEFAULT_SANDBOX_MCP_SERVERS_ENABLED),
		basicMemoryEnabled: normalizeBoolean(config.basicMemoryEnabled, DEFAULT_BASIC_MEMORY_ENABLED),
		chatAdaptiveTruncationEnabled: normalizeBoolean(
			config.chatAdaptiveTruncationEnabled,
			DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED,
		),
		reasoningBudgetEnabled: normalizeBoolean(config.reasoningBudgetEnabled, DEFAULT_REASONING_BUDGET_ENABLED),
		reviewLensesEnabled: normalizeBoolean(config.reviewLensesEnabled, DEFAULT_REVIEW_LENSES_ENABLED),
		capabilityBrokerEnabled: normalizeBoolean(config.capabilityBrokerEnabled, DEFAULT_CAPABILITY_BROKER_ENABLED),
		modelStatsTrackingLevel: normalizeModelStatsTrackingLevel(config.modelStatsTrackingLevel),
		retrievalEgressEnabled: normalizeRetrievalEgressEnabled(config.retrievalEgressEnabled),
		retrievalSearchBackendUrl: normalizeRetrievalSearchBackendUrl(config.retrievalSearchBackendUrl),
		llmfitCatalogUpdateMode: normalizeLlmfitCatalogUpdateMode(
			config.llmfitCatalogUpdateMode ?? DEFAULT_LLMFIT_CATALOG_UPDATE_MODE,
		),
		speculativeBestOfNEnabled: normalizeSpeculativeBestOfNEnabled(config.speculativeBestOfNEnabled),
		speculativeMaxConcurrentSpecs: normalizeSpeculativeMaxConcurrentSpecs(config.speculativeMaxConcurrentSpecs),
		speculativeMaxSpecsPerRun: normalizeSpeculativeMaxSpecsPerRun(config.speculativeMaxSpecsPerRun),
		fileOverlapParallelism: normalizeFileOverlapParallelism(config.fileOverlapParallelism),
		fileOverlapParallelismOverride: config.fileOverlapParallelismOverride ?? null,
		agentAutonomousModeEnabled: config.agentAutonomousModeEnabled,
		agentTimeoutMode: config.agentTimeoutMode,
		agentTimeoutProfile: config.agentTimeoutProfile,
		requestTimeoutMs: config.requestTimeoutMs,
		streamTimeoutMs: config.streamTimeoutMs,
		toolTimeoutMs: config.toolTimeoutMs,
		agentTimeoutMs: config.agentTimeoutMs,
		conversationTimeoutMs: config.conversationTimeoutMs,
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(config.maxAgentWritableFileLines),
		maxConcurrentTasks: normalizeMaxConcurrentTasks(config.maxConcurrentTasks),
		maxConcurrentTasksOverride: config.maxConcurrentTasksOverride ?? null,
		selectedAgentIdOverride: config.selectedAgentIdOverride ?? null,
		agentRulesetsOverride: config.agentRulesetsOverride ?? null,
		modelRolesOverride: config.modelRolesOverride ?? null,
		sandboxMaxContainers: normalizePositiveInteger(config.sandboxMaxContainers, DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS),
		sandboxAgentsPerContainer: normalizeNonNegativeInteger(
			config.sandboxAgentsPerContainer,
			DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
		),
		sandboxMemoryPerContainerMb: normalizePositiveInteger(
			config.sandboxMemoryPerContainerMb,
			DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
		),
		sandboxCpusPerContainer: normalizePositiveNumber(
			config.sandboxCpusPerContainer,
			DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
		),
		sandboxMaxConcurrentExec: normalizeNonNegativeInteger(
			config.sandboxMaxConcurrentExec,
			DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
		),
		sandboxIdleTimeoutMinutes: normalizePositiveInteger(
			config.sandboxIdleTimeoutMinutes,
			DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
		),
		sandboxIsolationProfileDefault: config.sandboxIsolationProfileDefault,
		sandboxIsolationProfileOverride: normalizeRuntimeSandboxIsolationProfileOverride(
			config.sandboxIsolationProfileOverride,
		),
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy),
		decompositionAutoApplyEnabled: normalizeBoolean(
			config.decompositionAutoApplyEnabled,
			DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
		),
		hardTaskRoutingMode:
			config.hardTaskRoutingMode === "wait_for_best"
				? ("wait_for_best" as const)
				: ("attempt_with_available" as const),
		testDrivenModeEnabled: config.testDrivenModeEnabled === true,
		secondOpinionReviewEnabled: normalizeBoolean(
			config.secondOpinionReviewEnabled,
			DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
		),
		reviewMaxRounds: normalizePositiveInteger(config.reviewMaxRounds, DEFAULT_REVIEW_MAX_ROUNDS),
		readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
		codeEmbeddingDefaults: config.codeEmbeddingDefaults ?? DEFAULT_CODE_EMBEDDING_SETTINGS,
		codeEmbeddingOverride: config.codeEmbeddingOverride ?? null,
		modelSuitabilityPolicyDefaults: config.modelSuitabilityPolicyDefaults ?? DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
		modelSuitabilityPolicyOverride: config.modelSuitabilityPolicyOverride ?? null,
		skillDynamicsLevelDefault: config.skillDynamicsLevelDefault ?? DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
		skillDynamicsLevelOverride: config.skillDynamicsLevelOverride ?? null,
		testDrivenModeOverride: config.testDrivenModeOverride ?? null,
		concurrencyDefaults: config.concurrencyDefaults ?? DEFAULT_CONCURRENCY_CONFIG,
		concurrencyOverride: config.concurrencyOverride ?? null,
		modelRoles: normalizeModelRoles(config.modelRoles),
		agentRulesets: normalizeAgentRulesets(config.agentRulesets),
		swarmGuardrails: normalizeRuntimeSwarmGuardrails(config.swarmGuardrails),
		shortcuts: config.shortcuts,
		commitPromptTemplate: config.commitPromptTemplate,
		openPrPromptTemplate: config.openPrPromptTemplate,
	};
}
