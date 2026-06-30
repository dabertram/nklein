// Pure assembler for a fully-resolved RuntimeConfigState (extracted from runtime-config.ts, §5.U).
// Takes the raw, already-merged field values (global defaults + project overrides + paths) and produces
// the normalized state the app consumes: every field is run through its normalizer, and the derived
// `effective*` fields are computed as `override ?? default`. Pure and IO-free — the load/save/update
// orchestration that gathers these values stays in runtime-config.ts.
import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
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
import { normalizeRuntimeSwarmGuardrails } from "../core/api-contract";
import type { ConcurrencyConfig, ConcurrencyOverride } from "../core/concurrency-config";
import {
	DEFAULT_AGENT_SANDBOX_AGENTS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_CPUS_PER_CONTAINER,
	DEFAULT_AGENT_SANDBOX_IDLE_TIMEOUT_MINUTES,
	DEFAULT_AGENT_SANDBOX_MAX_CONTAINERS,
	DEFAULT_AGENT_SANDBOX_MEMORY_PER_CONTAINER_MB,
} from "../nklein-agent/nklein-agent-sandbox";
import { deriveAgentIdFields } from "./runtime-config-agent-id-resolver";
import { deriveConcurrencyFields } from "./runtime-config-concurrency-resolver";
import {
	DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
	DEFAULT_DECOMPOSITION_AUTO_APPLY_ENABLED,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_READY_FOR_REVIEW_NOTIFICATIONS_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
	DEFAULT_REVIEW_MAX_ROUNDS,
	DEFAULT_SECOND_OPINION_REVIEW_ENABLED,
} from "./runtime-config-defaults";
import { deriveEmbeddingFields } from "./runtime-config-embedding-resolver";
import { deriveModelRolesFields } from "./runtime-config-model-roles-resolver";
import {
	normalizeAgentTimeoutMode,
	normalizeAgentTimeoutProfile,
	normalizeBoolean,
	normalizeLostHeartbeatPolicy,
	normalizeNonNegativeInteger,
	normalizePositiveInteger,
	normalizePositiveNumber,
	normalizePromptTemplateWithLegacyDefault,
	normalizeShortcuts,
	normalizeTimeoutMsValue,
} from "./runtime-config-normalizers";
import {
	DEFAULT_COMMIT_PROMPT_TEMPLATE,
	DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
} from "./runtime-config-prompt-templates";
import { deriveRulesetsFields } from "./runtime-config-rulesets-resolver";
import { deriveSkillDynamicsFields } from "./runtime-config-skill-dynamics-resolver";
import { deriveSuitabilityFields } from "./runtime-config-suitability-resolver";
import type { RuntimeConfigState } from "./runtime-config-types";
import { normalizeShortcutLabel, normalizeWorkspaceBaseDir } from "./runtime-config-value-helpers";

/** Raw, already-merged field values handed to the state assembler (pre-normalization). */
export interface RuntimeConfigStateFromValuesInput {
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
}

export function createRuntimeConfigStateFromValues(input: RuntimeConfigStateFromValuesInput): RuntimeConfigState {
	return {
		globalConfigPath: input.globalConfigPath,
		projectConfigPath: input.projectConfigPath,
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
		...deriveConcurrencyFields(
			input.maxConcurrentTasks,
			input.maxConcurrentTasksOverride,
			input.concurrencyDefaults,
			input.concurrencyOverride,
		),
		...deriveAgentIdFields(input.selectedAgentId, input.selectedAgentIdOverride),
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
		...deriveEmbeddingFields(input.codeEmbeddingDefaults, input.codeEmbeddingOverride),
		...deriveSuitabilityFields(input.modelSuitabilityPolicyDefaults, input.modelSuitabilityPolicyOverride),
		...deriveSkillDynamicsFields(input.skillDynamicsLevelDefault, input.skillDynamicsLevelOverride),
		...deriveModelRolesFields(input.modelRoles, input.modelRolesOverride),
		...deriveRulesetsFields(input.agentRulesets, input.agentRulesetsOverride),
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
