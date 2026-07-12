// Persists !Klein-owned runtime preferences on disk.
// This module should store !Klein settings such as selected agents,
// shortcuts, and prompt templates, not SDK-owned NKlein secrets or OAuth data.

import { getRuntimeAgentCatalogEntry } from "../core/agent-catalog";
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
import {
	type ConcurrencyConfig,
	type ConcurrencyOverride,
	DEFAULT_CONCURRENCY_CONFIG,
	normalizeConcurrencyOverride,
} from "../core/concurrency-config";
import { type ModelStatsTrackingLevel, normalizeModelStatsTrackingLevel } from "../core/model-stats-tracking-level";
import { lockedFileSystem } from "../fs/locked-file-system";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../nklein-agent/nklein-agent-sandbox";
import { detectInstalledCommands } from "../terminal/agent-registry";
import { resolveRuntimeAgentIdConfig } from "./runtime-config-agent-id-resolver";
import {
	RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS,
	RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS,
	runtimeConfigStateHasChanges,
} from "./runtime-config-change-detection";

export {
	RUNTIME_CONFIG_DERIVED_FIELD_KEYS,
	RUNTIME_PROJECT_CONFIG_CHANGE_FIELD_KEYS,
} from "./runtime-config-change-detection";

import { resolveRuntimeConcurrencyConfig } from "./runtime-config-concurrency-resolver";
import {
	AUTO_SELECT_AGENT_PRIORITY,
	DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
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
import { resolveRuntimeEmbeddingConfig } from "./runtime-config-embedding-resolver";
import {
	readRuntimeConfigFile,
	writeRuntimeGlobalConfigFile,
	writeRuntimeProjectConfigFile,
} from "./runtime-config-file-io";
import { resolveRuntimeModelRolesConfig } from "./runtime-config-model-roles-resolver";
import {
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	normalizeAgentRulesets,
	normalizeAgentRulesetsOverride,
	normalizeBoolean,
	normalizeCodeEmbeddingOverride,
	normalizeDeveloperModeEnabled,
	normalizeLlmfitCatalogUpdateMode,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasks,
	normalizeMaxConcurrentTasksOverride,
	normalizeModelRoles,
	normalizeModelRolesOverride,
	normalizeModelSuitabilityPolicyOverride,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
	normalizePromptTemplateWithLegacyDefault,
	normalizeSelectedAgentIdOverride,
	normalizeShortcuts,
	normalizeSkillDynamicsLevelOverride,
} from "./runtime-config-normalizers";
import {
	normalizeFileOverlapParallelism,
	normalizeFileOverlapParallelismOverride,
	resolveRuntimeFileOverlapConfig,
} from "./runtime-config-overlap-resolver";
import {
	getRuntimeConfigLockRequests,
	getRuntimeGlobalConfigPath,
	resolveRuntimeConfigPaths,
} from "./runtime-config-paths";
import {
	DEFAULT_COMMIT_PROMPT_TEMPLATE,
	DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
} from "./runtime-config-prompt-templates";
import {
	normalizeRetrievalEgressEnabled,
	normalizeRetrievalSearchBackendUrl,
	resolveRuntimeRetrievalConfig,
} from "./runtime-config-retrieval-resolver";
import { resolveRuntimeReviewConfig } from "./runtime-config-review-resolver";
import { resolveRuntimeRulesetsConfig } from "./runtime-config-rulesets-resolver";
import {
	normalizeRuntimeSandboxIsolationProfileOverride,
	resolveRuntimeSandboxConfig,
} from "./runtime-config-sandbox-resolver";
import {
	normalizeSetupWizardCompletedAt,
	resolveRuntimeSetupWizardConfig,
} from "./runtime-config-setup-wizard-resolver";
import { resolveRuntimeSkillDynamicsConfig } from "./runtime-config-skill-dynamics-resolver";
import {
	normalizeSpeculativeBestOfNEnabled,
	normalizeSpeculativeMaxConcurrentSpecs,
	normalizeSpeculativeMaxSpecsPerRun,
	resolveRuntimeSpeculativeConfig,
} from "./runtime-config-speculative-resolver";
import { createRuntimeConfigStateFromValues } from "./runtime-config-state-factory";
import { resolveRuntimeSuitabilityConfig } from "./runtime-config-suitability-resolver";
import { resolveRuntimeTimeoutConfig } from "./runtime-config-timeout-resolver";
import type {
	RuntimeConfigState,
	RuntimeConfigUpdateInput,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";
import { mergeGlobalRuntimeConfigFields } from "./runtime-config-update-merge";
import {
	keepNormalizedValue,
	normalizeDeviceRamGb,
	normalizeSandboxEgressAllowlist,
	normalizeShortcutLabel,
	normalizeWorkspaceBaseDir,
} from "./runtime-config-value-helpers";

export { getRuntimeGlobalConfigPath, getRuntimeProjectConfigPath } from "./runtime-config-paths";
// Re-exported from their dedicated types module (§5.AK runtime-config facade slice) so existing importers of this
// path (`./runtime-config`) keep resolving RuntimeConfigState / RuntimeConfigUpdateInput unchanged.
export type { RuntimeConfigState, RuntimeConfigUpdateInput };

export function pickBestInstalledAgentIdFromDetected(detectedCommands: readonly string[]): RuntimeAgentId | null {
	const detected = new Set(detectedCommands);
	for (const agentId of AUTO_SELECT_AGENT_PRIORITY) {
		const catalogEntry = getRuntimeAgentCatalogEntry(agentId);
		const binary = catalogEntry?.binary ?? agentId;
		if (detected.has(binary) || detected.has(agentId)) {
			return agentId;
		}
	}
	return null;
}

function pickBestInstalledAgentId(): RuntimeAgentId | null {
	return pickBestInstalledAgentIdFromDetected(detectInstalledCommands());
}

function toRuntimeConfigState({
	globalConfigPath,
	projectConfigPath,
	globalConfig,
	projectConfig,
}: {
	globalConfigPath: string;
	projectConfigPath: string | null;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}): RuntimeConfigState {
	return {
		globalConfigPath,
		projectConfigPath,
		...resolveRuntimeAgentIdConfig(globalConfig, projectConfig),
		selectedShortcutLabel: normalizeShortcutLabel(globalConfig?.selectedShortcutLabel),
		developerModeEnabled: normalizeDeveloperModeEnabled(globalConfig),
		replayCardsEnabled: normalizeBoolean(globalConfig?.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED),
		...resolveRuntimeSetupWizardConfig(globalConfig, projectConfig),
		knowsTodayEnabled: normalizeBoolean(globalConfig?.knowsTodayEnabled, DEFAULT_KNOWS_TODAY_ENABLED),
		sandboxMcpServersEnabled: normalizeBoolean(
			globalConfig?.sandboxMcpServersEnabled,
			DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
		),
		basicMemoryEnabled: normalizeBoolean(globalConfig?.basicMemoryEnabled, DEFAULT_BASIC_MEMORY_ENABLED),
		chatAdaptiveTruncationEnabled: normalizeBoolean(
			globalConfig?.chatAdaptiveTruncationEnabled,
			DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED,
		),
		reasoningBudgetEnabled: normalizeBoolean(globalConfig?.reasoningBudgetEnabled, DEFAULT_REASONING_BUDGET_ENABLED),
		reviewLensesEnabled: normalizeBoolean(globalConfig?.reviewLensesEnabled, DEFAULT_REVIEW_LENSES_ENABLED),
		capabilityBrokerEnabled: normalizeBoolean(
			globalConfig?.capabilityBrokerEnabled,
			DEFAULT_CAPABILITY_BROKER_ENABLED,
		),
		modelStatsTrackingLevel: normalizeModelStatsTrackingLevel(globalConfig?.modelStatsTrackingLevel),
		agentAutonomousModeEnabled: normalizeBoolean(
			globalConfig?.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		...resolveRuntimeTimeoutConfig(globalConfig),
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(globalConfig?.maxAgentWritableFileLines),
		...resolveRuntimeConcurrencyConfig(globalConfig, projectConfig),
		...resolveRuntimeSandboxConfig(globalConfig, projectConfig),
		...resolveRuntimeRetrievalConfig(globalConfig),
		llmfitCatalogUpdateMode: normalizeLlmfitCatalogUpdateMode(globalConfig?.llmfitCatalogUpdateMode),
		...resolveRuntimeSpeculativeConfig(globalConfig),
		...resolveRuntimeFileOverlapConfig(globalConfig, projectConfig),
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(globalConfig?.lostHeartbeatPolicy),
		hardTaskRoutingMode:
			globalConfig?.hardTaskRoutingMode === "wait_for_best" ? "wait_for_best" : "attempt_with_available",
		testDrivenModeEnabled: globalConfig?.testDrivenModeEnabled === true,
		...resolveRuntimeReviewConfig(globalConfig),
		...resolveRuntimeEmbeddingConfig(globalConfig, projectConfig),
		...resolveRuntimeSuitabilityConfig(globalConfig, projectConfig),
		...resolveRuntimeSkillDynamicsConfig(globalConfig, projectConfig),
		...resolveRuntimeModelRolesConfig(globalConfig, projectConfig),
		...resolveRuntimeRulesetsConfig(globalConfig, projectConfig),
		swarmGuardrails: normalizeRuntimeSwarmGuardrails(globalConfig?.swarmGuardrails),
		shortcuts: normalizeShortcuts(projectConfig?.shortcuts),
		commitPromptTemplate: normalizePromptTemplateWithLegacyDefault(
			globalConfig?.commitPromptTemplate,
			DEFAULT_COMMIT_PROMPT_TEMPLATE,
			LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
		),
		openPrPromptTemplate: normalizePromptTemplateWithLegacyDefault(
			globalConfig?.openPrPromptTemplate,
			DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
			LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
		),
		commitPromptTemplateDefault: DEFAULT_COMMIT_PROMPT_TEMPLATE,
		openPrPromptTemplateDefault: DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
		workspaceBaseDir: normalizeWorkspaceBaseDir(globalConfig?.workspaceBaseDir),
		deviceRamGb: normalizeDeviceRamGb(globalConfig?.deviceRamGb),
		sandboxEgressProxyEnabled: normalizeBoolean(
			globalConfig?.sandboxEgressProxyEnabled,
			DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
		),
		sandboxEgressAllowlist: normalizeSandboxEgressAllowlist(globalConfig?.sandboxEgressAllowlist),
	};
}

interface RuntimeConfigFiles {
	globalConfigPath: string;
	projectConfigPath: string | null;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}

async function readRuntimeConfigFiles(cwd: string | null): Promise<RuntimeConfigFiles> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return {
		globalConfigPath,
		projectConfigPath,
		globalConfig: await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(globalConfigPath),
		projectConfig: projectConfigPath
			? await readRuntimeConfigFile<RuntimeProjectConfigFileShape>(projectConfigPath)
			: null,
	};
}

async function loadRuntimeConfigLocked(cwd: string | null): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(cwd);
	if (configFiles.globalConfig === null) {
		const autoSelectedAgentId = pickBestInstalledAgentId();
		if (autoSelectedAgentId) {
			await writeRuntimeGlobalConfigFile(configFiles.globalConfigPath, {
				selectedAgentId: autoSelectedAgentId,
			});
			configFiles.globalConfig = {
				selectedAgentId: autoSelectedAgentId,
			};
		}
	}
	return toRuntimeConfigState(configFiles);
}

export function toGlobalRuntimeConfigState(current: RuntimeConfigState): RuntimeConfigState {
	return createRuntimeConfigStateFromValues({
		globalConfigPath: current.globalConfigPath,
		projectConfigPath: null,
		selectedAgentId: current.selectedAgentId,
		selectedShortcutLabel: current.selectedShortcutLabel,
		workspaceBaseDir: current.workspaceBaseDir,
		deviceRamGb: current.deviceRamGb,
		sandboxEgressProxyEnabled: current.sandboxEgressProxyEnabled,
		sandboxEgressAllowlist: current.sandboxEgressAllowlist,
		developerModeEnabled: current.developerModeEnabled,
		replayCardsEnabled: current.replayCardsEnabled,
		setupWizardCompletedAt: current.setupWizardCompletedAt,
		projectSetupWizardCompletedAt: null,
		knowsTodayEnabled: current.knowsTodayEnabled,
		sandboxMcpServersEnabled: current.sandboxMcpServersEnabled,
		basicMemoryEnabled: current.basicMemoryEnabled,
		chatAdaptiveTruncationEnabled: current.chatAdaptiveTruncationEnabled,
		reasoningBudgetEnabled: current.reasoningBudgetEnabled,
		reviewLensesEnabled: current.reviewLensesEnabled,
		capabilityBrokerEnabled: current.capabilityBrokerEnabled,
		modelStatsTrackingLevel: current.modelStatsTrackingLevel,
		retrievalEgressEnabled: current.retrievalEgressEnabled,
		retrievalSearchBackendUrl: current.retrievalSearchBackendUrl,
		llmfitCatalogUpdateMode: current.llmfitCatalogUpdateMode,
		speculativeBestOfNEnabled: current.speculativeBestOfNEnabled,
		speculativeMaxConcurrentSpecs: current.speculativeMaxConcurrentSpecs,
		speculativeMaxSpecsPerRun: current.speculativeMaxSpecsPerRun,
		fileOverlapParallelism: current.fileOverlapParallelism,
		fileOverlapParallelismOverride: null,
		agentAutonomousModeEnabled: current.agentAutonomousModeEnabled,
		agentTimeoutMode: current.agentTimeoutMode,
		agentTimeoutProfile: current.agentTimeoutProfile,
		requestTimeoutMs: current.requestTimeoutMs,
		streamTimeoutMs: current.streamTimeoutMs,
		toolTimeoutMs: current.toolTimeoutMs,
		agentTimeoutMs: current.agentTimeoutMs,
		conversationTimeoutMs: current.conversationTimeoutMs,
		maxAgentWritableFileLines: current.maxAgentWritableFileLines,
		maxConcurrentTasks: current.maxConcurrentTasks,
		maxConcurrentTasksOverride: null,
		selectedAgentIdOverride: null,
		sandboxMaxContainers: current.sandboxMaxContainers,
		sandboxAgentsPerContainer: current.sandboxAgentsPerContainer,
		sandboxMemoryPerContainerMb: current.sandboxMemoryPerContainerMb,
		sandboxCpusPerContainer: current.sandboxCpusPerContainer,
		sandboxMaxConcurrentExec: current.sandboxMaxConcurrentExec,
		sandboxIdleTimeoutMinutes: current.sandboxIdleTimeoutMinutes,
		sandboxIsolationProfileDefault: current.sandboxIsolationProfileDefault,
		sandboxIsolationProfileOverride: null,
		lostHeartbeatPolicy: current.lostHeartbeatPolicy,
		decompositionAutoApplyEnabled: current.decompositionAutoApplyEnabled,
		hardTaskRoutingMode: current.hardTaskRoutingMode,
		testDrivenModeEnabled: current.testDrivenModeEnabled,
		secondOpinionReviewEnabled: current.secondOpinionReviewEnabled,
		reviewMaxRounds: current.reviewMaxRounds,
		readyForReviewNotificationsEnabled: current.readyForReviewNotificationsEnabled,
		codeEmbeddingDefaults: current.codeEmbeddingDefaults,
		codeEmbeddingOverride: null,
		modelSuitabilityPolicyDefaults: current.modelSuitabilityPolicyDefaults,
		modelSuitabilityPolicyOverride: null,
		skillDynamicsLevelDefault: current.skillDynamicsLevelDefault,
		skillDynamicsLevelOverride: null,
		concurrencyDefaults: current.concurrencyDefaults,
		concurrencyOverride: null,
		modelRoles: current.modelRoles,
		modelRolesOverride: null,
		agentRulesets: current.agentRulesets,
		agentRulesetsOverride: null,
		swarmGuardrails: current.swarmGuardrails,
		shortcuts: [],
		commitPromptTemplate: current.commitPromptTemplate,
		openPrPromptTemplate: current.openPrPromptTemplate,
	});
}

export async function loadRuntimeConfig(cwd: string): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(cwd);
	if (configFiles.globalConfig !== null) {
		return toRuntimeConfigState(configFiles);
	}
	return await lockedFileSystem.withLocks(
		getRuntimeConfigLockRequests(cwd),
		async () => await loadRuntimeConfigLocked(cwd),
	);
}

export async function loadGlobalRuntimeConfig(): Promise<RuntimeConfigState> {
	const configFiles = await readRuntimeConfigFiles(null);
	if (configFiles.globalConfig !== null) {
		return toRuntimeConfigState(configFiles);
	}
	return await lockedFileSystem.withLocks(
		getRuntimeConfigLockRequests(null),
		async () => await loadRuntimeConfigLocked(null),
	);
}

export async function saveRuntimeConfig(
	cwd: string,
	config: {
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
	},
): Promise<RuntimeConfigState> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return await lockedFileSystem.withLocks(getRuntimeConfigLockRequests(cwd), async () => {
		await writeRuntimeGlobalConfigFile(globalConfigPath, {
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
			sandboxMcpServersEnabled: normalizeBoolean(
				config.sandboxMcpServersEnabled,
				DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
			),
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
			sandboxMaxContainers: normalizePositiveInteger(
				config.sandboxMaxContainers,
				DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
			),
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
				config.hardTaskRoutingMode === "wait_for_best" ? "wait_for_best" : "attempt_with_available",
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
		});
		await writeRuntimeProjectConfigFile(projectConfigPath, {
			shortcuts: config.shortcuts,
			projectSetupWizardCompletedAt: config.projectSetupWizardCompletedAt,
			codeEmbeddingOverride: config.codeEmbeddingOverride,
			modelSuitabilityPolicyOverride: config.modelSuitabilityPolicyOverride,
			skillDynamicsLevelOverride: config.skillDynamicsLevelOverride,
			fileOverlapParallelismOverride: config.fileOverlapParallelismOverride,
			maxConcurrentTasksOverride: config.maxConcurrentTasksOverride,
			selectedAgentIdOverride: config.selectedAgentIdOverride,
			agentRulesetsOverride: config.agentRulesetsOverride,
			modelRolesOverride: config.modelRolesOverride,
			sandboxIsolationProfileOverride: config.sandboxIsolationProfileOverride,
		});
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
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
			sandboxMcpServersEnabled: normalizeBoolean(
				config.sandboxMcpServersEnabled,
				DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
			),
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
			sandboxMaxContainers: normalizePositiveInteger(
				config.sandboxMaxContainers,
				DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
			),
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
				config.hardTaskRoutingMode === "wait_for_best" ? "wait_for_best" : "attempt_with_available",
			testDrivenModeEnabled: config.testDrivenModeEnabled === true,
			secondOpinionReviewEnabled: normalizeBoolean(
				config.secondOpinionReviewEnabled,
				DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
			),
			reviewMaxRounds: normalizePositiveInteger(config.reviewMaxRounds, DEFAULT_REVIEW_MAX_ROUNDS),
			readyForReviewNotificationsEnabled: config.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: config.codeEmbeddingDefaults ?? DEFAULT_CODE_EMBEDDING_SETTINGS,
			codeEmbeddingOverride: config.codeEmbeddingOverride ?? null,
			modelSuitabilityPolicyDefaults:
				config.modelSuitabilityPolicyDefaults ?? DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
			modelSuitabilityPolicyOverride: config.modelSuitabilityPolicyOverride ?? null,
			skillDynamicsLevelDefault: config.skillDynamicsLevelDefault ?? DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
			skillDynamicsLevelOverride: config.skillDynamicsLevelOverride ?? null,
			concurrencyDefaults: config.concurrencyDefaults ?? DEFAULT_CONCURRENCY_CONFIG,
			concurrencyOverride: config.concurrencyOverride ?? null,
			modelRoles: normalizeModelRoles(config.modelRoles),
			agentRulesets: normalizeAgentRulesets(config.agentRulesets),
			swarmGuardrails: normalizeRuntimeSwarmGuardrails(config.swarmGuardrails),
			shortcuts: config.shortcuts,
			commitPromptTemplate: config.commitPromptTemplate,
			openPrPromptTemplate: config.openPrPromptTemplate,
		});
	});
}

export async function updateRuntimeConfig(cwd: string, updates: RuntimeConfigUpdateInput): Promise<RuntimeConfigState> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return await lockedFileSystem.withLocks(getRuntimeConfigLockRequests(cwd), async () => {
		const current = await loadRuntimeConfigLocked(cwd);
		if (projectConfigPath === null && normalizeShortcuts(updates.shortcuts).length > 0) {
			throw new Error("Cannot save project shortcuts without a selected project.");
		}
		const nextConfig = {
			...mergeGlobalRuntimeConfigFields(updates, current),
			projectSetupWizardCompletedAt: keepNormalizedValue(
				updates.projectSetupWizardCompletedAt,
				current.projectSetupWizardCompletedAt,
				normalizeSetupWizardCompletedAt,
			),
			codeEmbeddingOverride: keepNormalizedValue(
				updates.codeEmbeddingOverride,
				current.codeEmbeddingOverride,
				normalizeCodeEmbeddingOverride,
			),
			modelSuitabilityPolicyOverride: keepNormalizedValue(
				updates.modelSuitabilityPolicyOverride,
				current.modelSuitabilityPolicyOverride,
				normalizeModelSuitabilityPolicyOverride,
			),
			skillDynamicsLevelOverride: keepNormalizedValue(
				updates.skillDynamicsLevelOverride,
				current.skillDynamicsLevelOverride,
				normalizeSkillDynamicsLevelOverride,
			),
			fileOverlapParallelismOverride: keepNormalizedValue(
				updates.fileOverlapParallelismOverride,
				current.fileOverlapParallelismOverride,
				normalizeFileOverlapParallelismOverride,
			),
			concurrencyOverride: keepNormalizedValue(
				updates.concurrencyOverride,
				current.concurrencyOverride,
				normalizeConcurrencyOverride,
			),
			maxConcurrentTasksOverride: keepNormalizedValue(
				updates.maxConcurrentTasksOverride,
				current.maxConcurrentTasksOverride,
				normalizeMaxConcurrentTasksOverride,
			),
			selectedAgentIdOverride: keepNormalizedValue(
				updates.selectedAgentIdOverride,
				current.selectedAgentIdOverride,
				normalizeSelectedAgentIdOverride,
			),
			agentRulesetsOverride: keepNormalizedValue(
				updates.agentRulesetsOverride,
				current.agentRulesetsOverride,
				normalizeAgentRulesetsOverride,
			),
			modelRolesOverride: keepNormalizedValue(
				updates.modelRolesOverride,
				current.modelRolesOverride,
				normalizeModelRolesOverride,
			),
			sandboxIsolationProfileOverride: keepNormalizedValue(
				updates.sandboxIsolationProfileOverride,
				current.sandboxIsolationProfileOverride,
				normalizeRuntimeSandboxIsolationProfileOverride,
			),
			shortcuts: projectConfigPath ? (updates.shortcuts ?? current.shortcuts) : current.shortcuts,
		};

		const hasChanges = runtimeConfigStateHasChanges(RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS, nextConfig, current);

		if (!hasChanges) {
			return current;
		}

		await writeRuntimeGlobalConfigFile(globalConfigPath, nextConfig);
		await writeRuntimeProjectConfigFile(projectConfigPath, nextConfig);
		return createRuntimeConfigStateFromValues({ ...nextConfig, globalConfigPath, projectConfigPath });
	});
}

export async function updateGlobalRuntimeConfig(
	current: RuntimeConfigState,
	updates: RuntimeConfigUpdateInput,
): Promise<RuntimeConfigState> {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	return await lockedFileSystem.withLocks(
		[
			{
				path: globalConfigPath,
				type: "file",
			},
		],
		async () => {
			const nextConfig = {
				...mergeGlobalRuntimeConfigFields(updates, current),
				projectSetupWizardCompletedAt: null,
				codeEmbeddingOverride: null,
				modelSuitabilityPolicyOverride: null,
				skillDynamicsLevelOverride: null,
				fileOverlapParallelismOverride: null,
				concurrencyOverride: null,
				maxConcurrentTasksOverride: null,
				selectedAgentIdOverride: null,
				agentRulesetsOverride: null,
				modelRolesOverride: null,
				sandboxIsolationProfileOverride: null,
				shortcuts: current.shortcuts,
			};

			const hasChanges = runtimeConfigStateHasChanges(RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS, nextConfig, current);

			if (!hasChanges) {
				return current;
			}

			await writeRuntimeGlobalConfigFile(globalConfigPath, nextConfig);

			return createRuntimeConfigStateFromValues({
				...nextConfig,
				globalConfigPath,
				projectConfigPath: current.projectConfigPath,
			});
		},
	);
}
