// Persists !Klein-owned runtime preferences on disk.
// This module should store !Klein settings such as selected agents,
// shortcuts, and prompt templates, not SDK-owned NKlein secrets or OAuth data.

import { getRuntimeAgentCatalogEntry } from "../core/agent-catalog";
import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type { RuntimeAgentId } from "../core/api-contract";
import { normalizeRuntimeMemoryFreshnessAudit, normalizeRuntimeSwarmGuardrails } from "../core/api-contract";
import { normalizeConcurrencyOverride } from "../core/concurrency-config";
import { normalizeModelStatsTrackingLevel } from "../core/model-stats-tracking-level";
import { resolveEffectiveTestDrivenMode } from "../core/test-driven-delivery";
import { lockedFileSystem } from "../fs/locked-file-system";
import { detectInstalledCommands } from "../terminal/agent-registry";
import { resolveRuntimeAgentIdConfig } from "./runtime-config-agent-id-resolver";
import {
	RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS,
	RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS,
	runtimeConfigStateHasChanges,
} from "./runtime-config-change-detection";
import {
	buildGlobalConfigFilePayload,
	buildProjectConfigFilePayload,
	buildSavedRuntimeConfigStateValues,
	type SaveRuntimeConfigInput,
} from "./runtime-config-save-payload";

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
	DEFAULT_KNOWS_TODAY_ENABLED,
	DEFAULT_REASONING_BUDGET_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
	DEFAULT_REVIEW_LENSES_ENABLED,
	DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
	DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
} from "./runtime-config-defaults";
import { resolveRuntimeEmbeddingConfig } from "./runtime-config-embedding-resolver";
import {
	readRuntimeConfigFile,
	writeRuntimeGlobalConfigFile,
	writeRuntimeProjectConfigFile,
} from "./runtime-config-file-io";
import { resolveRuntimeModelRolesConfig } from "./runtime-config-model-roles-resolver";
import {
	normalizeAgentRulesetsOverride,
	normalizeBoolean,
	normalizeCodeEmbeddingOverride,
	normalizeDeveloperModeEnabled,
	normalizeLlmfitCatalogUpdateMode,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasksOverride,
	normalizeModelRolesOverride,
	normalizeModelSuitabilityPolicyOverride,
	normalizePromptTemplateWithLegacyDefault,
	normalizeSelectedAgentIdOverride,
	normalizeShortcuts,
	normalizeSkillDynamicsLevelOverride,
	normalizeTestDrivenModeOverride,
} from "./runtime-config-normalizers";
import {
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
import { resolveRuntimeRetrievalConfig } from "./runtime-config-retrieval-resolver";
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
import { resolveRuntimeSpeculativeConfig } from "./runtime-config-speculative-resolver";
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
		testDrivenModeOverride: normalizeTestDrivenModeOverride(projectConfig?.testDrivenModeOverride),
		effectiveTestDrivenMode: resolveEffectiveTestDrivenMode(
			globalConfig?.testDrivenModeEnabled,
			normalizeTestDrivenModeOverride(projectConfig?.testDrivenModeOverride),
		),
		...resolveRuntimeReviewConfig(globalConfig),
		...resolveRuntimeEmbeddingConfig(globalConfig, projectConfig),
		...resolveRuntimeSuitabilityConfig(globalConfig, projectConfig),
		...resolveRuntimeSkillDynamicsConfig(globalConfig, projectConfig),
		...resolveRuntimeModelRolesConfig(globalConfig, projectConfig),
		...resolveRuntimeRulesetsConfig(globalConfig, projectConfig),
		swarmGuardrails: normalizeRuntimeSwarmGuardrails(globalConfig?.swarmGuardrails),
		memoryFreshnessAudit: normalizeRuntimeMemoryFreshnessAudit(globalConfig?.memoryFreshnessAudit),
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
		testDrivenModeOverride: null,
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
		memoryFreshnessAudit: current.memoryFreshnessAudit,
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

export async function saveRuntimeConfig(cwd: string, config: SaveRuntimeConfigInput): Promise<RuntimeConfigState> {
	const { globalConfigPath, projectConfigPath } = resolveRuntimeConfigPaths(cwd);
	return await lockedFileSystem.withLocks(getRuntimeConfigLockRequests(cwd), async () => {
		// F1.28: the payload assembly lives in runtime-config-save-payload.ts (verbatim extraction); the facade
		// owns only locking, path resolution, and the writes.
		await writeRuntimeGlobalConfigFile(globalConfigPath, buildGlobalConfigFilePayload(config));
		await writeRuntimeProjectConfigFile(projectConfigPath, buildProjectConfigFilePayload(config));
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
			...buildSavedRuntimeConfigStateValues(config),
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
			testDrivenModeOverride: keepNormalizedValue(
				updates.testDrivenModeOverride,
				current.testDrivenModeOverride,
				normalizeTestDrivenModeOverride,
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
				testDrivenModeOverride: null,
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
