import { beforeEach, describe, expect, it, vi } from "vitest";

const commandDiscoveryMocks = vi.hoisted(() => ({
	isBinaryAvailableOnPath: vi.fn(),
}));

vi.mock("../../../src/terminal/command-discovery.js", () => ({
	isBinaryAvailableOnPath: commandDiscoveryMocks.isBinaryAvailableOnPath,
}));

import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "../../../src/core/api-contract";
import {
	buildRuntimeConfigResponse,
	detectInstalledCommands,
	resolveAgentCommand,
} from "../../../src/terminal/agent-registry";

function createRuntimeConfigState(overrides: Partial<RuntimeConfigState> = {}): RuntimeConfigState {
	return {
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
		selectedAgentId: "claude",
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
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
		effectiveFileOverlapParallelism: "serialize",
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "cloud",
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		maxConcurrentTasksOverride: null,
		effectiveMaxConcurrentTasks: 3,
		selectedAgentIdOverride: null,
		effectiveSelectedAgentId: "claude",
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 2048,
		sandboxCpusPerContainer: 2,
		sandboxMaxConcurrentExec: 2,
		sandboxIdleTimeoutMinutes: 10,
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
		readyForReviewNotificationsEnabled: true,
		codeEmbeddingDefaults: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		codeEmbeddingOverride: null,
		concurrencyDefaults: { perProvider: {}, perModel: {} },
		concurrencyOverride: null,
		effectiveCodeEmbeddingSettings: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		modelSuitabilityPolicyDefaults: { onUnsuitable: "reject", onUnknown: "warn" },
		modelSuitabilityPolicyOverride: null,
		effectiveModelSuitabilityPolicy: { onUnsuitable: "reject", onUnknown: "warn" },
		skillDynamicsLevelDefault: "fully_dynamic",
		skillDynamicsLevelOverride: null,
		effectiveSkillDynamicsLevel: "fully_dynamic",
		modelRoles: {},
		modelRolesOverride: null,
		effectiveModelRoles: {},
		agentRulesetsOverride: null,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		...overrides,
	};
}

beforeEach(() => {
	commandDiscoveryMocks.isBinaryAvailableOnPath.mockReset();
	commandDiscoveryMocks.isBinaryAvailableOnPath.mockReturnValue(false);
	delete process.env.NKLEIN_DEBUG;
	delete process.env.KANBAN_DEBUG;
	delete process.env.KANBAN_DEBUG_MODE;
	delete process.env.DEBUG_MODE;
	delete process.env.debug_mode;
});

describe("agent-registry", () => {
	it("detects installed commands from the inherited PATH", () => {
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockImplementation((binary: string) => binary === "claude");

		const detected = detectInstalledCommands();

		expect(detected).toEqual(["claude"]);
		expect(commandDiscoveryMocks.isBinaryAvailableOnPath).toHaveBeenCalledTimes(8);
	});

	it("treats shell-only agents as unavailable", () => {
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockImplementation((binary: string) => binary === "npx");

		const resolved = resolveAgentCommand(createRuntimeConfigState({ selectedAgentId: "claude" }));

		expect(resolved).toBeNull();
	});
});

describe("buildRuntimeConfigResponse", () => {
	it("keeps curated agent default args independent of autonomous mode", () => {
		const config = createRuntimeConfigState({
			agentAutonomousModeEnabled: true,
			modelRoles: {
				worker: {
					providerId: "ollama",
					modelId: "qwen3.5-9b",
				},
			},
		});

		const response = buildRuntimeConfigResponse(config, {
			providerId: null,
			modelId: null,
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		expect(response.agentAutonomousModeEnabled).toBe(true);
		expect(response.lostHeartbeatPolicy).toBe("park");
		expect(response.decompositionAutoApplyEnabled).toBe(true);
		expect(response.sandboxMaxContainers).toBe(1);
		expect(response.sandboxAgentsPerContainer).toBe(0);
		expect(response.sandboxMemoryPerContainerMb).toBe(2048);
		expect(response.sandboxCpusPerContainer).toBe(2);
		expect(response.sandboxIdleTimeoutMinutes).toBe(10);
		expect(response.agentSandboxStatus).toMatchObject({
			state: "checking",
			dockerAvailable: null,
			imageAvailable: null,
		});
		expect(response.modelRoles).toEqual({
			worker: {
				providerId: "ollama",
				modelId: "qwen3.5-9b",
			},
		});
		expect(response.agents.map((agent) => agent.id)).toEqual(["nklein"]);
		expect(response.agents.find((agent) => agent.id === "nklein")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "nklein")?.installed).toBe(true);
	});

	it("omits autonomous flags from curated agent commands when disabled", () => {
		const config = createRuntimeConfigState({
			agentAutonomousModeEnabled: false,
		});
		commandDiscoveryMocks.isBinaryAvailableOnPath.mockImplementation((binary: string) => binary === "claude");

		const response = buildRuntimeConfigResponse(config, {
			providerId: null,
			modelId: null,
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		expect(response.agentAutonomousModeEnabled).toBe(false);
		expect(response.agents.map((agent) => agent.id)).toEqual(["nklein"]);
		expect(response.agents.find((agent) => agent.id === "nklein")?.defaultArgs).toEqual([]);
		expect(response.agents.find((agent) => agent.id === "nklein")?.installed).toBe(true);
		expect(response.agents.find((agent) => agent.id === "nklein")?.command).toBe("nklein");
	});

	it("returns the normalized developer mode setting from runtime config", () => {
		const response = buildRuntimeConfigResponse(
			createRuntimeConfigState({ developerModeEnabled: true, replayCardsEnabled: true }),
			{
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			},
		);
		expect(response.developerModeEnabled).toBe(true);
		expect(response.replayCardsEnabled).toBe(true);
	});

	it("does not let debug env override a normalized developer mode false response", () => {
		process.env.NKLEIN_DEBUG = "true";
		const response = buildRuntimeConfigResponse(createRuntimeConfigState(), {
			providerId: null,
			modelId: null,
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});
		expect(response.developerModeEnabled).toBe(false);
	});
});
