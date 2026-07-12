// Pure builder for the global runtime-config file payload (extracted from runtime-config.ts, §5.U).
// Given the caller's partial write input plus the existing on-disk shape, it produces the minimized
// `RuntimeGlobalConfigFileShape` to persist: every field is normalized, and a value is written only when
// it differs from its default or its key was already present on disk — so a freshly-defaulted config
// stays sparse and round-trips unchanged. This is the logic-dense core of `writeRuntimeGlobalConfigFile`;
// the surrounding read/write IO stays in runtime-config.ts.

import { DEFAULT_AGENT_RULESETS_CONFIG } from "../core/agent-rulesets";
import { DEFAULT_MAX_AGENT_WRITABLE_FILE_LINES, normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
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
	RuntimeSandboxIsolationProfile,
	RuntimeSkillDynamicsLevel,
	RuntimeSwarmGuardrails,
} from "../core/api-contract";
import {
	areRuntimeSwarmGuardrailsEqual,
	DEFAULT_RUNTIME_SANDBOX_ISOLATION_PROFILE,
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	normalizeRuntimeSwarmGuardrails,
} from "../core/api-contract";
import {
	areConcurrencyConfigsEqual,
	type ConcurrencyConfig,
	DEFAULT_CONCURRENCY_CONFIG,
	normalizeConcurrencyConfig,
} from "../core/concurrency-config";
import {
	DEFAULT_MODEL_STATS_TRACKING_LEVEL,
	type ModelStatsTrackingLevel,
	normalizeModelStatsTrackingLevel,
} from "../core/model-stats-tracking-level";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../nklein-agent/nklein-agent-sandbox";
import {
	DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
	DEFAULT_AGENT_ID,
	DEFAULT_AGENT_TIMEOUT_MODE,
	DEFAULT_AGENT_TIMEOUT_PROFILE,
	DEFAULT_BASIC_MEMORY_ENABLED,
	DEFAULT_CAPABILITY_BROKER_ENABLED,
	DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED,
	DEFAULT_CODE_EMBEDDING_SETTINGS,
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_KNOWS_TODAY_ENABLED,
	DEFAULT_LLMFIT_CATALOG_UPDATE_MODE,
	DEFAULT_LOST_HEARTBEAT_POLICY,
	DEFAULT_MAX_CONCURRENT_TASKS,
	DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
	DEFAULT_REASONING_BUDGET_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
	DEFAULT_REVIEW_LENSES_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
	DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "./runtime-config-defaults";
import {
	areAgentRulesetsEqual,
	areCodeEmbeddingSettingsEqual,
	areModelSuitabilityPoliciesEqual,
	areSkillDynamicsLevelsEqual,
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
	normalizeAgentId,
	normalizeAgentRulesets,
	normalizeAgentTimeoutMode,
	normalizeAgentTimeoutProfile,
	normalizeBoolean,
	normalizeCodeEmbeddingSettings,
	normalizeLlmfitCatalogUpdateMode,
	normalizeLostHeartbeatPolicy,
	normalizeMaxConcurrentTasks,
	normalizeModelRoles,
	normalizeModelSuitabilityPolicy,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
	normalizePromptTemplateWithLegacyDefault,
	normalizeSkillDynamicsLevel,
	normalizeTimeoutMsValue,
	readLegacyDeveloperModeEnabled,
	resolveProfileTimeoutDefaults,
} from "./runtime-config-normalizers";
import { DEFAULT_FILE_OVERLAP_PARALLELISM, normalizeFileOverlapParallelism } from "./runtime-config-overlap-resolver";
import {
	DEFAULT_COMMIT_PROMPT_TEMPLATE,
	DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
} from "./runtime-config-prompt-templates";
import {
	DEFAULT_RETRIEVAL_EGRESS_ENABLED,
	normalizeRetrievalEgressEnabled,
	normalizeRetrievalSearchBackendUrl,
} from "./runtime-config-retrieval-resolver";
import { normalizeRuntimeSandboxIsolationProfile } from "./runtime-config-sandbox-resolver";
import {
	DEFAULT_SETUP_WIZARD_COMPLETED_AT,
	normalizeSetupWizardCompletedAt,
} from "./runtime-config-setup-wizard-resolver";
import {
	DEFAULT_SPECULATIVE_BEST_OF_N_ENABLED,
	DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS,
	DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN,
	normalizeSpeculativeBestOfNEnabled,
	normalizeSpeculativeMaxConcurrentSpecs,
	normalizeSpeculativeMaxSpecsPerRun,
} from "./runtime-config-speculative-resolver";
import type { RuntimeGlobalConfigFileShape } from "./runtime-config-types";
import {
	assignChangedConfigField,
	hasOwnKey,
	normalizeDeviceRamGb,
	normalizeSandboxEgressAllowlist,
	normalizeShortcutLabel,
	normalizeWorkspaceBaseDir,
} from "./runtime-config-value-helpers";

/** Partial write input for a global-config save: every field optional, undefined meaning "leave as-is". */
export interface RuntimeGlobalConfigFileWriteInput {
	selectedAgentId?: RuntimeAgentId;
	selectedShortcutLabel?: string | null;
	developerModeEnabled?: boolean;
	replayCardsEnabled?: boolean;
	setupWizardCompletedAt?: number | null;
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
	sandboxMaxConcurrentExec?: number;
	sandboxIdleTimeoutMinutes?: number;
	sandboxIsolationProfileDefault?: RuntimeSandboxIsolationProfile;
	lostHeartbeatPolicy?: RuntimeLostHeartbeatPolicy;
	decompositionAutoApplyEnabled?: boolean;
	hardTaskRoutingMode?: "wait_for_best" | "attempt_with_available";
	testDrivenModeEnabled?: boolean;
	secondOpinionReviewEnabled?: boolean;
	reviewMaxRounds?: number;
	readyForReviewNotificationsEnabled?: boolean;
	codeEmbeddingDefaults?: RuntimeCodeEmbeddingSettings;
	modelSuitabilityPolicyDefaults?: RuntimeModelSuitabilityPolicy;
	skillDynamicsLevelDefault?: RuntimeSkillDynamicsLevel;
	fileOverlapParallelism?: RuntimeFileOverlapParallelism;
	concurrencyDefaults?: ConcurrencyConfig;
	modelRoles?: RuntimeModelRoles;
	agentRulesets?: AgentRulesetsConfigPayload;
	swarmGuardrails?: RuntimeSwarmGuardrails;
	commitPromptTemplate?: string;
	openPrPromptTemplate?: string;
	workspaceBaseDir?: string | null;
	deviceRamGb?: string | null;
	sandboxEgressProxyEnabled?: boolean;
	sandboxEgressAllowlist?: string | null;
}

export function buildRuntimeGlobalConfigFilePayload(
	config: RuntimeGlobalConfigFileWriteInput,
	existing: RuntimeGlobalConfigFileShape | null,
): RuntimeGlobalConfigFileShape {
	const selectedAgentId = config.selectedAgentId === undefined ? undefined : normalizeAgentId(config.selectedAgentId);
	const existingSelectedAgentId = hasOwnKey(existing, "selectedAgentId")
		? normalizeAgentId(existing?.selectedAgentId)
		: undefined;
	const selectedShortcutLabel =
		config.selectedShortcutLabel === undefined ? undefined : normalizeShortcutLabel(config.selectedShortcutLabel);
	const developerModeEnabled = normalizeBoolean(config.developerModeEnabled, DEFAULT_DEVELOPER_MODE_ENABLED);
	const replayCardsEnabled = normalizeBoolean(config.replayCardsEnabled, DEFAULT_REPLAY_CARDS_ENABLED);
	const setupWizardCompletedAt = normalizeSetupWizardCompletedAt(config.setupWizardCompletedAt);
	const knowsTodayEnabled = normalizeBoolean(config.knowsTodayEnabled, DEFAULT_KNOWS_TODAY_ENABLED);
	const sandboxMcpServersEnabled = normalizeBoolean(
		config.sandboxMcpServersEnabled,
		DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
	);
	const basicMemoryEnabled = normalizeBoolean(config.basicMemoryEnabled, DEFAULT_BASIC_MEMORY_ENABLED);
	const sandboxEgressProxyEnabled = normalizeBoolean(
		config.sandboxEgressProxyEnabled,
		DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
	);
	const chatAdaptiveTruncationEnabled = normalizeBoolean(
		config.chatAdaptiveTruncationEnabled,
		DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED,
	);
	const reasoningBudgetEnabled = normalizeBoolean(config.reasoningBudgetEnabled, DEFAULT_REASONING_BUDGET_ENABLED);
	const reviewLensesEnabled = normalizeBoolean(config.reviewLensesEnabled, DEFAULT_REVIEW_LENSES_ENABLED);
	const capabilityBrokerEnabled = normalizeBoolean(config.capabilityBrokerEnabled, DEFAULT_CAPABILITY_BROKER_ENABLED);
	const modelStatsTrackingLevel = normalizeModelStatsTrackingLevel(config.modelStatsTrackingLevel);
	const retrievalEgressEnabled = normalizeRetrievalEgressEnabled(config.retrievalEgressEnabled);
	const llmfitCatalogUpdateMode = normalizeLlmfitCatalogUpdateMode(config.llmfitCatalogUpdateMode);
	const speculativeBestOfNEnabled = normalizeSpeculativeBestOfNEnabled(config.speculativeBestOfNEnabled);
	const speculativeMaxConcurrentSpecs = normalizeSpeculativeMaxConcurrentSpecs(config.speculativeMaxConcurrentSpecs);
	const speculativeMaxSpecsPerRun = normalizeSpeculativeMaxSpecsPerRun(config.speculativeMaxSpecsPerRun);
	const fileOverlapParallelism = normalizeFileOverlapParallelism(config.fileOverlapParallelism);
	const retrievalSearchBackendUrl =
		config.retrievalSearchBackendUrl === undefined
			? undefined
			: normalizeRetrievalSearchBackendUrl(config.retrievalSearchBackendUrl);
	const existingRetrievalSearchBackendUrl = hasOwnKey(existing, "retrievalSearchBackendUrl")
		? normalizeRetrievalSearchBackendUrl(existing?.retrievalSearchBackendUrl)
		: undefined;
	const existingSelectedShortcutLabel = hasOwnKey(existing, "selectedShortcutLabel")
		? normalizeShortcutLabel(existing?.selectedShortcutLabel)
		: undefined;
	const workspaceBaseDir =
		config.workspaceBaseDir === undefined ? undefined : normalizeWorkspaceBaseDir(config.workspaceBaseDir);
	const existingWorkspaceBaseDir = hasOwnKey(existing, "workspaceBaseDir")
		? normalizeWorkspaceBaseDir(existing?.workspaceBaseDir)
		: undefined;
	const deviceRamGb = config.deviceRamGb === undefined ? undefined : normalizeDeviceRamGb(config.deviceRamGb);
	const existingDeviceRamGb = hasOwnKey(existing, "deviceRamGb")
		? normalizeDeviceRamGb(existing?.deviceRamGb)
		: undefined;
	const sandboxEgressAllowlist =
		config.sandboxEgressAllowlist === undefined
			? undefined
			: normalizeSandboxEgressAllowlist(config.sandboxEgressAllowlist);
	const existingSandboxEgressAllowlist = hasOwnKey(existing, "sandboxEgressAllowlist")
		? normalizeSandboxEgressAllowlist(existing?.sandboxEgressAllowlist)
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
	const sandboxMaxConcurrentExec = normalizeNonNegativeInteger(
		config.sandboxMaxConcurrentExec,
		DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
	);
	const sandboxIdleTimeoutMinutes = normalizePositiveInteger(
		config.sandboxIdleTimeoutMinutes,
		DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	);
	const sandboxIsolationProfileDefault = normalizeRuntimeSandboxIsolationProfile(
		config.sandboxIsolationProfileDefault,
		DEFAULT_RUNTIME_SANDBOX_ISOLATION_PROFILE,
	);
	const lostHeartbeatPolicy =
		config.lostHeartbeatPolicy === undefined
			? DEFAULT_LOST_HEARTBEAT_POLICY
			: normalizeLostHeartbeatPolicy(config.lostHeartbeatPolicy);
	const decompositionAutoApplyEnabled = normalizeBoolean(
		config.decompositionAutoApplyEnabled,
		DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	);
	const hardTaskRoutingMode: "wait_for_best" | "attempt_with_available" =
		config.hardTaskRoutingMode === "wait_for_best" ? "wait_for_best" : "attempt_with_available";
	const testDrivenModeEnabled = config.testDrivenModeEnabled === true;
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
	if (deviceRamGb !== undefined) {
		if (deviceRamGb) {
			payload.deviceRamGb = deviceRamGb;
		}
	} else if (existingDeviceRamGb) {
		payload.deviceRamGb = existingDeviceRamGb;
	}
	if (sandboxEgressAllowlist !== undefined) {
		if (sandboxEgressAllowlist) {
			payload.sandboxEgressAllowlist = sandboxEgressAllowlist;
		}
	} else if (existingSandboxEgressAllowlist) {
		payload.sandboxEgressAllowlist = existingSandboxEgressAllowlist;
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
		"setupWizardCompletedAt",
		setupWizardCompletedAt,
		DEFAULT_SETUP_WIZARD_COMPLETED_AT,
	);
	assignChangedConfigField(payload, existing, "knowsTodayEnabled", knowsTodayEnabled, DEFAULT_KNOWS_TODAY_ENABLED);
	assignChangedConfigField(
		payload,
		existing,
		"sandboxMcpServersEnabled",
		sandboxMcpServersEnabled,
		DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
	);
	assignChangedConfigField(payload, existing, "basicMemoryEnabled", basicMemoryEnabled, DEFAULT_BASIC_MEMORY_ENABLED);
	assignChangedConfigField(
		payload,
		existing,
		"sandboxEgressProxyEnabled",
		sandboxEgressProxyEnabled,
		DEFAULT_SANDBOX_EGRESS_PROXY_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"chatAdaptiveTruncationEnabled",
		chatAdaptiveTruncationEnabled,
		DEFAULT_CHAT_ADAPTIVE_TRUNCATION_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"reasoningBudgetEnabled",
		reasoningBudgetEnabled,
		DEFAULT_REASONING_BUDGET_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"reviewLensesEnabled",
		reviewLensesEnabled,
		DEFAULT_REVIEW_LENSES_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"capabilityBrokerEnabled",
		capabilityBrokerEnabled,
		DEFAULT_CAPABILITY_BROKER_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"modelStatsTrackingLevel",
		modelStatsTrackingLevel,
		DEFAULT_MODEL_STATS_TRACKING_LEVEL,
	);
	assignChangedConfigField(
		payload,
		existing,
		"retrievalEgressEnabled",
		retrievalEgressEnabled,
		DEFAULT_RETRIEVAL_EGRESS_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"llmfitCatalogUpdateMode",
		llmfitCatalogUpdateMode,
		DEFAULT_LLMFIT_CATALOG_UPDATE_MODE,
	);
	if (retrievalSearchBackendUrl !== undefined) {
		if (retrievalSearchBackendUrl) {
			payload.retrievalSearchBackendUrl = retrievalSearchBackendUrl;
		}
	} else if (existingRetrievalSearchBackendUrl) {
		payload.retrievalSearchBackendUrl = existingRetrievalSearchBackendUrl;
	}
	assignChangedConfigField(
		payload,
		existing,
		"speculativeBestOfNEnabled",
		speculativeBestOfNEnabled,
		DEFAULT_SPECULATIVE_BEST_OF_N_ENABLED,
	);
	assignChangedConfigField(
		payload,
		existing,
		"speculativeMaxConcurrentSpecs",
		speculativeMaxConcurrentSpecs,
		DEFAULT_SPECULATIVE_MAX_CONCURRENT_SPECS,
	);
	assignChangedConfigField(
		payload,
		existing,
		"speculativeMaxSpecsPerRun",
		speculativeMaxSpecsPerRun,
		DEFAULT_SPECULATIVE_MAX_SPECS_PER_RUN,
	);
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
		"sandboxMaxConcurrentExec",
		sandboxMaxConcurrentExec,
		DEFAULT_AGENT_SANDBOX_MAX_CONCURRENT_EXEC,
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
		"sandboxIsolationProfileDefault",
		sandboxIsolationProfileDefault,
		DEFAULT_RUNTIME_SANDBOX_ISOLATION_PROFILE,
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
	assignChangedConfigField(payload, existing, "hardTaskRoutingMode", hardTaskRoutingMode, "attempt_with_available");
	assignChangedConfigField(payload, existing, "testDrivenModeEnabled", testDrivenModeEnabled, false);
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
	assignChangedConfigField(
		payload,
		existing,
		"fileOverlapParallelism",
		fileOverlapParallelism,
		DEFAULT_FILE_OVERLAP_PARALLELISM,
	);
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

	return payload;
}
