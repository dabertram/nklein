import { describe, expect, it } from "vitest";
import {
	DEFAULT_AGENT_ID,
	DEFAULT_AGENT_TIMEOUT_MODE,
	DEFAULT_AGENT_TIMEOUT_PROFILE,
	DEFAULT_CODE_EMBEDDING_SETTINGS,
	DEFAULT_LOST_HEARTBEAT_POLICY,
} from "../../../src/config/runtime-config-defaults";
import {
	DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
	DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
} from "../../../src/config/runtime-config-normalizers";
import {
	DEFAULT_COMMIT_PROMPT_TEMPLATE,
	DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
} from "../../../src/config/runtime-config-prompt-templates";
import {
	createRuntimeConfigStateFromValues,
	type RuntimeConfigStateFromValuesInput,
} from "../../../src/config/runtime-config-state-factory";
import { DEFAULT_CONCURRENCY_CONFIG } from "../../../src/core/concurrency-config";

function makeInput(overrides: Partial<RuntimeConfigStateFromValuesInput> = {}): RuntimeConfigStateFromValuesInput {
	return {
		globalConfigPath: "/home/.nklein/nklein/config.json",
		projectConfigPath: null,
		selectedAgentId: DEFAULT_AGENT_ID,
		selectedShortcutLabel: null,
		developerModeEnabled: false,
		replayCardsEnabled: false,
		setupWizardCompletedAt: null,
		projectSetupWizardCompletedAt: null,
		knowsTodayEnabled: false,
		sandboxMcpServersEnabled: true,
		retrievalEgressEnabled: false,
		retrievalSearchBackendUrl: null,
		speculativeBestOfNEnabled: true,
		speculativeMaxConcurrentSpecs: 1,
		speculativeMaxSpecsPerRun: 3,
		fileOverlapParallelism: "serialize",
		fileOverlapParallelismOverride: null,
		agentAutonomousModeEnabled: false,
		agentTimeoutMode: DEFAULT_AGENT_TIMEOUT_MODE,
		agentTimeoutProfile: DEFAULT_AGENT_TIMEOUT_PROFILE,
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 500,
		maxConcurrentTasks: 2,
		maxConcurrentTasksOverride: null,
		selectedAgentIdOverride: null,
		sandboxMaxContainers: 4,
		sandboxAgentsPerContainer: 2,
		sandboxMemoryPerContainerMb: 2048,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 30,
		lostHeartbeatPolicy: DEFAULT_LOST_HEARTBEAT_POLICY,
		decompositionAutoApplyEnabled: false,
		secondOpinionReviewEnabled: false,
		reviewMaxRounds: 1,
		readyForReviewNotificationsEnabled: false,
		codeEmbeddingDefaults: DEFAULT_CODE_EMBEDDING_SETTINGS,
		codeEmbeddingOverride: null,
		modelSuitabilityPolicyDefaults: DEFAULT_MODEL_SUITABILITY_POLICY_CONFIG,
		modelSuitabilityPolicyOverride: null,
		skillDynamicsLevelDefault: DEFAULT_SKILL_DYNAMICS_LEVEL_CONFIG,
		skillDynamicsLevelOverride: null,
		concurrencyDefaults: DEFAULT_CONCURRENCY_CONFIG,
		concurrencyOverride: null,
		modelRoles: {},
		modelRolesOverride: null,
		agentRulesetsOverride: null,
		shortcuts: [],
		commitPromptTemplate: DEFAULT_COMMIT_PROMPT_TEMPLATE,
		openPrPromptTemplate: DEFAULT_OPEN_PR_PROMPT_TEMPLATE,
		workspaceBaseDir: null,
		...overrides,
	};
}

describe("createRuntimeConfigStateFromValues", () => {
	it("passes the config paths through and sets the derived template-default fields", () => {
		const state = createRuntimeConfigStateFromValues(makeInput({ globalConfigPath: "/g", projectConfigPath: "/p" }));
		expect(state.globalConfigPath).toBe("/g");
		expect(state.projectConfigPath).toBe("/p");
		expect(state.commitPromptTemplateDefault).toBe(DEFAULT_COMMIT_PROMPT_TEMPLATE);
		expect(state.openPrPromptTemplateDefault).toBe(DEFAULT_OPEN_PR_PROMPT_TEMPLATE);
	});

	it("derives effective* fields from the base value when no override is set", () => {
		const state = createRuntimeConfigStateFromValues(
			makeInput({ maxConcurrentTasks: 2, maxConcurrentTasksOverride: null }),
		);
		expect(state.maxConcurrentTasks).toBe(2);
		expect(state.effectiveMaxConcurrentTasks).toBe(2);
		expect(state.effectiveSelectedAgentId).toBe(state.selectedAgentId);
	});

	it("prefers the override for effective* fields when one is set", () => {
		const state = createRuntimeConfigStateFromValues(
			makeInput({ maxConcurrentTasks: 2, maxConcurrentTasksOverride: 5 }),
		);
		expect(state.maxConcurrentTasks).toBe(2);
		expect(state.maxConcurrentTasksOverride).toBe(5);
		expect(state.effectiveMaxConcurrentTasks).toBe(5);
	});

	it("drops a non-positive override back to null and falls back to the base value", () => {
		const state = createRuntimeConfigStateFromValues(
			makeInput({ maxConcurrentTasks: 2, maxConcurrentTasksOverride: 0 }),
		);
		expect(state.maxConcurrentTasksOverride).toBeNull();
		expect(state.effectiveMaxConcurrentTasks).toBe(2);
	});
});
