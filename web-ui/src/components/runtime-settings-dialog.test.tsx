import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import type { ReactNode } from "react";
import { act, createContext, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate, type SyntheticEventData } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeSettingsDialog } from "@/components/runtime-settings-dialog";
import type { RuntimeConfigResponse } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";

/*
 * Radix Select depends on pointer-capture APIs that jsdom lacks.
 * Replace it with a minimal native <select> so the theme-picker tests
 * can exercise onValueChange without fighting jsdom limitations.
 */
const RadixSelectCtx = createContext<{
	value: string;
	onValueChange: (v: string) => void;
}>({ value: "", onValueChange: () => {} });

vi.mock("@radix-ui/react-select", () => ({
	Root: ({
		value,
		onValueChange,
		children,
	}: {
		value: string;
		onValueChange: (v: string) => void;
		children: ReactNode;
	}) => {
		const open = false;
		return (
			<RadixSelectCtx.Provider value={{ value, onValueChange }}>
				<div data-radix-select-root="" data-state={open ? "open" : "closed"} data-open-setter={String(open)}>
					{typeof children === "function" ? null : children}
				</div>
			</RadixSelectCtx.Provider>
		);
	},
	Trigger: ({ children, ...props }: { children: ReactNode; "aria-label"?: string }) => {
		return (
			<button type="button" {...props} data-radix-select-trigger="">
				{children}
			</button>
		);
	},
	Value: ({ placeholder }: { placeholder?: string }) => {
		const ctx = useContext(RadixSelectCtx);
		return <span>{ctx.value || placeholder}</span>;
	},
	Icon: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
	Content: ({ children }: { children: ReactNode }) => <div data-radix-select-content="">{children}</div>,
	ScrollUpButton: () => null,
	ScrollDownButton: () => null,
	Viewport: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Label: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Separator: () => <hr />,
	Item: ({ value, children, ...rest }: { value: string; children: ReactNode }) => {
		const ctx = useContext(RadixSelectCtx);
		return (
			<button
				type="button"
				role="option"
				aria-label={value}
				data-radix-select-item=""
				onClick={() => ctx.onValueChange(value)}
				{...rest}
			>
				{children}
			</button>
		);
	},
	ItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
	ItemIndicator: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@radix-ui/react-switch", () => ({
	Root: ({
		checked,
		disabled,
		onCheckedChange,
		children,
		...props
	}: {
		checked: boolean;
		disabled?: boolean;
		onCheckedChange: (checked: boolean) => void;
		children: ReactNode;
	}) => (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			data-state={checked ? "checked" : "unchecked"}
			disabled={disabled}
			onClick={() => {
				if (!disabled) {
					onCheckedChange(!checked);
				}
			}}
			{...props}
		>
			{children}
		</button>
	),
	Thumb: ({ children, ...props }: { children?: ReactNode }) => <span {...props}>{children}</span>,
}));

const resetLayoutCustomizationsMock = vi.hoisted(() => vi.fn());
const saveRuntimeConfigMock = vi.hoisted(() => vi.fn(async () => true));
const buildNKleinAdvisorRequestMock = vi.hoisted(() => vi.fn());
const sendNKleinAdvisorRequestMock = vi.hoisted(() => vi.fn());
const writeNKleinDogfoodBacklogMock = vi.hoisted(() => vi.fn());
const runNKleinSmokeEvalMock = vi.hoisted(() => vi.fn());
const fetchNKleinProviderModelsMock = vi.hoisted(() => vi.fn());
const discoverNKleinEndpointModelsMock = vi.hoisted(() => vi.fn());
const fetchNKleinCodeIntelligenceStatusMock = vi.hoisted(() => vi.fn());
const fetchNKleinModelRegistryMock = vi.hoisted(() => vi.fn());
const checkLlmfitCatalogUpdateMock = vi.hoisted(() => vi.fn());
const pullLlmfitCatalogUpdateMock = vi.hoisted(() => vi.fn());
const saveNKleinModelContextWindowOverrideMock = vi.hoisted(() => vi.fn());
const removeNKleinModelRegistryEntryMock = vi.hoisted(() => vi.fn());
const pruneNKleinModelRegistryMock = vi.hoisted(() => vi.fn());
const openFileOnHostMock = vi.hoisted(() => vi.fn(async () => undefined));
const addMcpServerMock = vi.hoisted(() => vi.fn());
const nkleinSetupSectionOnSavedRef = vi.hoisted(() => ({
	onSaved: null as null | (() => void),
}));
const nkleinControllerState = vi.hoisted(() => ({
	providerId: "anthropic",
	modelId: "claude-3-7-sonnet",
	baseUrl: "",
}));

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeAgentCatalogEntry: vi.fn((agentId: string) => ({
		id: agentId,
		installUrl: null,
		autonomousArgs: [],
	})),
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => [
		{ id: "nklein", label: "!Klein", binary: "nklein" },
		{ id: "claude", label: "Claude Code", binary: "claude" },
	]),
}));

vi.mock("@runtime-shortcuts", () => ({
	areRuntimeProjectShortcutsEqual: vi.fn(() => true),
}));

vi.mock("@/components/shared/nklein-setup-section", () => ({
	NKleinSetupSection: ({ onSaved }: { onSaved?: () => void }) => {
		nkleinSetupSectionOnSavedRef.onSaved = onSaved ?? null;
		return null;
	},
}));

vi.mock("@/hooks/use-runtime-settings-nklein-controller", () => ({
	useRuntimeSettingsNKleinController: () => ({
		currentProviderSettings: {
			providerId: nkleinControllerState.providerId,
			modelId: nkleinControllerState.modelId,
			baseUrl: nkleinControllerState.baseUrl.trim() || null,
			reasoningEffort: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		hasUnsavedChanges: false,
		providerId: nkleinControllerState.providerId,
		modelId: nkleinControllerState.modelId,
		baseUrl: nkleinControllerState.baseUrl,
		reasoningEffort: "",
		providerCatalog: [
			{
				id: "anthropic",
				name: "Anthropic",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "claude-3-7-sonnet",
				baseUrl: null,
				supportsBaseUrl: false,
			},
			{
				id: "openrouter",
				name: "OpenRouter",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "openai/gpt-5.4",
				baseUrl: null,
				supportsBaseUrl: true,
			},
			{
				id: "lmstudio",
				name: "LM Studio",
				oauthSupported: false,
				enabled: true,
				defaultModelId: "configured-but-unloaded",
				baseUrl: "http://localhost:1234",
				supportsBaseUrl: true,
			},
		],
		providerModels: [
			{ id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", contextWindow: 200_000, supportsReasoningEffort: true },
			{ id: "claude-opus-4", name: "Claude Opus 4", contextWindow: 200_000, supportsReasoningEffort: true },
		],
		isLoadingProviderModels: false,
		refreshProviderModels: vi.fn(async () => ({ ok: true })),
		saveProviderSettings: vi.fn(async () => ({ ok: true })),
	}),
}));

vi.mock("@/hooks/use-runtime-settings-nklein-mcp-controller", () => ({
	useRuntimeSettingsNKleinMcpController: () => ({
		hasUnsavedChanges: false,
		isSavingMcpSettings: false,
		addMcpServer: addMcpServerMock,
		saveMcpSettings: vi.fn(async () => ({ ok: true })),
	}),
}));

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutCustomizations: () => ({
		layoutResetNonce: 0,
		resetLayoutCustomizations: resetLayoutCustomizationsMock,
	}),
}));

vi.mock("@/runtime/use-runtime-config", () => ({
	useRuntimeConfig: (_open: boolean, _workspaceId: string | null, initialConfig?: RuntimeConfigResponse | null) => ({
		config: initialConfig ?? null,
		isLoading: false,
		isSaving: false,
		refresh: vi.fn(),
		save: saveRuntimeConfigMock,
	}),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	buildNKleinAdvisorRequest: buildNKleinAdvisorRequestMock,
	checkLlmfitCatalogUpdate: checkLlmfitCatalogUpdateMock,
	discoverNKleinEndpointModels: discoverNKleinEndpointModelsMock,
	fetchKleinCorePyHealth: vi.fn(async () => ({
		enabled: false,
		reachable: false,
		sidecarUrl: "http://127.0.0.1:3585",
	})),
	fetchNKleinCodeIntelligenceStatus: fetchNKleinCodeIntelligenceStatusMock,
	fetchNKleinModelRegistry: fetchNKleinModelRegistryMock,
	fetchNKleinProviderModels: fetchNKleinProviderModelsMock,
	openFileOnHost: openFileOnHostMock,
	pullLlmfitCatalogUpdate: pullLlmfitCatalogUpdateMock,
	pruneNKleinModelRegistry: pruneNKleinModelRegistryMock,
	removeNKleinModelRegistryEntry: removeNKleinModelRegistryEntryMock,
	runNKleinSmokeEval: runNKleinSmokeEvalMock,
	saveNKleinModelContextWindowOverride: saveNKleinModelContextWindowOverrideMock,
	saveNKleinModelMaxConcurrentRequests: vi.fn(async () => ({})),
	sendNKleinAdvisorRequest: sendNKleinAdvisorRequestMock,
	writeNKleinDogfoodBacklog: writeNKleinDogfoodBacklogMock,
}));

vi.mock("@/utils/notification-permission", () => ({
	getBrowserNotificationPermission: () => "unsupported",
	requestBrowserNotificationPermission: vi.fn(async () => "unsupported"),
	formatNotificationPermissionStatus: (permission: string) =>
		permission === "default" ? "not requested yet" : permission,
}));

function findButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button"))
		.reverse()
		.find((button) => button.textContent?.trim() === text) ?? null) as HTMLButtonElement | null;
}

function findButtonByAriaLabel(container: ParentNode, ariaLabel: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find(
		(button) => button.getAttribute("aria-label") === ariaLabel,
	) ?? null) as HTMLButtonElement | null;
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
	const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
	valueSetter?.call(select, value);
	Simulate.change(select);
}

function setInputValue(input: HTMLInputElement, value: string): void {
	input.value = value;
	Simulate.change(input);
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
	textarea.value = value;
	const eventData = { currentTarget: { value }, target: { value } } as unknown as SyntheticEventData;
	Simulate.input(textarea, eventData);
	Simulate.change(textarea, eventData);
}

async function flushAsyncWork(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 0));
		await Promise.resolve();
	});
}

async function waitForCondition(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (condition()) {
			return;
		}
		await flushAsyncWork();
	}
	throw new Error("Condition was not met before timeout.");
}

async function waitForEmbeddingDiscoveryDebounce(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => window.setTimeout(resolve, 550));
	});
	await flushAsyncWork();
}

function findSectionByHeading(headingText: string, containedText: string): HTMLElement | null {
	const heading = Array.from(document.querySelectorAll("h6")).find(
		(element) => element.textContent?.trim() === headingText,
	);
	let section = heading?.parentElement ?? null;
	while (section && section !== document.body) {
		if (section.textContent?.includes(containedText)) {
			return section;
		}
		section = section.parentElement;
	}
	return null;
}

const savedNKleinOauthConfig = {
	selectedAgentId: "nklein",
	selectedShortcutLabel: null,
	agentAutonomousModeEnabled: true,
	lostHeartbeatPolicy: "park",
	decompositionAutoApplyEnabled: true,
	secondOpinionReviewEnabled: true,
	reviewMaxRounds: 20,
	readyForReviewNotificationsEnabled: false,
	replayCardsEnabled: false,
	llmfitCatalogUpdateMode: "notify",
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
	agentSandboxStatus: {
		state: "ready",
		dockerAvailable: true,
		imageAvailable: true,
		image: "nklein/agent-sandbox:0.0.1",
		message: null,
		checkedAt: 1,
	},
	effectiveCommand: "nklein",
	detectedCommands: [],
	shortcuts: [],
	modelRoles: {},
	agentRulesets: { capability: { globalPreset: "strict" }, delivery: { globalPreset: "strict" } },
	modelRolesOverride: null,
	effectiveModelRoles: {},
	agentRulesetsOverride: null,
	effectiveAgentRulesets: {
		capability: { globalPreset: "strict" },
		delivery: { globalPreset: "strict" },
	},
	swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	commitPromptTemplate: "",
	openPrPromptTemplate: "",
	commitPromptTemplateDefault: "",
	openPrPromptTemplateDefault: "",
	globalConfigPath: null,
	projectConfigPath: null,
	agents: [
		{
			id: "nklein",
			label: "!Klein",
			binary: "nklein",
			command: "nklein",
			installed: true,
		},
		{
			id: "claude",
			label: "Claude Code",
			binary: "claude",
			command: "claude",
			installed: true,
		},
	],
	nkleinProviderSettings: {
		providerId: null,
		modelId: "nklein-sonnet",
		baseUrl: null,
		reasoningEffort: null,
		apiKeyConfigured: false,
		oauthProvider: "nklein",
		oauthAccessTokenConfigured: true,
		oauthRefreshTokenConfigured: true,
		oauthAccountId: "acc-1",
		oauthExpiresAt: 1_800_000_000_000,
	},
} as unknown as RuntimeConfigResponse;

const cloudEnabledNKleinOauthConfig = {
	...savedNKleinOauthConfig,
	cloudProviderSupportEnabled: true,
} as RuntimeConfigResponse;

const debugNKleinOauthConfig = {
	...savedNKleinOauthConfig,
	developerModeEnabled: true,
} as RuntimeConfigResponse;

describe("RuntimeSettingsDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		resetLayoutCustomizationsMock.mockReset();
		buildNKleinAdvisorRequestMock.mockReset();
		buildNKleinAdvisorRequestMock.mockResolvedValue({
			kind: "model_freshness",
			title: "Check For Better Models",
			prompt: "Compare connected models.",
			requiresWebResearch: true,
			recommendedSources: ["https://openrouter.ai/models"],
		});
		sendNKleinAdvisorRequestMock.mockReset();
		sendNKleinAdvisorRequestMock.mockResolvedValue({
			providerId: "lmstudio",
			modelId: "loaded-qwen",
			output: "Use the loaded Qwen model for local checks.",
			sentAt: Date.UTC(2026, 0, 2, 3, 4, 5),
			receivedAt: Date.UTC(2026, 0, 2, 3, 4, 8),
		});
		writeNKleinDogfoodBacklogMock.mockReset();
		writeNKleinDogfoodBacklogMock.mockResolvedValue({
			rootPath: "/repo/.nklein/nklein/plans/dogfood",
			specPath: "/repo/.nklein/nklein/plans/dogfood/spec.md",
			planPath: "/repo/.nklein/nklein/plans/dogfood/plan.md",
			questionsPath: "/repo/.nklein/nklein/plans/dogfood/questions.md",
			decisionsPath: "/repo/.nklein/nklein/plans/dogfood/decisions.md",
			revisionsPath: "/repo/.nklein/nklein/plans/dogfood/revisions.md",
			summaryPath: "/repo/.nklein/nklein/plans/dogfood/summary.md",
			taskGraphPath: "/repo/.nklein/nklein/plans/dogfood/tasks.json",
			slug: "dogfood",
			taskCount: 1,
			nextCommand: "nklein task decompose --slug dogfood --project-path /repo",
		});
		runNKleinSmokeEvalMock.mockReset();
		runNKleinSmokeEvalMock.mockResolvedValue({
			workspacePath: "/tmp/eval-workspace",
			evidenceBundlePath: "/tmp/eval-evidence",
			acceptanceCommand: "npm test",
			passed: true,
			exitCode: 0,
			output: "ok",
			providerId: "ollama",
			modelId: "qwen3.5-9b",
			endpoint: "http://127.0.0.1:11434",
		});
		fetchNKleinCodeIntelligenceStatusMock.mockReset();
		fetchNKleinCodeIntelligenceStatusMock.mockResolvedValue({
			codeEmbeddingSettings: {
				globalDefaults: {
					provider: "local_lexical",
					model: "kanban-local-lexical-vector-v1",
					baseUrl: null,
				},
				projectOverride: null,
				effective: {
					provider: "local_lexical",
					model: "kanban-local-lexical-vector-v1",
					baseUrl: null,
				},
				source: "global",
			},
			repoMap: {
				filesScanned: 12,
				symbols: 34,
				tokenCount: 900,
				truncated: false,
				available: true,
				error: null,
			},
			codeIndex: {
				cachePath: "/repo/.nklein/nklein/code-index-v1.json",
				cacheExists: true,
				embeddingProvider: "local_lexical",
				embeddingModel: "kanban-local-lexical-vector-v1",
				updatedAt: Date.now(),
				totalFiles: 12,
				totalChunks: 20,
				indexedFiles: 10,
				indexedChunks: 16,
				staleFiles: 1,
				missingFiles: 1,
				searchAvailable: true,
				progress: {
					phase: "idle",
					startedAt: null,
					updatedAt: null,
					filesTotal: 0,
					filesProcessed: 0,
					chunksTotal: 0,
					chunksProcessed: 0,
					cacheHitCount: 0,
					cacheMissCount: 0,
					message: null,
				},
				error: null,
			},
		});
		fetchNKleinModelRegistryMock.mockReset();
		fetchNKleinModelRegistryMock.mockResolvedValue({
			schemaVersion: 1,
			updatedAt: 120_000,
			models: [
				{
					key: "ollama:qwen:http://127.0.0.1:11434",
					providerId: "ollama",
					modelId: "qwen",
					endpoint: "http://127.0.0.1:11434",
					contextWindow: {
						advertised: 80_000,
						observed: 64_000,
						userOverride: null,
						effective: 64_000,
					},
					speed: {
						samples: 1,
						promptTokensEwma: 1000,
						outputTokensEwma: 100,
						totalTokensEwma: 1100,
						prefillTokensPerSecondEwma: 500,
						decodeTokensPerSecondEwma: 40,
						ttftMsEwma: 300,
						wallTimeMsEwma: 2000,
						wallTimeMsPer1kPromptTokensEwma: 2000,
						lastPromptTokens: 1000,
						lastOutputTokens: 100,
						lastWallTimeMs: 2000,
						lastObservedAt: 120_000,
					},
					capability: {
						samples: 1,
						staticPrior: 35,
						evalScore: null,
						externalScore: null,
						observedPassRate: 1,
						effectiveScore: 65,
						lastObservedAt: 120_000,
					},
					constraints: {
						sharedEndpointId: "http://127.0.0.1:11434",
						inputCostPerMillionTokens: null,
						outputCostPerMillionTokens: null,
					},
					createdAt: 100_000,
					updatedAt: 120_000,
				},
			],
			fleetSuggestions: [],
		});
		checkLlmfitCatalogUpdateMock.mockReset();
		checkLlmfitCatalogUpdateMock.mockResolvedValue({
			mode: "notify",
			action: "up_to_date",
			reason: "Local catalog is current.",
			sourceUrl: "https://api.github.com/repos/AlexsJones/llmfit/contents/llmfit-core/data/hf_models.json?ref=main",
			downloadUrl: "https://raw.test/hf_models.json",
			localRevision: "sha",
			remoteRevision: "sha",
			remoteModelCount: 1,
			remoteSizeBytes: 10,
			checkedAt: 100,
		});
		pullLlmfitCatalogUpdateMock.mockReset();
		pullLlmfitCatalogUpdateMock.mockResolvedValue({
			mode: "notify",
			action: "up_to_date",
			reason: "Local llmfit catalog cache updated.",
			sourceUrl: "https://api.github.com/repos/AlexsJones/llmfit/contents/llmfit-core/data/hf_models.json?ref=main",
			downloadUrl: "https://raw.test/hf_models.json",
			localRevision: "sha",
			remoteRevision: "sha",
			remoteModelCount: 1,
			remoteSizeBytes: 10,
			checkedAt: 100,
			cachePath: "/tmp/llmfit-catalog-cache.json",
			written: true,
		});
		saveNKleinModelContextWindowOverrideMock.mockReset();
		saveNKleinModelContextWindowOverrideMock.mockResolvedValue({
			model: {
				key: "ollama:qwen:http://127.0.0.1:11434",
			},
		});
		removeNKleinModelRegistryEntryMock.mockReset();
		removeNKleinModelRegistryEntryMock.mockResolvedValue({ removed: true });
		pruneNKleinModelRegistryMock.mockReset();
		pruneNKleinModelRegistryMock.mockResolvedValue({ removed: 1 });
		fetchNKleinProviderModelsMock.mockReset();
		fetchNKleinProviderModelsMock.mockImplementation(async (_workspaceId: string | null, providerId: string) => {
			if (providerId === "openrouter") {
				return [
					{ id: "openai/gpt-5.4", name: "GPT-5.4", contextWindow: 128_000, supportsReasoningEffort: true },
					{
						id: "google/gemini-2.5-pro",
						name: "Gemini 2.5 Pro",
						contextWindow: 1_000_000,
						supportsReasoningEffort: true,
					},
				];
			}
			if (providerId === "lmstudio") {
				return [{ id: "loaded-qwen", name: "Loaded Qwen", contextWindow: 128_000 }];
			}
			return [];
		});
		discoverNKleinEndpointModelsMock.mockReset();
		discoverNKleinEndpointModelsMock.mockResolvedValue({
			modelSourceUrl: "http://127.0.0.1:11434/v1/models",
			models: [{ id: "nomic-embed-text", name: "nomic-embed-text" }],
		});
		addMcpServerMock.mockReset();
		addMcpServerMock.mockResolvedValue({ ok: true });
		openFileOnHostMock.mockClear();
		saveRuntimeConfigMock.mockClear();
		saveRuntimeConfigMock.mockResolvedValue(true);
		nkleinControllerState.providerId = "anthropic";
		nkleinControllerState.modelId = "claude-3-7-sonnet";
		nkleinControllerState.baseUrl = "";
		nkleinSetupSectionOnSavedRef.onSaved = null;
		window.localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn(async () => undefined),
			},
		});
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		document.body.innerHTML = "";
		window.localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("does not render support actions inside settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(findButtonByText(document.body, "Send feedback")).toBeNull();
		expect(findButtonByText(document.body, "Report issue")).toBeNull();
	});

	it("hides cloud account affordances in local-only mode", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(document.body.textContent).not.toContain("Sign in to !Klein");
		expect(document.body.textContent).not.toContain("Account ID:");
		expect(document.body.textContent).not.toContain("Sign in again with");
		expect(Array.from(document.body.querySelectorAll("option")).map((option) => option.value)).not.toContain("cloud");
		const architectProviderSelect = document.getElementById(
			"runtime-settings-model-role-architect-provider",
		) as HTMLSelectElement | null;
		expect(architectProviderSelect).not.toBeNull();
		const roleProviderValues = Array.from(architectProviderSelect?.options ?? []).map((option) => option.value);
		expect(roleProviderValues).toEqual(["", "lmstudio"]);
	});

	it("replaces the cloud agent picker with a local-only !Klein line", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(document.body.textContent).toContain("Local !Klein agent (cloud disabled).");
		expect(document.body.textContent).not.toContain("Claude Code");
		expect(document.body.textContent).not.toContain("Checking which CLIs are installed");
	});

	it("surfaces local swarm guardrail limits in settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							maxConcurrentTasks: 5,
							sandboxMaxContainers: 2,
							sandboxAgentsPerContainer: 2,
						} as RuntimeConfigResponse
					}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(document.body.textContent).toContain("Local swarm guardrails");
		expect(document.body.textContent).toContain("Agent isolation");
		expect(document.body.textContent).toContain("Docker sandbox ready");
		expect(document.body.textContent).toContain("Docker daemon");
		expect(document.body.textContent).toContain("Sandbox image");
		expect(document.body.textContent).toContain("5 running max");
		expect(document.body.textContent).toContain("Sandbox pool");
		expect(document.body.textContent).toContain("4 effective parallel");
		expect(document.body.textContent).toContain("2 containers, 4 pool slots, 4 GB each.");
		expect(document.body.textContent).toContain("Card batch budget");
		expect(document.body.textContent).toContain("12 cards");
		// The four per-task guardrails are now editable inputs (todo §5.T) seeded from the config defaults.
		expect(document.body.textContent).toContain("Autonomous turns");
		expect(document.body.textContent).toContain("Wall time (hours)");
		expect(document.body.textContent).toContain("No-diff checkpoints");
		expect(document.body.textContent).toContain("Repeated tool calls");
		expect(document.body.textContent).toContain("Reset to defaults");
		expect((document.getElementById("runtime-settings-guardrail-turns") as HTMLInputElement).value).toBe("12");
		expect((document.getElementById("runtime-settings-guardrail-wall-time") as HTMLInputElement).value).toBe("2");
		expect((document.getElementById("runtime-settings-guardrail-no-diff") as HTMLInputElement).value).toBe("4");
		expect((document.getElementById("runtime-settings-guardrail-tool-calls") as HTMLInputElement).value).toBe("3");
		expect(document.body.textContent).toContain("Advanced policy visibility");
		expect(document.body.textContent).toContain("Routing policy");
		expect(document.body.textContent).toContain("Context budget policy");
		expect(document.body.textContent).toContain("Acceptance gate");
		expect(document.body.textContent).toContain("Telemetry");
		expect(document.body.textContent).toContain(".nklein/nklein/telemetry, limit 20");
	});

	it("surfaces the online-retrieval egress toggle + SearXNG backend URL (§5.AC)", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							retrievalEgressEnabled: true,
							retrievalSearchBackendUrl: "http://localhost:18888",
						} as RuntimeConfigResponse
					}
					onOpenChange={() => {}}
				/>,
			);
		});
		expect(document.body.textContent).toContain("Allow online web research (egress)");
		expect(document.body.textContent).toContain("SearXNG backend URL");
		expect((document.getElementById("runtime-settings-retrieval-backend-url") as HTMLInputElement).value).toBe(
			"http://localhost:18888",
		);
	});

	it("surfaces the curated sandbox-MCP + capability-broker capability toggles (§5.AR/§5.M)", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							sandboxMcpServersEnabled: true,
							capabilityBrokerEnabled: false,
						} as RuntimeConfigResponse
					}
					onOpenChange={() => {}}
				/>,
			);
		});
		expect(document.body.textContent).toContain("Curated sandbox MCP servers");
		expect(document.body.textContent).toContain("Prompt-injection capability broker");
		expect(document.getElementById("runtime-settings-sandbox-mcp")).not.toBeNull();
		expect(document.getElementById("runtime-settings-capability-broker")).not.toBeNull();
	});

	it("edits and saves the global model-capability gate policy (§5.AL)", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		await act(async () => {
			setSelectValue(document.getElementById("runtime-settings-model-gate-unsuitable") as HTMLSelectElement, "warn");
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				modelSuitabilityPolicyDefaults: { onUnsuitable: "warn", onUnknown: "warn" },
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("edits and saves the llmfit catalog update mode (§5.AB)", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const modeSelect = document.getElementById("runtime-settings-llmfit-catalog-update-mode") as HTMLSelectElement;
		expect(modeSelect).toBeInstanceOf(HTMLSelectElement);
		await act(async () => {
			setSelectValue(modeSelect, "auto");
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				llmfitCatalogUpdateMode: "auto",
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("edits and saves the local swarm guardrails (§5.T)", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		await act(async () => {
			setInputValue(document.getElementById("runtime-settings-guardrail-turns") as HTMLInputElement, "30");
		});
		await act(async () => {
			setInputValue(document.getElementById("runtime-settings-guardrail-wall-time") as HTMLInputElement, "4");
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				swarmGuardrails: expect.objectContaining({
					maxAutonomousTurnsPerTask: 30,
					maxAutonomousWallTimeMs: 4 * 60 * 60 * 1000,
					maxRepeatedNoDiffCheckpoints: 4,
					maxRepeatedToolCallsPerTask: 3,
				}),
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("edits and saves the workspace base directory (§5.W)", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const input = document.getElementById("runtime-settings-workspace-base-dir") as HTMLInputElement;
		expect(input).not.toBeNull();
		await act(async () => {
			setInputValue(input, "/Users/me/.nklein/dev-workspaces");
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({ workspaceBaseDir: "/Users/me/.nklein/dev-workspaces" }),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("resets the local swarm guardrails to defaults (§5.T)", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							swarmGuardrails: {
								maxAutonomousTurnsPerTask: 99,
								maxAutonomousWallTimeMs: 30 * 60 * 1000,
								maxRepeatedNoDiffCheckpoints: 8,
								maxRepeatedToolCallsPerTask: 9,
							},
						} as RuntimeConfigResponse
					}
					onOpenChange={() => {}}
				/>,
			);
		});

		const turnsInput = document.getElementById("runtime-settings-guardrail-turns") as HTMLInputElement;
		expect(turnsInput.value).toBe("99");

		await act(async () => {
			findButtonByText(document.body, "Reset to defaults")?.click();
		});

		expect((document.getElementById("runtime-settings-guardrail-turns") as HTMLInputElement).value).toBe("12");
		expect((document.getElementById("runtime-settings-guardrail-wall-time") as HTMLInputElement).value).toBe("2");
		expect((document.getElementById("runtime-settings-guardrail-no-diff") as HTMLInputElement).value).toBe("4");
		expect((document.getElementById("runtime-settings-guardrail-tool-calls") as HTMLInputElement).value).toBe("3");
	});

	it("saves sandbox pool settings from general settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const inputByPlaceholder = (placeholder: string): HTMLInputElement => {
			const input = document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
			if (!input) {
				throw new Error(`Expected input with placeholder ${placeholder}.`);
			}
			return input;
		};

		await act(async () => {
			setInputValue(inputByPlaceholder("1"), "2");
			setInputValue(inputByPlaceholder("0"), "1");
			setInputValue(inputByPlaceholder("2048"), "8192");
			setInputValue(inputByPlaceholder("2"), "1.5");
			setInputValue(inputByPlaceholder("10"), "15");
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sandboxMaxContainers: 2,
				sandboxAgentsPerContainer: 1,
				sandboxMemoryPerContainerMb: 8192,
				sandboxCpusPerContainer: 1.5,
				sandboxIdleTimeoutMinutes: 15,
			}),
		);
	});

	it("applies sandbox pool presets as numeric setting shortcuts", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							sandboxMaxContainers: 3,
							sandboxAgentsPerContainer: 2,
						} as RuntimeConfigResponse
					}
					onOpenChange={() => {}}
				/>,
			);
		});

		const inputByPlaceholder = (placeholder: string): HTMLInputElement => {
			const input = document.body.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
			if (!input) {
				throw new Error(`Expected input with placeholder ${placeholder}.`);
			}
			return input;
		};
		const maxContainersInput = inputByPlaceholder("1");
		const agentsPerContainerInput = inputByPlaceholder("0");

		expect(maxContainersInput.value).toBe("3");
		expect(agentsPerContainerInput.value).toBe("2");

		await act(async () => {
			findButtonByText(document.body, "Dedicated")?.click();
		});

		expect(maxContainersInput.value).toBe("3");
		expect(agentsPerContainerInput.value).toBe("1");

		await act(async () => {
			findButtonByText(document.body, "Shared")?.click();
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				sandboxMaxContainers: 1,
				sandboxAgentsPerContainer: 0,
			}),
		);
	});

	it("saves the replay cards opt-in from general settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const replaySwitch = document.body.querySelector<HTMLElement>("#runtime-settings-replay-cards");
		expect(replaySwitch).toBeInstanceOf(HTMLElement);

		await act(async () => {
			replaySwitch?.click();
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				replayCardsEnabled: true,
			}),
		);
	});

	it("renders the speculative best-of-N block from config and disables its inputs when off (§5.AW)", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							speculativeBestOfNEnabled: false,
							speculativeMaxConcurrentSpecs: 2,
							speculativeMaxSpecsPerRun: 5,
						} as RuntimeConfigResponse
					}
					onOpenChange={() => {}}
				/>,
			);
		});

		const speculativeSwitch = document.body.querySelector<HTMLElement>(
			'[aria-labelledby="runtime-settings-speculative-best-of-n-label"]',
		);
		expect(speculativeSwitch).toBeInstanceOf(HTMLElement);
		expect(speculativeSwitch?.getAttribute("aria-checked")).toBe("false");
		const concurrentSpecsInput = document.getElementById(
			"runtime-settings-speculative-max-concurrent-specs",
		) as HTMLInputElement | null;
		const specsPerRunInput = document.getElementById(
			"runtime-settings-speculative-max-specs-per-run",
		) as HTMLInputElement | null;
		expect(concurrentSpecsInput).toBeInstanceOf(HTMLInputElement);
		expect(specsPerRunInput).toBeInstanceOf(HTMLInputElement);
		expect(concurrentSpecsInput?.value).toBe("2");
		expect(specsPerRunInput?.value).toBe("5");
		expect(concurrentSpecsInput?.disabled).toBe(true);
		expect(specsPerRunInput?.disabled).toBe(true);
	});

	it("saves speculative best-of-N settings after edits (§5.AW)", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const concurrentSpecsInput = document.getElementById(
			"runtime-settings-speculative-max-concurrent-specs",
		) as HTMLInputElement | null;
		const specsPerRunInput = document.getElementById(
			"runtime-settings-speculative-max-specs-per-run",
		) as HTMLInputElement | null;
		if (!(concurrentSpecsInput instanceof HTMLInputElement) || !(specsPerRunInput instanceof HTMLInputElement)) {
			throw new Error("Expected speculative best-of-N number inputs to render.");
		}
		expect(concurrentSpecsInput.disabled).toBe(false);
		expect(specsPerRunInput.disabled).toBe(false);

		await act(async () => {
			setInputValue(concurrentSpecsInput, "2");
			setInputValue(specsPerRunInput, "5");
		});
		const speculativeSwitch = document.body.querySelector<HTMLElement>(
			'[aria-labelledby="runtime-settings-speculative-best-of-n-label"]',
		);
		await act(async () => {
			speculativeSwitch?.click();
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				speculativeBestOfNEnabled: false,
				speculativeMaxConcurrentSpecs: 2,
				speculativeMaxSpecsPerRun: 5,
			}),
		);
	});

	it("saves the lost heartbeat policy from advanced settings", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							selectedAgentId: "claude",
							effectiveCommand: "claude",
						} as RuntimeConfigResponse
					}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const lostHeartbeatSelect = Array.from(document.body.querySelectorAll("select")).find((select) =>
			Array.from(select.options).some((option) => option.value === "keep_running"),
		);
		if (!(lostHeartbeatSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected lost heartbeat policy select to render.");
		}

		await act(async () => {
			setSelectValue(lostHeartbeatSelect, "keep_running");
		});
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				lostHeartbeatPolicy: "keep_running",
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("does not show project code intelligence status in global settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
			await Promise.resolve();
		});

		expect(fetchNKleinCodeIntelligenceStatusMock).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain("16/20 chunks");
		expect(document.body.textContent).not.toContain("Repo map");
	});

	it("shows and saves local model context-window overrides in settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
			await Promise.resolve();
		});
		await waitForCondition(() => document.body.textContent?.includes("Model context windows") === true);
		await waitForCondition(() => document.body.textContent?.includes("ollama/qwen") === true);

		expect(fetchNKleinModelRegistryMock).toHaveBeenCalledWith("workspace-1");
		expect(document.body.textContent).toContain("1 local model tracked");
		expect(document.body.textContent).toContain("Effective context: 64,000");
		const input = document.body.querySelector("input[aria-label='Context window override for ollama/qwen']");
		expect(input).toBeInstanceOf(HTMLInputElement);
		await act(async () => {
			if (input instanceof HTMLInputElement) {
				setInputValue(input, "96000");
			}
			await Promise.resolve();
		});
		await waitForCondition(() => {
			const rowSaveButton = Array.from(input?.parentElement?.querySelectorAll("button") ?? []).find(
				(button) => button.textContent?.trim() === "Save",
			);
			return rowSaveButton instanceof HTMLButtonElement && !rowSaveButton.disabled;
		});
		const saveButton = Array.from(input?.parentElement?.querySelectorAll("button") ?? []).find(
			(button) => button.textContent?.trim() === "Save",
		);
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			saveButton?.click();
			await Promise.resolve();
		});
		await flushAsyncWork();

		expect(saveNKleinModelContextWindowOverrideMock).toHaveBeenCalledWith("workspace-1", {
			providerId: "ollama",
			modelId: "qwen",
			endpoint: "http://127.0.0.1:11434",
			contextWindow: 96_000,
		});
	});

	it("calls the layout reset callback when reset layout is clicked", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const resetButton = findButtonByText(document.body, "Reset layout");
		expect(resetButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			resetButton?.click();
		});

		expect(resetLayoutCustomizationsMock).toHaveBeenCalledTimes(1);
	});

	it("saves new task defaults from settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const taskSection = Array.from(document.querySelectorAll("h6")).find((heading) =>
			heading.textContent?.includes("New Task Defaults"),
		)?.parentElement;
		expect(taskSection).toBeTruthy();
		const switches = Array.from(taskSection?.querySelectorAll<HTMLButtonElement>("[role='switch']") ?? []);
		expect(switches).toHaveLength(2);
		const reviewActionSelect = taskSection?.querySelector<HTMLSelectElement>("select");
		expect(reviewActionSelect).toBeInstanceOf(HTMLSelectElement);

		await act(async () => {
			switches[0]?.click();
			switches[1]?.click();
		});
		await act(async () => {
			if (reviewActionSelect) {
				setSelectValue(reviewActionSelect, "pr");
			}
		});

		const saveButton = findButtonByText(document.body, "Save");
		expect(saveButton?.disabled).toBe(false);
		await act(async () => {
			saveButton?.click();
		});

		expect(window.localStorage.getItem(LocalStorageKey.TaskStartInPlanMode)).toBe("true");
		expect(window.localStorage.getItem(LocalStorageKey.TaskAutoReviewEnabled)).toBe("true");
		expect(window.localStorage.getItem(LocalStorageKey.TaskAutoReviewMode)).toBe("pr");
	});

	it("enables save on theme change and reverts preview on cancel", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		let saveButton = findButtonByText(document.body, "Save");
		const cancelButton = findButtonByText(document.body, "Cancel");
		const themeSelectTrigger = findButtonByAriaLabel(document.body, "Theme");

		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(cancelButton).toBeInstanceOf(HTMLButtonElement);
		expect(themeSelectTrigger).toBeInstanceOf(HTMLButtonElement);
		expect(saveButton?.disabled).toBe(true);
		expect(themeSelectTrigger?.className).toContain("cursor-pointer");
		expect(themeSelectTrigger?.parentElement?.parentElement?.className).toContain("w-1/2");

		// The mock Radix Select renders items as buttons with role="option".
		// Click the Graphite option to trigger onValueChange.
		const graphiteOption = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
			el.textContent?.includes("Graphite"),
		) as HTMLElement | undefined;
		expect(graphiteOption).toBeTruthy();
		await act(async () => {
			graphiteOption?.click();
		});

		expect(document.documentElement.getAttribute("data-theme")).toBe("graphite");
		saveButton = findButtonByText(document.body, "Save");
		expect(saveButton?.disabled).toBe(false);
		expect(window.localStorage.getItem(LocalStorageKey.Theme)).toBeNull();

		await act(async () => {
			cancelButton?.click();
		});

		expect(handleOpenChange).toHaveBeenCalledWith(false);
		expect(window.localStorage.getItem(LocalStorageKey.Theme)).toBeNull();
		// §5.AX: cancel reverts the preview to the ACTIVE (unset ⇒ default) theme, which is now the klein
		// identity, not the legacy no-data-theme default. localStorage stays null (nothing was saved).
		expect(document.documentElement.getAttribute("data-theme")).toBe("klein");
	});

	it("persists theme selection only after clicking save", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		let saveButton = findButtonByText(document.body, "Save");

		expect(saveButton).toBeInstanceOf(HTMLButtonElement);

		// Click the Graphite option to trigger onValueChange.
		const graphiteOption = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
			el.textContent?.includes("Graphite"),
		) as HTMLElement | undefined;
		expect(graphiteOption).toBeTruthy();
		await act(async () => {
			graphiteOption?.click();
		});

		expect(window.localStorage.getItem(LocalStorageKey.Theme)).toBeNull();
		saveButton = findButtonByText(document.body, "Save");

		await act(async () => {
			saveButton?.click();
		});

		expect(handleOpenChange).toHaveBeenCalledWith(false);
		expect(window.localStorage.getItem(LocalStorageKey.Theme)).toBe("graphite");
		expect(document.documentElement.getAttribute("data-theme")).toBe("graphite");
	});

	it("saves configured NKlein model roles", async () => {
		fetchNKleinProviderModelsMock.mockImplementation(async (_workspaceId: string | null, providerId: string) => {
			if (providerId === "lmstudio") {
				return [
					{
						id: "loaded-qwen",
						name: "Loaded Qwen",
						contextWindow: 128_000,
						supportsReasoningEffort: true,
					},
				];
			}
			return [];
		});
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		let saveButton = findButtonByText(document.body, "Save");
		const modelRolesSection = findSectionByHeading("Model roles", "Architect");
		const selects = Array.from(modelRolesSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const architectProviderSelect = selects[0];
		const architectModelSelect = selects[1];
		const architectAssignmentSelect = selects[2];
		const architectReasoningSelect = selects[3];
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(modelRolesSection).toBeInstanceOf(HTMLDivElement);
		if (
			!(architectProviderSelect instanceof HTMLSelectElement) ||
			!(architectModelSelect instanceof HTMLSelectElement) ||
			!(architectAssignmentSelect instanceof HTMLSelectElement) ||
			!(architectReasoningSelect instanceof HTMLSelectElement)
		) {
			throw new Error("Expected architect model role controls to render.");
		}
		expect(architectAssignmentSelect.value).toBe("auto");

		await act(async () => {
			setSelectValue(architectProviderSelect, "lmstudio");
		});
		await waitForCondition(() =>
			fetchNKleinProviderModelsMock.mock.calls.some((call) => call[0] === "workspace-1" && call[1] === "lmstudio"),
		);
		await flushAsyncWork();
		expect(fetchNKleinProviderModelsMock).toHaveBeenCalledWith("workspace-1", "lmstudio");
		expect(Array.from(architectModelSelect.options).map((option) => option.value)).toContain("loaded-qwen");

		await act(async () => {
			setSelectValue(architectModelSelect, "loaded-qwen");
			setSelectValue(architectReasoningSelect, "high");
		});

		saveButton = findButtonByText(document.body, "Save");
		expect(saveButton?.disabled).toBe(false);

		await act(async () => {
			saveButton?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				modelRoles: {
					architect: {
						providerId: "lmstudio",
						modelId: "loaded-qwen",
						reasoningEffort: "high",
					},
				},
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("saves one explicit pinned model role while leaving another configured role on auto", async () => {
		fetchNKleinProviderModelsMock.mockImplementation(async (_workspaceId: string | null, providerId: string) => {
			if (providerId === "lmstudio") {
				return [
					{
						id: "loaded-qwen",
						name: "Loaded Qwen",
						contextWindow: 128_000,
						supportsReasoningEffort: true,
					},
				];
			}
			return [];
		});
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		let saveButton = findButtonByText(document.body, "Save");
		const selectById = (id: string): HTMLSelectElement => {
			const element = document.getElementById(id);
			if (!(element instanceof HTMLSelectElement)) {
				throw new Error(`Expected ${id} select to render.`);
			}
			return element;
		};
		const architectProviderSelect = selectById("runtime-settings-model-role-architect-provider");
		const architectModelSelect = selectById("runtime-settings-model-role-architect-model");
		const architectAssignmentSelect = selectById("runtime-settings-model-role-architect-assignment");
		const workerProviderSelect = selectById("runtime-settings-model-role-worker-provider");
		const workerModelSelect = selectById("runtime-settings-model-role-worker-model");
		const workerAssignmentSelect = selectById("runtime-settings-model-role-worker-assignment");
		expect(architectAssignmentSelect.value).toBe("auto");
		expect(workerAssignmentSelect.value).toBe("auto");

		await act(async () => {
			setSelectValue(architectProviderSelect, "lmstudio");
			setSelectValue(workerProviderSelect, "lmstudio");
		});
		await waitForCondition(() =>
			fetchNKleinProviderModelsMock.mock.calls.some((call) => call[0] === "workspace-1" && call[1] === "lmstudio"),
		);
		await flushAsyncWork();

		await act(async () => {
			setSelectValue(architectModelSelect, "loaded-qwen");
		});
		await flushAsyncWork();

		await act(async () => {
			setSelectValue(architectAssignmentSelect, "pinned");
			setSelectValue(workerModelSelect, "loaded-qwen");
		});

		saveButton = findButtonByText(document.body, "Save");
		await act(async () => {
			saveButton?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				modelRoles: {
					architect: {
						providerId: "lmstudio",
						modelId: "loaded-qwen",
						modelSelectionMode: "pinned",
					},
					worker: {
						providerId: "lmstudio",
						modelId: "loaded-qwen",
					},
				},
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("discovers embedding models for OpenAI-compatible endpoints", async () => {
		discoverNKleinEndpointModelsMock.mockResolvedValue({
			modelSourceUrl: "http://127.0.0.1:11434/v1/models",
			models: [
				{ id: "nomic-embed-text", name: "nomic-embed-text" },
				{ id: "bge-m3", name: "bge-m3" },
			],
		});
		const handleOpenChange = vi.fn();

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const embeddingsHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Code intelligence embeddings",
		);
		const embeddingsSection = embeddingsHeading?.parentElement ?? null;
		const selects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const defaultProviderSelect = selects[0];
		if (!(defaultProviderSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected default embedding provider select.");
		}

		await act(async () => {
			setSelectValue(defaultProviderSelect, "openai_compatible");
		});

		const endpointInput = Array.from(embeddingsSection?.querySelectorAll<HTMLInputElement>("input") ?? []).find(
			(input) => input.placeholder === "http://127.0.0.1:11434/v1/embeddings",
		);
		const discoverButton = Array.from(embeddingsSection?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
			(button) => button.textContent?.trim() === "Discover models",
		);
		if (!(endpointInput instanceof HTMLInputElement) || !(discoverButton instanceof HTMLButtonElement)) {
			throw new Error("Expected embedding endpoint controls.");
		}

		await act(async () => {
			setInputValue(endpointInput, "http://127.0.0.1:11434/v1/embeddings");
		});
		await act(async () => {
			discoverButton.click();
		});

		await waitForCondition(() => discoverNKleinEndpointModelsMock.mock.calls.length > 0);
		expect(discoverNKleinEndpointModelsMock).toHaveBeenCalledWith("workspace-1", {
			baseUrl: "http://127.0.0.1:11434/v1/embeddings",
		});
		await waitForCondition(
			() => document.body.textContent?.includes("Loaded 2 models from http://127.0.0.1:11434/v1/models.") === true,
		);
		await flushAsyncWork();

		const refreshedSelects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const discoveredModelSelect = refreshedSelects.find((select) =>
			Array.from(select.options).some((option) => option.value === "bge-m3"),
		);
		expect(discoveredModelSelect).toBeInstanceOf(HTMLSelectElement);
		expect((discoveredModelSelect as HTMLSelectElement | undefined)?.value).toBe("nomic-embed-text");

		await act(async () => {
			setSelectValue(discoveredModelSelect as HTMLSelectElement, "bge-m3");
		});

		const saveButton = findButtonByText(document.body, "Save");
		await act(async () => {
			saveButton?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				codeEmbeddingDefaults: {
					provider: "openai_compatible",
					baseUrl: "http://127.0.0.1:11434/v1/embeddings",
					model: "bge-m3",
				},
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("auto-discovers embedding models for local OpenAI-compatible endpoints", async () => {
		discoverNKleinEndpointModelsMock.mockResolvedValue({
			modelSourceUrl: "http://127.0.0.1:11434/v1/models",
			models: [
				{ id: "nomic-embed-text", name: "nomic-embed-text" },
				{ id: "bge-m3", name: "bge-m3" },
			],
		});

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const embeddingsHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Code intelligence embeddings",
		);
		const embeddingsSection = embeddingsHeading?.parentElement ?? null;
		const selects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const defaultProviderSelect = selects[0];
		if (!(defaultProviderSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected default embedding provider select.");
		}

		await act(async () => {
			setSelectValue(defaultProviderSelect, "openai_compatible");
		});
		const endpointInput = Array.from(embeddingsSection?.querySelectorAll<HTMLInputElement>("input") ?? []).find(
			(input) => input.placeholder === "http://127.0.0.1:11434/v1/embeddings",
		);
		if (!(endpointInput instanceof HTMLInputElement)) {
			throw new Error("Expected embedding endpoint input.");
		}

		await act(async () => {
			setInputValue(endpointInput, "http://127.0.0.1:11434/v1/embeddings");
		});
		await waitForEmbeddingDiscoveryDebounce();

		expect(discoverNKleinEndpointModelsMock).toHaveBeenCalledTimes(1);
		expect(discoverNKleinEndpointModelsMock).toHaveBeenCalledWith("workspace-1", {
			baseUrl: "http://127.0.0.1:11434/v1/embeddings",
		});
		await waitForCondition(
			() => document.body.textContent?.includes("Loaded 2 models from http://127.0.0.1:11434/v1/models.") === true,
		);
		const refreshedSelects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const discoveredModelSelect = refreshedSelects.find((select) =>
			Array.from(select.options).some((option) => option.value === "bge-m3"),
		);
		expect(discoveredModelSelect).toBeInstanceOf(HTMLSelectElement);
	});

	it("does not auto-discover non-local embedding endpoints and keeps automatic failures quiet", async () => {
		discoverNKleinEndpointModelsMock.mockRejectedValue(new Error("offline endpoint"));

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const embeddingsHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Code intelligence embeddings",
		);
		const embeddingsSection = embeddingsHeading?.parentElement ?? null;
		const selects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const defaultProviderSelect = selects[0];
		if (!(defaultProviderSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected default embedding provider select.");
		}

		await act(async () => {
			setSelectValue(defaultProviderSelect, "openai_compatible");
		});
		const endpointInput = Array.from(embeddingsSection?.querySelectorAll<HTMLInputElement>("input") ?? []).find(
			(input) => input.placeholder === "http://127.0.0.1:11434/v1/embeddings",
		);
		if (!(endpointInput instanceof HTMLInputElement)) {
			throw new Error("Expected embedding endpoint input.");
		}

		await act(async () => {
			setInputValue(endpointInput, "https://example.com/v1/embeddings");
		});
		await waitForEmbeddingDiscoveryDebounce();
		expect(discoverNKleinEndpointModelsMock).not.toHaveBeenCalled();

		await act(async () => {
			setInputValue(endpointInput, "http://127.0.0.1:11434/v1/embeddings");
		});
		await waitForEmbeddingDiscoveryDebounce();

		expect(discoverNKleinEndpointModelsMock).toHaveBeenCalledTimes(1);
		await waitForCondition(
			() =>
				document.body.textContent?.includes(
					"Could not automatically discover models from the local embedding endpoint.",
				) === true,
		);
		expect(document.body.textContent).not.toContain("offline endpoint");
	});

	it("prefills OpenAI-compatible embedding endpoints from the selected LM Studio provider", async () => {
		nkleinControllerState.providerId = "lmstudio";
		nkleinControllerState.modelId = "loaded-qwen";
		nkleinControllerState.baseUrl = "http://127.0.0.1:1234/v1";
		discoverNKleinEndpointModelsMock.mockResolvedValue({
			modelSourceUrl: "http://127.0.0.1:1234/api/v0/models",
			models: [{ id: "bge-large", name: "BGE Large" }],
		});

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const embeddingsHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Code intelligence embeddings",
		);
		const embeddingsSection = embeddingsHeading?.parentElement ?? null;
		const selects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const defaultProviderSelect = selects[0];
		if (!(defaultProviderSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected default embedding provider select.");
		}

		await act(async () => {
			setSelectValue(defaultProviderSelect, "openai_compatible");
		});
		await flushAsyncWork();
		const endpointInput = Array.from(embeddingsSection?.querySelectorAll<HTMLInputElement>("input") ?? []).find(
			(input) => input.placeholder === "http://127.0.0.1:11434/v1/embeddings",
		);
		if (!(endpointInput instanceof HTMLInputElement)) {
			throw new Error("Expected embedding endpoint input.");
		}
		expect(endpointInput.value).toBe("http://127.0.0.1:1234/v1/embeddings");

		await waitForEmbeddingDiscoveryDebounce();
		expect(discoverNKleinEndpointModelsMock).toHaveBeenCalledWith("workspace-1", {
			baseUrl: "http://127.0.0.1:1234/v1/embeddings",
		});
	});

	it("tests embedding endpoints without populating the model dropdown", async () => {
		discoverNKleinEndpointModelsMock.mockResolvedValue({
			modelSourceUrl: "http://127.0.0.1:11434/v1/models",
			models: [
				{ id: "nomic-embed-text", name: "nomic-embed-text" },
				{ id: "bge-m3", name: "bge-m3" },
			],
		});

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const embeddingsHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Code intelligence embeddings",
		);
		const embeddingsSection = embeddingsHeading?.parentElement ?? null;
		const selects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const defaultProviderSelect = selects[0];
		if (!(defaultProviderSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected default embedding provider select.");
		}

		await act(async () => {
			setSelectValue(defaultProviderSelect, "openai_compatible");
		});

		const endpointInput = Array.from(embeddingsSection?.querySelectorAll<HTMLInputElement>("input") ?? []).find(
			(input) => input.placeholder === "http://127.0.0.1:11434/v1/embeddings",
		);
		const testButton = Array.from(embeddingsSection?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
			(button) => button.textContent?.trim() === "Test endpoint",
		);
		if (!(endpointInput instanceof HTMLInputElement) || !(testButton instanceof HTMLButtonElement)) {
			throw new Error("Expected embedding test controls.");
		}

		await act(async () => {
			setInputValue(endpointInput, "http://127.0.0.1:11434/v1/embeddings");
		});
		await act(async () => {
			testButton.click();
		});

		await waitForCondition(() => discoverNKleinEndpointModelsMock.mock.calls.length > 0);
		expect(discoverNKleinEndpointModelsMock).toHaveBeenCalledWith("workspace-1", {
			baseUrl: "http://127.0.0.1:11434/v1/embeddings",
		});
		await waitForCondition(
			() =>
				document.body.textContent?.includes("Endpoint reachable: 2 models at http://127.0.0.1:11434/v1/models.") ===
				true,
		);

		const refreshedSelects = Array.from(embeddingsSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const discoveredModelSelect = refreshedSelects.find((select) =>
			Array.from(select.options).some((option) => option.value === "bge-m3"),
		);
		expect(discoveredModelSelect).toBeUndefined();
	});

	it("warns and blocks saving model roles below the minimum context window", async () => {
		fetchNKleinProviderModelsMock.mockImplementation(async (_workspaceId: string | null, providerId: string) => {
			if (providerId === "lmstudio") {
				return [
					{
						id: "loaded-qwen",
						name: "Loaded Qwen",
						contextWindow: 16_000,
						supportsReasoningEffort: true,
					},
				];
			}
			return [];
		});
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");
		const modelRolesSection = findSectionByHeading("Model roles", "Architect");
		const selects = Array.from(modelRolesSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const architectProviderSelect = selects[0];
		const architectModelSelect = selects[1];
		if (
			!(architectProviderSelect instanceof HTMLSelectElement) ||
			!(architectModelSelect instanceof HTMLSelectElement)
		) {
			throw new Error("Expected architect role selects.");
		}

		await act(async () => {
			setSelectValue(architectProviderSelect, "lmstudio");
		});
		await waitForCondition(() =>
			fetchNKleinProviderModelsMock.mock.calls.some((call) => call[0] === "workspace-1" && call[1] === "lmstudio"),
		);
		await flushAsyncWork();

		await act(async () => {
			setSelectValue(architectModelSelect, "loaded-qwen");
		});
		expect(document.body.textContent).toContain("Architect model reports 16,000 context tokens");
		await act(async () => {
			saveButton?.click();
		});

		expect(saveRuntimeConfigMock).not.toHaveBeenCalled();
		expect(handleOpenChange).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("!Klein requires at least 32,000");
	});

	it("does not offer stale LM Studio model role selections", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...savedNKleinOauthConfig,
							modelRoles: {
								architect: {
									providerId: "lmstudio",
									modelId: "configured-but-unloaded",
								},
							},
						} as RuntimeConfigResponse
					}
					onOpenChange={handleOpenChange}
				/>,
			);
		});
		await waitForCondition(() =>
			fetchNKleinProviderModelsMock.mock.calls.some((call) => call[0] === "workspace-1" && call[1] === "lmstudio"),
		);
		await waitForCondition(() => document.body.textContent?.includes("Loaded Qwen") === true);

		const modelRolesSection = findSectionByHeading("Model roles", "Architect");
		const selects = Array.from(modelRolesSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const architectModelSelect = selects[1];
		if (!(architectModelSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected architect model select to render.");
		}

		expect(Array.from(architectModelSelect.options).map((option) => option.value)).toEqual(["", "loaded-qwen"]);
		expect(document.body.textContent).toContain('Architect model "configured-but-unloaded" is not loaded');
		expect(handleOpenChange).not.toHaveBeenCalled();
	});

	it("requires an explicit loaded LM Studio model for role provider overrides", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		let saveButton = findButtonByText(document.body, "Save");
		const modelRolesSection = findSectionByHeading("Model roles", "Architect");
		const selects = Array.from(modelRolesSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const architectProviderSelect = selects[0];
		const architectModelSelect = selects[1];
		const architectAssignmentSelect = selects[2];
		if (
			!(saveButton instanceof HTMLButtonElement) ||
			!(architectProviderSelect instanceof HTMLSelectElement) ||
			!(architectModelSelect instanceof HTMLSelectElement) ||
			!(architectAssignmentSelect instanceof HTMLSelectElement)
		) {
			throw new Error("Expected architect role controls to render.");
		}
		expect(architectAssignmentSelect.value).toBe("auto");
		expect(architectAssignmentSelect.disabled).toBe(true);

		await act(async () => {
			setSelectValue(architectProviderSelect, "lmstudio");
		});
		await flushAsyncWork();

		expect(Array.from(architectModelSelect.options).map((option) => option.value)).toEqual(["", "loaded-qwen"]);
		expect(document.body.textContent).toContain("Architect role uses LM Studio");
		expect(architectAssignmentSelect.value).toBe("auto");
		expect(architectAssignmentSelect.disabled).toBe(true);
		await act(async () => {
			setSelectValue(architectAssignmentSelect, "pinned");
		});
		await flushAsyncWork();
		expect(architectAssignmentSelect.value).toBe("auto");
		await act(async () => {
			saveButton?.click();
		});
		expect(saveRuntimeConfigMock).not.toHaveBeenCalled();
		expect(handleOpenChange).not.toHaveBeenCalled();

		await act(async () => {
			setSelectValue(architectModelSelect, "loaded-qwen");
		});
		await flushAsyncWork();
		expect(architectAssignmentSelect.disabled).toBe(false);
		saveButton = findButtonByText(document.body, "Save");
		await act(async () => {
			saveButton?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				modelRoles: {
					architect: {
						providerId: "lmstudio",
						modelId: "loaded-qwen",
					},
				},
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("hides parked advisor actions while cloud provider support is disabled", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(findButtonByText(document.body, "Check models")).toBeNull();
		expect(findButtonByText(document.body, "Explain config")).toBeNull();
		expect(findButtonByText(document.body, "Analyze logs")).toBeNull();
		expect(findButtonByText(document.body, "Find MCP plugins")).toBeNull();
		expect(buildNKleinAdvisorRequestMock).not.toHaveBeenCalled();
	});

	it("keeps NKlein advisor prompts hidden when stale config enables cloud provider support", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={
						{
							...cloudEnabledNKleinOauthConfig,
							nkleinProviderSettings: {
								...cloudEnabledNKleinOauthConfig.nkleinProviderSettings,
								providerId: "lmstudio",
								modelId: "loaded-qwen",
								baseUrl: "http://localhost:1234/v1",
							},
						} as RuntimeConfigResponse
					}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(findButtonByText(document.body, "Check models")).toBeNull();
		expect(findButtonByText(document.body, "Explain config")).toBeNull();
		expect(findButtonByText(document.body, "Analyze logs")).toBeNull();
		expect(buildNKleinAdvisorRequestMock).not.toHaveBeenCalled();
		expect(sendNKleinAdvisorRequestMock).not.toHaveBeenCalled();
	});

	it("keeps MCP advisor suggestions hidden when stale config enables cloud provider support", async () => {
		buildNKleinAdvisorRequestMock.mockResolvedValueOnce({
			kind: "mcp_discovery",
			title: "Find Useful MCP Plugins",
			prompt: "Research MCP servers.",
			requiresWebResearch: true,
			recommendedSources: ["https://mcp.so/"],
		});

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={cloudEnabledNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(findButtonByText(document.body, "Find MCP plugins")).toBeNull();
		expect(buildNKleinAdvisorRequestMock).not.toHaveBeenCalled();
		expect(addMcpServerMock).not.toHaveBeenCalled();
	});

	it("hides developer tools in normal settings mode", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(document.body.textContent).not.toContain("Developer Tools");
		expect(document.body.textContent).not.toContain("Run smoke eval");
		expect(document.body.textContent).not.toContain("Suggest improvement");
	});

	it("writes self-improvement backlog artifacts from a user suggestion in debug mode", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={debugNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(document.body.textContent).toContain("Developer Tools");
		const suggestionInput = Array.from(document.body.querySelectorAll("textarea")).find(
			(textarea) =>
				textarea.getAttribute("placeholder") ===
				"Describe a !Klein improvement to turn into guarded dogfood tasks.",
		);
		if (!(suggestionInput instanceof HTMLTextAreaElement)) {
			throw new Error("Expected dogfood suggestion textarea.");
		}
		await act(async () => {
			setTextAreaValue(suggestionInput, " Improve stalled task diagnostics. ");
		});

		const suggestButton = findButtonByText(document.body, "Suggest improvement");
		expect(suggestButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			suggestButton?.click();
		});

		expect(writeNKleinDogfoodBacklogMock).toHaveBeenCalledWith("workspace-1", {
			suggestion: "Improve stalled task diagnostics.",
		});
		expect(document.body.textContent).toContain("1 task drafted");
		expect(document.body.textContent).toContain("nklein task decompose --slug dogfood");
	});

	it("runs the NKlein smoke eval from settings in debug mode", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={debugNKleinOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const runEvalButton = findButtonByText(document.body, "Run smoke eval");
		expect(runEvalButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			runEvalButton?.click();
		});

		expect(runNKleinSmokeEvalMock).toHaveBeenCalledWith("workspace-1");
		expect(document.body.textContent).toContain("ollama:qwen3.5-9b passed npm test");
		expect(document.body.textContent).toContain("/tmp/eval-evidence");
	});

	it("forwards nklein setup saves to the dialog onSaved callback", async () => {
		const handleSaved = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedNKleinOauthConfig}
					onOpenChange={() => {}}
					onSaved={handleSaved}
				/>,
			);
		});

		expect(nkleinSetupSectionOnSavedRef.onSaved).toBeTypeOf("function");

		await act(async () => {
			nkleinSetupSectionOnSavedRef.onSaved?.();
		});

		expect(handleSaved).toHaveBeenCalledTimes(1);
	});

	it("saves per-project overrides for maxConcurrentTasks and selectedAgentId (§5.W Phase 1 UI)", async () => {
		const handleOpenChange = vi.fn();
		const projectConfig = {
			...savedNKleinOauthConfig,
			projectConfigPath: "/repo/.nklein/nklein/config.json",
		} as RuntimeConfigResponse;

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={projectConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		// Both override rows should show the "inherit" state initially.
		expect(document.body.textContent).toContain("Inherits global: 3");
		expect(document.body.textContent).toContain("Inherits global: nklein");

		// Override maxConcurrentTasks: click "Override for this project" for the first OverrideRow.
		const overrideButtons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).filter(
			(b) => b.textContent?.trim() === "Override for this project",
		);
		expect(overrideButtons.length).toBeGreaterThanOrEqual(1);

		await act(async () => {
			overrideButtons[0]?.click();
		});

		// After clicking, a number input should appear seeded with the global value.
		const overrideInput = document.getElementById(
			"runtime-settings-max-concurrent-tasks-override",
		) as HTMLInputElement | null;
		expect(overrideInput).not.toBeNull();
		expect(overrideInput?.value).toBe("3");

		// Change the value to 5.
		await act(async () => {
			if (overrideInput) {
				setInputValue(overrideInput, "5");
			}
		});

		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(expect.objectContaining({ maxConcurrentTasksOverride: 5 }));
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("saves selectedAgentIdOverride when the agent override is set (§5.W Phase 1 UI)", async () => {
		const handleOpenChange = vi.fn();
		const projectConfig = {
			...savedNKleinOauthConfig,
			projectConfigPath: "/repo/.nklein/nklein/config.json",
		} as RuntimeConfigResponse;

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={projectConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		// Click "Override for this project" for the Agent row (second override button).
		const overrideButtons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).filter(
			(b) => b.textContent?.trim() === "Override for this project",
		);
		expect(overrideButtons.length).toBeGreaterThanOrEqual(2);

		await act(async () => {
			overrideButtons[1]?.click();
		});

		// A select should appear. Change it to "claude".
		const agentOverrideSelect = Array.from(document.body.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
			Array.from(s.options).some((o) => o.value === "claude"),
		);
		expect(agentOverrideSelect).toBeInstanceOf(HTMLSelectElement);

		await act(async () => {
			if (agentOverrideSelect) {
				setSelectValue(agentOverrideSelect, "claude");
			}
		});

		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({ selectedAgentIdOverride: "claude" }),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("saves modelRolesOverride and agentRulesetsOverride when nested overrides are enabled (§5.W Phase 1b UI)", async () => {
		const handleOpenChange = vi.fn();
		const projectConfig = {
			...savedNKleinOauthConfig,
			projectConfigPath: "/repo/.nklein/nklein/config.json",
		} as RuntimeConfigResponse;

		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={projectConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		// Initially all nested override rows show "inherit" state.
		expect(document.body.textContent).toContain("Model roles");
		expect(document.body.textContent).toContain("Agent rulesets");

		// At least 5 "Override for this project" rows (maxConcurrentTasks, agent, modelRoles, agentRulesets, concurrency).
		const overrideButtons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).filter(
			(b) => b.textContent?.trim() === "Override for this project",
		);
		expect(overrideButtons.length).toBeGreaterThanOrEqual(5);

		// Click the override toggle of a row by its label (the label span + button are siblings in the OverrideRow).
		const clickRowOverride = async (label: string) => {
			const row = Array.from(document.body.querySelectorAll<HTMLDivElement>("div.grid.gap-1")).find(
				(candidate) => candidate.querySelector("span")?.textContent?.trim() === label,
			);
			const button = row?.querySelector<HTMLButtonElement>("button");
			await act(async () => {
				button?.click();
			});
		};

		await clickRowOverride("Model roles");

		// The row switches to override mode — a "Revert to global" button should appear.
		const revertButtons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).filter(
			(b) => b.textContent?.trim() === "Revert to global",
		);
		expect(revertButtons.length).toBeGreaterThanOrEqual(1);

		await clickRowOverride("Agent rulesets");
		await clickRowOverride("Concurrency caps");

		// Save — all three nested overrides should be included in the payload (non-null).
		await act(async () => {
			findButtonByText(document.body, "Save")?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				modelRolesOverride: expect.anything(),
				agentRulesetsOverride: expect.anything(),
				concurrencyOverride: expect.anything(),
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});
});
