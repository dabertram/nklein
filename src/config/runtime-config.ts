// Persists !Klein-owned runtime preferences on disk.
// This module should store !Klein settings such as selected agents,
// shortcuts, and prompt templates, not SDK-owned NKlein secrets or OAuth data.
import { copyFile, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getRuntimeAgentCatalogEntry } from "../core/agent-catalog";
import { DEFAULT_AGENT_RULESETS_CONFIG } from "../core/agent-rulesets";
import { DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES, normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type {
	AgentRulesetsConfigPayload,
	RuntimeAgentId,
	RuntimeAgentTimeoutMode,
	RuntimeAgentTimeoutProfile,
	RuntimeCodeEmbeddingSettings,
	RuntimeLostHeartbeatPolicy,
	RuntimeModelRoles,
	RuntimeModelSuitabilityPolicy,
	RuntimeProjectShortcut,
	RuntimeSkillDynamicsLevel,
	RuntimeSwarmGuardrails,
} from "../core/api-contract";
import {
	areRuntimeSwarmGuardrailsEqual,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	normalizeRuntimeSwarmGuardrails,
} from "../core/api-contract";
import {
	areConcurrencyConfigsEqual,
	type ConcurrencyConfig,
	type ConcurrencyOverride,
	DEFAULT_CONCURRENCY_CONFIG,
	normalizeConcurrencyConfig,
	normalizeConcurrencyOverride,
} from "../core/concurrency-config";
import { type LockRequest, lockedFileSystem } from "../fs/locked-file-system";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
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
	DEFAULT_AGENT_ID,
	DEFAULT_AGENT_TIMEOUT_MODE,
	DEFAULT_AGENT_TIMEOUT_PROFILE,
	DEFAULT_CODE_EMBEDDING_SETTINGS,
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_LOST_HEARTBEAT_POLICY,
	DEFAULT_MAX_CONCURRENT_TASKS,
	DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "./runtime-config-defaults";
import { resolveRuntimeEmbeddingConfig } from "./runtime-config-embedding-resolver";
import { resolveRuntimeModelRolesConfig } from "./runtime-config-model-roles-resolver";
import {
	areAgentRulesetsEqual,
	areCodeEmbeddingSettingsEqual,
	areModelSuitabilityPoliciesEqual,
	areSkillDynamicsLevelsEqual,
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	normalizeAgentId,
	normalizeAgentRulesets,
	normalizeAgentRulesetsOverride,
	normalizeAgentTimeoutMode,
	normalizeAgentTimeoutProfile,
	normalizeBoolean,
	normalizeCodeEmbeddingOverride,
	normalizeCodeEmbeddingSettings,
	normalizeDeveloperModeEnabled,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasks,
	normalizeMaxConcurrentTasksOverride,
	normalizeModelRoles,
	normalizeModelRolesOverride,
	normalizeModelSuitabilityPolicy,
	normalizeModelSuitabilityPolicyOverride,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
	normalizePromptTemplateWithLegacyDefault,
	normalizeSelectedAgentIdOverride,
	normalizeShortcuts,
	normalizeSkillDynamicsLevel,
	normalizeSkillDynamicsLevelOverride,
	normalizeTimeoutMsValue,
	readLegacyDeveloperModeEnabled,
	resolveProfileTimeoutDefaults,
} from "./runtime-config-normalizers";
import {
	DEFAULT_COMMIT_PROMPT_TEMPLATE,
	DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
} from "./runtime-config-prompt-templates";
import { resolveRuntimeReviewConfig } from "./runtime-config-review-resolver";
import { resolveRuntimeRulesetsConfig } from "./runtime-config-rulesets-resolver";
import { resolveRuntimeSandboxConfig } from "./runtime-config-sandbox-resolver";
import { resolveRuntimeSkillDynamicsConfig } from "./runtime-config-skill-dynamics-resolver";
import { resolveRuntimeSuitabilityConfig } from "./runtime-config-suitability-resolver";
import { resolveRuntimeTimeoutConfig } from "./runtime-config-timeout-resolver";
import type {
	RuntimeConfigState,
	RuntimeConfigUpdateInput,
	RuntimeGlobalConfigFileShape,
	RuntimeProjectConfigFileShape,
} from "./runtime-config-types";
import {
	assignChangedConfigField,
	hasOwnKey,
	keepNormalizedValue,
	keepUpdatedValue,
	normalizeShortcutLabel,
	normalizeWorkspaceBaseDir,
} from "./runtime-config-value-helpers";
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
		agentAutonomousModeEnabled: normalizeBoolean(
			globalConfig?.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		...resolveRuntimeTimeoutConfig(globalConfig),
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(globalConfig?.maxAgentWritableFileLines),
		...resolveRuntimeConcurrencyConfig(globalConfig, projectConfig),
		...resolveRuntimeSandboxConfig(globalConfig),
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
	config: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutLabel?: string | null;
		developerModeEnabled?: boolean;
		replayCardsEnabled?: boolean;
		agentAutonomousModeEnabled?: boolean;
		agentTimeoutMode?: RuntimeAgentTimeoutMode;
		agentTimeoutProfile?: RuntimeAgentTimeoutProfile;
		requestTimeoutMs?: number | null;
		streamTimeoutMs?: number | null;
		toolTimeoutMs?: number | null;
		agentTimeoutMs?: number | null;
		conversationTimeoutMs?: number | null;
		maxAgentWritableFileLines?: number;
		maxConcurrentTasks?: number;
		sandboxMaxContainers?: number;
		sandboxAgentsPerContainer?: number;
		sandboxMemoryPerContainerMb?: number;
		sandboxCpusPerContainer?: number;
		sandboxIdleTimeoutMinutes?: number;
		lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
		decompositionAutoApplyEnabled?: boolean;
		secondOpinionReviewEnabled?: boolean;
		reviewMaxRounds?: number;
		readyForReviewNotificationsEnabled?: boolean;
		codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
		modelSuitabilityPolicyDefaults?: RuntimeModelSuitabilityPolicy;
		skillDynamicsLevelDefault?: RuntimeSkillDynamicsLevel;
		concurrencyDefaults?: ConcurrencyConfig;
		modelRoles?: RuntimeModelRoles;
		agentRulesets?: AgentRulesetsConfigPayload;
		swarmGuardrails?: RuntimeSwarmGuardrails;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
		workspaceBaseDir?: string | null;
	},
): Promise<void> {
	const existing = await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(configPath);
	const selectedAgentId = config.selectedAgentId === undefined ? undefined : normalizeAgentId(config.selectedAgentId);
	const existingSelectedAgentId = hasOwnKey(existing, "selectedAgentId")
		? normalizeAgentId(existing?.selectedAgentId)
		: undefined;
	const selectedShortcutLabel =
		config.selectedShortcutLabel === undefined ? undefined : normalizeShortcutLabel(config.selectedShortcutLabel);
	const developerModeEnabled = normalizeBoolean(config.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED);
	const replayCardsEnabled = normalizeBoolean(config.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED);
	const existingSelectedShortcutLabel = hasOwnKey(existing, "selectedShortcutLabel")
		? normalizeShortcutLabel(existing?.selectedShortcutLabel)
		: undefined;
	const workspaceBaseDir =
		config.workspaceBaseDir === undefined ? undefined : normalizeWorkspaceBaseDir(config.workspaceBaseDir);
	const existingWorkspaceBaseDir = hasOwnKey(existing, "workspaceBaseDir")
		? normalizeWorkspaceBaseDir(existing?.workspaceBaseDir)
		: undefined;
	const agentAutonomousModeEnabled = normalizeBoolean(
		config.agentAutonomousModeEnabled,
		DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
	);
	const agentTimeoutMode =
		config.agentTimeoutMode === undefined
			? DEFAULT_AGENT_TIMEOUT_MODE
			: normalizeAgentTimeoutMode(config.agentTimeoutMode);
	const agentTimeoutProfile =
		config.agentTimeoutProfile === undefined
			? DEFAULT_AGENT_TIMEOUT_PROFILE
			: normalizeAgentTimeoutProfile(config.agentTimeoutProfile);
	const defaultTimeouts = resolveProfileTimeoutDefaults(agentTimeoutProfile);
	const requestTimeoutMs =
		config.requestTimeoutMs === undefined
			? defaultTimeouts.requestTimeoutMs
			: normalizeTimeoutMsValue(config.requestTimeoutMs);
	const streamTimeoutMs =
		config.streamTimeoutMs === undefined
			? defaultTimeouts.streamTimeoutMs
			: normalizeTimeoutMsValue(config.streamTimeoutMs);
	const toolTimeoutMs =
		config.toolTimeoutMs === undefined
			? defaultTimeouts.toolTimeoutMs
			: normalizeTimeoutMsValue(config.toolTimeoutMs);
	const agentTimeoutMs =
		config.agentTimeoutMs === undefined
			? defaultTimeouts.agentTimeoutMs
			: normalizeTimeoutMsValue(config.agentTimeoutMs);
	const conversationTimeoutMs =
		config.conversationTimeoutMs === undefined
			? defaultTimeouts.conversationTimeoutMs
			: normalizeTimeoutMsValue(config.conversationTimeoutMs);
	const maxAgentWritableFileLines =
		config.maxAgentWritableFileLines === undefined
			? DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES
			: normalizeMaxAgentWritableFileLines(config.maxAgentWritableFileLines);
	const maxConcurrentTasks =
		config.maxConcurrentTasks === undefined
			? DEFAULT_MAX_CONCURRENT_TASKS
			: normalizeMaxConcurrentTasks(config.maxConcurrentTasks);
	const sandboxMaxContainers = normalizePositiveInteger(
		config.sandboxMaxContainers,
		DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	);
	const sandboxAgentsPerContainer = normalizeNonNegativeInteger(
		config.sandboxAgentsPerContainer,
		DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	);
	const sandboxMemoryPerContainerMb = normalizePositiveInteger(
		config.sandboxMemoryPerContainerMb,
		DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
	);
	const sandboxCpusPerContainer = normalizePositiveNumber(
		config.sandboxCpusPerContainer,
		DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	);
	const sandboxIdleTimeoutMinutes = normalizePositiveInteger(
		config.sandboxIdleTimeoutMinutes,
		DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	);
	const lostHeartbeatPolicy =
		config.lostHeartbeatPolicy === undefined
			? DEFAULT_LOST_HEARTBEAT_POLICY
			: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy);
	const decompositionAutoApplyEnabled = normalizeBoolean(
		config.decompositionAutoApplyEnabled,
		DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	);
	const secondOpinionReviewEnabled = normalizeBoolean(
		config.secondOpinionReviewEnabled,
		DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
	);
	const reviewMaxRounds = normalizePositiveInteger(config.reviewMaxRounds, DEFAULT_REVIEW_MAX_ROUNDS);
	const readyForReviewNotificationsEnabled = normalizeBoolean(
		config.readyForReviewNotificationsEnabled,
		DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
	);
	const codeEmbeddingDefaults =
		config.codeEmbeddingDefaults === undefined
			? DEFAULT_CODE_EMBEDDING_SETTINGS
			: normalizeCodeEmbeddingSettings(config.codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS);
	const modelSuitabilityPolicyDefaults =
		config.modelSuitabilityPolicyDefaults === undefined
			? DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG
			: normalizeModelSuitabilityPolicy(
					config.modelSuitabilityPolicyDefaults,
					DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
				);
	const skillDynamicsLevelDefault =
		config.skillDynamicsLevelDefault === undefined
			? DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG
			: normalizeSkillDynamicsLevel(config.skillDynamicsLevelDefault, DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG);
	const concurrencyDefaults =
		config.concurrencyDefaults === undefined
			? DEFAULT_CONCURRENCY_CONFIG
			: normalizeConcurrencyConfig(config.concurrencyDefaults);
	const modelRoles =
		config.modelRoles === undefined
			? normalizeModelRoles(existing?.modelRoles)
			: normalizeModelRoles(config.modelRoles);
	const agentRulesets =
		config.agentRulesets === undefined
			? normalizeAgentRulesets(existing?.agentRulesets)
			: normalizeAgentRulesets(config.agentRulesets);
	const swarmGuardrails =
		config.swarmGuardrails === undefined
			? normalizeRuntimeSwarmGuardrails(existing?.swarmGuardrails)
			: normalizeRuntimeSwarmGuardrails(config.swarmGuardrails);
	const commitPromptTemplate =
		config.commitPromptTemplate === undefined
			? DEFAULT_COMMIT_PROMPT_TEMPLATE
			: normalizePromptTemplateWithLegacyDefault(
					config.commitPromptTemplate,
					DEFAULT_COMMIT_PROMPT_TEMPLATE,
					LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
				);
	const openPrPromptTemplate =
		config.openPrPromptTemplate === undefined
			? DEFAULT_OPEN_PR_PROMPT_TEMPLATE
			: normalizePromptTemplateWithLegacyDefault(
					config.openPrPromptTemplate,
					DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
					LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
				);

	const payload: RuntimeGlobalConfigFileShape = {};
	if (selectedAgentId !== undefined) {
		if (hasOwnKey(existing, "selectedAgentId") || selectedAgentId !== DEFAULT_AGENT_ID) {
			payload.selectedAgentId = selectedAgentId;
		}
	} else if (existingSelectedAgentId !== undefined) {
		payload.selectedAgentId = existingSelectedAgentId;
	}
	if (selectedShortcutLabel !== undefined) {
		if (selectedShortcutLabel) {
			payload.selectedShortcutLabel = selectedShortcutLabel;
		}
	} else if (existingSelectedShortcutLabel) {
		payload.selectedShortcutLabel = existingSelectedShortcutLabel;
	}
	if (workspaceBaseDir !== undefined) {
		if (workspaceBaseDir) {
			payload.workspaceBaseDir = workspaceBaseDir;
		}
	} else if (existingWorkspaceBaseDir) {
		payload.workspaceBaseDir = existingWorkspaceBaseDir;
	}
	if (
		hasOwnKey(existing, "developerModeEnabled") ||
		readLegacyDeveloperModeEnabled(existing) !== null ||
		developerModeEnabled !== DEFAULT_DEVELOPER_MODE_ENABLED
	) {
		payload.developerModeEnabled = developerModeEnabled;
	}
	assignChangedConfigField(payload, existing, "replayCardsEnabled", replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED);
	assignChangedConfigField(
		payload,
		existing,
		"agentAutonomousModeEnabled",
		agentAutonomousModeEnabled,
		DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
	);
	assignChangedConfigField(payload, existing, "agentTimeoutMode", agentTimeoutMode, DEFAULT_AGENT_TIMEOUT_MODE);
	assignChangedConfigField(
		payload,
		existing,
		"agentTimeoutProfile",
		agentTimeoutProfile,
		DEFAULT_AGENT_TIMEOUT_PROFILE,
	);
	if (hasOwnKey(existing, "requestTimeoutMs") || requestTimeoutMs !== defaultTimeouts.requestTimeoutMs) {
		payload.requestTimeoutMs = requestTimeoutMs;
	}
	if (hasOwnKey(existing, "streamTimeoutMs") || streamTimeoutMs !== defaultTimeouts.streamTimeoutMs) {
		payload.streamTimeoutMs = streamTimeoutMs;
	}
	if (hasOwnKey(existing, "toolTimeoutMs") || toolTimeoutMs !== defaultTimeouts.toolTimeoutMs) {
		payload.toolTimeoutMs = toolTimeoutMs;
	}
	if (hasOwnKey(existing, "agentTimeoutMs") || agentTimeoutMs !== defaultTimeouts.agentTimeoutMs) {
		payload.agentTimeoutMs = agentTimeoutMs;
	}
	if (
		hasOwnKey(existing, "conversationTimeoutMs") ||
		conversationTimeoutMs !== defaultTimeouts.conversationTimeoutMs
	) {
		payload.conversationTimeoutMs = conversationTimeoutMs;
	}
	assignChangedConfigField(
		payload,
		existing,
		"maxAgentWritableFileLines",
		maxAgentWritableFileLines,
		DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES,
	);
	assignChangedConfigField(payload, existing, "maxConcurrentTasks", maxConcurrentTasks, DEFAULT_MAX_CONCURRENT_TASKS);
	assignChangedConfigField(
		payload,
		existing,
		"sandboxMaxContainers",
		sandboxMaxContainers,
		DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	);
	assignChangedConfigField(
		payload,
		existing,
		"sandboxAgentsPerContainer",
		sandboxAgentsPerContainer,
		DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	);
	assignChangedConfigField(
		payload,
		existing,
		"sandboxMemoryPerContainerMb",
		sandboxMemoryPerContainerMb,
		DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
	);
	assignChangedConfigField(
		payload,
		existing,
		"sandboxCpusPerContainer",
		sandboxCpusPerContainer,
		DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	);
	assignChangedConfigField(
		payload,
		existing,
		"sandboxIdleTimeoutMinutes",
		sandboxIdleTimeoutMinutes,
		DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	);
	assignChangedConfigField(
		payload,
		existing,
		"lostHeartbeatPolicy",
		lostHeartbeatPolicy,
		DEFAULT_LOST_HEARTBEAT_POLICY,
	);
	assignChangedConfigField(
		payload,
		existing,
		"decompositionAutoApplyEnabled",
		decompositionAutoApplyEnabled,
		DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"secondOpinionReviewEnabled",
		secondOpinionReviewEnabled,
		DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
	);
	assignChangedConfigField(payload, existing, "reviewMaxRounds", reviewMaxRounds, DEFAULT_REVIEW_MAX_ROUNDS);
	assignChangedConfigField(
		payload,
		existing,
		"readyForReviewNotificationsEnabled",
		readyForReviewNotificationsEnabled,
		DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
	);
	if (
		hasOwnKey(existing, "codeEmbeddingDefaults") ||
		!areCodeEmbeddingSettingsEqual(codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS)
	) {
		payload.codeEmbeddingDefaults = codeEmbeddingDefaults;
	}
	if (
		hasOwnKey(existing, "modelSuitabilityPolicyDefaults") ||
		!areModelSuitabilityPoliciesEqual(modelSuitabilityPolicyDefaults, DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG)
	) {
		payload.modelSuitabilityPolicyDefaults = modelSuitabilityPolicyDefaults;
	}
	if (
		hasOwnKey(existing, "skillDynamicsLevelDefault") ||
		!areSkillDynamicsLevelsEqual(skillDynamicsLevelDefault, DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG)
	) {
		payload.skillDynamicsLevelDefault = skillDynamicsLevelDefault;
	}
	if (
		hasOwnKey(existing, "concurrencyDefaults") ||
		!areConcurrencyConfigsEqual(concurrencyDefaults, DEFAULT_CONCURRENCY_CONFIG)
	) {
		payload.concurrencyDefaults = concurrencyDefaults;
	}
	if (hasOwnKey(existing, "modelRoles") || Object.keys(modelRoles).length > 0) {
		payload.modelRoles = modelRoles;
	}
	if (hasOwnKey(existing, "agentRulesets") || !areAgentRulesetsEqual(agentRulesets, DEFAULT_AGENT_RULESETS_CONFIG)) {
		payload.agentRulesets = agentRulesets;
	}
	if (
		hasOwnKey(existing, "swarmGuardrails") ||
		!areRuntimeSwarmGuardrailsEqual(swarmGuardrails, DEFAULT_RUNTIME_SWARM_GUARDRAILS)
	) {
		payload.swarmGuardrails = swarmGuardrails;
	}
	assignChangedConfigField(
		payload,
		existing,
		"commitPromptTemplate",
		commitPromptTemplate,
		DEFAULT_COMMIT_PROMPT_TEMPLATE,
	);
	assignChangedConfigField(
		payload,
		existing,
		"openPrPromptTemplate",
		openPrPromptTemplate,
		DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	);

	await lockedFileSystem.writeJsonFileAtomic(configPath, payload, {
		lock: null,
	});
}

async function writeRuntimeProjectConfigFile(
	configPath: string | null,
	config: {
		shortcuts: RuntimeProjectShortcut[];
		codeEmbeddingOverride?: RuntimeCodeEmbeddingSettings | null;
		modelSuitabilityPolicyOverride?: RuntimeModelSuitabilityPolicy | null;
		skillDynamicsLevelOverride?: RuntimeSkillDynamicsLevel | null;
		concurrencyOverride?: ConcurrencyOverride | null;
		maxConcurrentTasksOverride?: number | null;
		selectedAgentIdOverride?: RuntimeAgentId | null;
		agentRulesetsOverride?: AgentRulesetsConfigPayload | null;
		modelRolesOverride?: RuntimeModelRoles | null;
	},
): Promise<void> {
	const normalizedShortcuts = normalizeShortcuts(config.shortcuts);
	const codeEmbeddingOverride = normalizeCodeEmbeddingOverride(config.codeEmbeddingOverride);
	const modelSuitabilityPolicyOverride = normalizeModelSuitabilityPolicyOverride(
		config.modelSuitabilityPolicyOverride,
	);
	const skillDynamicsLevelOverride = normalizeSkillDynamicsLevelOverride(config.skillDynamicsLevelOverride);
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
		codeEmbeddingOverride === null &&
		modelSuitabilityPolicyOverride === null &&
		skillDynamicsLevelOverride === null &&
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
			...(codeEmbeddingOverride ? { codeEmbeddingOverride } : {}),
			...(modelSuitabilityPolicyOverride ? { modelSuitabilityPolicyOverride } : {}),
			...(skillDynamicsLevelOverride ? { skillDynamicsLevelOverride } : {}),
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

function createRuntimeConfigStateFromValues(input: {
	globalConfigPath: string;
	projectConfigPath: string | null;
	selectedAgentId: RuntimeAgentId;
	selectedShortcutLabel: string | null;
	developerModeEnabled: boolean;
	replayCardsEnabled: boolean;
	agentAutonomousModeEnabled: boolean;
	agentTimeoutMode: RuntimeAgentTimeoutMode;
	agentTimeoutProfile: RuntimeAgentTimeoutProfile;
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	maxAgentWritableFileLines: number;
	maxConcurrentTasks: number;
	maxConcurrentTasksOverride: number | null;
	selectedAgentIdOverride: RuntimeAgentId | null;
	sandboxMaxContainers: number;
	sandboxAgentsPerContainer: number;
	sandboxMemoryPerContainerMb: number;
	sandboxCpusPerContainer: number;
	sandboxIdleTimeoutMinutes: number;
	lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled: boolean;
	secondOpinionReviewEnabled: boolean;
	reviewMaxRounds: number;
	readyForReviewNotificationsEnabled: boolean;
	codeEmbeddingDefaults: RuntimeCodeEmbeddingSettings;
	codeEmbeddingOverride: RuntimeCodeEmbeddingSettings | null;
	modelSuitabilityPolicyDefaults: RuntimeModelSuitabilityPolicy;
	modelSuitabilityPolicyOverride: RuntimeModelSuitabilityPolicy | null;
	skillDynamicsLevelDefault: RuntimeSkillDynamicsLevel;
	skillDynamicsLevelOverride: RuntimeSkillDynamicsLevel | null;
	concurrencyDefaults: ConcurrencyConfig;
	concurrencyOverride: ConcurrencyOverride | null;
	modelRoles: RuntimeModelRoles;
	modelRolesOverride: RuntimeModelRoles | null;
	agentRulesets?: AgentRulesetsConfigPayload;
	agentRulesetsOverride: AgentRulesetsConfigPayload | null;
	swarmGuardrails?: Partial<RuntimeSwarmGuardrails>;
	shortcuts: RuntimeProjectShortcut[];
	commitPromptTemplate: string;
	openPrPromptTemplate: string;
	workspaceBaseDir: string | null;
}): RuntimeConfigState {
	return {
		globalConfigPath: input.globalConfigPath,
		projectConfigPath: input.projectConfigPath,
		selectedAgentId: normalizeAgentId(input.selectedAgentId),
		selectedShortcutLabel: normalizeShortcutLabel(input.selectedShortcutLabel),
		developerModeEnabled: normalizeBoolean(input.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED),
		replayCardsEnabled: normalizeBoolean(input.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED),
		agentAutonomousModeEnabled: normalizeBoolean(
			input.agentAutonomousModeEnabled,
			DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
		),
		agentTimeoutMode: normalizeAgentTimeoutMode(input.agentTimeoutMode),
		agentTimeoutProfile: normalizeAgentTimeoutProfile(input.agentTimeoutProfile),
		requestTimeoutMs: normalizeTimeoutMsValue(input.requestTimeoutMs),
		streamTimeoutMs: normalizeTimeoutMsValue(input.streamTimeoutMs),
		toolTimeoutMs: normalizeTimeoutMsValue(input.toolTimeoutMs),
		agentTimeoutMs: normalizeTimeoutMsValue(input.agentTimeoutMs),
		conversationTimeoutMs: normalizeTimeoutMsValue(input.conversationTimeoutMs),
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(input.maxAgentWritableFileLines),
		maxConcurrentTasks: normalizeMaxConcurrentTasks(input.maxConcurrentTasks),
		maxConcurrentTasksOverride: normalizeMaxConcurrentTasksOverride(input.maxConcurrentTasksOverride),
		effectiveMaxConcurrentTasks:
			normalizeMaxConcurrentTasksOverride(input.maxConcurrentTasksOverride) ??
			normalizeMaxConcurrentTasks(input.maxConcurrentTasks),
		selectedAgentIdOverride: normalizeSelectedAgentIdOverride(input.selectedAgentIdOverride),
		effectiveSelectedAgentId:
			normalizeSelectedAgentIdOverride(input.selectedAgentIdOverride) ?? normalizeAgentId(input.selectedAgentId),
		sandboxMaxContainers: normalizePositiveInteger(input.sandboxMaxContainers, DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS),
		sandboxAgentsPerContainer: normalizeNonNegativeInteger(
			input.sandboxAgentsPerContainer,
			DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
		),
		sandboxMemoryPerContainerMb: normalizePositiveInteger(
			input.sandboxMemoryPerContainerMb,
			DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
		),
		sandboxCpusPerContainer: normalizePositiveNumber(
			input.sandboxCpusPerContainer,
			DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
		),
		sandboxIdleTimeoutMinutes: normalizePositiveInteger(
			input.sandboxIdleTimeoutMinutes,
			DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
		),
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(input.lostHeartbeatPolicy),
		decompositionAutoApplyEnabled: normalizeBoolean(
			input.decompositionAutoApplyEnabled,
			DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
		),
		secondOpinionReviewEnabled: normalizeBoolean(
			input.secondOpinionReviewEnabled,
			DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
		),
		reviewMaxRounds: normalizePositiveInteger(input.reviewMaxRounds, DEFAULT_REVIEW_MAX_ROUNDS),
		readyForReviewNotificationsEnabled: normalizeBoolean(
			input.readyForReviewNotificationsEnabled,
			DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
		),
		codeEmbeddingDefaults: normalizeCodeEmbeddingSettings(
			input.codeEmbeddingDefaults,
			DEFAULT_CODE_EMBEDDING_SETTINGS,
		),
		codeEmbeddingOverride: normalizeCodeEmbeddingOverride(input.codeEmbeddingOverride),
		effectiveCodeEmbeddingSettings:
			normalizeCodeEmbeddingOverride(input.codeEmbeddingOverride) ??
			normalizeCodeEmbeddingSettings(input.codeEmbeddingDefaults, DEFAULT_CODE_EMBEDDING_SETTINGS),
		modelSuitabilityPolicyDefaults: normalizeModelSuitabilityPolicy(
			input.modelSuitabilityPolicyDefaults,
			DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
		),
		modelSuitabilityPolicyOverride: normalizeModelSuitabilityPolicyOverride(input.modelSuitabilityPolicyOverride),
		effectiveModelSuitabilityPolicy:
			normalizeModelSuitabilityPolicyOverride(input.modelSuitabilityPolicyOverride) ??
			normalizeModelSuitabilityPolicy(input.modelSuitabilityPolicyDefaults, DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG),
		skillDynamicsLevelDefault: normalizeSkillDynamicsLevel(
			input.skillDynamicsLevelDefault,
			DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
		),
		skillDynamicsLevelOverride: normalizeSkillDynamicsLevelOverride(input.skillDynamicsLevelOverride),
		effectiveSkillDynamicsLevel:
			normalizeSkillDynamicsLevelOverride(input.skillDynamicsLevelOverride) ??
			normalizeSkillDynamicsLevel(input.skillDynamicsLevelDefault, DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG),
		concurrencyDefaults: normalizeConcurrencyConfig(input.concurrencyDefaults),
		concurrencyOverride: normalizeConcurrencyOverride(input.concurrencyOverride),
		modelRoles: normalizeModelRoles(input.modelRoles),
		modelRolesOverride: normalizeModelRolesOverride(input.modelRolesOverride),
		effectiveModelRoles:
			normalizeModelRolesOverride(input.modelRolesOverride) ?? normalizeModelRoles(input.modelRoles),
		agentRulesets: normalizeAgentRulesets(input.agentRulesets),
		agentRulesetsOverride: normalizeAgentRulesetsOverride(input.agentRulesetsOverride),
		effectiveAgentRulesets:
			normalizeAgentRulesetsOverride(input.agentRulesetsOverride) ?? normalizeAgentRulesets(input.agentRulesets),
		swarmGuardrails: normalizeRuntimeSwarmGuardrails(input.swarmGuardrails),
		shortcuts: normalizeShortcuts(input.shortcuts),
		commitPromptTemplate: normalizePromptTemplateWithLegacyDefault(
			input.commitPromptTemplate,
			DEFAULT_COMMIT_PROMPT_TEMPLATE,
			LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
		),
		openPrPromptTemplate: normalizePromptTemplateWithLegacyDefault(
			input.openPrPromptTemplate,
			DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
			LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
		),
		commitPromptTemplateDefault: DEFAULT_COMMIT_PROMPT_TEMPLATE,
		openPrPromptTemplateDefault: DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
		workspaceBaseDir: normalizeWorkspaceBaseDir(input.workspaceBaseDir),
	};
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
			codeEmbeddingOverride: config.codeEmbeddingOverride,
			modelSuitabilityPolicyOverride: config.modelSuitabilityPolicyOverride,
			skillDynamicsLevelOverride: config.skillDynamicsLevelOverride,
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
			selectedAgentId: keepUpdatedValue(updates.selectedAgentId, current.selectedAgentId),
			selectedShortcutLabel: keepUpdatedValue(updates.selectedShortcutLabel, current.selectedShortcutLabel),
			workspaceBaseDir: keepUpdatedValue(updates.workspaceBaseDir, current.workspaceBaseDir),
			developerModeEnabled: keepNormalizedValue(
				updates.developerModeEnabled,
				current.developerModeEnabled,
				(value) => normalizeBoolean(value, DEFAULT_DEVELOPER_MODE_ENABLED),
			),
			replayCardsEnabled: keepNormalizedValue(updates.replayCardsEnabled, current.replayCardsEnabled, (value) =>
				normalizeBoolean(value, DEFAULT_REPLAY_CARDS_ENABLED),
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
			sandboxMaxContainers: keepNormalizedValue(
				updates.sandboxMaxContainers,
				current.sandboxMaxContainers,
				(value) => normalizePositiveInteger(value, DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS),
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
			codeEmbeddingOverride: keepNormalizedValue(
				updates.codeEmbeddingOverride,
				current.codeEmbeddingOverride,
				normalizeCodeEmbeddingOverride,
			),
			modelSuitabilityPolicyDefaults: keepNormalizedValue(
				updates.modelSuitabilityPolicyDefaults,
				current.modelSuitabilityPolicyDefaults,
				(value) => normalizeModelSuitabilityPolicy(value, DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG),
			),
			modelSuitabilityPolicyOverride: keepNormalizedValue(
				updates.modelSuitabilityPolicyOverride,
				current.modelSuitabilityPolicyOverride,
				normalizeModelSuitabilityPolicyOverride,
			),
			skillDynamicsLevelDefault: keepNormalizedValue(
				updates.skillDynamicsLevelDefault,
				current.skillDynamicsLevelDefault,
				(value) => normalizeSkillDynamicsLevel(value, DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG),
			),
			skillDynamicsLevelOverride: keepNormalizedValue(
				updates.skillDynamicsLevelOverride,
				current.skillDynamicsLevelOverride,
				normalizeSkillDynamicsLevelOverride,
			),
			concurrencyDefaults: keepNormalizedValue(
				updates.concurrencyDefaults,
				current.concurrencyDefaults,
				normalizeConcurrencyConfig,
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
			modelRoles: keepNormalizedValue(updates.modelRoles, current.modelRoles, normalizeModelRoles),
			agentRulesets: keepNormalizedValue(updates.agentRulesets, current.agentRulesets, normalizeAgentRulesets),
			swarmGuardrails: keepNormalizedValue(
				updates.swarmGuardrails,
				current.swarmGuardrails,
				normalizeRuntimeSwarmGuardrails,
			),
			shortcuts: projectConfigPath ? (updates.shortcuts ?? current.shortcuts) : current.shortcuts,
			commitPromptTemplate: keepUpdatedValue(updates.commitPromptTemplate, current.commitPromptTemplate),
			openPrPromptTemplate: keepUpdatedValue(updates.openPrPromptTemplate, current.openPrPromptTemplate),
		};

		const hasChanges = runtimeConfigStateHasChanges(RUNTIME_PROJECT_CONFIG_CHANGE_FIELDS, nextConfig, current);

		if (!hasChanges) {
			return current;
		}

		await writeRuntimeGlobalConfigFile(globalConfigPath, {
			selectedAgentId: nextConfig.selectedAgentId,
			selectedShortcutLabel: nextConfig.selectedShortcutLabel,
			workspaceBaseDir: nextConfig.workspaceBaseDir,
			developerModeEnabled: nextConfig.developerModeEnabled,
			replayCardsEnabled: nextConfig.replayCardsEnabled,
			agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
			agentTimeoutMode: nextConfig.agentTimeoutMode,
			agentTimeoutProfile: nextConfig.agentTimeoutProfile,
			requestTimeoutMs: nextConfig.requestTimeoutMs,
			streamTimeoutMs: nextConfig.streamTimeoutMs,
			toolTimeoutMs: nextConfig.toolTimeoutMs,
			agentTimeoutMs: nextConfig.agentTimeoutMs,
			conversationTimeoutMs: nextConfig.conversationTimeoutMs,
			maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
			maxConcurrentTasks: nextConfig.maxConcurrentTasks,
			sandboxMaxContainers: nextConfig.sandboxMaxContainers,
			sandboxAgentsPerContainer: nextConfig.sandboxAgentsPerContainer,
			sandboxMemoryPerContainerMb: nextConfig.sandboxMemoryPerContainerMb,
			sandboxCpusPerContainer: nextConfig.sandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes: nextConfig.sandboxIdleTimeoutMinutes,
			lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
			decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
			secondOpinionReviewEnabled: nextConfig.secondOpinionReviewEnabled,
			reviewMaxRounds: nextConfig.reviewMaxRounds,
			readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
			modelSuitabilityPolicyDefaults: nextConfig.modelSuitabilityPolicyDefaults,
			skillDynamicsLevelDefault: nextConfig.skillDynamicsLevelDefault,
			concurrencyDefaults: nextConfig.concurrencyDefaults,
			modelRoles: nextConfig.modelRoles,
			agentRulesets: nextConfig.agentRulesets,
			swarmGuardrails: nextConfig.swarmGuardrails,
			commitPromptTemplate: nextConfig.commitPromptTemplate,
			openPrPromptTemplate: nextConfig.openPrPromptTemplate,
		});
		await writeRuntimeProjectConfigFile(projectConfigPath, {
			shortcuts: nextConfig.shortcuts,
			codeEmbeddingOverride: nextConfig.codeEmbeddingOverride,
			modelSuitabilityPolicyOverride: nextConfig.modelSuitabilityPolicyOverride,
			skillDynamicsLevelOverride: nextConfig.skillDynamicsLevelOverride,
			concurrencyOverride: nextConfig.concurrencyOverride,
			maxConcurrentTasksOverride: nextConfig.maxConcurrentTasksOverride,
			selectedAgentIdOverride: nextConfig.selectedAgentIdOverride,
			agentRulesetsOverride: nextConfig.agentRulesetsOverride,
			modelRolesOverride: nextConfig.modelRolesOverride,
		});
		return createRuntimeConfigStateFromValues({
			globalConfigPath,
			projectConfigPath,
			selectedAgentId: nextConfig.selectedAgentId,
			selectedShortcutLabel: nextConfig.selectedShortcutLabel,
			workspaceBaseDir: nextConfig.workspaceBaseDir,
			developerModeEnabled: nextConfig.developerModeEnabled,
			replayCardsEnabled: nextConfig.replayCardsEnabled,
			agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
			agentTimeoutMode: nextConfig.agentTimeoutMode,
			agentTimeoutProfile: nextConfig.agentTimeoutProfile,
			requestTimeoutMs: nextConfig.requestTimeoutMs,
			streamTimeoutMs: nextConfig.streamTimeoutMs,
			toolTimeoutMs: nextConfig.toolTimeoutMs,
			agentTimeoutMs: nextConfig.agentTimeoutMs,
			conversationTimeoutMs: nextConfig.conversationTimeoutMs,
			maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
			maxConcurrentTasks: nextConfig.maxConcurrentTasks,
			maxConcurrentTasksOverride: nextConfig.maxConcurrentTasksOverride,
			selectedAgentIdOverride: nextConfig.selectedAgentIdOverride,
			agentRulesetsOverride: nextConfig.agentRulesetsOverride,
			modelRolesOverride: nextConfig.modelRolesOverride,
			sandboxMaxContainers: nextConfig.sandboxMaxContainers,
			sandboxAgentsPerContainer: nextConfig.sandboxAgentsPerContainer,
			sandboxMemoryPerContainerMb: nextConfig.sandboxMemoryPerContainerMb,
			sandboxCpusPerContainer: nextConfig.sandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes: nextConfig.sandboxIdleTimeoutMinutes,
			lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
			decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
			secondOpinionReviewEnabled: nextConfig.secondOpinionReviewEnabled,
			reviewMaxRounds: nextConfig.reviewMaxRounds,
			readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
			codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
			codeEmbeddingOverride: nextConfig.codeEmbeddingOverride,
			modelSuitabilityPolicyDefaults: nextConfig.modelSuitabilityPolicyDefaults,
			modelSuitabilityPolicyOverride: nextConfig.modelSuitabilityPolicyOverride,
			skillDynamicsLevelDefault: nextConfig.skillDynamicsLevelDefault,
			skillDynamicsLevelOverride: nextConfig.skillDynamicsLevelOverride,
			concurrencyDefaults: nextConfig.concurrencyDefaults,
			concurrencyOverride: nextConfig.concurrencyOverride,
			modelRoles: nextConfig.modelRoles,
			agentRulesets: nextConfig.agentRulesets,
			swarmGuardrails: nextConfig.swarmGuardrails,
			shortcuts: nextConfig.shortcuts,
			commitPromptTemplate: nextConfig.commitPromptTemplate,
			openPrPromptTemplate: nextConfig.openPrPromptTemplate,
		});
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
				selectedAgentId: keepUpdatedValue(updates.selectedAgentId, current.selectedAgentId),
				selectedShortcutLabel: keepUpdatedValue(updates.selectedShortcutLabel, current.selectedShortcutLabel),
				workspaceBaseDir: keepUpdatedValue(updates.workspaceBaseDir, current.workspaceBaseDir),
				developerModeEnabled: keepNormalizedValue(
					updates.developerModeEnabled,
					current.developerModeEnabled,
					(value) => normalizeBoolean(value, DEFAULT_DEVELOPER_MODE_ENABLED),
				),
				replayCardsEnabled: keepNormalizedValue(updates.replayCardsEnabled, current.replayCardsEnabled, (value) =>
					normalizeBoolean(value, DEFAULT_REPLAY_CARDS_ENABLED),
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
				sandboxMaxContainers: keepNormalizedValue(
					updates.sandboxMaxContainers,
					current.sandboxMaxContainers,
					(value) => normalizePositiveInteger(value, DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS),
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
				codeEmbeddingOverride: null,
				modelSuitabilityPolicyDefaults: keepNormalizedValue(
					updates.modelSuitabilityPolicyDefaults,
					current.modelSuitabilityPolicyDefaults,
					(value) => normalizeModelSuitabilityPolicy(value, DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG),
				),
				modelSuitabilityPolicyOverride: null,
				skillDynamicsLevelDefault: keepNormalizedValue(
					updates.skillDynamicsLevelDefault,
					current.skillDynamicsLevelDefault,
					(value) => normalizeSkillDynamicsLevel(value, DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG),
				),
				skillDynamicsLevelOverride: null,
				concurrencyDefaults: keepNormalizedValue(
					updates.concurrencyDefaults,
					current.concurrencyDefaults,
					normalizeConcurrencyConfig,
				),
				concurrencyOverride: null,
				maxConcurrentTasksOverride: null,
				selectedAgentIdOverride: null,
				agentRulesetsOverride: null,
				modelRolesOverride: null,
				modelRoles: keepNormalizedValue(updates.modelRoles, current.modelRoles, normalizeModelRoles),
				agentRulesets: keepNormalizedValue(updates.agentRulesets, current.agentRulesets, normalizeAgentRulesets),
				swarmGuardrails: keepNormalizedValue(
					updates.swarmGuardrails,
					current.swarmGuardrails,
					normalizeRuntimeSwarmGuardrails,
				),
				shortcuts: current.shortcuts,
				commitPromptTemplate: keepUpdatedValue(updates.commitPromptTemplate, current.commitPromptTemplate),
				openPrPromptTemplate: keepUpdatedValue(updates.openPrPromptTemplate, current.openPrPromptTemplate),
			};

			const hasChanges = runtimeConfigStateHasChanges(RUNTIME_GLOBAL_CONFIG_CHANGE_FIELDS, nextConfig, current);

			if (!hasChanges) {
				return current;
			}

			await writeRuntimeGlobalConfigFile(globalConfigPath, {
				selectedAgentId: nextConfig.selectedAgentId,
				selectedShortcutLabel: nextConfig.selectedShortcutLabel,
				workspaceBaseDir: nextConfig.workspaceBaseDir,
				developerModeEnabled: nextConfig.developerModeEnabled,
				replayCardsEnabled: nextConfig.replayCardsEnabled,
				agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
				agentTimeoutMode: nextConfig.agentTimeoutMode,
				agentTimeoutProfile: nextConfig.agentTimeoutProfile,
				requestTimeoutMs: nextConfig.requestTimeoutMs,
				streamTimeoutMs: nextConfig.streamTimeoutMs,
				toolTimeoutMs: nextConfig.toolTimeoutMs,
				agentTimeoutMs: nextConfig.agentTimeoutMs,
				conversationTimeoutMs: nextConfig.conversationTimeoutMs,
				maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
				maxConcurrentTasks: nextConfig.maxConcurrentTasks,
				sandboxMaxContainers: nextConfig.sandboxMaxContainers,
				sandboxAgentsPerContainer: nextConfig.sandboxAgentsPerContainer,
				sandboxMemoryPerContainerMb: nextConfig.sandboxMemoryPerContainerMb,
				sandboxCpusPerContainer: nextConfig.sandboxCpusPerContainer,
				sandboxIdleTimeoutMinutes: nextConfig.sandboxIdleTimeoutMinutes,
				lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
				decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
				secondOpinionReviewEnabled: nextConfig.secondOpinionReviewEnabled,
				reviewMaxRounds: nextConfig.reviewMaxRounds,
				readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
				codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
				modelSuitabilityPolicyDefaults: nextConfig.modelSuitabilityPolicyDefaults,
				skillDynamicsLevelDefault: nextConfig.skillDynamicsLevelDefault,
				concurrencyDefaults: nextConfig.concurrencyDefaults,
				modelRoles: nextConfig.modelRoles,
				agentRulesets: nextConfig.agentRulesets,
				swarmGuardrails: nextConfig.swarmGuardrails,
				commitPromptTemplate: nextConfig.commitPromptTemplate,
				openPrPromptTemplate: nextConfig.openPrPromptTemplate,
			});

			return createRuntimeConfigStateFromValues({
				globalConfigPath,
				projectConfigPath: current.projectConfigPath,
				selectedAgentId: nextConfig.selectedAgentId,
				selectedShortcutLabel: nextConfig.selectedShortcutLabel,
				workspaceBaseDir: nextConfig.workspaceBaseDir,
				developerModeEnabled: nextConfig.developerModeEnabled,
				replayCardsEnabled: nextConfig.replayCardsEnabled,
				agentAutonomousModeEnabled: nextConfig.agentAutonomousModeEnabled,
				agentTimeoutMode: nextConfig.agentTimeoutMode,
				agentTimeoutProfile: nextConfig.agentTimeoutProfile,
				requestTimeoutMs: nextConfig.requestTimeoutMs,
				streamTimeoutMs: nextConfig.streamTimeoutMs,
				toolTimeoutMs: nextConfig.toolTimeoutMs,
				agentTimeoutMs: nextConfig.agentTimeoutMs,
				conversationTimeoutMs: nextConfig.conversationTimeoutMs,
				maxAgentWritableFileLines: nextConfig.maxAgentWritableFileLines,
				maxConcurrentTasks: nextConfig.maxConcurrentTasks,
				maxConcurrentTasksOverride: null,
				selectedAgentIdOverride: null,
				agentRulesetsOverride: null,
				modelRolesOverride: null,
				sandboxMaxContainers: nextConfig.sandboxMaxContainers,
				sandboxAgentsPerContainer: nextConfig.sandboxAgentsPerContainer,
				sandboxMemoryPerContainerMb: nextConfig.sandboxMemoryPerContainerMb,
				sandboxCpusPerContainer: nextConfig.sandboxCpusPerContainer,
				sandboxIdleTimeoutMinutes: nextConfig.sandboxIdleTimeoutMinutes,
				lostHeartbeatPolicy: nextConfig.lostHeartbeatPolicy,
				decompositionAutoApplyEnabled: nextConfig.decompositionAutoApplyEnabled,
				secondOpinionReviewEnabled: nextConfig.secondOpinionReviewEnabled,
				reviewMaxRounds: nextConfig.reviewMaxRounds,
				readyForReviewNotificationsEnabled: nextConfig.readyForReviewNotificationsEnabled,
				codeEmbeddingDefaults: nextConfig.codeEmbeddingDefaults,
				codeEmbeddingOverride: null,
				modelSuitabilityPolicyDefaults: nextConfig.modelSuitabilityPolicyDefaults,
				modelSuitabilityPolicyOverride: null,
				skillDynamicsLevelDefault: nextConfig.skillDynamicsLevelDefault,
				skillDynamicsLevelOverride: null,
				concurrencyDefaults: nextConfig.concurrencyDefaults,
				concurrencyOverride: null,
				modelRoles: nextConfig.modelRoles,
				agentRulesets: nextConfig.agentRulesets,
				swarmGuardrails: nextConfig.swarmGuardrails,
				shortcuts: nextConfig.shortcuts,
				commitPromptTemplate: nextConfig.commitPromptTemplate,
				openPrPromptTemplate: nextConfig.openPrPromptTemplate,
			});
		},
	);
}
