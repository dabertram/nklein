import type { ReactNode } from "react";
import { act, createContext, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RuntimeSettingsDialog } from "@/components/runtime-settings-dialog";
import type { RuntimeConfigResponse } from "@/runtime/types";

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

const resetLayoutCustomizationsMock = vi.hoisted(() => vi.fn());
const saveRuntimeConfigMock = vi.hoisted(() => vi.fn(async () => true));
const buildClineAdvisorRequestMock = vi.hoisted(() => vi.fn());
const writeClineDogfoodBacklogMock = vi.hoisted(() => vi.fn());
const runClineSmokeEvalMock = vi.hoisted(() => vi.fn());
const fetchClineProviderModelsMock = vi.hoisted(() => vi.fn());
const fetchClineCodeIntelligenceStatusMock = vi.hoisted(() => vi.fn());
const fetchClineModelRegistryMock = vi.hoisted(() => vi.fn());
const saveClineModelContextWindowOverrideMock = vi.hoisted(() => vi.fn());
const openFileOnHostMock = vi.hoisted(() => vi.fn(async () => undefined));
const addMcpServerMock = vi.hoisted(() => vi.fn());
const clineSetupSectionOnSavedRef = vi.hoisted(() => ({
	onSaved: null as null | (() => void),
}));

vi.mock("@runtime-agent-catalog", () => ({
	getRuntimeAgentCatalogEntry: vi.fn((agentId: string) => ({
		id: agentId,
		installUrl: null,
		autonomousArgs: [],
	})),
	getRuntimeLaunchSupportedAgentCatalog: vi.fn(() => [
		{ id: "cline", label: "Cline", binary: "cline" },
		{ id: "claude", label: "Claude Code", binary: "claude" },
	]),
}));

vi.mock("@runtime-shortcuts", () => ({
	areRuntimeProjectShortcutsEqual: vi.fn(() => true),
}));

vi.mock("@/components/shared/cline-setup-section", () => ({
	ClineSetupSection: ({ onSaved }: { onSaved?: () => void }) => {
		clineSetupSectionOnSavedRef.onSaved = onSaved ?? null;
		return null;
	},
}));

vi.mock("@/hooks/use-runtime-settings-cline-controller", () => ({
	useRuntimeSettingsClineController: () => ({
		currentProviderSettings: {
			providerId: "anthropic",
			modelId: "claude-3-7-sonnet",
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: true,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		hasUnsavedChanges: false,
		providerId: "anthropic",
		modelId: "claude-3-7-sonnet",
		baseUrl: "",
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
		saveProviderSettings: vi.fn(async () => ({ ok: true })),
	}),
}));

vi.mock("@/hooks/use-runtime-settings-cline-mcp-controller", () => ({
	useRuntimeSettingsClineMcpController: () => ({
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
	buildClineAdvisorRequest: buildClineAdvisorRequestMock,
	fetchClineCodeIntelligenceStatus: fetchClineCodeIntelligenceStatusMock,
	fetchClineModelRegistry: fetchClineModelRegistryMock,
	fetchClineProviderModels: fetchClineProviderModelsMock,
	openFileOnHost: openFileOnHostMock,
	runClineSmokeEval: runClineSmokeEvalMock,
	saveClineModelContextWindowOverride: saveClineModelContextWindowOverrideMock,
	writeClineDogfoodBacklog: writeClineDogfoodBacklogMock,
}));

vi.mock("@/utils/notification-permission", () => ({
	getBrowserNotificationPermission: () => "unsupported",
	requestBrowserNotificationPermission: vi.fn(async () => "unsupported"),
}));

function findButtonByText(container: ParentNode, text: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ??
		null) as HTMLButtonElement | null;
}

function findButtonByAriaLabel(container: ParentNode, ariaLabel: string): HTMLButtonElement | null {
	return (Array.from(container.querySelectorAll("button")).find(
		(button) => button.getAttribute("aria-label") === ariaLabel,
	) ?? null) as HTMLButtonElement | null;
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
	const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
	valueSetter?.call(select, value);
	select.dispatchEvent(new Event("change", { bubbles: true }));
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

const savedClineOauthConfig = {
	selectedAgentId: "cline",
	selectedShortcutLabel: null,
	agentAutonomousModeEnabled: true,
	readyForReviewNotificationsEnabled: false,
	effectiveCommand: "cline",
	detectedCommands: [],
	shortcuts: [],
	modelRoles: {},
	commitPromptTemplate: "",
	openPrPromptTemplate: "",
	commitPromptTemplateDefault: "",
	openPrPromptTemplateDefault: "",
	globalConfigPath: null,
	projectConfigPath: null,
	agents: [
		{
			id: "cline",
			label: "Cline",
			binary: "cline",
			command: "cline",
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
	clineProviderSettings: {
		providerId: null,
		modelId: "cline-sonnet",
		baseUrl: null,
		reasoningEffort: null,
		apiKeyConfigured: false,
		oauthProvider: "cline",
		oauthAccessTokenConfigured: true,
		oauthRefreshTokenConfigured: true,
		oauthAccountId: "acc-1",
		oauthExpiresAt: 1_800_000_000_000,
	},
} as unknown as RuntimeConfigResponse;

describe("RuntimeSettingsDialog", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		resetLayoutCustomizationsMock.mockReset();
		buildClineAdvisorRequestMock.mockReset();
		buildClineAdvisorRequestMock.mockResolvedValue({
			kind: "model_freshness",
			title: "Check For Better Models",
			prompt: "Compare connected models.",
			requiresWebResearch: true,
			recommendedSources: ["https://openrouter.ai/models"],
		});
		writeClineDogfoodBacklogMock.mockReset();
		writeClineDogfoodBacklogMock.mockResolvedValue({
			rootPath: "/repo/.cline/kanban/plans/dogfood",
			specPath: "/repo/.cline/kanban/plans/dogfood/spec.md",
			planPath: "/repo/.cline/kanban/plans/dogfood/plan.md",
			questionsPath: "/repo/.cline/kanban/plans/dogfood/questions.md",
			decisionsPath: "/repo/.cline/kanban/plans/dogfood/decisions.md",
			revisionsPath: "/repo/.cline/kanban/plans/dogfood/revisions.md",
			summaryPath: "/repo/.cline/kanban/plans/dogfood/summary.md",
			taskGraphPath: "/repo/.cline/kanban/plans/dogfood/tasks.json",
			slug: "dogfood",
			taskCount: 1,
			nextCommand: "kanban task decompose --slug dogfood --project-path /repo",
		});
		runClineSmokeEvalMock.mockReset();
		runClineSmokeEvalMock.mockResolvedValue({
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
		fetchClineCodeIntelligenceStatusMock.mockReset();
		fetchClineCodeIntelligenceStatusMock.mockResolvedValue({
			repoMap: {
				filesScanned: 12,
				symbols: 34,
				tokenCount: 900,
				truncated: false,
				available: true,
				error: null,
			},
			codeIndex: {
				cachePath: "/repo/.cline/kanban/code-index-v1.json",
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
		fetchClineModelRegistryMock.mockReset();
		fetchClineModelRegistryMock.mockResolvedValue({
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
		});
		saveClineModelContextWindowOverrideMock.mockReset();
		saveClineModelContextWindowOverrideMock.mockResolvedValue({
			model: {
				key: "ollama:qwen:http://127.0.0.1:11434",
			},
		});
		fetchClineProviderModelsMock.mockReset();
		fetchClineProviderModelsMock.mockImplementation(async (_workspaceId: string | null, providerId: string) => {
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
		addMcpServerMock.mockReset();
		addMcpServerMock.mockResolvedValue({ ok: true });
		openFileOnHostMock.mockClear();
		saveRuntimeConfigMock.mockClear();
		saveRuntimeConfigMock.mockResolvedValue(true);
		clineSetupSectionOnSavedRef.onSaved = null;
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
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(findButtonByText(document.body, "Send feedback")).toBeNull();
		expect(findButtonByText(document.body, "Report issue")).toBeNull();
	});

	it("surfaces local swarm guardrail limits in settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={{ ...savedClineOauthConfig, maxConcurrentTasks: 5 } as RuntimeConfigResponse}
					onOpenChange={() => {}}
				/>,
			);
		});

		expect(document.body.textContent).toContain("Local swarm guardrails");
		expect(document.body.textContent).toContain("5 running max");
		expect(document.body.textContent).toContain("Card batch budget");
		expect(document.body.textContent).toContain("12 cards");
		expect(document.body.textContent).toContain("Autonomous turns");
		expect(document.body.textContent).toContain("12 turns");
		expect(document.body.textContent).toContain("Wall time");
		expect(document.body.textContent).toContain("2 hours");
		expect(document.body.textContent).toContain("No-diff checkpoints");
		expect(document.body.textContent).toContain("4 repeats");
		expect(document.body.textContent).toContain("Repeated tool calls");
		expect(document.body.textContent).toContain("5 repeats");
	});

	it("shows Cline code intelligence status in settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
			await Promise.resolve();
		});
		await waitForCondition(() => document.body.textContent?.includes("16/20 chunks") === true);

		expect(fetchClineCodeIntelligenceStatusMock).toHaveBeenCalledWith("workspace-1");
		expect(document.body.textContent).toContain("Code intelligence");
		expect(document.body.textContent).toContain("16/20 chunks (80%) indexed");
		expect(document.body.textContent).toContain("repo map ready");
		expect(document.body.textContent).toContain("12 files scanned");
		expect(document.body.textContent).toContain("34 symbols");
	});

	it("shows active code-index progress in settings", async () => {
		fetchClineCodeIntelligenceStatusMock.mockResolvedValueOnce({
			repoMap: {
				filesScanned: 12,
				symbols: 34,
				tokenCount: 900,
				truncated: false,
				available: true,
				error: null,
			},
			codeIndex: {
				cachePath: "/repo/.cline/kanban/code-index-v1.json",
				cacheExists: true,
				embeddingProvider: "local_lexical",
				embeddingModel: "kanban-local-lexical-vector-v1",
				updatedAt: Date.now(),
				totalFiles: 12,
				totalChunks: 20,
				indexedFiles: 6,
				indexedChunks: 8,
				staleFiles: 1,
				missingFiles: 1,
				searchAvailable: true,
				progress: {
					phase: "embedding",
					startedAt: Date.now(),
					updatedAt: Date.now(),
					filesTotal: 12,
					filesProcessed: 12,
					chunksTotal: 20,
					chunksProcessed: 8,
					cacheHitCount: 3,
					cacheMissCount: 5,
					message: "Embedding 20 code chunks",
				},
				error: null,
			},
		});
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
			await Promise.resolve();
		});
		await waitForCondition(() => document.body.textContent?.includes("Indexing 8/20 chunks") === true);

		expect(document.body.textContent).toContain("Indexing 8/20 chunks");
	});

	it("shows and saves local model context-window overrides in settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
			await Promise.resolve();
		});
		await waitForCondition(() => document.body.textContent?.includes("Model context windows") === true);
		await waitForCondition(() => document.body.textContent?.includes("ollama/qwen") === true);

		expect(fetchClineModelRegistryMock).toHaveBeenCalledWith("workspace-1");
		expect(document.body.textContent).toContain("1 local model tracked");
		expect(document.body.textContent).toContain("Effective: 64,000");
		const input = document.body.querySelector("input[aria-label='Context window override for ollama/qwen']");
		expect(input).toBeInstanceOf(HTMLInputElement);
		await act(async () => {
			if (input instanceof HTMLInputElement) {
				input.value = "96000";
				input.dispatchEvent(new Event("input", { bubbles: true }));
			}
			await Promise.resolve();
		});
		const saveButton = Array.from(document.body.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Save",
		);
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		await act(async () => {
			saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await Promise.resolve();
		});

		expect(saveClineModelContextWindowOverrideMock).toHaveBeenCalledWith("workspace-1", {
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
					initialConfig={savedClineOauthConfig}
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
					initialConfig={savedClineOauthConfig}
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
				reviewActionSelect.value = "pr";
				reviewActionSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
		});

		const saveButton = findButtonByText(document.body, "Save");
		expect(saveButton?.disabled).toBe(false);
		await act(async () => {
			saveButton?.click();
		});

		expect(window.localStorage.getItem("kanban.task-start-in-plan-mode")).toBe("true");
		expect(window.localStorage.getItem("kanban.task-auto-review-enabled")).toBe("true");
		expect(window.localStorage.getItem("kanban.task-auto-review-mode")).toBe("pr");
	});

	it("enables save on theme change and reverts preview on cancel", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");
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
		expect(saveButton?.disabled).toBe(false);
		expect(window.localStorage.getItem("kanban.theme")).toBeNull();

		await act(async () => {
			cancelButton?.click();
		});

		expect(handleOpenChange).toHaveBeenCalledWith(false);
		expect(window.localStorage.getItem("kanban.theme")).toBeNull();
		expect(document.documentElement.getAttribute("data-theme")).toBeNull();
	});

	it("persists theme selection only after clicking save", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");

		expect(saveButton).toBeInstanceOf(HTMLButtonElement);

		// Click the Graphite option to trigger onValueChange.
		const graphiteOption = Array.from(document.querySelectorAll('[role="option"]')).find((el) =>
			el.textContent?.includes("Graphite"),
		) as HTMLElement | undefined;
		expect(graphiteOption).toBeTruthy();
		await act(async () => {
			graphiteOption?.click();
		});

		expect(window.localStorage.getItem("kanban.theme")).toBeNull();

		await act(async () => {
			saveButton?.click();
		});

		expect(handleOpenChange).toHaveBeenCalledWith(false);
		expect(window.localStorage.getItem("kanban.theme")).toBe("graphite");
		expect(document.documentElement.getAttribute("data-theme")).toBe("graphite");
	});

	it("saves configured Cline model roles", async () => {
		const handleOpenChange = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");
		const modelRolesHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Model roles",
		);
		const modelRolesSection = modelRolesHeading?.parentElement ?? null;
		const selects = Array.from(modelRolesSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const architectProviderSelect = selects[0];
		const architectModelSelect = selects[1];
		const architectReasoningSelect = selects[2];
		expect(saveButton).toBeInstanceOf(HTMLButtonElement);
		expect(modelRolesSection).toBeInstanceOf(HTMLDivElement);
		if (
			!(architectProviderSelect instanceof HTMLSelectElement) ||
			!(architectModelSelect instanceof HTMLSelectElement) ||
			!(architectReasoningSelect instanceof HTMLSelectElement)
		) {
			throw new Error("Expected architect model role controls to render.");
		}

		await act(async () => {
			setSelectValue(architectProviderSelect, "openrouter");
		});
		await waitForCondition(() =>
			fetchClineProviderModelsMock.mock.calls.some((call) => call[0] === "workspace-1" && call[1] === "openrouter"),
		);
		await flushAsyncWork();
		expect(fetchClineProviderModelsMock).toHaveBeenCalledWith("workspace-1", "openrouter");
		expect(Array.from(architectModelSelect.options).map((option) => option.value)).toContain("google/gemini-2.5-pro");

		await act(async () => {
			setSelectValue(architectModelSelect, "google/gemini-2.5-pro");
			setSelectValue(architectReasoningSelect, "high");
		});

		expect(saveButton?.disabled).toBe(false);

		await act(async () => {
			saveButton?.click();
		});

		expect(saveRuntimeConfigMock).toHaveBeenCalledWith(
			expect.objectContaining({
				modelRoles: {
					architect: {
						providerId: "openrouter",
						modelId: "google/gemini-2.5-pro",
						reasoningEffort: "high",
					},
				},
			}),
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("warns and blocks saving model roles below the minimum context window", async () => {
		fetchClineProviderModelsMock.mockImplementation(async (_workspaceId: string | null, providerId: string) => {
			if (providerId === "openrouter") {
				return [
					{
						id: "openai/gpt-5.4",
						name: "GPT-5.4",
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
					initialConfig={savedClineOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");
		const modelRolesHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Model roles",
		);
		const modelRolesSection = modelRolesHeading?.parentElement ?? null;
		const architectProviderSelect = modelRolesSection?.querySelector<HTMLSelectElement>("select");
		if (!(architectProviderSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected architect provider select.");
		}

		await act(async () => {
			setSelectValue(architectProviderSelect, "openrouter");
		});
		await waitForCondition(() =>
			fetchClineProviderModelsMock.mock.calls.some((call) => call[0] === "workspace-1" && call[1] === "openrouter"),
		);
		await flushAsyncWork();

		expect(document.body.textContent).toContain("Architect model reports 16,000 context tokens");
		await act(async () => {
			saveButton?.click();
		});

		expect(saveRuntimeConfigMock).not.toHaveBeenCalled();
		expect(handleOpenChange).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain("Kanban requires at least 32,000");
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
							...savedClineOauthConfig,
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
			fetchClineProviderModelsMock.mock.calls.some((call) => call[0] === "workspace-1" && call[1] === "lmstudio"),
		);
		await waitForCondition(() => document.body.textContent?.includes("Loaded Qwen") === true);

		const modelRolesHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Model roles",
		);
		const modelRolesSection = modelRolesHeading?.parentElement ?? null;
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
					initialConfig={savedClineOauthConfig}
					onOpenChange={handleOpenChange}
				/>,
			);
		});

		const saveButton = findButtonByText(document.body, "Save");
		const modelRolesHeading = Array.from(document.querySelectorAll("h6")).find(
			(element) => element.textContent?.trim() === "Model roles",
		);
		const modelRolesSection = modelRolesHeading?.parentElement ?? null;
		const selects = Array.from(modelRolesSection?.querySelectorAll<HTMLSelectElement>("select") ?? []);
		const architectProviderSelect = selects[0];
		const architectModelSelect = selects[1];
		if (
			!(saveButton instanceof HTMLButtonElement) ||
			!(architectProviderSelect instanceof HTMLSelectElement) ||
			!(architectModelSelect instanceof HTMLSelectElement)
		) {
			throw new Error("Expected architect role controls to render.");
		}

		await act(async () => {
			setSelectValue(architectProviderSelect, "lmstudio");
		});
		await flushAsyncWork();

		expect(Array.from(architectModelSelect.options).map((option) => option.value)).toEqual(["", "loaded-qwen"]);
		expect(document.body.textContent).toContain("Architect role uses LM Studio");
		await act(async () => {
			saveButton.click();
		});
		expect(saveRuntimeConfigMock).not.toHaveBeenCalled();
		expect(handleOpenChange).not.toHaveBeenCalled();

		await act(async () => {
			setSelectValue(architectModelSelect, "loaded-qwen");
		});
		await act(async () => {
			saveButton.click();
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

	it("builds and copies Cline advisor prompts from settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const checkModelsButton = findButtonByText(document.body, "Check models");
		expect(checkModelsButton).toBeInstanceOf(HTMLButtonElement);
		expect(findButtonByText(document.body, "Explain config")).toBeInstanceOf(HTMLButtonElement);
		expect(findButtonByText(document.body, "Analyze logs")).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			checkModelsButton?.click();
		});

		expect(buildClineAdvisorRequestMock).toHaveBeenCalledWith("workspace-1", { kind: "model_freshness" });
		expect(document.body.textContent).toContain("Check For Better Models");
		expect(document.body.textContent).toContain("openrouter.ai");

		const copyButton = findButtonByText(document.body, "Copy prompt");
		expect(copyButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			copyButton?.click();
		});

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Compare connected models.");

		const explainConfigButton = findButtonByText(document.body, "Explain config");
		await act(async () => {
			explainConfigButton?.click();
		});

		expect(buildClineAdvisorRequestMock).toHaveBeenLastCalledWith(
			"workspace-1",
			expect.objectContaining({
				kind: "config_explainer",
				runtimeConfigSummary: expect.stringContaining("selectedAgentId=cline"),
			}),
		);
	});

	it("adds a pasted MCP advisor suggestion to Cline MCP settings", async () => {
		buildClineAdvisorRequestMock.mockResolvedValueOnce({
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
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const findPluginsButton = findButtonByText(document.body, "Find MCP plugins");
		expect(findPluginsButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			findPluginsButton?.click();
		});

		const suggestionInput = Array.from(document.body.querySelectorAll("textarea")).find((textarea) =>
			textarea.getAttribute("placeholder")?.includes('"mcpServers"'),
		);
		if (!(suggestionInput instanceof HTMLTextAreaElement)) {
			throw new Error("Expected MCP suggestion textarea.");
		}
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		await act(async () => {
			valueSetter?.call(
				suggestionInput,
				JSON.stringify({
					mcpServers: [
						{
							name: "linear",
							type: "streamableHttp",
							url: "https://mcp.linear.app/mcp",
						},
					],
				}),
			);
			suggestionInput.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const findAddableButton = findButtonByText(document.body, "Find addable servers");
		expect(findAddableButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			findAddableButton?.click();
		});

		const addButton = findButtonByText(document.body, "Add");
		expect(addButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			addButton?.click();
		});

		expect(addMcpServerMock).toHaveBeenCalledWith({
			name: "linear",
			disabled: false,
			type: "streamableHttp",
			url: "https://mcp.linear.app/mcp",
		});
	});

	it("writes self-improvement backlog artifacts from a user suggestion", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const suggestionInput = Array.from(document.body.querySelectorAll("textarea")).find(
			(textarea) =>
				textarea.getAttribute("placeholder") ===
				"Describe a Kanban improvement to turn into guarded dogfood tasks.",
		);
		if (!(suggestionInput instanceof HTMLTextAreaElement)) {
			throw new Error("Expected dogfood suggestion textarea.");
		}
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
		await act(async () => {
			valueSetter?.call(suggestionInput, " Improve stalled task diagnostics. ");
			suggestionInput.dispatchEvent(new Event("input", { bubbles: true }));
		});

		const suggestButton = findButtonByText(document.body, "Suggest improvement");
		expect(suggestButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			suggestButton?.click();
		});

		expect(writeClineDogfoodBacklogMock).toHaveBeenCalledWith("workspace-1", {
			suggestion: "Improve stalled task diagnostics.",
		});
		expect(document.body.textContent).toContain("1 task drafted");
		expect(document.body.textContent).toContain("kanban task decompose --slug dogfood");
	});

	it("runs the Cline smoke eval from settings", async () => {
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
				/>,
			);
		});

		const runEvalButton = findButtonByText(document.body, "Run smoke eval");
		expect(runEvalButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			runEvalButton?.click();
		});

		expect(runClineSmokeEvalMock).toHaveBeenCalledWith("workspace-1");
		expect(document.body.textContent).toContain("ollama:qwen3.5-9b passed npm test");
		expect(document.body.textContent).toContain("/tmp/eval-evidence");
	});

	it("forwards cline setup saves to the dialog onSaved callback", async () => {
		const handleSaved = vi.fn();
		await act(async () => {
			root.render(
				<RuntimeSettingsDialog
					open={true}
					workspaceId={"workspace-1"}
					initialConfig={savedClineOauthConfig}
					onOpenChange={() => {}}
					onSaved={handleSaved}
				/>,
			);
		});

		expect(clineSetupSectionOnSavedRef.onSaved).toBeTypeOf("function");

		await act(async () => {
			clineSetupSectionOnSavedRef.onSaved?.();
		});

		expect(handleSaved).toHaveBeenCalledTimes(1);
	});
});
