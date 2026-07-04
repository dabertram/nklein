// Persists !Klein-owned runtime preferences on disk.
// This module should store !Klein settings such as selected agents,
// shortcuts, and prompt templates, not SDK-owned NKlein secrets or OAuth data.
import { copyFile, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getRuntimeAgentCatalogEntry } from "../core/agent-catalog";
import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeFileOverlapParallelism,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeModelSuitabilityPolicy,
	RuntimeProjectShortcut,
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
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";
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
	DEFAULT_CODE_EMBEDDING_SETTINGS,
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_KNOWS_TODAY_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "./runtime-config-defaults";
import { resolveRuntimeEmbeddingConfig } from "./runtime-config-embedding-resolver";
import { resolveRuntimeModelRolesConfig } from "./runtime-config-model-roles-resolver";
import {
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	normalizeAgentRulesets,
	normalizeAgentRulesetsOverride,
	normalizeBoolean,
	normalizeCodeEmbeddingOverride,
	normalizeDeveloperModeEnabled,
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
import { resolveRuntimeSandboxConfig } from "./runtime-config-sandbox-resolver";
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
import { keepNormalizedValue, normalizeShortcutLabel, normalizeWorkspaceBaseDir } from "./runtime-config-value-helpers";
import {
	buildRuntimeGlobalConfigFilePayload,
	type RuntimeGlobalConfigFileWriteInput,
} from "./runtime-global-config-file-payload";
import {
	NKLEIN_HOME_DIR_NAME,
	NKLEIN_PROJECT_CONFIG_DIR_NAME,
	NKLEIN_RUNTIME_DIR_NAME,
} from "./runtime-path-constants";

// Re-exported from their dedicated types module (§5.AK runtime-config facade slice) so existing importers of this
// path (`./runtime-config`) keep resolving RuntimeConfigState / RuntimeConfigUpdateInput unchanged.
export type { RuntimeConfigState, RuntimeConfigUpdateInput };

const RUNTIME_HOME_PARENT_DIR = NKLEIN_HOME_DIR_NAME;
const RUNTIME_HOME_DIR = NKLEIN_RUNTIME_DIR_NAME;
const CONFIG_FILENAME = "config.json";
const PROJECT_CONFIG_PARENT_DIR = NKLEIN_HOME_DIR_NAME;
const PROJECT_CONFIG_DIR = NKLEIN_PROJECT_CONFIG_DIR_NAME;
const PROJECT_CONFIG_FILENAME = "config.json";

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

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_PARENT_DIR, RUNTIME_HOME_DIR);
}

function pickBestInstalledAgentId(): RuntimeAgentId | null {
	return pickBestInstalledAgentIdFromDetected(detectInstalledCommands());
}

export function getRuntimeGlobalConfigPath(): string {
	return join(getRuntimeHomePath(), CONFIG_FILENAME);
}

export function getRuntimeProjectConfigPath(cwd: string): string {
	return join(resolve(cwd), PROJECT_CONFIG_PARENT_DIR, PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

interface RuntimeConfigPaths {
	globalConfigPath: string;
	projectConfigPath: string | null;
}

function normalizePathForComparison(path: string): string {
	const normalized = resolve(path).replaceAll("\\", "/");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveRuntimeConfigPaths(cwd: string | null): RuntimeConfigPaths {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	if (cwd === null) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	const normalizedCwd = normalizePathForComparison(cwd);
	const normalizedHome = normalizePathForComparison(homedir());
	if (normalizedCwd === normalizedHome) {
		return {
			globalConfigPath,
			projectConfigPath: null,
		};
	}

	return {
		globalConfigPath,
		projectConfigPath: getRuntimeProjectConfigPath(cwd),
	};
}

function getRuntimeConfigLockRequests(cwd: string | null): LockRequest[] {
	const paths = resolveRuntimeConfigPaths(cwd);
	const requests: LockRequest[] = [
		{
			path: paths.globalConfigPath,
			type: "file",
		},
	];
	if (paths.projectConfigPath) {
		requests.push({
			path: paths.projectConfigPath,
			type: "file",
		});
	}
	return requests;
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
		agentAutonomousModeEnabled: normalizeBoolean(
			globalConfig?.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		...resolveRuntimeTimeoutConfig(globalConfig),
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(globalConfig?.maxAgentWritableFileLines),
		...resolveRuntimeConcurrencyConfig(globalConfig, projectConfig),
		...resolveRuntimeSandboxConfig(globalConfig),
		...resolveRuntimeRetrievalConfig(globalConfig),
		...resolveRuntimeSpeculativeConfig(globalConfig),
		...resolveRuntimeFileOverlapConfig(globalConfig, projectConfig),
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(globalConfig?.lostHeartbeatPolicy),
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
	};
}

async function readRuntimeConfigFile<T>(configPath: string): Promise<T | null> {
	let raw: string;
	try {
		raw = await readFile(configPath, "utf8");
	} catch (err) {
		// File does not exist (ENOENT) → normal first-run, return null silently.
		// Any other read error (e.g. permissions) is surfaced so the user is not silently surprised.
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
			process.stderr.write(`[!Klein] Failed to read config file at ${configPath}: ${err.message}\n`);
		}
		return null;
	}
	try {
		return JSON.parse(raw) as T;
	} catch (parseErr) {
		// File exists but is corrupt (unparseable JSON). Preserve the original bytes
		// in a timestamped backup so a subsequent save cannot silently overwrite them.
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const backupPath = `${configPath}.corrupt-${timestamp}.bak`;
		process.stderr.write(
			`[!Klein] Config file at ${configPath} could not be parsed and may be corrupt. ` +
				`Original file preserved at ${backupPath}. ` +
				`Error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}\n`,
		);
		try {
			await copyFile(configPath, backupPath);
		} catch (backupErr) {
			process.stderr.write(
				`[!Klein] Failed to create backup of corrupt config at ${backupPath}: ` +
					`${backupErr instanceof Error ? backupErr.message : String(backupErr)}\n`,
			);
		}
		return null;
	}
}

async function writeRuntimeGlobalConfigFile(
	configPath: string,
	config: RuntimeGlobalConfigFileWriteInput,
): Promise<void> {
	const existing = await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(configPath);
	const payload = buildRuntimeGlobalConfigFilePayload(config, existing);
	await lockedFileSystem.writeJsonFileAtomic(configPath, payload, {
		lock: null,
	});
}

async function writeRuntimeProjectConfigFile(
	configPath: string | null,
	config: {
		shortcuts: RuntimeProjectShortcut[];
		projectSetupWizardCompletedAt?: number | null;
		codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
		modelSuitabilityPolicyOverride?: RuntimeModelSuitabilityPolicy | null;
		skillDynamicsLevelOverride?: RuntimeSkillDynamicsLevel | null;
		fileOverlapParallelismOverride?: RuntimeFileOverlapParallelism | null;
		concurrencyOverride?: ConcurrencyOverride | null;
		maxConcurrentTasksOverride?: number | null;
		selectedAgentIdOverride?: RuntimeAgentId | null;
		agentRulesetsOverride?: AgentRulesetsConfigPayload | null;
		modelRolesOverride?: RuntimeModelRoles | null;
	},
): Promise<void> {
	const normalizedShortcuts = normalizeShortcuts(config.shortcuts);
	const projectSetupWizardCompletedAt = normalizeSetupWizardCompletedAt(config.projectSetupWizardCompletedAt);
	const codeEmbeddingOverride = normalizeCodeEmbeddingOverride(config.codeEmbeddingOverride);
	const modelSuitabilityPolicyOverride = normalizeModelSuitabilityPolicyOverride(
		config.modelSuitabilityPolicyOverride,
	);
	const skillDynamicsLevelOverride = normalizeSkillDynamicsLevelOverride(config.skillDynamicsLevelOverride);
	const fileOverlapParallelismOverride = normalizeFileOverlapParallelismOverride(
		config.fileOverlapParallelismOverride,
	);
	const concurrencyOverride = normalizeConcurrencyOverride(config.concurrencyOverride);
	const maxConcurrentTasksOverride = normalizeMaxConcurrentTasksOverride(config.maxConcurrentTasksOverride);
	const selectedAgentIdOverride = normalizeSelectedAgentIdOverride(config.selectedAgentIdOverride);
	const agentRulesetsOverride = normalizeAgentRulesetsOverride(config.agentRulesetsOverride);
	const modelRolesOverride = normalizeModelRolesOverride(config.modelRolesOverride);
	if (!configPath) {
		if (normalizedShortcuts.length > 0) {
			throw new Error("Cannot save project shortcuts without a selected project.");
		}
		if (codeEmbeddingOverride) {
			throw new Error("Cannot save project embedding overrides without a selected project.");
		}
		if (modelSuitabilityPolicyOverride) {
			throw new Error("Cannot save project model-suitability override without a selected project.");
		}
		if (skillDynamicsLevelOverride) {
			throw new Error("Cannot save project skill-dynamics override without a selected project.");
		}
		if (fileOverlapParallelismOverride) {
			throw new Error("Cannot save project file-overlap parallelism override without a selected project.");
		}
		if (projectSetupWizardCompletedAt !== null) {
			throw new Error("Cannot save project setup-wizard completion stamp without a selected project.");
		}
		if (maxConcurrentTasksOverride !== null) {
			throw new Error("Cannot save project concurrent task override without a selected project.");
		}
		if (selectedAgentIdOverride !== null) {
			throw new Error("Cannot save project agent override without a selected project.");
		}
		if (agentRulesetsOverride !== null) {
			throw new Error("Cannot save project agent rulesets override without a selected project.");
		}
		if (modelRolesOverride !== null) {
			throw new Error("Cannot save project model roles override without a selected project.");
		}
		return;
	}
	if (
		normalizedShortcuts.length === 0 &&
		projectSetupWizardCompletedAt === null &&
		codeEmbeddingOverride === null &&
		modelSuitabilityPolicyOverride === null &&
		skillDynamicsLevelOverride === null &&
		fileOverlapParallelismOverride === null &&
		concurrencyOverride === null &&
		maxConcurrentTasksOverride === null &&
		selectedAgentIdOverride === null &&
		agentRulesetsOverride === null &&
		modelRolesOverride === null
	) {
		await rm(configPath, { force: true });
		try {
			await rm(dirname(configPath));
		} catch {
			// Ignore missing or non-empty project config directories.
		}
		return;
	}
	await lockedFileSystem.writeJsonFileAtomic(
		configPath,
		{
			shortcuts: normalizedShortcuts,
			...(projectSetupWizardCompletedAt !== null ? { projectSetupWizardCompletedAt } : {}),
			...(codeEmbeddingOverride ? { codeEmbeddingOverride } : {}),
			...(modelSuitabilityPolicyOverride ? { modelSuitabilityPolicyOverride } : {}),
			...(skillDynamicsLevelOverride ? { skillDynamicsLevelOverride } : {}),
			...(fileOverlapParallelismOverride ? { fileOverlapParallelismOverride } : {}),
			...(concurrencyOverride ? { concurrencyOverride } : {}),
			...(maxConcurrentTasksOverride !== null ? { maxConcurrentTasksOverride } : {}),
			...(selectedAgentIdOverride !== null ? { selectedAgentIdOverride } : {}),
			...(agentRulesetsOverride !== null ? { agentRulesetsOverride } : {}),
			...(modelRolesOverride !== null ? { modelRolesOverride } : {}),
		} satisfies RuntimeProjectConfigFileShape,
		{
			lock: null,
		},
	);
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
		developerModeEnabled: current.developerModeEnabled,
		replayCardsEnabled: current.replayCardsEnabled,
		setupWizardCompletedAt: current.setupWizardCompletedAt,
		projectSetupWizardCompletedAt: null,
		knowsTodayEnabled: current.knowsTodayEnabled,
		sandboxMcpServersEnabled: current.sandboxMcpServersEnabled,
		retrievalEgressEnabled: current.retrievalEgressEnabled,
		retrievalSearchBackendUrl: current.retrievalSearchBackendUrl,
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
		lostHeartbeatPolicy: current.lostHeartbeatPolicy,
		decompositionAutoApplyEnabled: current.decompositionAutoApplyEnabled,
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
		developerModeEnabled?: boolean;
		replayCardsEnabled?: boolean;
		setupWizardCompletedAt?: number | null;
		projectSetupWizardCompletedAt?: number | null;
		knowsTodayEnabled?: boolean;
		sandboxMcpServersEnabled?: boolean;
		retrievalEgressEnabled?: boolean;
		retrievalSearchBackendUrl?: string | null;
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
		lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
		decompositionAutoApplyEnabled?: boolean;
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
			developerModeEnabled: normalizeBoolean(config.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED),
			replayCardsEnabled: normalizeBoolean(config.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED),
			setupWizardCompletedAt: normalizeSetupWizardCompletedAt(config.setupWizardCompletedAt),
			knowsTodayEnabled: normalizeBoolean(config.knowsTodayEnabled, DEFAULT_KNOWS_TODAY_ENABLED),
			sandboxMcpServersEnabled: normalizeBoolean(
				config.sandboxMcpServersEnabled,
				DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
			),
			retrievalEgressEnabled: normalizeRetrievalEgressEnabled(config.retrievalEgressEnabled),
			retrievalSearchBackendUrl: normalizeRetrievalSearchBackendUrl(config.retrievalSearchBackendUrl),
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
			lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy),
			decompositionAutoApplyEnabled: normalizeBoolean(
				config.decompositionAutoApplyEnabled,
				DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
			),
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
		});
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
			selectedAgentId: config.selectedAgentId,
			selectedShortcutLabel: config.selectedShortcutLabel,
			workspaceBaseDir: config.workspaceBaseDir,
			developerModeEnabled: normalizeBoolean(config.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED),
			replayCardsEnabled: normalizeBoolean(config.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED),
			setupWizardCompletedAt: normalizeSetupWizardCompletedAt(config.setupWizardCompletedAt),
			projectSetupWizardCompletedAt: normalizeSetupWizardCompletedAt(config.projectSetupWizardCompletedAt),
			knowsTodayEnabled: normalizeBoolean(config.knowsTodayEnabled, DEFAULT_KNOWS_TODAY_ENABLED),
			sandboxMcpServersEnabled: normalizeBoolean(
				config.sandboxMcpServersEnabled,
				DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
			),
			retrievalEgressEnabled: normalizeRetrievalEgressEnabled(config.retrievalEgressEnabled),
			retrievalSearchBackendUrl: normalizeRetrievalSearchBackendUrl(config.retrievalSearchBackendUrl),
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
			lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy),
			decompositionAutoApplyEnabled: normalizeBoolean(
				config.decompositionAutoApplyEnabled,
				DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
			),
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
