import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "../../../src/core/api-contract";
import { readPausedTasks, setCardPaused } from "../../../src/core/card-pause";
import { requestSwarmStop } from "../../../src/core/swarm-guardrails";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import { loadWorkspaceState, saveWorkspaceState } from "../../../src/state/workspace-state";

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
	runNKleinDevSmokeEval: vi.fn(),
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
	resolveClineDataDir: vi.fn(() => "/tmp/nklein"),
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

const nkleinAccountMocks = vi.hoisted(() => ({
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
	// Tests run with an isolated empty HOME, so loading the (fresh) global config reaches the agent auto-select path;
	// stub detection as "nothing installed" → it falls back to the default agent id.
	detectInstalledCommands: () => [],
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

vi.mock("@cline/sdk", () => ({
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
			nkleinAccountMocks.constructedOptions.push(options);
		}
		fetchMe = nkleinAccountMocks.fetchMe;
		fetchRemoteConfig = nkleinAccountMocks.fetchRemoteConfig;
		fetchOrganization = nkleinAccountMocks.fetchOrganization;
		fetchFeaturebaseToken = nkleinAccountMocks.fetchFeaturebaseToken;
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
		NKLEIN_DEFAULT_MODEL: "anthropic/claude-sonnet-4.6",
		getAllProviders: llmsModelMocks.getAllProviders,
		getModelsForProvider: llmsModelMocks.getModelsForProvider,
	},
}));

vi.mock("../../../src/server/browser.js", () => ({
	openInBrowser: browserMocks.openInBrowser,
}));

vi.mock("../../../src/nklein-agent/nklein-model-registry.js", () => ({
	buildNKleinModelRegistryKey: (input: { providerId: string; modelId: string; endpoint?: string | null }) =>
		`${input.providerId.trim().toLowerCase()}:${input.modelId.trim()}:${input.endpoint?.trim() || "default"}`,
	createNKleinModelRegistryEntry: (input: { providerId: string; modelId: string; endpoint?: string | null }) => {
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
				maxConcurrentRequests: null,
			},
			createdAt: 1,
			updatedAt: 1,
		};
	},
	getDefaultNKleinModelRegistry: () => ({
		getSnapshot: modelRegistryMocks.getSnapshot,
		removeEntry: modelRegistryMocks.removeEntry,
		removeEntries: modelRegistryMocks.removeEntries,
	}),
}));

vi.mock("../../../src/nklein-agent/nklein-eval-harness.js", () => ({
	runNKleinDevSmokeEval: evalHarnessMocks.runNKleinDevSmokeEval,
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
	deps: Omit<CreateRuntimeApiDependencies, "getUpdateStatus" | "runUpdateNow" | "getActiveWorkspacePath"> &
		Partial<Pick<CreateRuntimeApiDependencies, "getUpdateStatus" | "runUpdateNow" | "getActiveWorkspacePath">>,
): RuntimeTrpcContext["runtimeApi"] {
	return createRuntimeApi({
		...deps,
		// No active workspace by default ⇒ chat stays on the plain completion path (todo §5.M G3a); tests that need
		// the tool-using path can pass their own getActiveWorkspacePath.
		getActiveWorkspacePath: deps.getActiveWorkspacePath ?? (() => null),
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
}): NKleinModelRegistryEntry {
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
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

function createRuntimeConfigState(): RuntimeConfigState {
	return {
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
		developerModeEnabled: false,
		replayCardsEnabled: false,
		knowsTodayEnabled: false,
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
		maxConcurrentTasksOverride: null,
		effectiveMaxConcurrentTasks: 3,
		selectedAgentIdOverride: null,
		effectiveSelectedAgentId: "nklein",
		sandboxMaxContainers: 1,
		sandboxAgentsPerContainer: 0,
		sandboxMemoryPerContainerMb: 4096,
		sandboxCpusPerContainer: 2,
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
		nklein: [
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

function restoreEnvVar(name: "NKLEIN_API_KEY" | "OCA_API_KEY", value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

/**
 * Run `body` with a guaranteed restore of the named process-env keys, even if `body` throws.
 *
 * This is the isolation harness for the residency/suitability gates, which can only be armed by MUTATING
 * process-wide env: `delete process.env.VITEST` flips EVERY VITEST-gated branch (residencyCheckEnabled,
 * modelDiscoveryCacheTtlMs, …) for the whole runner until restored, so a leak here would silently turn
 * sibling tests' residency checks live (real network) or re-enable the discovery cache. Each key's ORIGINAL
 * value is captured up front and restored exactly in `finally`: an absent key is deleted again, a set key
 * is reassigned to its captured string (no `""`/undefined confusion). Mutate only via the supplied setter.
 */
async function withEnvRestored<T>(
	keys: readonly string[],
	mutate: (setEnv: (key: string, value: string | undefined) => void) => void,
	body: () => Promise<T>,
): Promise<T> {
	const original = new Map<string, string | undefined>();
	for (const key of keys) {
		original.set(key, process.env[key]);
	}
	const setEnv = (key: string, value: string | undefined): void => {
		if (value === undefined) {
			delete process.env[key];
			return;
		}
		process.env[key] = value;
	};
	mutate(setEnv);
	try {
		return await body();
	} finally {
		for (const [key, value] of original) {
			setEnv(key, value);
		}
	}
}

function createNKleinTaskSessionServiceMock() {
	return {
		startTaskSession: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary>>(async () =>
			createSummary({ agentId: "nklein", pid: null }),
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
		verifyTaskAcceptanceInSandbox: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
			present: true,
			command: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
			durationMs: 1,
		})),
		resumePausedTasks: vi.fn<(...args: unknown[]) => Promise<RuntimeTaskSessionSummary[]>>(async () => []),
		dispose: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
	};
}

describe("createRuntimeApi startTaskSession", () => {
	const originalNKleinApiKey = process.env.NKLEIN_API_KEY;
	const originalOcaApiKey = process.env.OCA_API_KEY;
	const originalNKleinMcpSettingsPath = process.env.NKLEIN_MCP_SETTINGS_PATH;
	const originalNKleinMcpOauthSettingsPath = process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH;
	const originalProviderSelectionPath = process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH;
	// Captured once so the afterEach tripwire can prove the residency test (T1) restored VITEST. The runner
	// always sets VITEST (it is what keeps residencyCheckEnabled false suite-wide), so a leak ⇒ this is undefined.
	const originalVitest = process.env.VITEST;
	let mcpSettingsPath = "";
	let mcpOauthSettingsPath = "";

	beforeEach(() => {
		mcpSettingsPath = `/tmp/kanban-mcp-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		mcpOauthSettingsPath = `/tmp/kanban-mcp-oauth-settings-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		providerSelectionPath = `/tmp/kanban-provider-selection-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
		process.env.NKLEIN_MCP_SETTINGS_PATH = mcpSettingsPath;
		process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH = mcpOauthSettingsPath;
		process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH = providerSelectionPath;
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
		nkleinAccountMocks.fetchMe.mockReset();
		nkleinAccountMocks.fetchRemoteConfig.mockReset();
		nkleinAccountMocks.constructedOptions.length = 0;
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
		evalHarnessMocks.runNKleinDevSmokeEval.mockReset();
		evalHarnessMocks.runNKleinDevSmokeEval.mockResolvedValue({
			workspacePath: "/tmp/eval-workspace",
			evidenceBundlePath: "/tmp/eval-evidence",
			acceptanceCommand: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
		});
		llmsModelMocks.resolveProviderModelCatalogKeys.mockImplementation((providerId: string) =>
			providerId === "nklein" ? ["openrouter", "nklein"] : [providerId],
		);
		oauthMocks.resolveDefaultMcpSettingsPath.mockReturnValue(mcpSettingsPath);
		oauthMocks.loadMcpSettingsFile.mockReturnValue({
			mcpServers: {},
		});
		nkleinAccountMocks.fetchMe.mockResolvedValue({
			id: "acct-1",
			email: "saoud@example.com",
			displayName: "Saoud",
		});
		nkleinAccountMocks.fetchRemoteConfig.mockResolvedValue({
			organizationId: "org-1",
			enabled: true,
			value: JSON.stringify({
				kanbanEnabled: true,
			}),
		});
		setSelectedProviderSettings(null);
		llmsModelMocks.getAllProviders.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
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
			if (providerId !== "nklein") {
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
		// Tripwire for the residency test (T1): if its delete-of-VITEST ever leaks past withEnvRestored, VITEST
		// would be undefined here and every later test's residency check would silently go live. Fail loud instead.
		expect(process.env.VITEST).toBe(originalVitest);
		restoreEnvVar("NKLEIN_API_KEY", originalNKleinApiKey);
		restoreEnvVar("OCA_API_KEY", originalOcaApiKey);
		if (originalNKleinMcpSettingsPath === undefined) {
			delete process.env.NKLEIN_MCP_SETTINGS_PATH;
		} else {
			process.env.NKLEIN_MCP_SETTINGS_PATH = originalNKleinMcpSettingsPath;
		}
		if (originalNKleinMcpOauthSettingsPath === undefined) {
			delete process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH;
		} else {
			process.env.NKLEIN_MCP_OAUTH_SETTINGS_PATH = originalNKleinMcpOauthSettingsPath;
		}
		if (originalProviderSelectionPath === undefined) {
			delete process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH;
		} else {
			process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH = originalProviderSelectionPath;
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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

	it("loads task diagnostics scoped to the active workspace", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		await api.getTaskDiagnostics(
			{
				workspaceId: "workspace-1",
				workspacePath: "/tmp/project-a",
			},
			{
				taskId: "shared-task",
				limit: 7,
			},
		);

		expect(selfObservationMocks.readSelfObservationEvents).toHaveBeenCalledWith({
			taskId: "shared-task",
			workspacePath: "/tmp/project-a",
			limit: 7,
		});
	});

	it("verifies task acceptance through the scoped NKlein sandbox service", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-acceptance-workspace-"));
		try {
			execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
			const board: RuntimeBoardData = {
				columns: [
					{
						id: "backlog",
						title: "Backlog",
						cards: [
							{
								id: "task-acceptance",
								title: "Verify acceptance",
								prompt: "Acceptance check: npm test",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{ id: "planning", title: "Planning", cards: [] },
					{ id: "in_progress", title: "In Progress", cards: [] },
					{ id: "review", title: "Review", cards: [] },
					{ id: "completed", title: "Completed", cards: [] },
					{ id: "trash", title: "Trash", cards: [] },
				],
				dependencies: [],
			};
			await saveWorkspaceState(workspacePath, { board, sessions: {} });
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			nkleinTaskSessionService.verifyTaskAcceptanceInSandbox.mockResolvedValue({
				present: true,
				command: "npm test",
				passed: true,
				exitCode: 0,
				output: "ok",
				durationMs: 25,
			});
			const getScopedNKleinTaskSessionService = vi.fn(async () => nkleinTaskSessionService as never);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => ({}) as never),
				getScopedNKleinTaskSessionService,
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});

			const response = await api.verifyTaskAcceptance(
				{ workspaceId: "workspace-1", workspacePath },
				{ taskId: "task-acceptance", timeoutMs: 1234 },
			);

			expect(getScopedNKleinTaskSessionService).toHaveBeenCalledWith({ workspaceId: "workspace-1", workspacePath });
			expect(nkleinTaskSessionService.verifyTaskAcceptanceInSandbox).toHaveBeenCalledWith({
				taskId: "task-acceptance",
				projectRepoPath: workspacePath,
				baseRef: "main",
				taskPrompt: "Acceptance check: npm test",
				timeoutMs: 1234,
			});
			expect(response).toMatchObject({
				ok: true,
				taskId: "task-acceptance",
				taskWorkspacePath: null,
				message: "Acceptance check passed: npm test.",
			});
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("starts NKlein tasks without resolving a host task worktree", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/tmp/repo",
				workspaceRoot: "/tmp/repo",
				baseRef: "main",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("moves a started backlog card out of backlog into its working lane (regression: card stayed in backlog)", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-nklein-start-lane-"));
		try {
			setSelectedProviderSettings({ provider: "ollama", model: "qwen3.5-9b", baseUrl: "http://127.0.0.1:11434" });
			execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
			const board: RuntimeBoardData = {
				columns: [
					{
						id: "backlog",
						title: "Backlog",
						cards: [
							{
								id: "task-1",
								title: "Do the work",
								prompt: "Implement it",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{ id: "planning", title: "Planning", cards: [] },
					{ id: "in_progress", title: "In Progress", cards: [] },
					{ id: "review", title: "Review", cards: [] },
					{ id: "completed", title: "Completed", cards: [] },
					{ id: "trash", title: "Trash", cards: [] },
				],
				dependencies: [],
			};
			await saveWorkspaceState(workspacePath, { board, sessions: {} });
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			nkleinTaskSessionService.startTaskSession.mockResolvedValue(
				createSummary({ agentId: "nklein", pid: null, taskId: "task-1", state: "running" }),
			);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => ({}) as never),
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});

			const response = await api.startTaskSession(
				{ workspaceId: "workspace-1", workspacePath },
				{ taskId: "task-1", baseRef: "main", prompt: "Implement it", startInPlanMode: false },
			);

			expect(response.ok).toBe(true);
			const saved = await loadWorkspaceState(workspacePath);
			// The card must not sit in backlog while the agent is working it. Under §5.B every started card enters
			// the Planning/Refinement lane first (it refines, then calls begin_implementation to advance).
			expect(saved.board.columns.find((column) => column.id === "backlog")?.cards).toHaveLength(0);
			expect(saved.board.columns.find((column) => column.id === "planning")?.cards).toMatchObject([
				{ id: "task-1" },
			]);
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("blocks NKlein starts when the agent sandbox preflight is unavailable", async () => {
		const terminalManager = {
			listSummaries: vi.fn(() => []),
		};
		const getScopedNKleinTaskSessionService = vi.fn(async () => createNKleinTaskSessionServiceMock() as never);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService,
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			refreshAgentSandboxStatus: vi.fn(async () => ({
				state: "blocked" as const,
				dockerAvailable: false,
				imageAvailable: false,
				image: "test-image",
				message: "Docker is required for !Klein agent isolation, but it is unavailable.",
				checkedAt: 123,
			})),
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
			error: "Docker is required for !Klein agent isolation, but it is unavailable.",
			errorCode: "agent_sandbox_unavailable",
		});
		expect(getScopedNKleinTaskSessionService).not.toHaveBeenCalled();
	});

	it("still avoids host worktree creation for NKlein when no existing task cwd is available", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/tmp/repo",
				workspaceRoot: "/tmp/repo",
				baseRef: "main",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("counts active NKlein sessions when enforcing project task capacity", async () => {
		const terminalManager = {
			listSummaries: vi.fn(() => []),
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.listSummaries.mockReturnValue([
			createSummary({ taskId: "task-2", state: "awaiting_review", agentId: "nklein", pid: null }),
		]);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				runtimeConfigState.maxConcurrentTasks = 1;
				runtimeConfigState.effectiveMaxConcurrentTasks = 1;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			getLoadedScopedNKleinTaskSessionService: vi.fn(() => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("routes nklein start sessions to nklein task session service", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
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

	it("passes the MCSR effective context window to NKlein starts instead of the provider advertised window", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				contextWindow: 64_000,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("routes NKlein starts up to the smallest sufficient configured role model", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				runtimeConfigState.modelRoles = {
					architect: {
						providerId: "anthropic",
						modelId: "claude-opus",
						reasoningEffort: "high",
					},
				};
				runtimeConfigState.effectiveModelRoles = runtimeConfigState.modelRoles;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-opus",
				reasoningEffort: "high",
			}),
		);
	});

	it("prefers the configured architect role model for plan-mode NKlein starts", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "small-model",
			apiKey: "anthropic-api-key",
		});
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				"anthropic:small-model:default": createModelRegistryEntry({
					key: "anthropic:small-model:default",
					providerId: "anthropic",
					modelId: "small-model",
					contextWindow: 80_000,
					capability: 90,
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				runtimeConfigState.modelRoles = {
					architect: {
						providerId: "anthropic",
						modelId: "claude-opus",
						reasoningEffort: "high",
					},
				};
				runtimeConfigState.effectiveModelRoles = runtimeConfigState.modelRoles;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
				prompt: "Plan a task graph.",
				startInPlanMode: true,
			},
		);

		expect(response.ok).toBe(true);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-opus",
				reasoningEffort: "high",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("uses the configured architect role model for plan-mode starts with stale task model settings", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "small-model",
			apiKey: "anthropic-api-key",
		});
		modelRegistryMocks.getSnapshot.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 1,
			models: {
				"anthropic:small-model:default": createModelRegistryEntry({
					key: "anthropic:small-model:default",
					providerId: "anthropic",
					modelId: "small-model",
					contextWindow: 80_000,
					capability: 90,
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

		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				runtimeConfigState.modelRoles = {
					architect: {
						providerId: "anthropic",
						modelId: "claude-opus",
						reasoningEffort: "high",
					},
				};
				runtimeConfigState.effectiveModelRoles = runtimeConfigState.modelRoles;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
				prompt: "Plan with an explicit model.",
				startInPlanMode: true,
				nkleinSettings: {
					providerId: "anthropic",
					modelId: "small-model",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-opus",
				reasoningEffort: "high",
			}),
		);
	});

	it("blocks NKlein starts when any configured role model is below the minimum context window", async () => {
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

		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				runtimeConfigState.modelRoles = {
					worker: {
						providerId: "anthropic",
						modelId: "small-model",
					},
				};
				runtimeConfigState.effectiveModelRoles = runtimeConfigState.modelRoles;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		// T4a (folded): the sub-min model here is the role's PRIMARY, so the role-loop catch re-raises the
		// context-window policy error as a fatal escalation (start-task-session.ts L256-262), tagging it
		// errorCode: "routing_escalation". Contrast T4b below, where the same sub-min condition on a
		// NON-primary pool member is swallowed and the start still succeeds.
		expect(response.errorCode).toBe("routing_escalation");
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("swallows a sub-min context-window pool member and still starts on the valid primary (T4b)", async () => {
		// T4b — the high-value asymmetry guard. A role's primary is valid (good-worker @ 64k) and its
		// additionalModels pool contains a sub-min member (tiny-extra @ 16k). When the role loop resolves
		// the pool member, buildNKleinStartGuardCandidate/resolveLaunchConfig throws a context-window policy
		// error, but because it is NON-primary the catch falls through to start-task-session.ts L264 and
		// silently skips it. The start therefore succeeds on a valid model and tiny-extra is never launched.
		// (Pins the CURRENT contract; the over-broad non-primary swallow is a flagged follow-up, not fixed here.)
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-opus",
			apiKey: "anthropic-api-key",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "anthropic",
			models: [
				{ id: "claude-opus", name: "Opus", contextWindow: 200_000 },
				{ id: "good-worker", name: "Worker", contextWindow: 64_000 },
				{ id: "tiny-extra", name: "Tiny extra", contextWindow: 16_000 },
			],
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
				"anthropic:good-worker:default": createModelRegistryEntry({
					key: "anthropic:good-worker:default",
					providerId: "anthropic",
					modelId: "good-worker",
					contextWindow: 64_000,
					capability: 70,
				}),
			},
		});

		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				runtimeConfigState.modelRoles = {
					worker: {
						providerId: "anthropic",
						modelId: "good-worker",
						additionalModels: [{ providerId: "anthropic", modelId: "tiny-extra" }],
					},
				};
				runtimeConfigState.effectiveModelRoles = runtimeConfigState.modelRoles;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", baseRef: "main", prompt: "Implement a focused change." },
		);

		// The swallowed pool-member error did NOT block the start (asymmetry vs T4a's primary escalation).
		expect(response.ok).toBe(true);
		expect(response.errorCode).toBeUndefined();
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledTimes(1);
		// The model actually launched is one of the valid candidates — never the sub-min pool member.
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: expect.stringMatching(/^(claude-opus|good-worker)$/),
			}),
		);
		const startedWith = nkleinTaskSessionService.startTaskSession.mock.calls[0]?.[0] as { modelId?: string };
		expect(startedWith.modelId).not.toBe("tiny-extra");
	});

	it("refuses to start a model that is not loaded in LM Studio (residency gate, T1)", async () => {
		// T1 — the model-not-loaded residency block (start-task-session.ts L179-190). The gate is disabled under
		// the runner because process.env.VITEST is truthy; arming it requires deleting VITEST (and pinning the
		// discovery cache TTL to 0 so the per-test fetch stub is authoritative). withEnvRestored guarantees BOTH
		// keys are restored even if an assertion throws — a VITEST leak would turn sibling residency checks live.
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const originalFetch = globalThis.fetch;
		// Non-empty loaded set that OMITS the requested model ⇒ shouldBlockUnloadedModel returns true. A bare
		// vi.fn ignores the URL (http://127.0.0.1:1234/api/v0/models), so the stub is robust to the exact path.
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ data: [{ id: "some-other-loaded-model", state: "loaded" }] }),
		})) as unknown as typeof globalThis.fetch;
		try {
			const response = await withEnvRestored(
				["VITEST", "NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS"],
				(setEnv) => {
					setEnv("VITEST", undefined);
					setEnv("NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS", "0");
				},
				() =>
					api.startTaskSession(
						{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
						{ taskId: "task-1", baseRef: "main", prompt: "Investigate startup freeze" },
					),
			);

			expect(response.ok).toBe(false);
			expect(response.error).toContain('Model "claude-sonnet-4-6" is not loaded in LM Studio');
			expect(response.error).toContain("!Klein does not load models");
			expect(response.error).toContain("loaded: some-other-loaded-model");
			// This return intentionally carries NO errorCode today; assert its absence so a future tidy-up that
			// bolts one on is caught and reviewed.
			expect(response).not.toHaveProperty("errorCode");
			expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		} finally {
			globalThis.fetch = originalFetch;
		}
		// Tripwire: withEnvRestored must have put VITEST back (a leak would silently break sibling tests).
		expect(process.env.VITEST).toBeDefined();
	});

	it("refuses a catalog-reject (tool-unsuitable) primary model up front (suitability gate, T2)", async () => {
		// T2 — the §5.AL suitability reject (start-task-session.ts L196-210). Pure gate (no fetch, no VITEST flip):
		// a TOOL_UNSUITABLE reasoning-only model selected as the primary yields severity "reject" under the
		// default reject policy. phi-4-mini-reasoning is reported at 64k so it clears the context-window floor and
		// lands on the suitability gate (not the window gate). The override env is explicitly cleared (and restored)
		// so a leaked NKLEIN_ALLOW_UNSUITABLE_MODEL="1" from another test can't silently skip the gate.
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "phi-4-mini-reasoning",
			apiKey: "anthropic-api-key",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "anthropic",
			models: [{ id: "phi-4-mini-reasoning", name: "Phi-4 mini reasoning", contextWindow: 64_000 }],
		});
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await withEnvRestored(
			["NKLEIN_ALLOW_UNSUITABLE_MODEL"],
			(setEnv) => setEnv("NKLEIN_ALLOW_UNSUITABLE_MODEL", undefined),
			() =>
				api.startTaskSession(
					{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
					{ taskId: "task-1", baseRef: "main", prompt: "Implement a focused change." },
				),
		);

		expect(response.ok).toBe(false);
		expect(response.error).toContain('Model "phi-4-mini-reasoning" is not suitable for agentic tasks');
		expect(response.error).toMatch(/NKLEIN_ALLOW_UNSUITABLE_MODEL=1/);
		expect(response).not.toHaveProperty("errorCode");
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("lets NKLEIN_ALLOW_UNSUITABLE_MODEL=1 override the suitability gate and start anyway (T2 companion)", async () => {
		// T2 companion — the override arm of the L196 condition: with NKLEIN_ALLOW_UNSUITABLE_MODEL="1" the
		// suitability gate is skipped entirely, so the same reject-class model is allowed to start. Pins the
		// documented escape hatch (and that the gate is the ONLY thing blocking this model here).
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "phi-4-mini-reasoning",
			apiKey: "anthropic-api-key",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "anthropic",
			models: [{ id: "phi-4-mini-reasoning", name: "Phi-4 mini reasoning", contextWindow: 64_000 }],
		});
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await withEnvRestored(
			["NKLEIN_ALLOW_UNSUITABLE_MODEL"],
			(setEnv) => setEnv("NKLEIN_ALLOW_UNSUITABLE_MODEL", "1"),
			() =>
				api.startTaskSession(
					{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
					{ taskId: "task-1", baseRef: "main", prompt: "Implement a focused change." },
				),
		);

		expect(response.ok).toBe(true);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledTimes(1);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: "anthropic", modelId: "phi-4-mini-reasoning" }),
		);
	});

	it("blocks a cloud provider with errorCode cloud_provider_disabled (T3)", async () => {
		// T3 — the top-level catch's cloud-disabled branch (start-task-session.ts L540-547), reached via the real
		// resolver guard (nklein-provider-service.ts L1201). The cloud provider is supplied as a per-task OVERRIDE
		// (nkleinSettings.providerId), which the handler forwards as providerIdOverride to the FIRST
		// resolveLaunchConfig (L147-148). That override branch (provider-service L1185) skips the
		// getSelectedProviderSettings local-only pre-filter (which would otherwise null out a cloud selection and
		// surface a generic "no provider configured" error instead), so resolution reaches assertLocalProviderAllowed
		// and throws CloudProviderDisabledError before any residency/network path. No fetch stub, no VITEST flip.
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.startTaskSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				taskId: "task-1",
				baseRef: "main",
				prompt: "Continue task",
				nkleinSettings: { providerId: "openrouter", modelId: "openrouter/auto" },
			},
		);

		expect(response.ok).toBe(false);
		expect(response.errorCode).toBe("cloud_provider_disabled");
		expect(response.error).toContain("local-only mode");
		expect(response.error).toContain("openrouter");
		expect(response.summary).toBeNull();
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("blocks NKlein starts that no configured model can fit", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("blocks NKlein starts that would contend for the same local endpoint", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.listModelEndpointSessions.mockReturnValue([
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
			// The registry canonicalizes loopback hosts to `localhost` (todo §5.Q / the 2026-06-22 loopback fix),
			// so the stored key + endpoint use the canonical form even though sessions report `127.0.0.1`.
			key: "ollama:qwen3.5-9b:http://localhost:11434",
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://localhost:11434",
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
			snapshot: vi.fn(() => []),
			hydrate: vi.fn(),
		};

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(response.error).toContain("http://localhost:11434");
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
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
				nkleinSettings: {
					reasoningEffort: "medium",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				reasoningEffort: "medium",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("clamps stale one-second NKlein timeout settings to the local timeout floor", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
				nkleinSettings: {
					requestTimeoutMs: 1_000,
					streamTimeoutMs: 1_000,
					toolTimeoutMs: 1_000,
					agentTimeoutMs: 1_000,
					conversationTimeoutMs: 1_000,
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
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

	it("raises positive local NKlein timeouts from slow MCSR speed observations", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
				nkleinSettings: {
					requestTimeoutMs: 1_000,
					streamTimeoutMs: 1_000,
					toolTimeoutMs: 1_000,
					agentTimeoutMs: 1_000,
					conversationTimeoutMs: 1_000,
				},
			},
		);

		expect(response.ok).toBe(true);
		const launchRequest = nkleinTaskSessionService.startTaskSession.mock.calls[0]?.[0] as
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

	it("keeps unlimited NKlein timeouts unlimited when MCSR speed data is slow", async () => {
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				runtimeConfigState.agentTimeoutMode = "unlimited";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
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
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
				nkleinSettings: {
					modelId: "anthropic/claude-opus-4.6",
				},
			},
		);

		expect(response.ok).toBe(true);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "anthropic/claude-opus-4.6",
				reasoningEffort: null,
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("clears task chat cache and resumes the nklein session on resumeFromTrash", async () => {
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

		const broadcastTaskChatCleared = vi.fn();
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				resumeFromTrash: true,
			}),
		);
	});

	it("uses saved nklein settings even when no last-used provider is recorded", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		oauthMocks.getLastUsedProviderSettings.mockReturnValue(undefined);
		oauthMocks.getProviderSettings.mockImplementation((providerId: string) =>
			providerId === "nklein"
				? {
						provider: "nklein",
						model: "anthropic/claude-opus-4.6",
						apiKey: "saved-nklein-api-key",
					}
				: undefined,
		);
		writeSelectedProviderId("nklein");

		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(
				async () => ({ startTaskSession: vi.fn(), applyTurnCheckpoint: vi.fn() }) as never,
			),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			error: expect.stringContaining("No native !Klein provider is configured"),
		});
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("ignores a persisted nklein cloud provider selection", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		delete process.env.NKLEIN_API_KEY;
		setSelectedProviderSettings({
			provider: "nklein",
			model: "anthropic/claude-opus-4.6",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(response.error).toContain("No native !Klein provider is configured");
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
	});

	it("blocks the nklein provider even when NKLEIN_API_KEY is present in the environment", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);
		process.env.NKLEIN_API_KEY = "env-nklein-api-key";
		setSelectedProviderSettings({
			provider: "nklein",
			model: "anthropic/claude-opus-4.6",
		});

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				const runtimeConfigState = createRuntimeConfigState();
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			error: expect.stringContaining("No native !Klein provider is configured"),
		});
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("starts home agent sessions in the workspace root without resolving a task worktree", async () => {
		const homeTaskId = "__home_agent__:workspace-1:nklein";
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
			baseUrl: "http://127.0.0.1:11434",
		});
		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary({ taskId: homeTaskId })),
			applyTurnCheckpoint: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(
			createSummary({ taskId: homeTaskId, agentId: "nklein", pid: null }),
		);
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: homeTaskId,
				cwd: "/tmp/repo",
			}),
		);
		expect(terminalManager.startTaskSession).not.toHaveBeenCalled();
		expect(turnCheckpointMocks.captureTaskTurnCheckpoint).not.toHaveBeenCalled();
	});

	it("prefers OAuth api key when nklein OAuth credentials are configured", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
		oauthMocks.getValidClineCredentials.mockResolvedValue({
			access: "oauth-access",
			refresh: "oauth-refresh",
			expires: 1_700_000_000_000,
			accountId: "acct-1",
		});
		setSelectedProviderSettings({
			provider: "nklein",
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
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			error: expect.stringContaining("No native !Klein provider is configured"),
		});
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(nkleinAccountMocks.fetchMe).not.toHaveBeenCalled();
		expect(oauthMocks.saveProviderSettings).not.toHaveBeenCalled();
	});

	it("does not use OAuth credentials for non-OAuth providers", async () => {
		taskWorktreeMocks.resolveTaskCwd.mockResolvedValue("/tmp/existing-worktree");
		agentRegistryMocks.resolveAgentCommand.mockReturnValue(null);

		const terminalManager = {
			startTaskSession: vi.fn(async () => createSummary()),
			applyTurnCheckpoint: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(createSummary({ agentId: "nklein", pid: null }));
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
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
		expect(oauthMocks.saveProviderSettings).not.toHaveBeenCalled();
	});

	it("routes nklein task input and stop to nklein task session service", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-nklein-task-stop-"));
		try {
			const summary = createSummary({ agentId: "nklein", pid: null, paused: true });
			const terminalManager = {
				writeInput: vi.fn(),
				stopTaskSession: vi.fn(),
			};
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
			nkleinTaskSessionService.stopTaskSession.mockResolvedValue(summary);
			await setCardPaused({ workspacePath, taskId: "task-1", paused: true });

			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => terminalManager as never),
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			expect(nkleinTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith("task-1", "hello\n");
			expect(terminalManager.writeInput).not.toHaveBeenCalled();

			const stopResponse = await api.stopTaskSession(scope, { taskId: "task-1" });
			expect(stopResponse.ok).toBe(true);
			expect(stopResponse.summary?.paused).toBe(false);
			expect(nkleinTaskSessionService.stopTaskSession).toHaveBeenCalledWith("task-1");
			expect(terminalManager.stopTaskSession).not.toHaveBeenCalled();
			await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set());
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("moves a recovered review task back to in progress after nklein input resumes it", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-nklein-review-resume-"));
		try {
			execFileSync("git", ["init"], { cwd: workspacePath, stdio: "ignore" });
			const board: RuntimeBoardData = {
				columns: [
					{ id: "backlog", title: "Backlog", cards: [] },
					{ id: "planning", title: "Planning", cards: [] },
					{ id: "in_progress", title: "In Progress", cards: [] },
					{
						id: "review",
						title: "Review",
						cards: [
							{
								id: "task-1",
								title: "Recover task",
								prompt: "Continue",
								startInPlanMode: false,
								baseRef: "main",
								createdAt: 1,
								updatedAt: 1,
							},
						],
					},
					{ id: "completed", title: "Completed", cards: [] },
					{ id: "trash", title: "Trash", cards: [] },
				],
				dependencies: [],
			};
			await saveWorkspaceState(workspacePath, { board, sessions: {} });
			const summary = createSummary({ agentId: "nklein", pid: null, taskId: "task-1", state: "running" });
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => ({ writeInput: vi.fn() }) as never),
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});

			const response = await api.sendTaskSessionInput(
				{ workspaceId: "workspace-1", workspacePath },
				{ taskId: "task-1", text: "continue", appendNewline: false },
			);

			expect(response.ok).toBe(true);
			const saved = await loadWorkspaceState(workspacePath);
			expect(saved.board.columns.find((column) => column.id === "review")?.cards).toHaveLength(0);
			expect(saved.board.columns.find((column) => column.id === "in_progress")?.cards).toMatchObject([
				{ id: "task-1" },
			]);
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("manages workspace swarm stop signal through runtime api", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-swarm-stop-api-"));
		try {
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(),
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
				getLoadedScopedNKleinTaskSessionService: vi.fn(() => nkleinTaskSessionService as never),
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
			expect(nkleinTaskSessionService.setBoardPaused).toHaveBeenCalledWith(true);
			await expect(api.getSwarmStop(scope)).resolves.toMatchObject({
				ok: true,
				signal: expect.objectContaining({
					stopped: true,
					reason: "Operator paused from UI.",
				}),
			});

			await expect(api.clearSwarmStop(scope)).resolves.toEqual({ ok: true, signal: null });
			expect(nkleinTaskSessionService.setBoardPaused).toHaveBeenLastCalledWith(false);
			expect(nkleinTaskSessionService.resumePausedTasks).toHaveBeenCalledTimes(1);
			await expect(api.getSwarmStop(scope)).resolves.toEqual({ ok: true, signal: null });
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("persists and resumes per-card pause state through runtime api", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-card-pause-api-"));
		try {
			const runningSummary = createSummary({ agentId: "nklein", taskId: "task-1", state: "running" });
			const resumedSummary = createSummary({ agentId: "nklein", taskId: "task-1", state: "running" });
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			nkleinTaskSessionService.getSummary.mockReturnValue(runningSummary);
			nkleinTaskSessionService.resumePausedTasks.mockResolvedValue([resumedSummary]);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(),
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
				getLoadedScopedNKleinTaskSessionService: vi.fn(() => nkleinTaskSessionService as never),
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
			expect(nkleinTaskSessionService.setCardPaused).toHaveBeenCalledWith("task-1", true);
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
			expect(nkleinTaskSessionService.setCardPaused).toHaveBeenLastCalledWith("task-1", false);
			expect(nkleinTaskSessionService.resumePausedTasks).toHaveBeenCalledTimes(1);
			await expect(readPausedTasks(workspacePath)).resolves.toEqual(new Set());
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("rebinds a persisted paused nklein session before card resume after runtime restart", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "kanban-card-pause-rebind-api-"));
		try {
			const reboundSummary = createSummary({
				agentId: "nklein",
				taskId: "task-1",
				state: "awaiting_review",
			});
			const resumedSummary = createSummary({ agentId: "nklein", taskId: "task-1", state: "running" });
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			nkleinTaskSessionService.getSummary.mockReturnValue(null);
			nkleinTaskSessionService.rebindPersistedTaskSession.mockResolvedValue(reboundSummary);
			nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(resumedSummary);
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(),
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			expect(nkleinTaskSessionService.rebindPersistedTaskSession).toHaveBeenCalledWith("task-1");
			expect(nkleinTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
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
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			const api = createTestRuntimeApi({
				getActiveWorkspaceId: vi.fn(() => "workspace-1"),
				loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
				setActiveRuntimeConfig: vi.fn(),
				getScopedTerminalManager: vi.fn(async () => terminalManager as never),
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		} finally {
			rmSync(workspacePath, { recursive: true, force: true });
		}
	});

	it("returns nklein chat messages and sends chat message through nklein service", async () => {
		const summary = createSummary({ agentId: "nklein", pid: null });
		const latestMessage = {
			id: "message-1",
			role: "user" as const,
			content: "hello",
			createdAt: Date.now(),
		};
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
		nkleinTaskSessionService.listMessages.mockReturnValue([latestMessage]);
		nkleinTaskSessionService.loadTaskSessionMessages.mockResolvedValue([latestMessage]);
		nkleinTaskSessionService.getSummary.mockReturnValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const sendResponse = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", text: "hello" },
		);
		expect(sendResponse.ok).toBe(true);
		expect(nkleinTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
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

		nkleinTaskSessionService.abortTaskSession.mockResolvedValue(summary);
		const abortResponse = await api.abortTaskChatTurn(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(abortResponse.ok).toBe(true);
		expect(nkleinTaskSessionService.abortTaskSession).toHaveBeenCalledWith("task-1");

		nkleinTaskSessionService.cancelTaskTurn.mockResolvedValue(summary);
		const cancelResponse = await api.cancelTaskChatTurn(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);
		expect(cancelResponse.ok).toBe(true);
		expect(nkleinTaskSessionService.cancelTaskTurn).toHaveBeenCalledWith("task-1");
	});

	it("forwards selected NKlein model settings through chat sends", async () => {
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
		const summary = createSummary({ agentId: "nklein", pid: null });
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			expect(nkleinTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
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
		const summary = createSummary({ agentId: "nklein", pid: null, state: "idle" });
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.clearTaskSession.mockResolvedValue(summary);
		const broadcastTaskChatCleared = vi.fn();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.clearTaskSession).toHaveBeenCalledWith("__home_agent__:workspace-1");
		expect(broadcastTaskChatCleared).toHaveBeenCalledWith("workspace-1", "__home_agent__:workspace-1");
		expect(nkleinTaskSessionService.sendTaskSessionInput).not.toHaveBeenCalled();
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("forwards chat images through the nklein service send path", async () => {
		const summary = createSummary({ agentId: "nklein", pid: null });
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(summary);
		nkleinTaskSessionService.listMessages.mockReturnValue([]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
		expect(nkleinTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith("task-1", "hello", undefined, [
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);
	});

	it("hydrates persisted nklein chat messages when no live in-memory session is loaded", async () => {
		const persistedMessage = {
			id: "message-persisted-1",
			role: "assistant" as const,
			content: "Recovered from SDK artifacts",
			createdAt: Date.now(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.getSummary.mockReturnValue(null);
		nkleinTaskSessionService.loadTaskSessionMessages.mockResolvedValue([persistedMessage]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getTaskChatMessages(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1" },
		);

		expect(response.ok).toBe(true);
		expect(response.messages).toEqual([persistedMessage]);
		expect(nkleinTaskSessionService.loadTaskSessionMessages).toHaveBeenCalledWith("task-1");
	});

	it("reloads a chat session through the NKlein task session service", async () => {
		const summary = createSummary({ agentId: "nklein", pid: null });
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.reloadTaskSession.mockResolvedValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.reloadTaskChatSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1:nklein" },
		);

		expect(response).toEqual({
			ok: true,
			summary,
		});
		expect(nkleinTaskSessionService.reloadTaskSession).toHaveBeenCalledWith("__home_agent__:workspace-1:nklein");
	});

	it("restarts the home chat session from the saved launch config when reload cannot reuse cached config", async () => {
		const summary = createSummary({ agentId: "nklein", pid: null });
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.reloadTaskSession.mockResolvedValue(null);
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(summary);
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
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.reloadTaskChatSession(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1:nklein" },
		);

		expect(response).toMatchObject({
			ok: false,
			summary: null,
			error: expect.stringContaining("No native !Klein provider is configured"),
		});
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("rebinds persisted non-home chat sessions before retrying the first send after restart", async () => {
		setSelectedProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "anthropic-api-key",
		});
		const summary = createSummary({ agentId: "nklein", pid: null });
		const reboundSummary = createSummary({
			agentId: "nklein",
			pid: null,
			workspacePath: "/tmp/repo/.worktrees/task-1",
		});
		const latestMessage = {
			id: "message-rebound-1",
			role: "user" as const,
			content: "continue",
			createdAt: Date.now(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValueOnce(null);
		nkleinTaskSessionService.rebindPersistedTaskSession.mockResolvedValue(reboundSummary);
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(summary);
		nkleinTaskSessionService.listMessages.mockReturnValue([latestMessage]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "task-1", text: "continue" },
		);

		expect(response.ok).toBe(true);
		expect(nkleinTaskSessionService.rebindPersistedTaskSession).toHaveBeenCalledWith("task-1");
		expect(nkleinTaskSessionService.sendTaskSessionInput).toHaveBeenCalledTimes(1);
		expect(nkleinTaskSessionService.sendTaskSessionInput).toHaveBeenCalledWith(
			"task-1",
			"continue",
			undefined,
			undefined,
		);
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
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
		const summary = createSummary({ agentId: "nklein", pid: null });
		const latestMessage = {
			id: "message-home-1",
			role: "user" as const,
			content: "hello home",
			createdAt: Date.now(),
		};
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		const runtimeConfigState = createRuntimeConfigState();
		setSelectedProviderSettings({
			provider: "nklein",
			auth: {
				accessToken: "seed-token",
				refreshToken: "seed-refresh",
				expiresAt: Date.now() + 3_600_000,
			},
		});
		nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(null);
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(summary);
		nkleinTaskSessionService.listMessages.mockReturnValue([latestMessage]);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => runtimeConfigState),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			error: expect.stringContaining("No native !Klein provider is configured"),
		});
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
	});

	it("starts home chat sessions from persisted history with current launch config", async () => {
		const summary = createSummary({ agentId: "nklein", pid: null });
		const latestMessage = {
			id: "message-home-rebound-1",
			role: "user" as const,
			content: "continue home",
			createdAt: Date.now(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValueOnce(null);
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(summary);
		nkleinTaskSessionService.listMessages.mockReturnValue([latestMessage]);
		setSelectedProviderSettings({
			provider: "nklein",
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
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
			error: expect.stringContaining("No native !Klein provider is configured"),
		});
		expect(nkleinTaskSessionService.startTaskSession).not.toHaveBeenCalled();
	});

	it("home chat auto-start keeps manual API key for non-OAuth providers", async () => {
		const summary = createSummary({ agentId: "nklein", pid: null });
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
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
		nkleinTaskSessionService.sendTaskSessionInput.mockResolvedValue(null);
		nkleinTaskSessionService.startTaskSession.mockResolvedValue(summary);

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => runtimeConfigState),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.sendTaskChatMessage(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ taskId: "__home_agent__:workspace-1", text: "hello home" },
		);

		expect(response.ok).toBe(true);
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
		expect(nkleinTaskSessionService.startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
			}),
		);
	});

	it("returns nklein provider catalog and provider models", async () => {
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => {
				return createRuntimeConfigState();
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
		});

		const catalogResponse = await api.getNKleinProviderCatalog({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});
		expect(catalogResponse.providers.some((provider) => provider.id === "nklein")).toBe(false);
		expect(catalogResponse.providers.find((provider) => provider.id === "ollama")?.enabled).toBe(true);

		const modelsResponse = await api.getNKleinProviderModels(
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
						maxConcurrentRequests: null,
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
				"nklein:sonnet:default": {
					key: "nklein:sonnet:default",
					providerId: "nklein",
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
						sharedEndpointId: "nklein:default",
						inputCostPerMillionTokens: null,
						outputCostPerMillionTokens: null,
						maxConcurrentRequests: null,
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getNKleinModelRegistry({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.updatedAt).toBe(40);
		expect(response.models.map((model) => model.key)).toEqual(["ollama:qwen:local", "openai-compatible:local:lan"]);
		expect(response.models[0]?.speed.prefillTokensPerSecondEwma).toBe(800);
		expect(response.models[1]?.contextWindow.effective).toBe(32_000);
	});

	it("includes configured local NKlein models before they have registry samples", async () => {
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
				runtimeConfigState.selectedAgentId = "nklein";
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
				runtimeConfigState.effectiveModelRoles = runtimeConfigState.modelRoles;
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getNKleinModelRegistry({
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

	it("removes a local NKlein model registry entry", async () => {
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.removeNKleinModelRegistryEntry(null, { key: "ollama:stale:local" });

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
				runtimeConfigState.selectedAgentId = "nklein";
				return runtimeConfigState;
			}),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.pruneNKleinModelRegistry({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response).toEqual({ removed: 2 });
		expect(modelRegistryMocks.removeEntries).toHaveBeenCalledWith([
			"lmstudio:old-model:http://127.0.0.1:1234/v1",
			"lmstudio:stale-model:http://127.0.0.1:1234/v1",
		]);
	});

	it("returns NKlein code intelligence status for the workspace", async () => {
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getNKleinCodeIntelligenceStatus({
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
			const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
			nkleinTaskSessionService.listMessages.mockReturnValue([
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
				getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
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
						maxConcurrentRequests: null,
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.buildNKleinModelFreshnessAdvisor({
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.buildNKleinAdvisor(
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

	it("sends advisor prompts to the selected local NKlein model", async () => {
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
				getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
				resolveInteractiveShellCommand: vi.fn(),
				runCommand: vi.fn(),
			});

			const response = await api.sendNKleinAdvisor(null, {
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			getDogfoodTelemetryRoot: vi.fn(() => telemetryRoot),
		});

		const response = await api.writeNKleinDogfoodBacklog(
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

	it("runs the NKlein smoke eval for the selected provider and model", async () => {
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.runNKleinSmokeEval({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(evalHarnessMocks.runNKleinDevSmokeEval).toHaveBeenCalledWith({
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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

		const response = await api.getNKleinProviderModels(
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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

		const response = await api.getNKleinProviderModels(
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

	it("does not load managed NKlein provider models in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "nklein",
			model: "anthropic/claude-sonnet-4.6",
		});
		localProviderMocks.getLocalProviderModels.mockResolvedValue({
			providerId: "nklein",
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

		const response = await api.getNKleinProviderModels(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ providerId: "nklein" },
		);

		expect(response).toEqual({ providerId: "nklein", models: [] });
		expect(llmsModelMocks.resolveProviderModelCatalogKeys).not.toHaveBeenCalled();
		expect(llmsModelMocks.resolveProviderConfig).not.toHaveBeenCalled();
	});

	it("falls back to the queried provider's saved model when provider model loading fails", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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

		const response = await api.getNKleinProviderModels(
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		llmsModelMocks.getAllProviders.mockResolvedValue([
			{
				id: "nklein",
				name: "!Klein",
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

		const response = await api.addNKleinProvider(
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

	it("does not fetch nklein account profile in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "nklein",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const response = await api.getNKleinAccountProfile({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.profile).toBeNull();
		expect(nkleinAccountMocks.constructedOptions).toHaveLength(0);
		expect(nkleinAccountMocks.fetchMe).not.toHaveBeenCalled();
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
	});

	it("does not refresh nklein OAuth credentials for profile lookup in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		nkleinAccountMocks.fetchMe
			.mockRejectedValueOnce(new Error("NKlein account request failed with status 401"))
			.mockResolvedValueOnce({
				id: "acct-1",
				email: "saoud@example.com",
				displayName: "Saoud",
			});
		setSelectedProviderSettings({
			provider: "nklein",
			auth: {
				accessToken: "workos:expired-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		const response = await api.getNKleinAccountProfile({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.profile).toBeNull();
		expect(nkleinAccountMocks.fetchMe).not.toHaveBeenCalled();
		expect(oauthMocks.getValidClineCredentials).not.toHaveBeenCalled();
	});

	it("does not fetch nklein remote config in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "nklein",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		nkleinAccountMocks.fetchRemoteConfig.mockResolvedValueOnce({
			organizationId: "org-1",
			enabled: true,
			value: JSON.stringify({
				kanbanEnabled: false,
			}),
		});

		nkleinAccountMocks.fetchOrganization.mockResolvedValueOnce({
			externalOrganizationId: "test",
		});

		const response = await api.getNKleinKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.enabled).toBe(true);
		expect(nkleinAccountMocks.fetchRemoteConfig).not.toHaveBeenCalled();
	});

	it("keeps kanban enabled without nklein remote config in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "nklein",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		nkleinAccountMocks.fetchRemoteConfig
			.mockResolvedValueOnce({
				organizationId: "org-1",
				enabled: true,
				value: JSON.stringify({
					kanbanEnabled: false,
				}),
			})
			.mockRejectedValueOnce(new Error("remote config request failed"));

		nkleinAccountMocks.fetchOrganization.mockResolvedValueOnce({
			externalOrganizationId: "test",
		});

		const initialResponse = await api.getNKleinKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});
		const failedFetchResponse = await api.getNKleinKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(initialResponse.enabled).toBe(true);
		expect(failedFetchResponse.enabled).toBe(true);
		expect(nkleinAccountMocks.fetchRemoteConfig).not.toHaveBeenCalled();
	});

	it("allows kanban by default for non-nklein providers", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "anthropic",
			apiKey: "anthropic-api-key",
		});

		const response = await api.getNKleinKanbanAccess({
			workspaceId: "workspace-1",
			workspacePath: "/tmp/repo",
		});

		expect(response.enabled).toBe(true);
		expect(nkleinAccountMocks.fetchRemoteConfig).not.toHaveBeenCalled();
	});

	it("blocks nklein oauth login in local-only mode", async () => {
		const terminalManager = {
			writeInput: vi.fn(),
		};
		const nkleinTaskSessionService = createNKleinTaskSessionServiceMock();
		const bumpNKleinSessionContextVersion = vi.fn();

		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => terminalManager as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => nkleinTaskSessionService as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpNKleinSessionContextVersion,
		});

		const response = await api.runNKleinProviderOAuthLogin(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{ provider: "nklein" },
		);
		expect(response.ok).toBe(false);
		expect(response.provider).toBe("nklein");
		expect(response.error).toContain("Cloud models are disabled");
		expect(oauthMocks.saveProviderSettings).not.toHaveBeenCalled();
		expect(oauthMocks.loginClineOAuth).not.toHaveBeenCalled();
		expect(bumpNKleinSessionContextVersion).not.toHaveBeenCalled();
	});

	it("bumps nklein session context when provider settings are saved", async () => {
		const bumpNKleinSessionContextVersion = vi.fn();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpNKleinSessionContextVersion,
		});
		setSelectedProviderSettings({
			provider: "ollama",
			model: "qwen3.5-9b",
		});

		const response = await api.saveNKleinProviderSettings(
			{ workspaceId: "workspace-1", workspacePath: "/tmp/repo" },
			{
				providerId: "ollama",
				modelId: "qwen3.5-9b",
			},
		);

		expect(response.providerId).toBe("ollama");
		expect(bumpNKleinSessionContextVersion).toHaveBeenCalledTimes(1);
	});

	it("returns NKlein MCP settings", async () => {
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getNKleinMcpSettings({
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

	it("saves NKlein MCP settings", async () => {
		const bumpNKleinSessionContextVersion = vi.fn();
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
			bumpNKleinSessionContextVersion,
		});

		const response = await api.saveNKleinMcpSettings(
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
		expect(bumpNKleinSessionContextVersion).toHaveBeenCalledTimes(1);
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		const response = await api.getNKleinMcpAuthStatuses({
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});

		await expect(
			api.runNKleinMcpServerOAuth(
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
			join(tempHome, ".nklein", "data"),
			join(tempHome, ".nklein", "nklein"),
			join(tempHome, ".nklein", "worktrees"),
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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
			join(tempHome, ".nklein", "data"),
			join(tempHome, ".nklein", "nklein"),
			join(tempHome, ".nklein", "worktrees"),
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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
	const originalProviderSelectionPath = process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH;

	beforeEach(() => {
		providerSelectionPath = `/tmp/kanban-featurebase-provider-selection-${Date.now()}-${Math.random()
			.toString(16)
			.slice(2)}.json`;
		process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH = providerSelectionPath;
		oauthMocks.getProviderSettings.mockReset();
		oauthMocks.getLastUsedProviderSettings.mockReset();
		oauthMocks.getValidClineCredentials.mockReset();
		oauthMocks.saveProviderSettings.mockReset();
		nkleinAccountMocks.fetchFeaturebaseToken.mockReset();
		nkleinAccountMocks.constructedOptions.length = 0;
	});

	afterEach(() => {
		rmSync(providerSelectionPath, { force: true });
		providerSelectionPath = "";
		if (originalProviderSelectionPath === undefined) {
			delete process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH;
		} else {
			process.env.KANBAN_NKLEIN_PROVIDER_SELECTION_PATH = originalProviderSelectionPath;
		}
	});

	it("does not fetch Featurebase JWT in local-only mode", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "nklein",
			auth: {
				accessToken: "workos:oauth-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});
		nkleinAccountMocks.fetchFeaturebaseToken.mockResolvedValueOnce({
			featurebaseJwt: "jwt-token-123",
		});

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("No provider settings configured.");
		expect(nkleinAccountMocks.fetchFeaturebaseToken).not.toHaveBeenCalled();
	});

	it("throws when no provider settings configured", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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

	it("throws when provider is not nklein", async () => {
		const api = createTestRuntimeApi({
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(),
		});
		setSelectedProviderSettings({
			provider: "nklein",
			auth: {
				accessToken: "workos:stale-access",
				refreshToken: "oauth-refresh",
				accountId: "acct-1",
				expiresAt: 1_700_000_000_000,
			},
		});

		// First attempt fails (e.g. expired token)
		nkleinAccountMocks.fetchFeaturebaseToken.mockRejectedValueOnce(new Error("Unauthorized"));

		// OAuth refresh returns fresh credentials
		oauthMocks.getValidClineCredentials.mockResolvedValueOnce({
			access: "fresh-access",
			refresh: "fresh-refresh",
			expires: 1_800_000_000_000,
			accountId: "acct-1",
		});

		// Second attempt succeeds with refreshed token
		nkleinAccountMocks.fetchFeaturebaseToken.mockResolvedValueOnce({
			featurebaseJwt: "refreshed-jwt-456",
		});

		await expect(
			api.getFeaturebaseToken({
				workspaceId: "workspace-1",
				workspacePath: "/tmp/repo",
			}),
		).rejects.toThrow("No provider settings configured.");
		expect(nkleinAccountMocks.fetchFeaturebaseToken).not.toHaveBeenCalled();
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
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

describe("createRuntimeApi host-local action guards (§5.Y #2 + #9)", () => {
	const workspaceScope = { workspaceId: "workspace-1", workspacePath: "/tmp/repo" };

	beforeEach(() => {
		browserMocks.openInBrowser.mockReset();
	});

	function makeBaseApiDeps(overrides: Partial<CreateRuntimeApiDependencies> = {}) {
		return {
			getActiveWorkspaceId: vi.fn(() => "workspace-1"),
			loadScopedRuntimeConfig: vi.fn(async () => createRuntimeConfigState()),
			setActiveRuntimeConfig: vi.fn(),
			getScopedTerminalManager: vi.fn(async () => ({}) as never),
			getScopedNKleinTaskSessionService: vi.fn(async () => createNKleinTaskSessionServiceMock() as never),
			resolveInteractiveShellCommand: vi.fn(),
			runCommand: vi.fn(async () => ({
				exitCode: 0,
				stdout: "ok",
				stderr: "",
				combinedOutput: "ok",
				durationMs: 1,
			})),
			...overrides,
		};
	}

	it("runCommand executes in local mode (isRemoteMode omitted)", async () => {
		const runCommandDep = vi.fn(async () => ({
			exitCode: 0,
			stdout: "hello",
			stderr: "",
			combinedOutput: "hello",
			durationMs: 5,
		}));
		const api = createTestRuntimeApi(makeBaseApiDeps({ runCommand: runCommandDep }));

		const result = await api.runCommand(workspaceScope, { command: "echo hello" });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("hello");
		expect(runCommandDep).toHaveBeenCalledWith("echo hello", "/tmp/repo");
	});

	it("runCommand executes in local mode (isRemoteMode: false)", async () => {
		const runCommandDep = vi.fn(async () => ({
			exitCode: 0,
			stdout: "hello",
			stderr: "",
			combinedOutput: "hello",
			durationMs: 5,
		}));
		const api = createRuntimeApi({
			...makeBaseApiDeps({ runCommand: runCommandDep }),
			getActiveWorkspacePath: () => null,
			getUpdateStatus: vi.fn(() => ({
				currentVersion: "0.1.0",
				latestVersion: null,
				updateAvailable: false,
				updateTiming: null,
				installCommand: null,
			})),
			runUpdateNow: vi.fn(async () => ({
				status: "unsupported_installation" as const,
				currentVersion: "0.1.0",
				latestVersion: null,
				message: "N/A",
			})),
			isRemoteMode: false,
		});

		const result = await api.runCommand(workspaceScope, { command: "echo hello" });
		expect(result.exitCode).toBe(0);
		expect(runCommandDep).toHaveBeenCalledOnce();
	});

	it("runCommand refuses in remote mode (isRemoteMode: true)", async () => {
		const runCommandDep = vi.fn();
		const api = createRuntimeApi({
			...makeBaseApiDeps({ runCommand: runCommandDep }),
			getActiveWorkspacePath: () => null,
			getUpdateStatus: vi.fn(() => ({
				currentVersion: "0.1.0",
				latestVersion: null,
				updateAvailable: false,
				updateTiming: null,
				installCommand: null,
			})),
			runUpdateNow: vi.fn(async () => ({
				status: "unsupported_installation" as const,
				currentVersion: "0.1.0",
				latestVersion: null,
				message: "N/A",
			})),
			isRemoteMode: true,
		});

		await expect(api.runCommand(workspaceScope, { command: "echo hello" })).rejects.toThrow(
			"Host-local action unavailable in remote mode",
		);
		expect(runCommandDep).not.toHaveBeenCalled();
	});

	it("openFile executes in local mode (isRemoteMode omitted)", async () => {
		const api = createTestRuntimeApi(makeBaseApiDeps());

		const result = await api.openFile({ filePath: "/tmp/some-file.txt" });
		expect(result.ok).toBe(true);
		expect(browserMocks.openInBrowser).toHaveBeenCalledWith("/tmp/some-file.txt");
	});

	it("openFile executes in local mode (isRemoteMode: false)", async () => {
		const api = createRuntimeApi({
			...makeBaseApiDeps(),
			getActiveWorkspacePath: () => null,
			getUpdateStatus: vi.fn(() => ({
				currentVersion: "0.1.0",
				latestVersion: null,
				updateAvailable: false,
				updateTiming: null,
				installCommand: null,
			})),
			runUpdateNow: vi.fn(async () => ({
				status: "unsupported_installation" as const,
				currentVersion: "0.1.0",
				latestVersion: null,
				message: "N/A",
			})),
			isRemoteMode: false,
		});

		const result = await api.openFile({ filePath: "/tmp/some-file.txt" });
		expect(result.ok).toBe(true);
		expect(browserMocks.openInBrowser).toHaveBeenCalledWith("/tmp/some-file.txt");
	});

	it("openFile refuses in remote mode (isRemoteMode: true)", async () => {
		const api = createRuntimeApi({
			...makeBaseApiDeps(),
			getActiveWorkspacePath: () => null,
			getUpdateStatus: vi.fn(() => ({
				currentVersion: "0.1.0",
				latestVersion: null,
				updateAvailable: false,
				updateTiming: null,
				installCommand: null,
			})),
			runUpdateNow: vi.fn(async () => ({
				status: "unsupported_installation" as const,
				currentVersion: "0.1.0",
				latestVersion: null,
				message: "N/A",
			})),
			isRemoteMode: true,
		});

		await expect(api.openFile({ filePath: "/tmp/some-file.txt" })).rejects.toThrow(
			"Host-local action unavailable in remote mode",
		);
		expect(browserMocks.openInBrowser).not.toHaveBeenCalled();
	});
});
