import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRuntimeSettingsNKleinController } from "@/hooks/use-runtime-settings-nklein-controller";
import type {
	RuntimeConfigResponse,
	RuntimeNKleinProviderModel,
	RuntimeNKleinReasoningEffort,
	RuntimeTaskNKleinSettings,
} from "@/runtime/types";

const fetchNKleinProviderCatalogMock = vi.hoisted(() => vi.fn());
const fetchNKleinProviderModelsMock = vi.hoisted(() => vi.fn());
const addNKleinProviderMock = vi.hoisted(() => vi.fn());
const updateNKleinProviderMock = vi.hoisted(() => vi.fn());
const saveNKleinProviderSettingsMock = vi.hoisted(() => vi.fn());
const runNKleinProviderOauthLoginMock = vi.hoisted(() => vi.fn());
const startNKleinDeviceAuthMock = vi.hoisted(() => vi.fn());
const completeNKleinDeviceAuthMock = vi.hoisted(() => vi.fn());
const isLocalhostAccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	addNKleinProvider: addNKleinProviderMock,
	updateNKleinProvider: updateNKleinProviderMock,
	fetchNKleinProviderCatalog: fetchNKleinProviderCatalogMock,
	fetchNKleinProviderModels: fetchNKleinProviderModelsMock,
	saveNKleinProviderSettings: saveNKleinProviderSettingsMock,
	runNKleinProviderOauthLogin: runNKleinProviderOauthLoginMock,
	startNKleinDeviceAuth: startNKleinDeviceAuthMock,
	completeNKleinDeviceAuth: completeNKleinDeviceAuthMock,
}));

vi.mock("@/utils/localhost-detection", () => ({
	isLocalhostAccess: isLocalhostAccessMock,
}));

interface HookSnapshot {
	providerId: string;
	modelId: string;
	apiKey: string;
	baseUrl: string;
	reasoningEffort: string;
	providerCatalogIds: string[];
	providerModelIds: string[];
	selectedModelSupportsReasoningEffort: boolean;
	isOauthProviderSelected: boolean;
	apiKeyConfigured: boolean;
	oauthConfigured: boolean;
	oauthAccountId: string;
	hasUnsavedChanges: boolean;
	setProviderId: (value: string) => void;
	setModelId: (value: string) => void;
	setApiKey: (value: string) => void;
	setBaseUrl: (value: string) => void;
	setReasoningEffort: (value: string) => void;
	saveProviderSettings: (
		overrides?: Parameters<ReturnType<typeof useRuntimeSettingsNKleinController>["saveProviderSettings"]>[0],
	) => Promise<{ ok: boolean; message?: string }>;
	refreshProviderModels: () => Promise<{ ok: boolean; message?: string }>;
	addCustomProvider: (
		input: Parameters<ReturnType<typeof useRuntimeSettingsNKleinController>["addCustomProvider"]>[0],
	) => Promise<{ ok: boolean; message?: string }>;
	runOauthLogin: () => Promise<{ ok: boolean; message?: string }>;
}

function createRuntimeConfigResponse(
	nkleinOverrides: Partial<RuntimeConfigResponse["nkleinProviderSettings"]> = {},
): RuntimeConfigResponse {
	return {
		selectedAgentId: "nklein",
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
		secondOpinionReviewEnabled: true,
		reviewMaxRounds: 20,
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
		effectiveCommand: "nklein",
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.nklein/nklein/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["nklein"],
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
		shortcuts: [],
		modelRoles: {},
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		nkleinProviderSettings: {
			providerId: "nklein",
			modelId: "claude-sonnet-4-6",
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: "nklein",
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
			...nkleinOverrides,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
	};
}

function createLegacyRuntimeConfigResponse(): RuntimeConfigResponse {
	const { nkleinProviderSettings: _nkleinProviderSettings, ...legacyConfig } = createRuntimeConfigResponse();
	return legacyConfig as RuntimeConfigResponse;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected hook snapshot.");
	}
	return snapshot;
}

async function flushAsyncWork(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

function createDeferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve: (value: T) => void = () => {};
	let reject: (reason?: unknown) => void = () => {};
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function HookHarness({
	open,
	workspaceId,
	selectedAgentId,
	config,
	taskNKleinSettings,
	onSnapshot,
}: {
	open: boolean;
	workspaceId: string | null;
	selectedAgentId: RuntimeConfigResponse["selectedAgentId"];
	config: RuntimeConfigResponse | null;
	taskNKleinSettings?: RuntimeTaskNKleinSettings;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const state = useRuntimeSettingsNKleinController({
		open,
		workspaceId,
		selectedAgentId,
		config,
		taskNKleinSettings,
	});

	useEffect(() => {
		onSnapshot({
			providerId: state.providerId,
			modelId: state.modelId,
			apiKey: state.apiKey,
			baseUrl: state.baseUrl,
			reasoningEffort: state.reasoningEffort,
			providerCatalogIds: state.providerCatalog.map((provider) => provider.id),
			providerModelIds: state.providerModels.map((model) => model.id),
			selectedModelSupportsReasoningEffort: state.selectedModelSupportsReasoningEffort,
			isOauthProviderSelected: state.isOauthProviderSelected,
			apiKeyConfigured: state.apiKeyConfigured,
			oauthConfigured: state.oauthConfigured,
			oauthAccountId: state.oauthAccountId,
			hasUnsavedChanges: state.hasUnsavedChanges,
			setProviderId: (value) => {
				state.setProviderId(value);
			},
			setModelId: (value) => {
				state.setModelId(value);
			},
			setApiKey: (value) => {
				state.setApiKey(value);
			},
			setBaseUrl: (value) => {
				state.setBaseUrl(value);
			},
			setReasoningEffort: (value) => {
				state.setReasoningEffort(value as RuntimeNKleinReasoningEffort | "");
			},
			saveProviderSettings: state.saveProviderSettings,
			refreshProviderModels: state.refreshProviderModels,
			addCustomProvider: state.addCustomProvider,
			runOauthLogin: state.runOauthLogin,
		});
	}, [onSnapshot, state]);

	return null;
}

describe("useRuntimeSettingsNKleinController", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchNKleinProviderCatalogMock.mockReset();
		fetchNKleinProviderModelsMock.mockReset();
		addNKleinProviderMock.mockReset();
		updateNKleinProviderMock.mockReset();
		saveNKleinProviderSettingsMock.mockReset();
		runNKleinProviderOauthLoginMock.mockReset();
		startNKleinDeviceAuthMock.mockReset();
		completeNKleinDeviceAuthMock.mockReset();
		isLocalhostAccessMock.mockReset();
		isLocalhostAccessMock.mockReturnValue(true);
		fetchNKleinProviderCatalogMock.mockResolvedValue([]);
		fetchNKleinProviderModelsMock.mockResolvedValue([]);
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("loads provider catalog and models for the current NKlein provider", async () => {
		const config = createRuntimeConfigResponse();
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
				baseUrl: "https://api.nklein.bot/api/v1",
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
				supportsReasoningEffort: false,
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(fetchNKleinProviderCatalogMock).toHaveBeenCalledWith("workspace-1");
		expect(fetchNKleinProviderModelsMock).toHaveBeenCalledWith("workspace-1", "nklein");
		expect(requireSnapshot(latestSnapshot).providerCatalogIds).toEqual(["nklein"]);
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["claude-sonnet-4-6"]);
		expect(requireSnapshot(latestSnapshot).selectedModelSupportsReasoningEffort).toBe(false);
		expect(requireSnapshot(latestSnapshot).isOauthProviderSelected).toBe(true);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("loads provider catalog and models without a selected workspace", async () => {
		const config = createRuntimeConfigResponse();
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
				baseUrl: "https://api.nklein.bot/api/v1",
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
				supportsReasoningEffort: false,
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId={null}
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(fetchNKleinProviderCatalogMock).toHaveBeenCalledWith(null);
		expect(fetchNKleinProviderModelsMock).toHaveBeenCalledWith(null, "nklein");
		expect(requireSnapshot(latestSnapshot).providerCatalogIds).toEqual(["nklein"]);
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["claude-sonnet-4-6"]);
	});

	it("replaces a stale LM Studio model selection with the first loaded model", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "lmstudio",
			oauthProvider: null,
			modelId: "openai/gpt-oss-20b",
			baseUrl: null,
			apiKeyConfigured: false,
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "lmstudio",
				name: "LM Studio",
				oauthSupported: false,
				enabled: true,
				defaultModelId: null,
				baseUrl: "http://localhost:1234/v1",
				supportsBaseUrl: true,
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{
				id: "lmstudio-community/qwen3.5-9b-mlx-8bit-m4-32kctx",
				name: "Qwen3.5 9B",
				contextWindow: 40_000,
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).providerId).toBe("lmstudio");
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual([
			"lmstudio-community/qwen3.5-9b-mlx-8bit-m4-32kctx",
		]);
		expect(requireSnapshot(latestSnapshot).modelId).toBe("lmstudio-community/qwen3.5-9b-mlx-8bit-m4-32kctx");
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("http://localhost:1234/v1");
	});

	it("defaults provider settings to nklein when the config omits nklein settings", async () => {
		const config = createLegacyRuntimeConfigResponse();
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
				baseUrl: "https://api.nklein.bot/api/v1",
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(fetchNKleinProviderCatalogMock).toHaveBeenCalledWith("workspace-1");
		expect(fetchNKleinProviderModelsMock).toHaveBeenCalledWith("workspace-1", "nklein");
		expect(requireSnapshot(latestSnapshot).providerId).toBe("nklein");
		expect(requireSnapshot(latestSnapshot).modelId).toBe("claude-sonnet-4-6");
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("");
		expect(requireSnapshot(latestSnapshot).isOauthProviderSelected).toBe(true);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(true);
	});

	it("normalizes legacy base urls away for OAuth providers", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			oauthProvider: "nklein",
			baseUrl: "https://legacy.example.com",
		});
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("defaults the model when NKlein settings load with a blank model", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			oauthProvider: "nklein",
			modelId: null,
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
				baseUrl: "https://api.nklein.bot/api/v1",
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).providerId).toBe("nklein");
		expect(requireSnapshot(latestSnapshot).modelId).toBe("claude-sonnet-4-6");
	});

	it("fills the provider base url from the catalog when the saved settings are blank", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "openrouter",
			oauthProvider: null,
			modelId: "gpt-5",
			baseUrl: null,
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "openrouter",
				name: "OpenRouter",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "gpt-5",
				baseUrl: "https://openrouter.ai/api/v1",
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).providerId).toBe("openrouter");
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("https://openrouter.ai/api/v1");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("treats task-level provider, model, and reasoning overrides as the clean baseline", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "openrouter",
			modelId: "openai/gpt-5",
			reasoningEffort: "high",
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "openrouter",
				name: "OpenRouter",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "openai/gpt-5",
				baseUrl: "https://openrouter.ai/api/v1",
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{
				id: "anthropic/claude-sonnet-4.6",
				name: "Claude Sonnet 4.6",
				contextWindow: null,
				maxOutputTokens: null,
				supportsReasoningEffort: true,
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					taskNKleinSettings={{
						providerId: "openrouter",
						modelId: "anthropic/claude-sonnet-4.6",
						reasoningEffort: "low",
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).providerId).toBe("openrouter");
		expect(requireSnapshot(latestSnapshot).modelId).toBe("anthropic/claude-sonnet-4.6");
		expect(requireSnapshot(latestSnapshot).reasoningEffort).toBe("low");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("treats task-level provider or model overrides with no reasoning override as model default", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "openrouter",
			modelId: "openai/gpt-5",
			reasoningEffort: "high",
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "openrouter",
				name: "OpenRouter",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "openai/gpt-5",
				baseUrl: "https://openrouter.ai/api/v1",
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{
				id: "anthropic/claude-sonnet-4.6",
				name: "Claude Sonnet 4.6",
				contextWindow: null,
				maxOutputTokens: null,
				supportsReasoningEffort: true,
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					taskNKleinSettings={{
						modelId: "anthropic/claude-sonnet-4.6",
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).modelId).toBe("anthropic/claude-sonnet-4.6");
		expect(requireSnapshot(latestSnapshot).reasoningEffort).toBe("");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("treats an explicit task-level default reasoning override as the clean baseline", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "openrouter",
			modelId: "openai/gpt-5",
			reasoningEffort: "high",
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "openrouter",
				name: "OpenRouter",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "openai/gpt-5",
				baseUrl: "https://openrouter.ai/api/v1",
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{
				id: "openai/gpt-5",
				name: "GPT-5",
				contextWindow: null,
				maxOutputTokens: null,
				supportsReasoningEffort: true,
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					taskNKleinSettings={{}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).reasoningEffort).toBe("");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("saves the current provider draft and clears dirty state using the saved override", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "anthropic",
			oauthProvider: null,
			modelId: "claude-sonnet-4-5",
			baseUrl: "https://old.example.com",
		});
		let latestSnapshot: HookSnapshot | null = null;
		saveNKleinProviderSettingsMock.mockResolvedValue({
			providerId: "openrouter",
			modelId: "gpt-5",
			baseUrl: "https://openrouter.ai/api",
			reasoningEffort: "high",
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setProviderId("openrouter");
			requireSnapshot(latestSnapshot).setModelId("gpt-5");
			requireSnapshot(latestSnapshot).setBaseUrl("https://openrouter.ai/api");
			requireSnapshot(latestSnapshot).setApiKey("secret-key");
			requireSnapshot(latestSnapshot).setReasoningEffort("high");
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(true);

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).saveProviderSettings()).toEqual({ ok: true });
		});

		expect(saveNKleinProviderSettingsMock).toHaveBeenCalledWith("workspace-1", {
			providerId: "openrouter",
			modelId: "gpt-5",
			apiKey: "secret-key",
			baseUrl: "https://openrouter.ai/api",
			reasoningEffort: "high",
		});
		expect(requireSnapshot(latestSnapshot).providerId).toBe("openrouter");
		expect(requireSnapshot(latestSnapshot).modelId).toBe("gpt-5");
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("https://openrouter.ai/api");
		expect(requireSnapshot(latestSnapshot).reasoningEffort).toBe("high");
		expect(requireSnapshot(latestSnapshot).apiKey).toBe("");
		expect(requireSnapshot(latestSnapshot).apiKeyConfigured).toBe(true);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("does not clear a saved manual api key when saving model-only overrides", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "openrouter",
			oauthProvider: null,
			modelId: "openrouter/auto",
			baseUrl: "https://openrouter.ai/api/v1",
			apiKeyConfigured: true,
		});
		let latestSnapshot: HookSnapshot | null = null;
		saveNKleinProviderSettingsMock.mockResolvedValue({
			providerId: "openrouter",
			modelId: "openrouter/free",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoningEffort: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).saveProviderSettings({ modelId: "openrouter/free" })).toEqual({
				ok: true,
			});
		});

		expect(saveNKleinProviderSettingsMock).toHaveBeenCalledWith("workspace-1", {
			providerId: "openrouter",
			modelId: "openrouter/free",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoningEffort: null,
		});
	});

	it("saves base URL provider settings before refreshing models", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "litellm",
			oauthProvider: null,
			modelId: "gpt-5.4",
			baseUrl: null,
			apiKeyConfigured: false,
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "litellm",
				name: "LiteLLM",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "gpt-5.4",
				baseUrl: "http://localhost:4000/v1",
				supportsBaseUrl: true,
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([
			{
				id: "private-proxy-model",
				name: "private-proxy-model",
				supportsReasoningEffort: true,
			},
		]);
		saveNKleinProviderSettingsMock.mockResolvedValue({
			providerId: "litellm",
			modelId: "gpt-5.4",
			baseUrl: "http://127.0.0.1:4010/v1",
			reasoningEffort: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("http://localhost:4000/v1");
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual([]);

		await act(async () => {
			requireSnapshot(latestSnapshot).setBaseUrl("http://127.0.0.1:4010/v1");
			requireSnapshot(latestSnapshot).setApiKey("test-key-catalog");
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(true);

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).refreshProviderModels()).toEqual({ ok: true });
			await flushAsyncWork();
		});

		expect(saveNKleinProviderSettingsMock).toHaveBeenCalledWith("workspace-1", {
			providerId: "litellm",
			modelId: "gpt-5.4",
			apiKey: "test-key-catalog",
			baseUrl: "http://127.0.0.1:4010/v1",
			reasoningEffort: null,
		});
		expect(fetchNKleinProviderModelsMock).toHaveBeenLastCalledWith("workspace-1", "litellm");
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["private-proxy-model"]);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("keeps refreshed provider models when the initial model load resolves later", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "litellm",
			oauthProvider: null,
			modelId: "gpt-5.4",
			baseUrl: "http://localhost:4000/v1",
			apiKeyConfigured: false,
		});
		const initialModels = createDeferred<RuntimeNKleinProviderModel[]>();
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "litellm",
				name: "LiteLLM",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "gpt-5.4",
				baseUrl: "http://localhost:4000/v1",
				supportsBaseUrl: true,
			},
		]);
		fetchNKleinProviderModelsMock.mockReturnValueOnce(initialModels.promise).mockResolvedValueOnce([
			{
				id: "fresh-proxy-model",
				name: "fresh-proxy-model",
			},
		]);
		saveNKleinProviderSettingsMock.mockResolvedValue({
			providerId: "litellm",
			modelId: "gpt-5.4",
			baseUrl: "http://127.0.0.1:4010/v1",
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setBaseUrl("http://127.0.0.1:4010/v1");
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).refreshProviderModels()).toEqual({ ok: true });
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["fresh-proxy-model"]);

		await act(async () => {
			initialModels.resolve([
				{
					id: "stale-proxy-model",
					name: "stale-proxy-model",
				},
			]);
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["fresh-proxy-model"]);
	});

	it("adds a custom provider and refreshes catalog and models", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			modelId: "claude-sonnet-4-6",
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock
			.mockResolvedValueOnce([
				{
					id: "nklein",
					name: "!Klein",
					oauthSupported: true,
					enabled: true,
					defaultModelId: "claude-sonnet-4-6",
				},
			])
			.mockResolvedValueOnce([
				{
					id: "nklein",
					name: "!Klein",
					oauthSupported: true,
					enabled: false,
					defaultModelId: "claude-sonnet-4-6",
				},
				{
					id: "my-provider",
					name: "My Provider",
					oauthSupported: false,
					enabled: true,
					defaultModelId: "qwen2.5-coder:32b",
				},
			]);
		fetchNKleinProviderModelsMock
			.mockResolvedValueOnce([
				{
					id: "claude-sonnet-4-6",
					name: "Claude Sonnet 4.6",
				},
			])
			.mockResolvedValue([
				{
					id: "qwen2.5-coder:32b",
					name: "Qwen 2.5 Coder 32B",
				},
			]);
		addNKleinProviderMock.mockResolvedValue({
			providerId: "my-provider",
			modelId: "qwen2.5-coder:32b",
			baseUrl: "http://localhost:8000/v1",
			reasoningEffort: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		await act(async () => {
			expect(
				await requireSnapshot(latestSnapshot).addCustomProvider({
					providerId: "my-provider",
					name: "My Provider",
					baseUrl: "http://localhost:8000/v1",
					apiKey: "secret-key",
					models: ["qwen2.5-coder:32b"],
					defaultModelId: "qwen2.5-coder:32b",
					modelsSourceUrl: null,
					capabilities: ["tools", "streaming"],
				}),
			).toEqual({ ok: true });
		});

		expect(addNKleinProviderMock).toHaveBeenCalledWith("workspace-1", {
			providerId: "my-provider",
			name: "My Provider",
			baseUrl: "http://localhost:8000/v1",
			apiKey: "secret-key",
			models: ["qwen2.5-coder:32b"],
			defaultModelId: "qwen2.5-coder:32b",
			modelsSourceUrl: null,
			capabilities: ["tools", "streaming"],
		});
		expect(fetchNKleinProviderCatalogMock).toHaveBeenLastCalledWith("workspace-1");
		expect(fetchNKleinProviderModelsMock).toHaveBeenLastCalledWith("workspace-1", "my-provider");
		expect(requireSnapshot(latestSnapshot).providerId).toBe("my-provider");
		expect(requireSnapshot(latestSnapshot).modelId).toBe("qwen2.5-coder:32b");
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("http://localhost:8000/v1");
		expect(requireSnapshot(latestSnapshot).apiKeyConfigured).toBe(true);
		expect(requireSnapshot(latestSnapshot).providerCatalogIds).toEqual(["nklein", "my-provider"]);
		expect(requireSnapshot(latestSnapshot).providerModelIds).toEqual(["qwen2.5-coder:32b"]);
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("applies OAuth login results to the local settings state (device auth, remote)", async () => {
		isLocalhostAccessMock.mockReturnValue(false);
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			oauthProvider: "nklein",
			oauthAccessTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});
		let latestSnapshot: HookSnapshot | null = null;
		startNKleinDeviceAuthMock.mockResolvedValue({
			deviceCode: "device-code-1",
			userCode: "ABCD-1234",
			verificationUrl: "https://auth.nklein.bot/verify",
			expiresInSeconds: 300,
			pollIntervalSeconds: 5,
		});
		completeNKleinDeviceAuthMock.mockResolvedValue({
			ok: true,
			provider: "nklein",
			settings: {
				providerId: "nklein",
				modelId: "claude-sonnet-4-6",
				baseUrl: null,
				reasoningEffort: null,
				apiKeyConfigured: false,
				oauthProvider: "nklein",
				oauthAccessTokenConfigured: true,
				oauthRefreshTokenConfigured: true,
				oauthAccountId: "acct-123",
				oauthExpiresAt: 123456789,
			},
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runOauthLogin()).toEqual({ ok: true });
		});

		expect(startNKleinDeviceAuthMock).toHaveBeenCalledWith("workspace-1");
		expect(completeNKleinDeviceAuthMock).toHaveBeenCalledWith("workspace-1", {
			deviceCode: "device-code-1",
			expiresInSeconds: 300,
			pollIntervalSeconds: 5,
		});
		expect(requireSnapshot(latestSnapshot).oauthConfigured).toBe(true);
		expect(requireSnapshot(latestSnapshot).oauthAccountId).toBe("acct-123");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("uses the provider default when OAuth login returns no model", async () => {
		isLocalhostAccessMock.mockReturnValue(false);
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			oauthProvider: "nklein",
			modelId: "claude-sonnet-4-6",
			oauthAccessTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "claude-sonnet-4-6",
				baseUrl: "https://api.nklein.bot/api/v1",
			},
		]);
		startNKleinDeviceAuthMock.mockResolvedValue({
			deviceCode: "device-code-2",
			userCode: "EFGH-5678",
			verificationUrl: "https://auth.nklein.bot/verify",
			expiresInSeconds: 300,
			pollIntervalSeconds: 5,
		});
		completeNKleinDeviceAuthMock.mockResolvedValue({
			ok: true,
			provider: "nklein",
			settings: {
				providerId: "nklein",
				modelId: null,
				baseUrl: null,
				reasoningEffort: null,
				apiKeyConfigured: false,
				oauthProvider: "nklein",
				oauthAccessTokenConfigured: true,
				oauthRefreshTokenConfigured: true,
				oauthAccountId: "acct-123",
				oauthExpiresAt: 123456789,
			},
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runOauthLogin()).toEqual({ ok: true });
		});

		expect(startNKleinDeviceAuthMock).toHaveBeenCalledWith("workspace-1");
		expect(completeNKleinDeviceAuthMock).toHaveBeenCalledWith("workspace-1", {
			deviceCode: "device-code-2",
			expiresInSeconds: 300,
			pollIntervalSeconds: 5,
		});
		expect(requireSnapshot(latestSnapshot).modelId).toBe("claude-sonnet-4-6");
		expect(requireSnapshot(latestSnapshot).oauthConfigured).toBe(true);
	});

	it("shows reasoning effort support for GPT style models", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			oauthProvider: "nklein",
			modelId: "openai/gpt-5.4",
		});
		let latestSnapshot: HookSnapshot | null = null;
		fetchNKleinProviderCatalogMock.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
				oauthSupported: true,
				enabled: true,
				defaultModelId: "openai/gpt-5.4",
				baseUrl: "https://api.nklein.bot/api/v1",
			},
		]);
		fetchNKleinProviderModelsMock.mockResolvedValue([
			{
				id: "openai/gpt-5.4",
				name: "GPT-5.4",
				supportsReasoningEffort: true,
			},
		]);

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			await flushAsyncWork();
		});

		expect(requireSnapshot(latestSnapshot).selectedModelSupportsReasoningEffort).toBe(true);
	});

	it("clears base url when saving an OAuth provider", async () => {
		const config = createRuntimeConfigResponse({
			providerId: "openrouter",
			oauthProvider: null,
			modelId: "gpt-5",
			baseUrl: "https://openrouter.ai/api",
		});
		let latestSnapshot: HookSnapshot | null = null;
		saveNKleinProviderSettingsMock.mockResolvedValue({
			providerId: "nklein",
			modelId: "claude-sonnet-4-6",
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: "nklein",
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setProviderId("nklein");
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).saveProviderSettings()).toEqual({ ok: true });
		});

		expect(saveNKleinProviderSettingsMock).toHaveBeenCalledWith("workspace-1", {
			providerId: "nklein",
			modelId: "gpt-5",
			apiKey: null,
			baseUrl: null,
			reasoningEffort: null,
		});
		expect(requireSnapshot(latestSnapshot).baseUrl).toBe("");
	});

	it("uses browser OAuth for nklein provider when accessing from localhost", async () => {
		isLocalhostAccessMock.mockReturnValue(true);
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			oauthProvider: "nklein",
			oauthAccessTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});
		let latestSnapshot: HookSnapshot | null = null;
		runNKleinProviderOauthLoginMock.mockResolvedValue({
			ok: true,
			provider: "nklein",
			settings: {
				providerId: "nklein",
				modelId: "claude-sonnet-4-6",
				baseUrl: null,
				reasoningEffort: null,
				apiKeyConfigured: false,
				oauthProvider: "nklein",
				oauthAccessTokenConfigured: true,
				oauthRefreshTokenConfigured: true,
				oauthAccountId: "acct-browser",
				oauthExpiresAt: 123456789,
			},
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runOauthLogin()).toEqual({ ok: true });
		});

		// Should use browser OAuth, NOT device auth
		expect(runNKleinProviderOauthLoginMock).toHaveBeenCalledWith("workspace-1", {
			provider: "nklein",
		});
		expect(startNKleinDeviceAuthMock).not.toHaveBeenCalled();
		expect(completeNKleinDeviceAuthMock).not.toHaveBeenCalled();
		expect(requireSnapshot(latestSnapshot).oauthConfigured).toBe(true);
		expect(requireSnapshot(latestSnapshot).oauthAccountId).toBe("acct-browser");
		expect(requireSnapshot(latestSnapshot).hasUnsavedChanges).toBe(false);
	});

	it("uses device auth for nklein provider when accessing remotely", async () => {
		isLocalhostAccessMock.mockReturnValue(false);
		const config = createRuntimeConfigResponse({
			providerId: "nklein",
			oauthProvider: "nklein",
			oauthAccessTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		});
		let latestSnapshot: HookSnapshot | null = null;
		startNKleinDeviceAuthMock.mockResolvedValue({
			deviceCode: "device-code-headless",
			userCode: "HEAD-LESS",
			verificationUrl: "https://auth.nklein.bot/verify",
			expiresInSeconds: 300,
			pollIntervalSeconds: 5,
		});
		completeNKleinDeviceAuthMock.mockResolvedValue({
			ok: true,
			provider: "nklein",
			settings: {
				providerId: "nklein",
				modelId: "claude-sonnet-4-6",
				baseUrl: null,
				reasoningEffort: null,
				apiKeyConfigured: false,
				oauthProvider: "nklein",
				oauthAccessTokenConfigured: true,
				oauthRefreshTokenConfigured: true,
				oauthAccountId: "acct-device",
				oauthExpiresAt: 123456789,
			},
		});

		await act(async () => {
			root.render(
				<HookHarness
					open={true}
					workspaceId="workspace-1"
					selectedAgentId="nklein"
					config={config}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
			await flushAsyncWork();
		});

		await act(async () => {
			expect(await requireSnapshot(latestSnapshot).runOauthLogin()).toEqual({ ok: true });
		});

		// Should use device auth, NOT browser OAuth
		expect(startNKleinDeviceAuthMock).toHaveBeenCalledWith("workspace-1");
		expect(completeNKleinDeviceAuthMock).toHaveBeenCalledWith("workspace-1", {
			deviceCode: "device-code-headless",
			expiresInSeconds: 300,
			pollIntervalSeconds: 5,
		});
		expect(runNKleinProviderOauthLoginMock).not.toHaveBeenCalled();
		expect(requireSnapshot(latestSnapshot).oauthConfigured).toBe(true);
		expect(requireSnapshot(latestSnapshot).oauthAccountId).toBe("acct-device");
	});
});
