import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClineModelRegistryEntry } from "../../../src/cline-sdk/cline-model-registry";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { readPausedTasks, setCardPaused } from "../../../src/core/card-pause";
import { requestSwarmStop } from "../../../src/core/swarm-guardrails";
import { saveWorkspaceState } from "../../../src/state/workspace-state";

const agentRegistryMocks = vi.hoisted(() => ({
	resolveAgentCommand: vi.fn(),
	buildRuntimeConfigResponse: vi.fn(),
}));

const taskWorktreeMocks = vi.hoisted(() => ({
	resolveTaskCwd: vi.fn(),
}));

const turnCheckpointMocks = vi.hoisted(() => ({
	captureTaskTurnCheckpoint: vi.fn(),
}));

const selfObservationMocks = vi.hoisted(() => ({
	recordSelfObservation: vi.fn(),
	readSelfObservationEvents: vi.fn(),
}));

const evalHarnessMocks = vi.hoisted(() => ({
	runClineDevSmokeEval: vi.fn(),
}));

const oauthMocks = vi.hoisted(() => ({
	addLocalProvider: vi.fn(),
	ensureCustomProvidersLoaded: vi.fn(),
	getValidClineCredentials: vi.fn(),
	getValidOcaCredentials: vi.fn(),
	getValidOpenAICodexCredentials: vi.fn(),
	loginClineOAuth: vi.fn(),
	loginOcaOAuth: vi.fn(),
	loginOpenAICodex: vi.fn(),
	resolveDefaultMcpSettingsPath: vi.fn(),
	resolveClineDataDir: vi.fn(() => "/tmp/cline"),
	loadMcpSettingsFile: vi.fn(),
	saveProviderSettings: vi.fn(),
	getProviderSettings: vi.fn(),
	getLastUsedProviderSettings: vi.fn(),
}));

const llmsModelMocks = vi.hoisted(() => ({
	getAllProviders: vi.fn(),
	getModelsForProvider: vi.fn(),
	resolveProviderConfig: vi.fn(),
	resolveProviderModelCatalogKeys: vi.fn(),
}));

const localProviderMocks = vi.hoisted(() => ({
	getLocalProviderModels: vi.fn(),
}));

const clineAccountMocks = vi.hoisted(() => ({
	fetchMe: vi.fn(),
	fetchRemoteConfig: vi.fn(),
	fetchOrganization: vi.fn(),
	fetchFeaturebaseToken: vi.fn(),
	constructedOptions: [] as Array<{ apiBaseUrl: string; getAuthToken: () => Promise<string | undefined | null> }>,
}));

const browserMocks = vi.hoisted(() => ({
	openInBrowser: vi.fn(),
}));

const modelRegistryMocks = vi.hoisted(() => ({
	getSnapshot: vi.fn(),
	removeEntry: vi.fn(),
	removeEntries: vi.fn(),
}));

vi.mock("../../../src/terminal/agent-registry.js", () => ({
	resolveAgentCommand: agentRegistryMocks.resolveAgentCommand,
	buildRuntimeConfigResponse: agentRegistryMocks.buildRuntimeConfigResponse,
}));

vi.mock("../../../src/workspace/task-worktree.js", () => ({
	resolveTaskCwd: taskWorktreeMocks.resolveTaskCwd,
}));

vi.mock("../../../src/workspace/turn-checkpoints.js", () => ({
	captureTaskTurnCheckpoint: turnCheckpointMocks.captureTaskTurnCheckpoint,
}));

vi.mock("../../../src/telemetry/self-observation-sink.js", () => ({
	recordSelfObservation: selfObservationMocks.recordSelfObservation,
	readSelfObservationEvents: selfObservationMocks.readSelfObservationEvents,
}));

vi.mock("@clinebot/core", () => ({
	addLocalProvider: oauthMocks.addLocalProvider,
	ensureCustomProvidersLoaded: oauthMocks.ensureCustomProvidersLoaded,
	getLocalProviderModels: localProviderMocks.getLocalProviderModels,
	getValidClineCredentials: oauthMocks.getValidClineCredentials,
	getValidOcaCredentials: oauthMocks.getValidOcaCredentials,
	getValidOpenAICodexCredentials: oauthMocks.getValidOpenAICodexCredentials,
	loginClineOAuth: oauthMocks.loginClineOAuth,
	loginOcaOAuth: oauthMocks.loginOcaOAuth,
	loginOpenAICodex: oauthMocks.loginOpenAICodex,
	resolveDefaultMcpSettingsPath: oauthMocks.resolveDefaultMcpSettingsPath,
	resolveClineDataDir: oauthMocks.resolveClineDataDir,
	loadMcpSettingsFile: oauthMocks.loadMcpSettingsFile,
	resolveProviderConfig: llmsModelMocks.resolveProviderConfig,
	ClineAccountService: class {
		constructor(options: { apiBaseUrl: string; getAuthToken: () => Promise<string | undefined | null> }) {
			clineAccountMocks.constructedOptions.push(options);
		}
		fetchMe = clineAccountMocks.fetchMe;
		fetchRemoteConfig = clineAccountMocks.fetchRemoteConfig;
		fetchOrganization = clineAccountMocks.fetchOrganization;
		fetchFeaturebaseToken = clineAccountMocks.fetchFeaturebaseToken;
	},
	ProviderSettingsManager: class {
		saveProviderSettings = oauthMocks.saveProviderSettings;
		getProviderSettings = oauthMocks.getProviderSettings;
		getLastUsedProviderSettings = oauthMocks.getLastUsedProviderSettings;
		getProviderConfig = vi.fn((providerId: string) => {
			const settings = oauthMocks.getProviderSettings(providerId);
			if (!settings) {
				return undefined;
			}
			return {
				providerId: settings.provider,
				apiKey: settings.apiKey,
				modelId: settings.model,
				baseUrl: settings.baseUrl,
			};
		});
	},
	Llms: {
		getAllProviders: llmsModelMocks.getAllProviders,
		getModelsForProvider: llmsModelMocks.getModelsForProvider,
		resolveProviderModelCatalogKeys: llmsModelMocks.resolveProviderModelCatalogKeys,
	},
	LlmsModels: {
		CLINE_DEFAULT_MODEL: "anthropic/claude-sonnet-4.6",
		getAllProviders: llmsModelMocks.getAllProviders,
		getModelsForProvider: llmsModelMocks.getModelsForProvider,
	},
}));

vi.mock("../../../src/server/browser.js", () => ({
	openInBrowser: browserMocks.openInBrowser,
}));

vi.mock("../../../src/cline-sdk/cline-model-registry.js", () => ({
	buildClineModelRegistryKey: (input: { providerId: string; modelId: string; endpoint?: string | null }) =>
		`${input.providerId.trim().toLowerCase()}:${input.modelId.trim()}:${input.endpoint?.trim() || "default"}`,
	createClineModelRegistryEntry: (input: { providerId: string; modelId: string; endpoint?: string | null }) => {
		const providerId = input.providerId.trim().toLowerCase();
		const modelId = input.modelId.trim();
		const endpoint = input.endpoint?.trim() || null;
		const key = `${providerId}:${modelId}:${endpoint || "default"}`;
		return {
			key,
			providerId,
			modelId,
			endpoint,
			contextWindow: {
				advertised: null,
				observed: null,
				userOverride: null,
				effective: null,
			},
			speed: {
				samples: 0,
				promptTokensEwma: null,
				outputTokensEwma: null,
				totalTokensEwma: null,
				prefillTokensPerSecondEwma: null,
				decodeTokensPerSecondEwma: null,
				ttftMsEwma: null,
				wallTimeMsEwma: null,
				wallTimeMsPer1kPromptTokensEwma: null,
				lastPromptTokens: null,
				lastOutputTokens: null,
				lastWallTimeMs: null,
				lastObservedAt: null,
			},
			capability: {
				samples: 0,
				staticPrior: 35,
				evalScore: null,
				externalScore: null,
				observedPassRate: null,
				effectiveScore: 35,
				lastObservedAt: null,
			},
			constraints: {
				sharedEndpointId: endpoint ?? `${providerId}:default`,
				inputCostPerMillionTokens: null,
				outputCostPerMillionTokens: null,
			},
			createdAt: 1,
			updatedAt: 1,
		};
	},
	getDefaultClineModelRegistry: () => ({
		getSnapshot: modelRegistryMocks.getSnapshot,
		removeEntry: modelRegistryMocks.removeEntry,
		removeEntries: modelRegistryMocks.removeEntries,
	}),
}));

vi.mock("../../../src/cline-sdk/cline-eval-harness.js", () => ({
	runClineDevSmokeEval: evalHarnessMocks.runClineDevSmokeEval,
}));

import type { RuntimeTrpcContext } from "../../../src/trpc/app-router";
import { type CreateRuntimeApiDependencies, createRuntimeApi } from "../../../src/trpc/runtime-api";

type ScopedTerminalManager = Awaited<ReturnType<CreateRuntimeApiDependencies["getScopedTerminalManager"]>>;

function withDefaultTerminalListSummaries(manager: ScopedTerminalManager): ScopedTerminalManager {
	const managerWithOptionalList = manager as unknown as {
		listSummaries?: () => RuntimeTaskSessionSummary[];
	};
	if (managerWithOptionalList.listSummaries) {
		return manager;
	}
	managerWithOptionalList.listSummaries = vi.fn((): RuntimeTaskSessionSummary[] => []);
	return manager;
}

function createTestRuntimeApi(
	deps: Omit<CreateRuntimeApiDependencies, "getUpdateStatus" | "runUpdateNow"> &
		Partial<Pick<CreateRuntimeApiDependencies, "getUpdateStatus" | "runUpdateNow">>,
): RuntimeTrpcContext["runtimeApi"] {
	return createRuntimeApi({
		...deps,
		getScopedTerminalManager: async (scope) =>
			withDefaultTerminalListSummaries(await deps.getScopedTerminalManager(scope)),
		getUpdateStatus:
			deps.getUpdateStatus ??
			vi.fn(() => ({
				currentVersion: "0.1.0",
				latestVersion: null,
				updateAvailable: false,
				updateTiming: null,
				installCommand: null,
			})),
		runUpdateNow:
			deps.runUpdateNow ??
			vi.fn(async () => ({
				status: "unsupported_installation" as const,
				currentVersion: "0.1.0",
				latestVersion: null,
				message: "On-demand updates are not available in this test runtime.",
			})),
	});
}

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createModelRegistryEntry(input: {
	key: string;
	providerId: string;
	modelId: string;
	endpoint?: string | null;
	contextWindow?: number;
	capability?: number;
}): ClineModelRegistryEntry {
	const contextWindow = input.contextWindow ?? 32_000;
	const capability = input.capability ?? 35;
	return {
		key: input.key,
		providerId: input.providerId,
		modelId: input.modelId,
		endpoint: input.endpoint ?? (input.providerId === "anthropic" ? "http://127.0.0.1:1234/v1" : null),
		contextWindow: {
			advertised: contextWindow,
			observed: null,
			userOverride: null,
			effective: contextWindow,
		},
		speed: {
			samples: 0,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: null,
			decodeTokensPerSecondEwma: null,
			ttftMsEwma: null,
			wallTimeMsEwma: null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 0,
			staticPrior: capability,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: capability,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: input.endpoint ?? `${input.providerId}:default`,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

function createRuntimeConfigState(): RuntimeConfigState {
	return {
		selectedAgentId: "cline",
		selectedShortcutLabel: null,
		developerModeEnabled: false,
		replayCardsEnabled: false,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "local",
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks: 3,
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 4096,
		sandboxCpusPerContainer: 2,
		sandboxIdleTimeoutMinutes: 10,
		lostHeartbeatPolicy: "park",
		decompositionAutoApplyEnabled: true,
		readyForReviewNotificationsEnabled: true,
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
		modelRoles: {},
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project-config.json",
	};
}

let providerSelectionPath = "";

function writeSelectedProviderId(providerId: string): void {
	if (!providerSelectionPath) {
		return;
	}
	rmSync(providerSelectionPath, { force: true });
	mkdirSync(dirname(providerSelectionPath), { recursive: true });
	writeFileSync(providerSelectionPath, `${JSON.stringify({ providerId }, null, 2)}\n`, "utf8");
}

function setSelectedProviderSettings(
	settings: {
		provider: string;
		model?: string;
		baseUrl?: string;
		apiKey?: string;
		reasoning?: {
			effort?: "low" | "medium" | "high" | "xhigh";
		};
		auth?: {
			accessToken?: string;
			refreshToken?: string;
			accountId?: string;
			expiresAt?: number;
		};
	} | null,
): void {
	const normalizedSettings =
		settings && settings.provider === "anthropic" && settings.baseUrl === undefined
			? { ...settings, baseUrl: "http://127.0.0.1:1234/v1" }
			: settings;
	oauthMocks.getLastUsedProviderSettings.mockReturnValue(normalizedSettings ?? undefined);
	oauthMocks.getProviderSettings.mockImplementation((providerId: string) =>
		normalizedSettings && normalizedSettings.provider === providerId ? normalizedSettings : undefined,
	);
	if (!providerSelectionPath) {
		return;
	}
	rmSync(providerSelectionPath, { force: true });
	if (normalizedSettings) {
		writeSelectedProviderId(normalizedSettings.provider);
	}
}

function createMockLocalProviderModels(providerId: string) {
	const modelsByProvider: Record<
		string,
		Array<{
			id: string;
			name: string;
			contextWindow: number;
			supportsReasoning?: boolean;
		}>
	> = {
		anthropic: [
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
				contextWindow: 200_000,
			},
			{
				id: "anthropic/claude-opus-4.6",
				name: "Claude Opus 4.6",
				contextWindow: 200_000,
			},
		],
		cline: [
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
				contextWindow: 200_000,
			},
			{
				id: "anthropic/claude-sonnet-4.6",
				name: "Claude Sonnet 4.6",
				contextWindow: 200_000,
			},
			{
				id: "anthropic/claude-opus-4.6",
				name: "Claude Opus 4.6",
				contextWindow: 200_000,
			},
		],
		lmstudio: [
			{
				id: "old-model",
				name: "Old Model",
				contextWindow: 64_000,
			},
			{
				id: "new-model",
				name: "New Model",
				contextWindow: 64_000,
			},
		],
		ollama: [
			{
				id: "qwen3.5-9b",
				name: "Qwen 3.5 9B",
				contextWindow: 64_000,
			},
		],
		openrouter: [
			{
				id: "openrouter/auto",
				name: "OpenRouter Auto",
				contextWindow: 128_000,
			},
			{
				id: "openrouter/free",
				name: "OpenRouter Free",
				contextWindow: 128_000,
				supportsReasoning: true,
			},
		],
	};
	return {
		providerId,
		models: modelsByProvider[providerId] ?? [],
	};
}

function restoreEnvVar(name: "CLINE_API_KEY" | "OCA_API_KEY", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

function createClineTaskSessionServiceMock() {
	return {
		startTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary>>(async () =>
			createSummary({ agentId: "cline", pid: null }),
		),
		onMessage: vi.fn<(...args: unknown[]) => () => void>(() => () => {}),
		onTeamProgress: vi.fn<(...args: unknown[]) => () => void>(() => () => {}),
		stopTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		abortTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		cancelTaskTurn: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		sendTaskSessionInput: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		clearTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		reloadTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(async () => null),
		rebindPersistedTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary | null>>(
			async () => null,
		),
		getSummary: vi.fn<(...args: unknown[]) => RuntimeTaskSessionSummary | null>(() => null),
		listSummaries: vi.fn<(...args: unknown[]) => RuntimeTaskSessionSummary[]>(() => []),
		listModelEndpointSessions: vi.fn<(...args: unknown[]) => unknown[]>(() => []),
		listMessages: vi.fn<(...args: unknown[]) => unknown[]>(() => []),
		loadTaskSessionMessages: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
		applyTurnCheckpoint: vi.fn<(...args: unknown[]) => RuntimeTaskSessionSummary | null>(() => null),
		setBoardPaused: vi.fn<(...args: unknown[]) => void>(),
		setCardPaused: vi.fn<(...args: unknown[]) => void>(),
		resumePausedTasks: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary[]>>(async () => []),
		dispose: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	};
}

describe("createRuntimeApi startTaskSession", () => {
	const originalClineApiKey = process.env.CLINE_API_KEY;
	const originalOcaApiKey = process.env.OCA_API_KEY;
	const originalClineMcpSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
	const originalClineMcpOauthSettingsPath = process.env.CLINE_MCP_OAUTH_SETTINGS_PATH;
	const originalProviderSelectionPath = process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH;
	let mcpSettingsPath = "";
	let mcpOauthSettingsPath = "";

	beforeEach(() => {
		mcpSettingsPath = `/tmp/kanban-mcp-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		mcpOauthSettingsPath = `/tmp/kanban-mcp-oauth-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		providerSelectionPath = `/tmp/kanban-provider-selection-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		process.env.CLINE_MCP_SETTINGS_PATH = mcpSettingsPath;
		process.env.CLINE_MCP_OAUTH_SETTINGS_PATH = mcpOauthSettingsPath;
		process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH = providerSelectionPath;
		agentRegistryMocks.resolveAgentCommand.mockReset();
		agentRegistryMocks.buildRuntimeConfigResponse.mockReset();
		taskWorktreeMocks.resolveTaskCwd.mockReset();
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockReset();
		selfObservationMocks.recordSelfObservation.mockReset();
		selfObservationMocks.readSelfObservationEvents.mockReset();
		selfObservationMocks.readSelfObservationEvents.mockResolvedValue([]);
		oauthMocks.addLocalProvider.mockReset();
		oauthMocks.ensureCustomProvidersLoaded.mockReset();
		oauthMocks.loginClineOAuth.mockReset();
		oauthMocks.loginOcaOAuth.mockReset();
		oauthMocks.loginOpenAICodex.mockReset();
		oauthMocks.getValidClineCredentials.mockReset();
		oauthMocks.getValidOcaCredentials.mockReset();
		oauthMocks.getValidOpenAICodexCredentials.mockReset();
		oauthMocks.resolveDefaultMcpSettingsPath.mockReset();
		oauthMocks.loadMcpSettingsFile.mockReset();
		oauthMocks.saveProviderSettings.mockReset();
		oauthMocks.getProviderSettings.mockReset();
		oauthMocks.getLastUsedProviderSettings.mockReset();
		clineAccountMocks.fetchMe.mockReset();
		clineAccountMocks.fetchRemoteConfig.mockReset();
		clineAccountMocks.constructedOptions.length = 0;
		localProviderMocks.getLocalProviderModels.mockReset();
		localProviderMocks.getLocalProviderModels.mockImplementation(async (providerId: string) =>
			createMockLocalProviderModels(providerId),
		);
		llmsModelMocks.getAllProviders.mockReset();
		llmsModelMocks.getModelsForProvider.mockReset();
		llmsModelMocks.resolveProviderConfig.mockReset();
		llmsModelMocks.resolveProviderModelCatalogKeys.mockReset();
		browserMocks.openInBrowser.mockReset();
		modelRegistryMocks.getSnapshot.mockReset();
		modelRegistryMocks.removeEntry.mockReset();
		modelRegistryMocks.removeEntry.mockResolvedValue(false);
		modelRegistryMocks.removeEntries.mockReset();
		modelRegistryMocks.removeEntries.mockResolvedValue(0);
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 0,
			models: {},
		});

		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "claude",
			label: "Claude Code",
			command: "claude",
			binary: "claude",
			args: [],
		});
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockResolvedValue({
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "1111111",
			createdAt: Date.now(),
		});
		oauthMocks.loginClineOAuth.mockResolvedValue({
			access: "oauth-access",
			refresh: "oauth-refresh",
			expires: 1_700_000_000_000,
			accountId: "acct-1",
		});
		oauthMocks.loginOcaOAuth.mockResolvedValue({
			access: "oca-access",
			refresh: "oca-refresh",
			expires: 1_700_000_000_000,
			accountId: "oca-acct",
		});
		oauthMocks.loginOpenAICodex.mockResolvedValue({
			access: "codex-access",
			refresh: "codex-refresh",
			expires: 1_700_000_000_000,
			accountId: "codex-acct",
		});
		oauthMocks.getValidClineCredentials.mockResolvedValue({
			access: "oauth-access",
			refresh: "oauth-refresh",
			expires: 1_700_000_000_000,
			accountId: "acct-1",
		});
		oauthMocks.getValidOcaCredentials.mockResolvedValue({
			access: "oca-access",
			refresh: "oca-refresh",
			expires: 1_700_000_000_000,
			accountId: "oca-acct",
		});
		oauthMocks.getValidOpenAICodexCredentials.mockResolvedValue({
			access: "codex-access",
			refresh: "codex-refresh",
			expires: 1_700_000_000_000,
			accountId: "codex-acct",
		});
		oauthMocks.addLocalProvider.mockResolvedValue({
			providerId: "custom-provider",
			settingsPath: "/tmp/providers.json",
			modelsPath: "/tmp/models.json",
			modelsCount: 1,
		});
		oauthMocks.ensureCustomProvidersLoaded.mockResolvedValue(undefined);
		llmsModelMocks.getAllProviders.mockResolvedValue([]);
		llmsModelMocks.getModelsForProvider.mockResolvedValue({});
		llmsModelMocks.resolveProviderConfig.mockResolvedValue(undefined);
		evalHarnessMocks.runClineDevSmokeEval.mockReset();
		evalHarnessMocks.runClineDevSmokeEval.mockResolvedValue({
			workspacePath: "/tmp/eval-workspace",
			evidenceBundlePath: "/tmp/eval-evidence",
			acceptanceCommand: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
		});
		llmsModelMocks.resolveProviderModelCatalogKeys.mockImplementation((providerId: string) =>
			providerId === "cline" ? ["openrouter", "cline"] : [providerId],
		);
		oauthMocks.resolveDefaultMcpSettingsPath.mockReturnValue(mcpSettingsPath);
		oauthMocks.loadMcpSettingsFile.mockReturnValue({
			mcpServers: {},
		});
		clineAccountMocks.fetchMe.mockResolvedValue({
			id: "acct-1",
			email: "saoud@example.com",
			displayName: "Saoud",
		});
		clineAccountMocks.fetchRemoteConfig.mockResolvedValue({
			organizationId: "org-1",
			enabled: true,
			value: JSON.stringify({
				kanbanEnabled: true,
			}),
		});
		setSelectedProviderSettings(null);
		llmsModelMocks.getAllProviders.mockResolvedValue([
			{
				id: "cline",
				name: "Cline",
				defaultModelId: "claude-sonnet-4-6",
				capabilities: ["oauth"],
			},
			{
				id: "anthropic",
				name: "Anthropic",
				defaultModelId: "claude-sonnet-4-6",
				capabilities: ["tools"],
			},
			{
				id: "ollama",
				name: "Ollama",
				defaultModelId: "qwen3.5-9b",
				capabilities: ["tools"],
			},
		]);
		llmsModelMocks.getModelsForProvider.mockImplementation(async (providerId: string) => {
			if (providerId !== "cline") {
				return {};
			}
			return {
				"claude-sonnet-4-6": {
					id: "claude-sonnet-4-6",
					name: "Claude Sonnet 4.6",
					contextWindow: 200_000,
					capabilities: ["images", "files"],
				},
			};
		});
	});

	afterEach(() => {
		restoreEnvVar("CLINE_API_KEY", originalClineApiKey);
		restoreEnvVar("OCA_API_KEY", originalOcaApiKey);
		if (originalClineMcpSettingsPath === undefined) {
			delete process.env.CLINE_MCP_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_SETTINGS_PATH = originalClineMcpSettingsPath;
		}
		if (originalClineMcpOauthSettingsPath === undefined) {
			delete process.env.CLINE_MCP_OAUTH_SETTINGS_PATH;
		} else {
			process.env.CLINE_MCP_OAUTH_SETTINGS_PATH = originalClineMcpOauthSettingsPath;
		}
		if (originalProviderSelectionPath === undefined) {
			delete process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH;
		} else {
			process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH = originalProviderSelectionPath;
		}
		rmSync(mcpSettingsPath, { force: true });
		rmSync(`${mcpSettingsPath}.lock`, { force: true });
		rmSync(mcpOauthSettingsPath, { force: true });
		rmSync(`${mcpOauthSettingsPath}.lock`, { force: true });
		rmSync(providerSelectionPath, { force: true });
		providerSelectionPath = "";
	});

	it("records telemetry when granting a protected-test approval", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.grantProtectedTestApproval(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-approval",
				approval: {
					intent: "Change protected test suite path test/protected/protected-tests.json via editor.",
					diff: "{}",
					reason: "The editor tool attempted to change a protected test-suite file.",
					expectedEffects: "The protected test-suite file would be edited with the supplied new text.",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "custom",
				severity: "info",
				message: "Protected-test edit approval granted.",
				taskId: "task-approval",
				workspacePath: "/tmp/repo",
				metadata: expect.objectContaining({
					operation: "grant_protected_test_approval",
					intent: "Change protected test suite path test/protected/protected-tests.json via editor.",
				}),
			}),
		);
	});

	it("starts Cline tasks without resolving a host task worktree", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Investigate startup freeze",
			},
		);

		expect(response.ok).toBe(true);
		expect(taskWorktreeMocks.resolveTaskCwd).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/tmp/repo",
				workspaceRoot: "/tmp/repo",
				baseRef: "main",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("still avoids host worktree creation for Cline when no existing task cwd is available", async () => {
		taskWorktreeMocks.resolveTaskCwd
			.mockRejectedValueOnce(new Error("missing"))
			.mockResolvedValueOnce("/tmp/new-worktree");
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Investigate startup freeze",
			},
		);

		expect(response.ok).toBe(true);
		expect(taskWorktreeMocks.resolveTaskCwd).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/tmp/repo",
				workspaceRoot: "/tmp/repo",
				baseRef: "main",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("records checkpoint capture failures without blocking task start", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockRejectedValue(new Error("checkpoint ref failed"));

		const terminalManager = {
			listSummaries: vi.fn(() => []),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => ({
				...createRuntimeConfigState(),
				selectedAgentId: "codex" as const,
			})),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Start work",
			},
		);

		expect(response.ok).toBe(true);
		expect(selfObservationMocks.recordSelfObservation).toHaveBeenCalledWith(
			expect.objectContaining({
				signal: "runtime_error",
				severity: "warning",
				taskId: "task-1",
				workspacePath: "/tmp/repo",
				message: "Task checkpoint capture failed: checkpoint ref failed",
				metadata: expect.objectContaining({
					operation: "capture_task_turn_checkpoint",
					agentId: "claude",
				}),
			}),
		);
	});

	it("blocks project task starts when the terminal active task capacity is full", async () => {
		const terminalManager = {
			listSummaries: vi.fn(() => [createSummary({ taskId: "task-2", state: "running" })]),
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => ({
				...createRuntimeConfigState(),
				maxConcurrentTasks: 1,
			})),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Investigate startup freeze",
			},
		);

		expect(response).toEqual({
			ok: false,
			summary: null,
			error: "Maximum concurrent task limit reached (1). Wait for a running task to finish, or stop an active task before starting another.",
		});
		expect(taskWorktreeMocks.resolveTaskCwd).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("counts active Cline sessions when enforcing project task capacity", async () => {
		const terminalManager = {
			listSummaries: vi.fn(() => []),
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.listSummaries.mockReturnValue([
			createSummary({ taskId: "task-2", state: "awaiting_review", agentId: "cline", pid: null }),
		]);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				runtimeConfigState.maxConcurrentTasks = 1;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			getLoadedScopedClineTaskSessionService: vi.fn(() => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(false);
		expect(response.error).toContain("Maximum concurrent task limit reached (1)");
		expect(taskWorktreeMocks.resolveTaskCwd).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("routes cline start sessions to cline task session service", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		modelRegistryMocks.getSnapshot.mockReturnValue({
			schemaVersion: 1,
			updatedAt: 0,
			models: {},
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				startInPlanMode: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				cwd: "/tmp/repo",
				workspaceRoot: "/tmp/repo",
				baseRef: "main",
				prompt: "Continue task",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
				mode: "act",
				startInPlanMode: true,
				resumeFromTrash: undefined,
				requestTimeoutMs: 3_600_000,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("passes the MCSR effective context window to Cline starts instead of the provider advertised window", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		const registryEntry = createModelRegistryEntry({
			key: "anthropic:claude-sonnet-4-6:http://127.0.0.1:1234/v1",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			endpoint: "http://127.0.0.1:1234/v1",
			contextWindow: 64_000,
			capability: 70,
		});
		registryEntry.contextWindow.advertised = 200_000;
		registryEntry.contextWindow.observed = 64_000;
		registryEntry.contextWindow.effective = 64_000;
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				[registryEntry.key]: registryEntry,
			},
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				contextWindow: 64_000,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("routes Cline starts up to the smallest sufficient configured role model", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "small-model",
			apiKey: "anthropic-api-key",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "anthropic",
			models: [
				{
					id: "small-model",
					name: "Small Model",
					contextWindow: 32_000,
				},
			],
		});
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				"anthropic:small-model:default": createModelRegistryEntry({
					key: "anthropic:small-model:default",
					providerId: "anthropic",
					modelId: "small-model",
					contextWindow: 32_000,
					capability: 35,
				}),
				"anthropic:claude-opus:default": createModelRegistryEntry({
					key: "anthropic:claude-opus:default",
					providerId: "anthropic",
					modelId: "claude-opus",
					contextWindow: 200_000,
					capability: 90,
				}),
			},
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				runtimeConfigState.modelRoles = {
					architect: {
						providerId: "anthropic",
						modelId: "claude-opus",
						reasoningEffort: "high",
					},
				};
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: `Implement a broad architecture change.\n${"complex ".repeat(60_000)}`,
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-opus",
				reasoningEffort: "high",
			}),
		);
	});

	it("blocks Cline starts when any configured role model is below the minimum context window", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-opus",
			apiKey: "anthropic-api-key",
		});
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				"anthropic:claude-opus:default": createModelRegistryEntry({
					key: "anthropic:claude-opus:default",
					providerId: "anthropic",
					modelId: "claude-opus",
					contextWindow: 200_000,
					capability: 90,
				}),
				"anthropic:small-model:default": createModelRegistryEntry({
					key: "anthropic:small-model:default",
					providerId: "anthropic",
					modelId: "small-model",
					contextWindow: 16_000,
					capability: 70,
				}),
			},
		});

		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				runtimeConfigState.modelRoles = {
					worker: {
						providerId: "anthropic",
						modelId: "small-model",
					},
				};
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Implement a focused change.",
			},
		);

		expect(response).toMatchObject({
			ok: false,
			error: expect.stringContaining("requires at least 32,000"),
		});
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("blocks Cline starts that no configured model can fit", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "small-model",
			apiKey: "anthropic-api-key",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "anthropic",
			models: [
				{
					id: "small-model",
					name: "Small Model",
					contextWindow: 32_000,
				},
			],
		});
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				"anthropic:small-model:default": createModelRegistryEntry({
					key: "anthropic:small-model:default",
					providerId: "anthropic",
					modelId: "small-model",
					contextWindow: 32_000,
					capability: 90,
				}),
			},
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: `Implement a broad architecture change.\n${"complex ".repeat(60_000)}`,
			},
		);

		expect(response.ok).toBe(false);
		expect(response.errorCode).toBe("routing_escalation");
		expect(response.error).toContain("No connected model is capable enough or large enough");
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("blocks Cline starts that would contend for the same local endpoint", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.listModelEndpointSessions.mockReturnValue([
			{
				taskId: "task-1",
				state: "running",
				startedAt: Date.now() - 30_000,
				providerId: "ollama",
				modelId: "qwen3.5-9b",
				endpoint: "http://127.0.0.1:11434",
			},
		]);
		const qwenEntry = createModelRegistryEntry({
			key: "ollama:qwen3.5-9b:http://127.0.0.1:11434",
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://127.0.0.1:11434",
			contextWindow: 64_000,
			capability: 70,
		});
		qwenEntry.speed.wallTimeMsEwma = 120_000;
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				[qwenEntry.key]: qwenEntry,
			},
		});
		const taskStartQueue = {
			enqueue: vi.fn(),
			remove: vi.fn(),
			takeReady: vi.fn(() => []),
			clearWorkspace: vi.fn(),
			size: vi.fn(() => 0),
		};

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			taskStartQueue,
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-2",
				baseRef: "main",
				prompt: "Continue task",
				queueOnEndpointBusy: true,
			},
		);

		expect(response.ok).toBe(false);
		expect(response.errorCode).toBe("endpoint_busy");
		expect(response.queued).toBe(true);
		expect(response.retryAfterMs).toBeGreaterThan(0);
		expect(response.error).toContain("http://127.0.0.1:11434");
		expect(response.error).toContain("task-1");
		expect(response.error).toContain("Estimated wait");
		expect(taskStartQueue.enqueue).toHaveBeenCalledWith(
			expect.objectContaining({
				workspaceScope: {
					workspaceId: "workspace-1",
					workspacePath: "/tmp/repo",
				},
				request: expect.objectContaining({
					taskId: "task-2",
					queueOnEndpointBusy: true,
				}),
				delayMs: expect.any(Number),
			}),
		);
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("applies task-level reasoning overrides even without task model/provider overrides", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Reasoning-only override task",
				clineSettings: {
					reasoningEffort: "medium",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				reasoningEffort: "medium",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("clamps stale one-second Cline timeout settings to the local timeout floor", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Timeout floor task",
				clineSettings: {
					requestTimeoutMs: 1_000,
					streamTimeoutMs: 1_000,
					toolTimeoutMs: 1_000,
					agentTimeoutMs: 1_000,
					conversationTimeoutMs: 1_000,
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				requestTimeoutMs: 60_000,
				streamTimeoutMs: 60_000,
				toolTimeoutMs: 60_000,
				turnTimeoutMs: 60_000,
				conversationTimeoutMs: 60_000,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("raises positive local Cline timeouts from slow MCSR speed observations", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		const registryEntry = createModelRegistryEntry({
			key: "anthropic:claude-sonnet-4-6:http://127.0.0.1:1234/v1",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			endpoint: "http://127.0.0.1:1234/v1",
			contextWindow: 80_000,
			capability: 70,
		});
		registryEntry.speed = {
			...registryEntry.speed,
			samples: 3,
			promptTokensEwma: 1_000,
			outputTokensEwma: 250,
			totalTokensEwma: 1_250,
			prefillTokensPerSecondEwma: 0.5,
			decodeTokensPerSecondEwma: 2,
			ttftMsEwma: 120_000,
			wallTimeMsEwma: 180_000,
			wallTimeMsPer1kPromptTokensEwma: 120_000,
			lastPromptTokens: 1_000,
			lastOutputTokens: 250,
			lastWallTimeMs: 180_000,
			lastObservedAt: 1,
		};
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				[registryEntry.key]: registryEntry,
			},
		});
		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Slow local model timeout task",
				clineSettings: {
					requestTimeoutMs: 1_000,
					streamTimeoutMs: 1_000,
					toolTimeoutMs: 1_000,
					agentTimeoutMs: 1_000,
					conversationTimeoutMs: 1_000,
				},
			},
		);

		expect(response.ok).toBe(true);
		const launchRequest = clineTaskSessionService.startTaskSession.mock.calls[0]?.[0] as
			| {
					requestTimeoutMs?: number | null;
					streamTimeoutMs?: number | null;
					toolTimeoutMs?: number | null;
					turnTimeoutMs?: number | null;
					conversationTimeoutMs?: number | null;
			  }
			| undefined;
		expect(launchRequest?.requestTimeoutMs).toBeGreaterThan(60_000);
		expect(launchRequest?.streamTimeoutMs).toBeGreaterThan(60_000);
		expect(launchRequest?.toolTimeoutMs).toBeGreaterThan(60_000);
		expect(launchRequest?.turnTimeoutMs).toBeGreaterThan(60_000);
		expect(launchRequest?.conversationTimeoutMs).toBeGreaterThan(60_000);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("keeps unlimited Cline timeouts unlimited when MCSR speed data is slow", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		const registryEntry = createModelRegistryEntry({
			key: "anthropic:claude-sonnet-4-6:http://127.0.0.1:1234/v1",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			endpoint: "http://127.0.0.1:1234/v1",
			contextWindow: 80_000,
			capability: 70,
		});
		registryEntry.speed = {
			...registryEntry.speed,
			samples: 1,
			wallTimeMsEwma: 600_000,
			wallTimeMsPer1kPromptTokensEwma: 600_000,
			lastWallTimeMs: 600_000,
			lastObservedAt: 1,
		};
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				[registryEntry.key]: registryEntry,
			},
		});
		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				runtimeConfigState.agentTimeoutMode = "unlimited";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Unlimited local model timeout task",
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				requestTimeoutMs: null,
				streamTimeoutMs: null,
				toolTimeoutMs: null,
				turnTimeoutMs: null,
				conversationTimeoutMs: null,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("uses model-default reasoning when a task overrides the model but leaves reasoning on default", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
			reasoning: {
				effort: "high",
			},
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Task with model override",
				clineSettings: {
					modelId: "anthropic/claude-opus-4.6",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "anthropic/claude-opus-4.6",
				reasoningEffort: null,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("skips cline persisted-session probing when resumeFromTrash already has a non-cline terminal summary", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});

		const terminalManager = {
			getSummary: vi.fn(() => createSummary({ agentId: "codex", state: "idle", pid: null })),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const getScopedClineTaskSessionService = vi.fn(async () => clineTaskSessionService as never);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService,
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Resume task",
				resumeFromTrash: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(terminalManager.getSummary).toHaveBeenCalledWith("task-1");
		expect(getScopedClineTaskSessionService).not.toHaveBeenCalled();
		expect(clineTaskSessionService.rebindPersistedTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				agentId: "codex",
				resumeFromTrash: true,
			}),
		);
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("clears task chat cache before resumeFromTrash starts", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});

		const broadcastTaskChatCleared = vi.fn();
		const terminalManager = {
			getSummary: vi.fn(() => createSummary({ agentId: "codex", state: "idle", pid: null })),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			broadcastTaskChatCleared,
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Resume task",
				resumeFromTrash: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(broadcastTaskChatCleared).toHaveBeenCalledWith("workspace-1", "task-1");
	});

	it("probes cline persisted sessions on resumeFromTrash when no terminal agent summary exists", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});

		const terminalManager = {
			getSummary: vi.fn(() => null),
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.rebindPersistedTaskSession.mockResolvedValue(
			createSummary({ agentId: "cline", pid: null }),
		);
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Resume task",
				resumeFromTrash: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(terminalManager.getSummary).toHaveBeenCalledWith("task-1");
		expect(clineTaskSessionService.rebindPersistedTaskSession).toHaveBeenCalledWith("task-1");
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				resumeFromTrash: true,
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("uses saved cline settings even when no last-used provider is recorded", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		oauthMocks.getLastUsedProviderSettings.mockReturnValue(undefined);
		oauthMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "cline"
				? {
						provider: "cline",
						model: "anthropic/claude-opus-4.6",
						apiKey: "saved-cline-api-key",
					}
				: undefined,
		);
		writeSelectedProviderId("cline");

		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(
				async () => ({ startTaskSession: vi.fn(), applyTurnCheckpoint: vi.fn() }) as never,
			),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response).toMatchObject({
			ok: false,
			summary: null,
			error: expect.stringContaining("No native Cline provider is configured"),
		});
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("ignores a persisted cline cloud provider selection", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		delete process.env.CLINE_API_KEY;
		setSelectedProviderSettings({
			provider: "cline",
			model: "anthropic/claude-opus-4.6",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(false);
		expect(response.summary).toBeNull();
		expect(response.error).toContain("No native Cline provider is configured");
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("blocks the cline provider even when CLINE_API_KEY is present in the environment", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		process.env.CLINE_API_KEY = "env-cline-api-key";
		setSelectedProviderSettings({
			provider: "cline",
			model: "anthropic/claude-opus-4.6",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response).toMatchObject({
			ok: false,
			summary: null,
			error: expect.stringContaining("No native Cline provider is configured"),
		});
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("starts home agent sessions in the workspace root without resolving a task worktree", async () => {
		const homeTaskId = "__home_agent__:workspace-1:cline";
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
		});
		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary({ taskId: homeTaskId })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(
			createSummary({ taskId: homeTaskId, agentId: "cline", pid: null }),
		);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: homeTaskId,
				baseRef: "main",
				prompt: "",
			},
		);

		expect(response.ok).toBe(true);
		expect(taskWorktreeMocks.resolveTaskCwd).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: homeTaskId,
				cwd: "/tmp/repo",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("forwards task images to CLI task sessions", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const images = [
			{
				id: "img-1",
				data: Buffer.from("hello").toString("base64"),
				mimeType: "image/png",
				name: "diagram.png",
			},
		];

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
				images,
			},
		);

		expect(response.ok).toBe(true);
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex",
				images,
			}),
		);
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("does not resolve cline OAuth when starting a non-cline task session", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue({
			agentId: "codex",
			label: "OpenAI Codex",
			command: "codex",
			binary: "codex",
			args: [],
		});
		oauthMocks.getValidClineCredentials.mockRejectedValue(
			new Error('OAuth credentials for provider "cline" are invalid. Re-run OAuth login.'),
		);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary({ agentId: "codex" })),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "codex";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "codex",
				cwd: "/tmp/existing-worktree",
			}),
		);
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("prefers OAuth api key when cline OAuth credentials are configured", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		oauthMocks.getValidClineCredentials.mockResolvedValue({
			access: "oauth-access",
			refresh: "oauth-refresh",
			expires: 1_700_000_000_000,
			accountId: "acct-1",
		});
		setSelectedProviderSettings({
			provider: "cline",
			model: "claude-sonnet-4-6",
			auth: {
				accessToken: "oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response).toMatchObject({
			ok: false,
			summary: null,
			error: expect.stringContaining("No native Cline provider is configured"),
		});
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(clineAccountMocks.fetchMe).not.toHaveBeenCalled();
		expect(oauthMocks.saveProviderSettings).not.toHaveBeenCalled();
	});

	it("does not use OAuth credentials for non-OAuth providers", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "cline", pid: null }));
		setSelectedProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-api-key",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				expiresAt: 1_700_000_000_000,
			},
		});

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
			},
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
		expect(oauthMocks.saveProviderSettings).not.toHaveBeenCalled();
	});

	it("routes cline task input and stop to cline task session service", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-cline-task-stop-"));
		try {
			const summary = createSummary({ agentId: "cline", pid: null, paused: true });
			const terminalManager = {
				writeInput: vi.fn(),
				stopTaskSession: vi.fn(),
			};
			const clineTaskSessionService = createClineTaskSessionServiceMock();
			clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
			clineTaskSessionService.stopTaskSession.mockResolvedValue(summary);
			await setCardPaused({ workspacePath, taskId: "task-1", paused: true });

			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => terminalManager as never),
				getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});
			const scope = { workspaceId: "workspace-1", workspacePath };

			const sendResponse = await api.sendTaskSessionInput(scope, {
				taskId: "task-1",
				text: "hello",
				appendNewline: true,
			});
			expect(sendResponse.ok).toBe(true);
			expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith("task-1", "hello\n");
			expect(terminalManager.writeInput).not.toHaveBeenCalled();

			const stopResponse = await api.stopTaskSession(scope, { taskId: "task-1" });
			expect(stopResponse.ok).toBe(true);
			expect(stopResponse.summary?.paused).toBe(false);
			expect(clineTaskSessionService.stopTaskSession).toHaveBeenCalledWith("task-1");
			expect(terminalManager.stopTaskSession).not.toHaveBeenCalled();
			await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set());
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("manages workspace swarm stop signal through runtime api", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-swarm-stop-api-"));
		try {
			const clineTaskSessionService = createClineTaskSessionServiceMock();
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(),
				getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
				getLoadedScopedClineTaskSessionService: vi.fn(() => clineTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});
			const scope = { workspaceId: "workspace-1", workspacePath };

			await expect(api.getSwarmStop(scope)).resolves.toEqual({ ok: true, signal: null });

			const stopped = await api.requestSwarmStop(scope, { reason: "Operator paused from UI." });
			expect(stopped.ok).toBe(true);
			expect(stopped.signal).toMatchObject({
				stopped: true,
				reason: "Operator paused from UI.",
			});
			expect(clineTaskSessionService.setBoardPaused).toHaveBeenCalledWith(true);
			await expect(api.getSwarmStop(scope)).resolves.toMatchObject({
				ok: true,
				signal: expect.objectContaining({
					stopped: true,
					reason: "Operator paused from UI.",
				}),
			});

			await expect(api.clearSwarmStop(scope)).resolves.toEqual({ ok: true, signal: null });
			expect(clineTaskSessionService.setBoardPaused).toHaveBeenLastCalledWith(false);
			expect(clineTaskSessionService.resumePausedTasks).toHaveBeenCalledTimes(1);
			await expect(api.getSwarmStop(scope)).resolves.toEqual({ ok: true, signal: null });
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("persists and resumes per-card pause state through runtime api", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-card-pause-api-"));
		try {
			const runningSummary = createSummary({ agentId: "cline", taskId: "task-1", state: "running" });
			const resumedSummary = createSummary({ agentId: "cline", taskId: "task-1", state: "running" });
			const clineTaskSessionService = createClineTaskSessionServiceMock();
			clineTaskSessionService.getSummary.mockReturnValue(runningSummary);
			clineTaskSessionService.resumePausedTasks.mockResolvedValue([resumedSummary]);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(),
				getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
				getLoadedScopedClineTaskSessionService: vi.fn(() => clineTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});
			const scope = { workspaceId: "workspace-1", workspacePath };

			const pauseResponse = await api.pauseTask(scope, { taskId: " task-1 " });
			expect(pauseResponse).toMatchObject({
				ok: true,
				pausedTaskIds: ["task-1"],
				summary: {
					taskId: "task-1",
					paused: true,
				},
			});
			expect(clineTaskSessionService.setCardPaused).toHaveBeenCalledWith("task-1", true);
			await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set(["task-1"]));

			const resumeResponse = await api.resumeTask(scope, { taskId: "task-1" });
			expect(resumeResponse).toMatchObject({
				ok: true,
				pausedTaskIds: [],
				summary: {
					taskId: "task-1",
					paused: false,
				},
			});
			expect(clineTaskSessionService.setCardPaused).toHaveBeenLastCalledWith("task-1", false);
			expect(clineTaskSessionService.resumePausedTasks).toHaveBeenCalledTimes(1);
			await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set());
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("rebinds a persisted paused cline session before card resume after runtime restart", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-card-pause-rebind-api-"));
		try {
			const reboundSummary = createSummary({
				agentId: "cline",
				taskId: "task-1",
				state: "awaiting_review",
			});
			const resumedSummary = createSummary({ agentId: "cline", taskId: "task-1", state: "running" });
			const clineTaskSessionService = createClineTaskSessionServiceMock();
			clineTaskSessionService.getSummary.mockReturnValue(null);
			clineTaskSessionService.rebindPersistedTaskSession.mockResolvedValue(reboundSummary);
			clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(resumedSummary);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(),
				getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});
			const scope = { workspaceId: "workspace-1", workspacePath };
			await setCardPaused({ workspacePath, taskId: "task-1", paused: true });

			const resumeResponse = await api.resumeTask(scope, { taskId: "task-1" });

			expect(resumeResponse).toMatchObject({
				ok: true,
				pausedTaskIds: [],
				summary: {
					taskId: "task-1",
					paused: false,
				},
			});
			expect(clineTaskSessionService.rebindPersistedTaskSession).toHaveBeenCalledWith("task-1");
			expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
				"task-1",
				"Continue from the paused checkpoint.",
			);
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("blocks project task starts while the swarm stop signal is active", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-swarm-stop-runtime-"));
		try {
			await requestSwarmStop({
				workspacePath,
				reason: "Operator paused the run.",
				now: 123,
			});
			const terminalManager = {
				listSummaries: vi.fn(() => []),
			};
			const clineTaskSessionService = createClineTaskSessionServiceMock();
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => terminalManager as never),
				getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});

			const response = await api.startTaskSession(
				{
					workspaceId: "workspace-1",
					workspacePath,
				},
				{
					taskId: "task-1",
					baseRef: "main",
					prompt: "Continue task",
				},
			);

			expect(response).toMatchObject({
				ok: false,
				summary: null,
				errorCode: "swarm_stopped",
			});
			expect(response.error).toContain("Operator paused the run.");
			expect(terminalManager.listSummaries).not.toHaveBeenCalled();
			expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("returns cline chat messages and sends chat message through cline service", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const latestMessage = {
			id: "message-1",
			role: "user" as const,
			content: "hello",
			createdAt: Date.now(),
		};
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);
		clineTaskSessionService.loadTaskSessionMessages.mockResolvedValue([latestMessage]);
		clineTaskSessionService.getSummary.mockReturnValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const sendResponse = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", text: "hello" },
		);
		expect(sendResponse.ok).toBe(true);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
			"task-1",
			"hello",
			undefined,
			undefined,
		);
		expect(sendResponse.message).toEqual(latestMessage);

		const messagesResponse = await api.getTaskChatMessages(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(messagesResponse.ok).toBe(true);
		expect(messagesResponse.messages).toEqual([latestMessage]);

		clineTaskSessionService.abortTaskSession.mockResolvedValue(summary);
		const abortResponse = await api.abortTaskChatTurn(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(abortResponse.ok).toBe(true);
		expect(clineTaskSessionService.abortTaskSession).toHaveBeenCalledWith("task-1");

		clineTaskSessionService.cancelTaskTurn.mockResolvedValue(summary);
		const cancelResponse = await api.cancelTaskChatTurn(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(cancelResponse.ok).toBe(true);
		expect(clineTaskSessionService.cancelTaskTurn).toHaveBeenCalledWith("task-1");
	});

	it("forwards selected Cline model settings through chat sends", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				data: [
					{
						id: "new-model",
						name: "New Model",
						loaded_context_length: 64_000,
					},
				],
			}),
		})) as unknown as typeof globalThis.fetch;
		setSelectedProviderSettings({
			provider: "lmstudio",
			model: "old-model",
			baseUrl: "http://127.0.0.1:1234/v1",
			apiKey: "local-key",
			reasoning: {
				effort: "high",
			},
		});
		const summary = createSummary({ agentId: "cline", pid: null });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		try {
			const response = await api.sendTaskChatMessage(
				{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
				{
					taskId: "task-1",
					text: "hello",
					providerId: "lmstudio",
					modelId: "new-model",
					reasoningEffort: null,
				},
			);

			expect(response.ok).toBe(true);
			expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
				"task-1",
				"hello",
				undefined,
				undefined,
				{
					providerId: "lmstudio",
					modelId: "new-model",
					apiKey: "local-key",
					baseUrl: "http://127.0.0.1:1234/v1",
					reasoningEffort: null,
					contextWindow: 64_000,
				},
			);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("handles clear slash commands without sending them to the model", async () => {
		const summary = createSummary({ agentId: "cline", pid: null, state: "idle" });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.clearTaskSession.mockResolvedValue(summary);
		const broadcastTaskChatCleared = vi.fn();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			broadcastTaskChatCleared,
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "  /clear  " },
		);

		expect(response).toEqual({
			ok: true,
			summary,
			message: null,
		});
		expect(clineTaskSessionService.clearTaskSession).toHaveBeenCalledWith("__home_agent__:workspace-1");
		expect(broadcastTaskChatCleared).toHaveBeenCalledWith("workspace-1", "__home_agent__:workspace-1");
		expect(clineTaskSessionService.sendTaskSessionInput).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("forwards chat images through the cline service send path", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				taskId: "task-1",
				text: "hello",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			},
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith("task-1", "hello", undefined, [
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);
	});

	it("hydrates persisted cline chat messages when no live in-memory session is loaded", async () => {
		const persistedMessage = {
			id: "message-persisted-1",
			role: "assistant" as const,
			content: "Recovered from SDK artifacts",
			createdAt: Date.now(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.getSummary.mockReturnValue(null);
		clineTaskSessionService.loadTaskSessionMessages.mockResolvedValue([persistedMessage]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getTaskChatMessages(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);

		expect(response.ok).toBe(true);
		expect(response.messages).toEqual([persistedMessage]);
		expect(clineTaskSessionService.loadTaskSessionMessages).toHaveBeenCalledWith("task-1");
	});

	it("reloads a chat session through the Cline task session service", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.reloadTaskSession.mockResolvedValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.reloadTaskChatSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1:cline" },
		);

		expect(response).toEqual({
			ok: true,
			summary,
		});
		expect(clineTaskSessionService.reloadTaskSession).toHaveBeenCalledWith("__home_agent__:workspace-1:cline");
	});

	it("restarts the home chat session from the saved launch config when reload cannot reuse cached config", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.reloadTaskSession.mockResolvedValue(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);
		setSelectedProviderSettings({
			provider: "openrouter",
			model: "openrouter/auto",
			apiKey: "sk-or-test",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: {},
		});

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.reloadTaskChatSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1:cline" },
		);

		expect(response).toMatchObject({
			ok: false,
			summary: null,
			error: expect.stringContaining("No native Cline provider is configured"),
		});
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("rebinds persisted non-home chat sessions before retrying the first send after restart", async () => {
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		const summary = createSummary({ agentId: "cline", pid: null });
		const reboundSummary = createSummary({
			agentId: "cline",
			pid: null,
			workspacePath: "/tmp/repo/.worktrees/task-1",
		});
		const latestMessage = {
			id: "message-rebound-1",
			role: "user" as const,
			content: "continue",
			createdAt: Date.now(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValueOnce(null);
		clineTaskSessionService.rebindPersistedTaskSession.mockResolvedValue(reboundSummary);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", text: "continue" },
		);

		expect(response.ok).toBe(true);
		expect(clineTaskSessionService.rebindPersistedTaskSession).toHaveBeenCalledWith("task-1");
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledTimes(1);
		expect(clineTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
			"task-1",
			"continue",
			undefined,
			undefined,
		);
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				cwd: "/tmp/repo/.worktrees/task-1",
				prompt: "continue",
				resumeFromPersistence: true,
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "anthropic-api-key",
			}),
		);
		expect(response.message).toEqual(latestMessage);
	});

	it("auto-starts home chat sessions when the first message is sent", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const latestMessage = {
			id: "message-home-1",
			role: "user" as const,
			content: "hello home",
			createdAt: Date.now(),
		};
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const runtimeConfigState = createRuntimeConfigState();
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "seed-token",
				refreshToken: "seed-refresh",
				expiresAt: Date.now() + 3_600_000,
			},
		});
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => runtimeConfigState),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "hello home" },
		);

		expect(response).toMatchObject({
			ok: false,
			summary: null,
			error: expect.stringContaining("No native Cline provider is configured"),
		});
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
	});

	it("starts home chat sessions from persisted history with current launch config", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const latestMessage = {
			id: "message-home-rebound-1",
			role: "user" as const,
			content: "continue home",
			createdAt: Date.now(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValueOnce(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);
		clineTaskSessionService.listMessages.mockReturnValue([latestMessage]);
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "seed-token",
				refreshToken: "seed-refresh",
				expiresAt: Date.now() + 3_600_000,
			},
		});

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "continue home" },
		);

		expect(response).toMatchObject({
			ok: false,
			summary: null,
			error: expect.stringContaining("No native Cline provider is configured"),
		});
		expect(clineTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("home chat auto-start keeps manual API key for non-OAuth providers", async () => {
		const summary = createSummary({ agentId: "cline", pid: null });
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const runtimeConfigState = createRuntimeConfigState();
		setSelectedProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-api-key",
			auth: {
				accessToken: "workos:seed-token",
				refreshToken: "seed-refresh",
				expiresAt: Date.now() + 3_600_000,
			},
		});
		clineTaskSessionService.sendTaskSessionInput.mockResolvedValue(null);
		clineTaskSessionService.startTaskSession.mockResolvedValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => runtimeConfigState),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "hello home" },
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(clineTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
	});

	it("returns cline provider catalog and provider models", async () => {
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				return createRuntimeConfigState();
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
		});

		const catalogResponse = await api.getClineProviderCatalog({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});
		expect(catalogResponse.providers.some((provider) => provider.id === "cline")).toBe(false);
		expect(catalogResponse.providers.find((provider) => provider.id === "ollama")?.enabled).toBe(true);

		const modelsResponse = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "ollama" },
		);
		expect(modelsResponse.providerId).toBe("ollama");
		expect(modelsResponse.models.some((model) => model.id === "qwen3.5-9b")).toBe(true);
	});

	it("returns the local model registry snapshot sorted by recency", async () => {
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 40,
			models: {
				"ollama:qwen:local": {
					key: "ollama:qwen:local",
					providerId: "ollama",
					modelId: "qwen",
					endpoint: "local",
					contextWindow: {
						advertised: null,
						observed: 16_000,
						userOverride: null,
						effective: 16_000,
					},
					speed: {
						samples: 2,
						promptTokensEwma: 1_500,
						outputTokensEwma: 75,
						totalTokensEwma: 1_575,
						prefillTokensPerSecondEwma: 800,
						decodeTokensPerSecondEwma: 40,
						ttftMsEwma: 500,
						wallTimeMsEwma: 3_000,
						wallTimeMsPer1kPromptTokensEwma: 2_000,
						lastPromptTokens: 1_000,
						lastOutputTokens: 50,
						lastWallTimeMs: 2_000,
						lastObservedAt: 20,
					},
					capability: {
						samples: 1,
						staticPrior: 35,
						evalScore: null,
						externalScore: null,
						observedPassRate: 1,
						effectiveScore: 68,
						lastObservedAt: 20,
					},
					constraints: {
						sharedEndpointId: "local",
						inputCostPerMillionTokens: null,
						outputCostPerMillionTokens: null,
					},
					createdAt: 10,
					updatedAt: 20,
				},
				"openai-compatible:local:lan": createModelRegistryEntry({
					key: "openai-compatible:local:lan",
					providerId: "openai-compatible",
					modelId: "local",
					endpoint: "http://192.168.1.20:1234/v1",
					contextWindow: 32_000,
					capability: 45,
				}),
				"cline:sonnet:default": {
					key: "cline:sonnet:default",
					providerId: "cline",
					modelId: "sonnet",
					endpoint: null,
					contextWindow: {
						advertised: 200_000,
						observed: null,
						userOverride: null,
						effective: 200_000,
					},
					speed: {
						samples: 1,
						promptTokensEwma: 5_000,
						outputTokensEwma: 400,
						totalTokensEwma: 5_400,
						prefillTokensPerSecondEwma: 2_000,
						decodeTokensPerSecondEwma: 80,
						ttftMsEwma: 300,
						wallTimeMsEwma: 4_000,
						wallTimeMsPer1kPromptTokensEwma: 800,
						lastPromptTokens: 5_000,
						lastOutputTokens: 400,
						lastWallTimeMs: 4_000,
						lastObservedAt: 30,
					},
					capability: {
						samples: 1,
						staticPrior: 80,
						evalScore: null,
						externalScore: null,
						observedPassRate: 1,
						effectiveScore: 90,
						lastObservedAt: 30,
					},
					constraints: {
						sharedEndpointId: "cline:default",
						inputCostPerMillionTokens: null,
						outputCostPerMillionTokens: null,
					},
					createdAt: 5,
					updatedAt: 30,
				},
				"openai-compatible:gpt:remote": createModelRegistryEntry({
					key: "openai-compatible:gpt:remote",
					providerId: "openai-compatible",
					modelId: "gpt",
					endpoint: "https://api.example.com/v1",
					contextWindow: 200_000,
					capability: 85,
				}),
			},
		});
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getClineModelRegistry({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.updatedAt).toBe(40);
		expect(response.models.map((model) => model.key)).toEqual(["ollama:qwen:local", "openai-compatible:local:lan"]);
		expect(response.models[0]?.speed.prefillTokensPerSecondEwma).toBe(800);
		expect(response.models[1]?.contextWindow.effective).toBe(32_000);
	});

	it("includes configured local Cline models before they have registry samples", async () => {
		setSelectedProviderSettings({
			provider: "lmstudio",
			model: "selected-local",
			apiKey: "local-key",
		});
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 40,
			models: {},
		});
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				runtimeConfigState.modelRoles = {
					worker: {
						providerId: "ollama",
						modelId: "role-worker",
					},
					reviewer: {
						providerId: "openai-compatible",
						modelId: "remote-role",
					},
				};
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getClineModelRegistry({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.models.map((model) => model.key).sort()).toEqual([
			"lmstudio:selected-local:default",
			"ollama:role-worker:default",
		]);
		expect(response.models.every((model) => model.speed.samples === 0)).toBe(true);
		expect(response.models.find((model) => model.modelId === "remote-role")).toBeUndefined();
	});

	it("removes a local Cline model registry entry", async () => {
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 40,
			models: {
				"ollama:stale:local": createModelRegistryEntry({
					key: "ollama:stale:local",
					providerId: "ollama",
					modelId: "stale",
					endpoint: "local",
				}),
			},
		});
		modelRegistryMocks.removeEntry.mockResolvedValue(true);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.removeClineModelRegistryEntry(null, { key: "ollama:stale:local" });

		expect(response).toEqual({ removed: true });
		expect(modelRegistryMocks.removeEntry).toHaveBeenCalledWith("ollama:stale:local");
	});

	it("prunes stale local registry entries while keeping configured models", async () => {
		setSelectedProviderSettings({
			provider: "lmstudio",
			model: "configured-model",
			baseUrl: "http://127.0.0.1:1234/v1",
		});
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 40,
			models: {
				"lmstudio:configured-model:http://127.0.0.1:1234/v1": createModelRegistryEntry({
					key: "lmstudio:configured-model:http://127.0.0.1:1234/v1",
					providerId: "lmstudio",
					modelId: "configured-model",
					endpoint: "http://127.0.0.1:1234/v1",
				}),
				"lmstudio:old-model:http://127.0.0.1:1234/v1": createModelRegistryEntry({
					key: "lmstudio:old-model:http://127.0.0.1:1234/v1",
					providerId: "lmstudio",
					modelId: "old-model",
					endpoint: "http://127.0.0.1:1234/v1",
				}),
				"lmstudio:stale-model:http://127.0.0.1:1234/v1": createModelRegistryEntry({
					key: "lmstudio:stale-model:http://127.0.0.1:1234/v1",
					providerId: "lmstudio",
					modelId: "stale-model",
					endpoint: "http://127.0.0.1:1234/v1",
				}),
			},
		});
		modelRegistryMocks.removeEntries.mockResolvedValue(2);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "cline";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.pruneClineModelRegistry({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response).toEqual({ removed: 2 });
		expect(modelRegistryMocks.removeEntries).toHaveBeenCalledWith([
			"lmstudio:old-model:http://127.0.0.1:1234/v1",
			"lmstudio:stale-model:http://127.0.0.1:1234/v1",
		]);
	});

	it("returns Cline code intelligence status for the workspace", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-code-intelligence-status-"));
		mkdirSync(join(workspacePath, "src"), { recursive: true });
		writeFileSync(
			join(workspacePath, "src", "status.ts"),
			["export function statusSymbol() {", '  return "ready";', "}"].join("\n"),
			"utf8",
		);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getClineCodeIntelligenceStatus({
			workspaceId: "workspace-1",
			workspacePath,
		});

		expect(response.repoMap.available).toBe(true);
		expect(response.repoMap.filesScanned).toBe(1);
		expect(response.repoMap.symbols).toBeGreaterThan(0);
		expect(response.codeIndex.totalFiles).toBe(1);
		expect(response.codeIndex.totalChunks).toBe(1);
		expect(response.codeIndex.cacheExists).toBe(false);
		expect(response.codeEmbeddingSettings.source).toBe("global");
		expect(response.codeEmbeddingSettings.effective.provider).toBe("local_lexical");
		expect(response.codeIndex.searchAvailable).toBe(false);
	});

	it("collects a task evidence bundle and copyable prompt block", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-task-evidence-workspace-"));
		const evidenceRoot = mkdtempSync(join(tmpdir(), "kanban-task-evidence-"));
		const tempHome = mkdtempSync(join(tmpdir(), "kanban-task-evidence-home-"));
		const originalHome = process.env.HOME;
		const originalUserProfile = process.env.USERPROFILE;

		try {
			process.env.HOME = tempHome;
			process.env.USERPROFILE = tempHome;
			execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
			const board: RuntimeBoardData = {
				columns: [
					{
						id: "backlog",
						title: "Backlog",
						cards: [
							{
								id: "task-1",
								title: "Fix local model timeout",
								prompt: "Acceptance check: npm test",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 2,
							},
						],
					},
					{ id: "in_progress", title: "In Progress", cards: [] },
					{ id: "review", title: "Review", cards: [] },
					{ id: "trash", title: "Done", cards: [] },
				],
				dependencies: [],
			};
			await saveWorkspaceState(workspacePath, { board, sessions: {} });
			const clineTaskSessionService = createClineTaskSessionServiceMock();
			clineTaskSessionService.listMessages.mockReturnValue([
				{
					id: "message-1",
					role: "assistant",
					content: "The timeout failed.",
					createdAt: 10,
				},
			]);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => ({}) as never),
				getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
				getEvidenceBundleRoot: () => evidenceRoot,
			});
			const response = await api.collectTaskEvidence(
				{ workspaceId: "workspace-1", workspacePath },
				{ taskId: "task-1" },
			);

			expect(response.bundlePath).toContain(evidenceRoot);
			expect(response.promptBlock).toContain("Here is evidence from a !Klein task.");
			expect(response.promptBlock).toContain("Fix local model timeout");
			expect(response.promptBlock).toContain(response.bundlePath);
			expect(existsSync(join(response.bundlePath, "summary.md"))).toBe(true);
			expect(existsSync(join(response.bundlePath, "config-snapshot.json"))).toBe(true);
			expect(readFileSync(join(response.bundlePath, "summary.md"), "utf8")).toContain("Acceptance check: npm test");
			expect(readFileSync(join(response.bundlePath, "transcript", "01-task-1.json"), "utf8")).toContain(
				"The timeout failed.",
			);
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
			if (originalUserProfile === undefined) {
				delete process.env.USERPROFILE;
			} else {
				process.env.USERPROFILE = originalUserProfile;
			}
		}
	});

	it("builds a model freshness advisor request from the runtime model registry", async () => {
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 40,
			models: {
				"ollama:qwen:local": {
					key: "ollama:qwen:local",
					providerId: "ollama",
					modelId: "qwen",
					endpoint: "http://127.0.0.1:11434",
					contextWindow: {
						advertised: 16_000,
						observed: null,
						userOverride: null,
						effective: 16_000,
					},
					speed: {
						samples: 1,
						promptTokensEwma: 2_000,
						outputTokensEwma: 100,
						totalTokensEwma: 2_100,
						prefillTokensPerSecondEwma: 500,
						decodeTokensPerSecondEwma: 40,
						ttftMsEwma: 500,
						wallTimeMsEwma: 3_000,
						wallTimeMsPer1kPromptTokensEwma: 1_500,
						lastPromptTokens: 2_000,
						lastOutputTokens: 100,
						lastWallTimeMs: 3_000,
						lastObservedAt: 40,
					},
					capability: {
						samples: 1,
						staticPrior: 35,
						evalScore: 70,
						externalScore: null,
						observedPassRate: 1,
						effectiveScore: 70,
						lastObservedAt: 40,
					},
					constraints: {
						sharedEndpointId: "ollama:local",
						inputCostPerMillionTokens: null,
						outputCostPerMillionTokens: null,
					},
					createdAt: 20,
					updatedAt: 40,
				},
			},
		});
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.buildClineModelFreshnessAdvisor({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.kind).toBe("model_freshness");
		expect(response.requiresWebResearch).toBe(true);
		expect(response.recommendedSources).toContain("https://openrouter.ai/models");
		expect(response.prompt).toContain("ollama:qwen");
		expect(response.prompt).toContain("16,000 tokens");
		expect(response.prompt).toContain("70/100 capability");
	});

	it("builds generic advisor requests with workspace context", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.buildClineAdvisor(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				kind: "mcp_discovery",
				repoSummary: "TypeScript desktop app",
			},
		);

		expect(response.kind).toBe("mcp_discovery");
		expect(response.requiresWebResearch).toBe(true);
		expect(response.recommendedSources).toContain("https://mcp.so/");
		expect(response.prompt).toContain("Workspace: /tmp/repo");
		expect(response.prompt).toContain("TypeScript desktop app");
	});

	it("sends advisor prompts to the selected local Cline model", async () => {
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
			apiKey: "local-key",
		});
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => {
			return new Response(
				JSON.stringify({
					message: { content: "Use local Qwen for this advisor request." },
				}),
				{ status: 200 },
			);
		});
		vi.stubGlobal("fetch", fetchMock);
		try {
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => ({}) as never),
				getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});

			const response = await api.sendClineAdvisor(null, {
				prompt: "Explain this config.",
				providerId: "ollama",
				modelId: "qwen3.5-9b",
			});

			expect(response.providerId).toBe("ollama");
			expect(response.modelId).toBe("qwen3.5-9b");
			expect(response.output).toBe("Use local Qwen for this advisor request.");
			expect(response.receivedAt).toBeGreaterThanOrEqual(response.sentAt);
			expect(fetchMock).toHaveBeenCalledWith(
				"http://127.0.0.1:11434/api/chat",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						authorization: "Bearer local-key",
						"content-type": "application/json",
					}),
					body: expect.stringContaining('"model":"qwen3.5-9b"'),
				}),
			);
			const request = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string) as {
				messages: Array<{ role: string; content: string }>;
			};
			expect(request.messages).toEqual([{ role: "user", content: "Explain this config." }]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("writes dogfood backlog artifacts for the active workspace", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-runtime-dogfood-workspace-"));
		const telemetryRoot = mkdtempSync(join(tmpdir(), "kanban-runtime-dogfood-telemetry-"));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			getDogfoodTelemetryRoot: vi.fn(() => telemetryRoot),
		});

		const response = await api.writeClineDogfoodBacklog(
			{
				workspaceId: "workspace-1",
				workspacePath,
			},
			{
				slug: "runtime-dogfood",
				suggestion: "Improve stalled task diagnostics.",
			},
		);

		expect(response.slug).toBe("runtime-dogfood");
		expect(response.taskCount).toBe(1);
		expect(response.nextCommand).toContain("nklein task decompose --slug runtime-dogfood");
		expect(existsSync(response.questionsPath)).toBe(true);
		expect(existsSync(response.decisionsPath)).toBe(true);
		expect(existsSync(response.revisionsPath)).toBe(true);
		expect(existsSync(response.summaryPath)).toBe(true);
		expect(existsSync(response.taskGraphPath)).toBe(true);
	});

	it("runs the Cline smoke eval for the selected provider and model", async () => {
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
		});
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.runClineSmokeEval({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(evalHarnessMocks.runClineDevSmokeEval).toHaveBeenCalledWith({
			modelObservation: {
				providerId: "ollama",
				modelId: "qwen3.5-9b",
				endpoint: "http://127.0.0.1:11434",
			},
		});
		expect(response).toMatchObject({
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			evidenceBundlePath: "/tmp/eval-evidence",
			passed: true,
		});
	});

	it("loads provider models through the SDK local-provider resolver with saved config", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "ollama",
			models: [
				{
					id: "qwen3.5-9b",
					name: "Qwen 3.5 9B",
					supportsReasoning: true,
				},
			],
		});

		const response = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "ollama" },
		);

		expect(localProviderMocks.getLocalProviderModels).toHaveBeenCalledWith(
			"ollama",
			expect.objectContaining({
				providerId: "ollama",
				modelId: "qwen3.5-9b",
				baseUrl: "http://127.0.0.1:11434",
			}),
		);
		expect(response).toEqual({
			providerId: "ollama",
			models: [
				{
					id: "qwen3.5-9b",
					name: "Qwen 3.5 9B",
					supportsReasoningEffort: true,
				},
			],
		});
	});

	it("adds refreshed live catalog models to provider model responses", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "deepseek",
			model: "deepseek-chat",
			apiKey: "deepseek-key",
			baseUrl: "http://127.0.0.1:4000/v1",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "deepseek",
			models: [
				{
					id: "deepseek-chat",
					name: "DeepSeek Chat",
				},
			],
		});
		llmsModelMocks.resolveProviderConfig.mockResolvedValue({
			knownModels: {
				"deepseek-v4-pro": {
					id: "deepseek-v4-pro",
					name: "DeepSeek V4 Pro",
					capabilities: ["tools", "reasoning"],
				},
			},
		});

		const response = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "deepseek" },
		);

		expect(llmsModelMocks.resolveProviderModelCatalogKeys).toHaveBeenCalledWith("deepseek");
		expect(llmsModelMocks.resolveProviderConfig).toHaveBeenCalledWith(
			"deepseek",
			expect.objectContaining({
				loadLatestOnInit: true,
				loadPrivateOnAuth: true,
				failOnError: false,
			}),
			expect.objectContaining({
				providerId: "deepseek",
				modelId: "deepseek-chat",
				apiKey: "deepseek-key",
				baseUrl: "http://127.0.0.1:4000/v1",
			}),
		);
		expect(response.models).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "deepseek-v4-pro",
					name: "DeepSeek V4 Pro",
					supportsReasoningEffort: true,
				}),
				expect.objectContaining({
					id: "deepseek-chat",
					name: "DeepSeek Chat",
				}),
			]),
		);
	});

	it("does not load managed Cline provider models in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			model: "anthropic/claude-sonnet-4.6",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "cline",
			models: [
				{
					id: "anthropic/claude-sonnet-4.6",
					name: "Claude Sonnet 4.6",
				},
			],
		});
		llmsModelMocks.resolveProviderConfig.mockImplementation((providerId: string) =>
			providerId === "openrouter"
				? Promise.resolve({
						knownModels: {
							"deepseek/deepseek-v4-flash": {
								id: "deepseek/deepseek-v4-flash",
								name: "DeepSeek V4 Flash",
								capabilities: ["tools", "reasoning"],
							},
						},
					})
				: Promise.resolve(undefined),
		);

		const response = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "cline" },
		);

		expect(response).toEqual({ providerId: "cline", models: [] });
		expect(llmsModelMocks.resolveProviderModelCatalogKeys).not.toHaveBeenCalled();
		expect(llmsModelMocks.resolveProviderConfig).not.toHaveBeenCalled();
	});

	it("falls back to the queried provider's saved model when provider model loading fails", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		oauthMocks.getLastUsedProviderSettings.mockReturnValue({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-key",
		});
		oauthMocks.getProviderSettings.mockImplementation((providerId: string) => {
			if (providerId === "anthropic") {
				return {
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					apiKey: "anthropic-key",
				};
			}
			if (providerId === "openrouter") {
				return {
					provider: "openrouter",
					model: "openrouter/free",
					apiKey: "openrouter-key",
					baseUrl: "https://openrouter.ai/api/v1",
				};
			}
			return undefined;
		});
		localProviderMocks.getLocalProviderModels.mockRejectedValue(new Error("catalog unavailable"));

		const response = await api.getClineProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "openrouter" },
		);

		expect(response).toEqual({ providerId: "openrouter", models: [] });
	});

	it("adds a custom OpenAI-compatible provider through the SDK-backed flow", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		llmsModelMocks.getAllProviders.mockResolvedValue([
			{
				id: "cline",
				name: "Cline",
				defaultModelId: "claude-sonnet-4-6",
				capabilities: ["oauth"],
			},
		]);
		oauthMocks.addLocalProvider.mockImplementation(async (_manager: unknown, request: Record<string, unknown>) => {
			oauthMocks.getProviderSettings.mockImplementation((providerId: string) =>
				providerId === request.providerId
					? {
							provider: request.providerId,
							model: request.defaultModelId,
							apiKey: request.apiKey,
							baseUrl: request.baseUrl,
						}
					: undefined,
			);
			return {
				providerId: request.providerId,
				settingsPath: "/tmp/providers.json",
				modelsPath: "/tmp/models.json",
				modelsCount: 1,
			};
		});

		const response = await api.addClineProvider(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				providerId: "my-provider",
				name: "My Provider",
				baseUrl: "http://localhost:8000/v1",
				apiKey: "secret-key",
				models: ["qwen2.5-coder:32b"],
				defaultModelId: "qwen2.5-coder:32b",
				capabilities: ["tools", "streaming"],
			},
		);

		expect(response).toEqual(
			expect.objectContaining({
				providerId: "my-provider",
				modelId: "qwen2.5-coder:32b",
				baseUrl: "http://localhost:8000/v1",
				apiKeyConfigured: true,
			}),
		);
		expect(oauthMocks.addLocalProvider).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				providerId: "my-provider",
				name: "My Provider",
				baseUrl: "http://localhost:8000/v1",
				apiKey: "secret-key",
				models: ["qwen2.5-coder:32b"],
				defaultModelId: "qwen2.5-coder:32b",
				capabilities: ["tools", "streaming"],
			}),
		);
		expect(oauthMocks.ensureCustomProvidersLoaded).toHaveBeenCalled();
		expect(oauthMocks.saveProviderSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "my-provider",
				model: "qwen2.5-coder:32b",
				apiKey: "secret-key",
				baseUrl: "http://localhost:8000/v1",
			}),
			expect.objectContaining({
				tokenSource: "manual",
				setLastUsed: true,
			}),
		);
	});

	it("does not fetch cline account profile in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const response = await api.getClineAccountProfile({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.profile).toBeNull();
		expect(clineAccountMocks.constructedOptions).toHaveLength(0);
		expect(clineAccountMocks.fetchMe).not.toHaveBeenCalled();
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
	});

	it("does not refresh cline OAuth credentials for profile lookup in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		clineAccountMocks.fetchMe
			.mockRejectedValueOnce(new Error("Cline account request failed with status 401"))
			.mockResolvedValueOnce({
				id: "acct-1",
				email: "saoud@example.com",
				displayName: "Saoud",
			});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:expired-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const response = await api.getClineAccountProfile({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.profile).toBeNull();
		expect(clineAccountMocks.fetchMe).not.toHaveBeenCalled();
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
	});

	it("does not fetch cline remote config in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		clineAccountMocks.fetchRemoteConfig.mockResolvedValueOnce({
			organizationId: "org-1",
			enabled: true,
			value: JSON.stringify({
				kanbanEnabled: false,
			}),
		});

		clineAccountMocks.fetchOrganization.mockResolvedValueOnce({
			externalOrganizationId: "test",
		});

		const response = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.enabled).toBe(true);
		expect(clineAccountMocks.fetchRemoteConfig).not.toHaveBeenCalled();
	});

	it("keeps kanban enabled without cline remote config in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		clineAccountMocks.fetchRemoteConfig
			.mockResolvedValueOnce({
				organizationId: "org-1",
				enabled: true,
				value: JSON.stringify({
					kanbanEnabled: false,
				}),
			})
			.mockRejectedValueOnce(new Error("remote config request failed"));

		clineAccountMocks.fetchOrganization.mockResolvedValueOnce({
			externalOrganizationId: "test",
		});

		const initialResponse = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});
		const failedFetchResponse = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(initialResponse.enabled).toBe(true);
		expect(failedFetchResponse.enabled).toBe(true);
		expect(clineAccountMocks.fetchRemoteConfig).not.toHaveBeenCalled();
	});

	it("allows kanban by default for non-cline providers", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-api-key",
		});

		const response = await api.getClineKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.enabled).toBe(true);
		expect(clineAccountMocks.fetchRemoteConfig).not.toHaveBeenCalled();
	});

	it("blocks cline oauth login in local-only mode", async () => {
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const clineTaskSessionService = createClineTaskSessionServiceMock();
		const bumpClineSessionContextVersion = vi.fn();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedClineTaskSessionService: vi.fn(async () => clineTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpClineSessionContextVersion,
		});

		const response = await api.runClineProviderOAuthLogin(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ provider: "cline" },
		);
		expect(response.ok).toBe(false);
		expect(response.provider).toBe("cline");
		expect(response.error).toContain("Cloud models are disabled");
		expect(oauthMocks.saveProviderSettings).not.toHaveBeenCalled();
		expect(oauthMocks.loginClineOAuth).not.toHaveBeenCalled();
		expect(bumpClineSessionContextVersion).not.toHaveBeenCalled();
	});

	it("bumps cline session context when provider settings are saved", async () => {
		const bumpClineSessionContextVersion = vi.fn();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpClineSessionContextVersion,
		});
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
		});

		const response = await api.saveClineProviderSettings(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				providerId: "ollama",
				modelId: "qwen3.5-9b",
			},
		);

		expect(response.providerId).toBe("ollama");
		expect(bumpClineSessionContextVersion).toHaveBeenCalledTimes(1);
	});

	it("returns Cline MCP settings", async () => {
		writeFileSync(
			mcpSettingsPath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							type: "streamableHttp",
							url: "https://mcp.linear.app/mcp",
							disabled: false,
						},
					},
				},
				null,
				2,
			),
		);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getClineMcpSettings({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.path).toBe(mcpSettingsPath);
		expect(response.servers).toEqual([
			{
				name: "linear",
				disabled: false,
				type: "streamableHttp",
				url: "https://mcp.linear.app/mcp",
			},
		]);
	});

	it("saves Cline MCP settings", async () => {
		const bumpClineSessionContextVersion = vi.fn();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpClineSessionContextVersion,
		});

		const response = await api.saveClineMcpSettings(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			},
			{
				servers: [
					{
						name: "linear",
						disabled: false,
						type: "streamableHttp",
						url: "https://mcp.linear.app/mcp",
					},
				],
			},
		);

		expect(response.path).toBe(mcpSettingsPath);
		expect(response.servers).toEqual([
			{
				name: "linear",
				disabled: false,
				type: "streamableHttp",
				url: "https://mcp.linear.app/mcp",
			},
		]);
		expect(bumpClineSessionContextVersion).toHaveBeenCalledTimes(1);
	});

	it("returns MCP auth statuses from persisted OAuth settings", async () => {
		writeFileSync(
			mcpSettingsPath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							type: "streamableHttp",
							url: "https://mcp.linear.app/mcp",
						},
						filesystem: {
							type: "stdio",
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
						},
					},
				},
				null,
				2,
			),
		);
		writeFileSync(
			mcpOauthSettingsPath,
			JSON.stringify(
				{
					servers: {
						linear: {
							tokens: {
								access_token: "token-1",
								token_type: "Bearer",
							},
							lastAuthenticatedAt: 1_700_000_000_000,
						},
					},
				},
				null,
				2,
			),
		);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getClineMcpAuthStatuses({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.statuses).toEqual([
			{
				serverName: "filesystem",
				oauthSupported: false,
				oauthConfigured: false,
				lastError: null,
				lastAuthenticatedAt: null,
			},
			{
				serverName: "linear",
				oauthSupported: true,
				oauthConfigured: true,
				lastError: null,
				lastAuthenticatedAt: 1_700_000_000_000,
			},
		]);
	});

	it("rejects MCP OAuth flow for stdio servers", async () => {
		writeFileSync(
			mcpSettingsPath,
			JSON.stringify(
				{
					mcpServers: {
						filesystem: {
							type: "stdio",
							command: "npx",
							args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
						},
					},
				},
				null,
				2,
			),
		);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		await expect(
			api.runClineMcpServerOAuth(
				{
					workspaceId: "workspace-1",
					workspacePath: "/tmp/repo",
				},
				{
					serverName: "filesystem",
				},
			),
		).rejects.toThrow("does not support OAuth browser flow");
	});

	it("runs reset teardown before deleting debug state paths", async () => {
		const originalHome = process.env.HOME;
		const tempHome = `/tmp/kanban-reset-home-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		process.env.HOME = tempHome;
		mkdirSync(tempHome, { recursive: true });
		const debugPaths = [
			join(tempHome, ".cline", "data"),
			join(tempHome, ".cline", "nklein"),
			join(tempHome, ".cline", "worktrees"),
		];
		for (const path of debugPaths) {
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, "marker.txt"), "present");
		}
		const prepareForStateReset = vi.fn(async () => {
			for (const path of debugPaths) {
				expect(existsSync(path)).toBe(true);
			}
		});
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			prepareForStateReset,
		});

		try {
			const response = await api.resetAllState(null);

			expect(response.ok).toBe(true);
			expect(prepareForStateReset).toHaveBeenCalledTimes(1);
			for (const path of debugPaths) {
				expect(existsSync(path)).toBe(false);
			}
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
			rmSync(tempHome, { recursive: true, force: true });
		}
	});

	it("aborts reset path deletion when teardown fails", async () => {
		const originalHome = process.env.HOME;
		const tempHome = `/tmp/kanban-reset-home-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		process.env.HOME = tempHome;
		mkdirSync(tempHome, { recursive: true });
		const debugPaths = [
			join(tempHome, ".cline", "data"),
			join(tempHome, ".cline", "nklein"),
			join(tempHome, ".cline", "worktrees"),
		];
		for (const path of debugPaths) {
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, "marker.txt"), "present");
		}
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			prepareForStateReset: vi.fn(async () => {
				throw new Error("teardown failed");
			}),
		});

		try {
			await expect(api.resetAllState(null)).rejects.toThrow("teardown failed");
			for (const path of debugPaths) {
				expect(existsSync(path)).toBe(true);
			}
		} finally {
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
			rmSync(tempHome, { recursive: true, force: true });
		}
	});
});

describe("createRuntimeApi getFeaturebaseToken", () => {
	const originalProviderSelectionPath = process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH;

	beforeEach(() => {
		providerSelectionPath = `/tmp/kanban-featurebase-provider-selection-${Date.now()}-${Math.random()
			.toString(16)
			.slice(2)}.json`;
		process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH = providerSelectionPath;
		oauthMocks.getProviderSettings.mockReset();
		oauthMocks.getLastUsedProviderSettings.mockReset();
		oauthMocks.getValidClineCredentials.mockReset();
		oauthMocks.saveProviderSettings.mockReset();
		clineAccountMocks.fetchFeaturebaseToken.mockReset();
		clineAccountMocks.constructedOptions.length = 0;
	});

	afterEach(() => {
		rmSync(providerSelectionPath, { force: true });
		providerSelectionPath = "";
		if (originalProviderSelectionPath === undefined) {
			delete process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH;
		} else {
			process.env.KANBAN_CLINE_PROVIDER_SELECTION_PATH = originalProviderSelectionPath;
		}
	});

	it("does not fetch Featurebase JWT in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		clineAccountMocks.fetchFeaturebaseToken.mockResolvedValueOnce({
			featurebaseJwt: "jwt-token-123",
		});

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("No provider settings configured.");
		expect(clineAccountMocks.fetchFeaturebaseToken).not.toHaveBeenCalled();
	});

	it("throws when no provider settings configured", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings(null);

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("No provider settings configured.");
	});

	it("throws when provider is not cline", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "oca",
			auth: {
				accessToken: "some-token",
				refreshToken: "some-refresh",
			},
		});

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("No provider settings configured.");
	});

	it("does not refresh OAuth for Featurebase in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "cline",
			auth: {
				accessToken: "workos:stale-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		// First attempt fails (e.g. expired token)
		clineAccountMocks.fetchFeaturebaseToken.mockRejectedValueOnce(new Error("Unauthorized"));

		// OAuth refresh returns fresh credentials
		oauthMocks.getValidClineCredentials.mockResolvedValueOnce({
			access: "fresh-access",
			refresh: "fresh-refresh",
			expires: 1_800_000_000_000,
			accountId: "acct-1",
		});

		// Second attempt succeeds with refreshed token
		clineAccountMocks.fetchFeaturebaseToken.mockResolvedValueOnce({
			featurebaseJwt: "refreshed-jwt-456",
		});

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("No provider settings configured.");
		expect(clineAccountMocks.fetchFeaturebaseToken).not.toHaveBeenCalled();
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
	});
});

describe("createRuntimeApi update handlers", () => {
	it("delegates update status to the required dependency", async () => {
		const getUpdateStatus = vi.fn(() => ({
			currentVersion: "0.1.0",
			latestVersion: "0.2.0",
			updateAvailable: true,
			updateTiming: "startup" as const,
			installCommand: "npm install -g kanban@latest",
		}));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			getUpdateStatus,
		});

		await expect(api.getUpdateStatus(null)).resolves.toEqual({
			currentVersion: "0.1.0",
			latestVersion: "0.2.0",
			updateAvailable: true,
			updateTiming: "startup",
			installCommand: "npm install -g kanban@latest",
		});
		expect(getUpdateStatus).toHaveBeenCalledTimes(1);
	});

	it("delegates update execution to the required dependency", async () => {
		const runUpdateNow = vi.fn(async () => ({
			status: "updated" as const,
			currentVersion: "0.1.0",
			latestVersion: "0.2.0",
			message: "Updated !Klein to 0.2.0.",
		}));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedClineTaskSessionService: vi.fn(async () => createClineTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			runUpdateNow,
		});

		await expect(api.runUpdateNow(null)).resolves.toEqual({
			status: "updated",
			currentVersion: "0.1.0",
			latestVersion: "0.2.0",
			message: "Updated !Klein to 0.2.0.",
		});
		expect(runUpdateNow).toHaveBeenCalledTimes(1);
	});
});
