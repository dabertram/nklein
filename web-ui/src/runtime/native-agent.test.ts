import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { describe, expect, it } from "vitest";

import {
	filterVisibleNKleinProviderCatalog,
	getTaskAgentNavbarHint,
	isCloudProviderSupportEnabled,
	isNativeNKleinAgentSelected,
	isNKleinLocalModelConfigured,
	isNKleinProviderAuthenticated,
	isTaskAgentSetupSatisfied,
	selectLatestTaskChatMessageForTask,
	selectTaskChatMessagesForTask,
} from "@/runtime/native-agent";
import type {
	RuntimeConfigResponse,
	RuntimeNKleinProviderCatalogItem,
	RuntimeStateStreamTaskChatMessage,
} from "@/runtime/types";

function createRuntimeConfigResponse(
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"],
	overrides?: Partial<RuntimeConfigResponse>,
): RuntimeConfigResponse {
	const nextConfig: RuntimeConfigResponse = {
		selectedAgentId,
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "cloud",
		requestTimeoutMs: 300_000,
		streamTimeoutMs: 180_000,
		toolTimeoutMs: 600_000,
		agentTimeoutMs: 3_600_000,
		conversationTimeoutMs: 7_200_000,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		maxConcurrentTasksOverride: null,
		effectiveMaxConcurrentTasks: 3,
		selectedAgentIdOverride: null,
		effectiveSelectedAgentId: selectedAgentId,
		sandboxMaxContainers: 1,
		sandboxMaxConcurrentExec: 2,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 4096,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
		sandboxIsolationProfileDefault: "lean_shared",
		sandboxIsolationProfileOverride: null,
		effectiveSandboxIsolationProfile: "lean_shared",
		agentSandboxStatus: {
			state: "ready",
			dockerAvailable: true,
			imageAvailable: true,
			image: "nklein/agent-sandbox:0.0.1",
			message: null,
			checkedAt: 1,
		},
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		hardTaskRoutingMode: "attempt_with_available",
		testDrivenModeEnabled: false,
		testDrivenModeOverride: null,
		effectiveTestDrivenMode: false,
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
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
		effectiveCommand: selectedAgentId === "nklein" ? null : selectedAgentId,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.nklein/nklein/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["claude", "codex"],
		agents: [
			{
				id: "nklein",
				label: "!Klein",
				binary: "nklein",
				command: "nklein",
				defaultArgs: [],
				installed: false,
				configured: true,
			},
		],
		shortcuts: [],
		modelRoles: {},
		agentRulesetsOverride: null,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		nkleinProviderSettings: {
			providerId: "nklein",
			modelId: "sonnet",
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: "nklein",
			oauthAccessTokenConfigured: true,
			oauthRefreshTokenConfigured: true,
			oauthAccountId: "acct_123",
			oauthExpiresAt: 123,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
	};
	return {
		...nextConfig,
		...overrides,
	};
}

function createLatestTaskChatMessage(taskId: string): RuntimeStateStreamTaskChatMessage {
	return {
		type: "task_chat_message",
		workspaceId: "workspace-1",
		taskId,
		message: {
			id: "message-1",
			role: "assistant",
			content: "Hello",
			createdAt: Date.now(),
			meta: null,
		},
	};
}

const providerCatalog: RuntimeNKleinProviderCatalogItem[] = [
	{
		id: "anthropic",
		name: "Anthropic",
		enabled: true,
		oauthSupported: false,
		defaultModelId: null,
		baseUrl: null,
		supportsBaseUrl: false,
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		enabled: true,
		oauthSupported: false,
		defaultModelId: null,
		baseUrl: "http://127.0.0.1:1234",
		supportsBaseUrl: true,
	},
	{
		id: "custom-local",
		name: "Custom Local",
		enabled: true,
		oauthSupported: false,
		defaultModelId: null,
		baseUrl: "http://127.0.0.1:4000/v1",
		supportsBaseUrl: true,
	},
	{
		id: "custom-cloud",
		name: "Custom Cloud",
		enabled: true,
		oauthSupported: false,
		defaultModelId: null,
		baseUrl: "https://models.example.com/v1",
		supportsBaseUrl: true,
	},
	{
		id: "ollama",
		name: "Ollama",
		enabled: true,
		oauthSupported: false,
		defaultModelId: null,
		baseUrl: "http://127.0.0.1:11434",
		supportsBaseUrl: true,
	},
];

describe("native-agent helpers", () => {
	it("treats nklein as the native chat agent", () => {
		expect(isNativeNKleinAgentSelected("nklein")).toBe(true);
		expect(isNativeNKleinAgentSelected(null)).toBe(false);
		expect(isNativeNKleinAgentSelected(undefined)).toBe(false);
	});

	it("treats selected nklein as task-ready when nklein authentication is configured", () => {
		expect(isTaskAgentSetupSatisfied(createRuntimeConfigResponse("nklein"))).toBe(true);
		expect(isTaskAgentSetupSatisfied(null)).toBeNull();
	});

	it("requires setup when nklein is selected and nklein authentication is missing", () => {
		const config = createRuntimeConfigResponse("nklein", {
			agents: [
				{
					id: "nklein",
					label: "!Klein",
					binary: "nklein",
					command: "nklein",
					defaultArgs: [],
					installed: true,
					configured: true,
				},
			],
			nkleinProviderSettings: {
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
		});
		expect(isTaskAgentSetupSatisfied(config)).toBe(false);
	});

	it("treats selected nklein as task-ready when a local model provider is configured (no API key / oauth)", () => {
		const config = createRuntimeConfigResponse("nklein", {
			agents: [
				{
					id: "nklein",
					label: "!Klein",
					binary: "nklein",
					command: "nklein",
					defaultArgs: [],
					installed: true,
					configured: true,
				},
			],
			nkleinProviderSettings: {
				providerId: "lmstudio",
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: false,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			},
		});
		// Local-only readiness: a selected local provider is enough; no other installed CLI agent is required.
		expect(isTaskAgentSetupSatisfied(config)).toBe(true);
	});

	it("recognizes a configured local model provider for local-only readiness", () => {
		const base = {
			modelId: null,
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		};
		expect(isNKleinLocalModelConfigured(null)).toBe(false);
		expect(isNKleinLocalModelConfigured({ ...base, providerId: null })).toBe(false);
		expect(isNKleinLocalModelConfigured({ ...base, providerId: "lmstudio" })).toBe(true);
		expect(isNKleinLocalModelConfigured({ ...base, providerId: "ollama" })).toBe(true);
		// Known cloud providers are never "local configured".
		expect(isNKleinLocalModelConfigured({ ...base, providerId: "anthropic" })).toBe(false);
		// Custom / unknown provider: configured when it carries a model id or a local endpoint.
		expect(isNKleinLocalModelConfigured({ ...base, providerId: "custom", modelId: "my-model" })).toBe(true);
		expect(isNKleinLocalModelConfigured({ ...base, providerId: "custom", baseUrl: "http://127.0.0.1:4000/v1" })).toBe(
			true,
		);
		// Custom provider pointed at a non-local endpoint with no model id is not configured-local.
		expect(
			isNKleinLocalModelConfigured({ ...base, providerId: "custom", baseUrl: "https://models.example.com/v1" }),
		).toBe(false);
	});

	it("does not show the navbar setup hint when nklein is configured through the native SDK path", () => {
		expect(getTaskAgentNavbarHint(createRuntimeConfigResponse("nklein"))).toBeUndefined();
	});

	it("shows the navbar setup hint when no task agent path is ready", () => {
		const config = createRuntimeConfigResponse("nklein", {
			agents: [
				{
					id: "nklein",
					label: "!Klein",
					binary: "nklein",
					command: "nklein",
					defaultArgs: [],
					installed: true,
					configured: true,
				},
			],
			nkleinProviderSettings: {
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
		});
		expect(getTaskAgentNavbarHint(config)).toBe("No agent configured");
		expect(
			getTaskAgentNavbarHint(config, {
				shouldUseNavigationPath: true,
			}),
		).toBeUndefined();
	});

	it("filters cloud providers out of the visible NKlein provider catalog when cloud is disabled", () => {
		expect(filterVisibleNKleinProviderCatalog(providerCatalog, false).map((provider) => provider.id)).toEqual([
			"lmstudio",
			"custom-local",
			"ollama",
		]);
	});

	it("keeps cloud providers hidden in the visible NKlein provider catalog even when stale config enables cloud", () => {
		expect(filterVisibleNKleinProviderCatalog(providerCatalog, true).map((provider) => provider.id)).toEqual([
			"lmstudio",
			"custom-local",
			"ollama",
		]);
	});

	it("keeps frontend cloud support disabled even when stale runtime config says otherwise", () => {
		expect(isCloudProviderSupportEnabled({ cloudProviderSupportEnabled: true })).toBe(false);
	});

	it("checks for a provider selection when determining nklein authentication", () => {
		expect(
			isNKleinProviderAuthenticated({
				providerId: null,
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: true,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(false);
		expect(
			isNKleinProviderAuthenticated({
				providerId: "anthropic",
				modelId: null,
				baseUrl: null,
				apiKeyConfigured: true,
				oauthProvider: null,
				oauthAccessTokenConfigured: false,
				oauthRefreshTokenConfigured: false,
				oauthAccountId: null,
				oauthExpiresAt: null,
			}),
		).toBe(true);
	});

	it("selects the latest incoming chat message only for the matching task", () => {
		const messageEvent = createLatestTaskChatMessage("task-1");
		expect(selectLatestTaskChatMessageForTask("task-1", messageEvent)).toEqual(messageEvent.message);
		expect(selectLatestTaskChatMessageForTask("task-2", messageEvent)).toBeNull();
		expect(selectLatestTaskChatMessageForTask(null, messageEvent)).toBeNull();
	});

	it("selects the streamed task chat transcript for the matching task", () => {
		const messageEvent = createLatestTaskChatMessage("task-1");
		expect(
			selectTaskChatMessagesForTask("task-1", {
				"task-1": [messageEvent.message],
			}),
		).toEqual([messageEvent.message]);
		expect(selectTaskChatMessagesForTask("task-2", { "task-1": [messageEvent.message] })).toBeNull();
		expect(selectTaskChatMessagesForTask(null, { "task-1": [messageEvent.message] })).toBeNull();
	});
});
