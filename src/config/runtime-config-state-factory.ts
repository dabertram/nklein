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
import { deriveAgentIdFields } from "./runtime-config-agent-id-resolver";
import { deriveConcurrencyFields } from "./runtime-config-concurrency-resolver";
import {
	DEFAULT_AGENT_AUTONOMOUS_MODE_ENABLED,
	DEFAULT_DEVELOPER_MODE_ENABLED,
	DEFAULT_REPLAY_CARDS_ENABLED,
} from "./runtime-config-defaults";
import { deriveEmbeddingFields } from "./runtime-config-embedding-resolver";
import { deriveModelRolesFields } from "./runtime-config-model-roles-resolver";
import {
	normalizeBoolean,
	normalizeLostHeartbeatPolicy,
	normalizePromptTemplateWithLegacyDefault,
	normalizeShortcuts,
} from "./runtime-config-normalizers";
import {
	DEFAULT_COMMIT_PROMPT_TEMPLATE,
	DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_COMMIT_PROMPT_TEMPLATE,
	LEGACY_HOST_WORKTREE_OPEN_PR_PROMPT_TEMPLATE,
} from "./runtime-config-prompt-templates";
import { resolveRuntimeReviewConfig } from "./runtime-config-review-resolver";
import { deriveRulesetsFields } from "./runtime-config-rulesets-resolver";
import { resolveRuntimeSandboxConfig } from "./runtime-config-sandbox-resolver";
import { deriveSkillDynamicsFields } from "./runtime-config-skill-dynamics-resolver";
import { deriveSuitabilityFields } from "./runtime-config-suitability-resolver";
import { resolveRuntimeTimeoutConfig } from "./runtime-config-timeout-resolver";
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
		...resolveRuntimeTimeoutConfig({
			agentTimeoutMode: input.agentTimeoutMode,
			agentTimeoutProfile: input.agentTimeoutProfile,
			requestTimeoutMs: input.requestTimeoutMs,
			streamTimeoutMs: input.streamTimeoutMs,
			toolTimeoutMs: input.toolTimeoutMs,
			agentTimeoutMs: input.agentTimeoutMs,
			conversationTimeoutMs: input.conversationTimeoutMs,
		}),
		maxAgentWritableFileLines: normalizeMaxAgentWritableFileLines(input.maxAgentWritableFileLines),
		...deriveConcurrencyFields(
			input.maxConcurrentTasks,
			input.maxConcurrentTasksOverride,
			input.concurrencyDefaults,
			input.concurrencyOverride,
		),
		...deriveAgentIdFields(input.selectedAgentId, input.selectedAgentIdOverride),
		...resolveRuntimeSandboxConfig({
			sandboxMaxContainers: input.sandboxMaxContainers,
			sandboxAgentsPerContainer: input.sandboxAgentsPerContainer,
			sandboxMemoryPerContainerMb: input.sandboxMemoryPerContainerMb,
			sandboxCpusPerContainer: input.sandboxCpusPerContainer,
			sandboxIdleTimeoutMinutes: input.sandboxIdleTimeoutMinutes,
		}),
		lostHeartbeatPolicy: normalizeLostHeartbeatPolicy(input.lostHeartbeatPolicy),
		...resolveRuntimeReviewConfig({
			decompositionAutoApplyEnabled: input.decompositionAutoApplyEnabled,
			secondOpinionReviewEnabled: input.secondOpinionReviewEnabled,
			reviewMaxRounds: input.reviewMaxRounds,
			readyForReviewNotificationsEnabled: input.readyForReviewNotificationsEnabled,
		}),
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
