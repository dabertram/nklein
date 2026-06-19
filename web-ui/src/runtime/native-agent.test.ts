import { describe, expect, it } from "vitest";

import {
	filterVisibleClineProviderCatalog,
	getTaskAgentNavbarHint,
	isClineProviderAuthenticated,
	isNativeClineAgentSelected,
	isTaskAgentSetupSatisfied,
	selectLatestTaskChatMessageForTask,
	selectTaskChatMessagesForTask,
} from "@/runtime/native-agent";
import type {
	RuntimeClineProviderCatalogItem,
	RuntimeConfigResponse,
	RuntimeStateStreamTaskChatMessage,
} from "@/runtime/types";

function createRuntimeConfigResponse(
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"],
	overrides?: Partial<RuntimeConfigResponse>,
): RuntimeConfigResponse {
	const nextConfig: RuntimeConfigResponse = {
		selectedAgentId,
		selectedShortcutLabel: null,
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
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 4096,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
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
		codeEmbeddingDefaults: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		codeEmbeddingOverride: null,
		effectiveCodeEmbeddingSettings: {
			provider: "local_lexical",
			model: "kanban-local-lexical-vector-v1",
			baseUrl: null,
		},
		effectiveCommand: selectedAgentId === "cline" ? null : selectedAgentId,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.cline/nklein/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["claude", "codex"],
		agents: [
			{
				id: "cline",
				label: "Cline",
				binary: "cline",
				command: "cline",
				defaultArgs: [],
				installed: false,
				configured: true,
			},
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		shortcuts: [],
		modelRoles: {},
		clineProviderSettings: {
			providerId: "cline",
			modelId: "sonnet",
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: "cline",
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

const providerCatalog: RuntimeClineProviderCatalogItem[] = [
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
	it("treats cline as the native chat agent", () => {
		expect(isNativeClineAgentSelected("cline")).toBe(true);
		expect(isNativeClineAgentSelected("codex")).toBe(false);
	});

	it("treats selected cline as task-ready when cline authentication is configured", () => {
		expect(isTaskAgentSetupSatisfied(createRuntimeConfigResponse("cline"))).toBe(true);
		expect(isTaskAgentSetupSatisfied(null)).toBeNull();
	});

	it("requires setup when cline is selected and cline authentication is missing", () => {
		const config = createRuntimeConfigResponse("cline", {
			agents: [
				{
					id: "cline",
					label: "Cline",
					binary: "cline",
					command: "cline",
					defaultArgs: [],
					installed: true,
					configured: true,
				},
			],
			clineProviderSettings: {
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

	it("falls back to other installed launch-supported agents when cline auth is missing", () => {
		const config = createRuntimeConfigResponse("cline", {
			agents: [
				{
					id: "cline",
					label: "Cline",
					binary: "cline",
					command: "cline",
					defaultArgs: [],
					installed: true,
					configured: true,
				},
				{
					id: "codex",
					label: "OpenAI Codex",
					binary: "codex",
					command: "codex",
					defaultArgs: [],
					installed: true,
					configured: false,
				},
			],
			clineProviderSettings: {
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
		expect(isTaskAgentSetupSatisfied(config)).toBe(true);
	});

	it("does not show the navbar setup hint when cline is configured through the native SDK path", () => {
		expect(getTaskAgentNavbarHint(createRuntimeConfigResponse("cline"))).toBeUndefined();
	});

	it("shows the navbar setup hint when no task agent path is ready", () => {
		const config = createRuntimeConfigResponse("cline", {
			agents: [
				{
					id: "cline",
					label: "Cline",
					binary: "cline",
					command: "cline",
					defaultArgs: [],
					installed: true,
					configured: true,
				},
			],
			clineProviderSettings: {
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

	it("filters cloud providers out of the visible Cline provider catalog when cloud is disabled", () => {
		expect(filterVisibleClineProviderCatalog(providerCatalog, false).map((provider) => provider.id)).toEqual([
			"lmstudio",
			"ollama",
		]);
	});

	it("keeps cloud providers in the visible Cline provider catalog when cloud is enabled", () => {
		expect(filterVisibleClineProviderCatalog(providerCatalog, true).map((provider) => provider.id)).toEqual([
			"anthropic",
			"lmstudio",
			"ollama",
		]);
	});

	it("checks for a provider selection when determining cline authentication", () => {
		expect(
			isClineProviderAuthenticated({
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
			isClineProviderAuthenticated({
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

	it("ignores non-launch agents when checking native CLI availability", () => {
		const config = createRuntimeConfigResponse("claude");
		config.agents = [
			{
				id: "gemini",
				label: "Gemini CLI",
				binary: "gemini",
				command: "gemini",
				defaultArgs: [],
				installed: true,
				configured: false,
			},
		];
		expect(isTaskAgentSetupSatisfied(config)).toBe(false);
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
