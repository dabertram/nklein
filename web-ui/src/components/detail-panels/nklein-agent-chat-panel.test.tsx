import { DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT, DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import { act, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	estimateNKleinRequestHistoryTokens,
	estimateNKleinRequestMessageTokens,
	extractClarifyingQuestionPrompt,
	extractProtectedTestApprovalPrompt,
	findNKleinModelRegistryEntry,
	formatNKleinCardContentDisplay,
	formatNKleinContextBudgetDisplay,
	formatNKleinModelActivityDisplay,
	formatNKleinModelRegistryDisplay,
	NKleinAgentChatPanel,
	type NKleinAgentChatPanelHandle,
} from "@/components/detail-panels/nklein-agent-chat-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NKleinChatMessage } from "@/hooks/use-nklein-chat-session";
import type {
	RuntimeConfigResponse,
	RuntimeNKleinModelRegistryEntry,
	RuntimeNKleinTeamProgressEvent,
	RuntimeTaskHookActivity,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import { resetWorkspaceMetadataStore, setTaskWorkspaceSnapshot } from "@/stores/workspace-metadata-store";

function createSummary(
	state: RuntimeTaskSessionSummary["state"],
	latestHookActivity: RuntimeTaskHookActivity | null = null,
	overrides: Partial<RuntimeTaskSessionSummary> = {},
): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state,
		agentId: "nklein",
		workspacePath: "/tmp/worktree",
		pid: null,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createModelRegistryEntry(
	overrides: Partial<RuntimeNKleinModelRegistryEntry> = {},
): RuntimeNKleinModelRegistryEntry {
	return {
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
		...overrides,
	};
}

function renderPanel(root: Root, panel: ReactElement): void {
	root.render(<TooltipProvider>{panel}</TooltipProvider>);
}

function createRuntimeConfig(agentTimeoutMode: RuntimeConfigResponse["agentTimeoutMode"]): RuntimeConfigResponse {
	return {
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode,
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
		effectiveCommand: null,
		globalConfigPath: "/tmp/global-config",
		projectConfigPath: null,
		readyForReviewNotificationsEnabled: true,
		detectedCommands: [],
		agents: [],
		shortcuts: [],
		modelRoles: {},
		agentRulesetsOverride: null,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		memoryFreshnessAudit: DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT,
		nkleinProviderSettings: {
			providerId: null,
			modelId: null,
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
	};
}

function getMessageList(container: HTMLElement): HTMLDivElement {
	const messageList = container.querySelector("div.overflow-y-auto");
	expect(messageList).toBeInstanceOf(HTMLDivElement);
	if (!(messageList instanceof HTMLDivElement)) {
		throw new Error("Expected chat message list.");
	}
	return messageList;
}

function mockScrollMetrics(
	element: HTMLDivElement,
	initialValues: { scrollHeight: number; clientHeight: number; scrollTop: number },
): {
	getScrollTop: () => number;
	setScrollHeight: (value: number) => void;
	setScrollTop: (value: number) => void;
} {
	let currentScrollHeight = initialValues.scrollHeight;
	const currentClientHeight = initialValues.clientHeight;
	let currentScrollTop = initialValues.scrollTop;

	Object.defineProperty(element, "scrollHeight", {
		configurable: true,
		get: () => currentScrollHeight,
	});
	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		get: () => currentClientHeight,
	});
	Object.defineProperty(element, "scrollTop", {
		configurable: true,
		get: () => currentScrollTop,
		set: (value: number) => {
			currentScrollTop = value;
		},
	});

	return {
		getScrollTop: () => currentScrollTop,
		setScrollHeight: (value: number) => {
			currentScrollHeight = value;
		},
		setScrollTop: (value: number) => {
			currentScrollTop = value;
		},
	};
}

describe("NKleinAgentChatPanel", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		resetWorkspaceMetadataStore();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		act(() => {
			root.unmount();
		});
		resetWorkspaceMetadataStore();
		window.localStorage.clear();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("labels the fallback as a working budget when the model limit is unavailable", () => {
		const contextBudget = formatNKleinContextBudgetDisplay({
			estimatedContextTokens: 96_000,
			contextScope: "smart",
			modelContextWindow: null,
		});

		expect(contextBudget.limit).toBe(120_000);
		expect(contextBudget.text).toContain("fallback working budget");
		expect(contextBudget.text).toContain("model max unavailable");
		expect(contextBudget.text).toContain("120k");
	});

	it("shows the loaded model context window when one is available", () => {
		const contextBudget = formatNKleinContextBudgetDisplay({
			estimatedContextTokens: 96_000,
			contextScope: "smart",
			modelContextWindow: 256_000,
		});

		expect(contextBudget.limit).toBe(256_000);
		expect(contextBudget.text).toContain("256k effective model window");
		expect(contextBudget.text).toContain("estimated request ~96k tokens");
		expect(contextBudget.text).not.toContain("fallback working budget");
	});

	it("calls out when estimated context exceeds the loaded model window", () => {
		const contextBudget = formatNKleinContextBudgetDisplay({
			estimatedContextTokens: 87_000,
			estimatedNextPromptTokens: 6_000,
			contextScope: "smart",
			modelContextWindow: 80_000,
		});

		expect(contextBudget.limit).toBe(80_000);
		expect(contextBudget.percent).toBe(100);
		expect(contextBudget.text).toBe(
			"estimated request ~87k tokens · 80k effective model window (100% · over by ~7k · overflow)",
		);
	});

	it("formats card content token estimates separately from request context", () => {
		const text = formatNKleinCardContentDisplay({
			taskTitle: "Konten Bilanzierungs Tool",
			taskPrompt: "Build the reconciliation workflow.",
		});

		expect(text).toContain("Card content: ~");
		expect(text).toContain("tokens");
	});

	it("matches model registry entries by provider and model", () => {
		const qwenEntry = createModelRegistryEntry();
		const sonnetEntry = createModelRegistryEntry({
			key: "nklein:sonnet:default",
			providerId: "nklein",
			modelId: "sonnet",
			endpoint: null,
		});

		expect(findNKleinModelRegistryEntry([qwenEntry, sonnetEntry], " OLLAMA ", "qwen")).toBe(qwenEntry);
		expect(findNKleinModelRegistryEntry([qwenEntry, sonnetEntry], "nklein", "missing")).toBeNull();
	});

	it("formats model telemetry when measured registry stats exist", () => {
		const text = formatNKleinModelRegistryDisplay(createModelRegistryEntry());

		expect(text).toBe("Model telemetry: 16k measured window · 800 tok/s in · 40 tok/s out · 2000 ms/1k · cap 68");
	});

	it("hides model telemetry until the model has request samples", () => {
		const text = formatNKleinModelRegistryDisplay(
			createModelRegistryEntry({
				speed: {
					...createModelRegistryEntry().speed,
					samples: 0,
				},
			}),
		);

		expect(text).toBeNull();
	});

	it("counts the newest read_files output while treating older chunks as compacted", () => {
		const hugeOutput = "line of source text\n".repeat(5_000);
		const olderReadFilesMessage: NKleinChatMessage = {
			id: "m1",
			role: "tool",
			content: `Tool: read_files\nInput: src/big.ts:1-1500\nOutput:\n${hugeOutput}`,
			createdAt: Date.now(),
			meta: { toolName: "read_files" },
		};
		const newestReadFilesMessage: NKleinChatMessage = {
			id: "m2",
			role: "tool",
			content: `Tool: read_files\nInput: src/big.ts:1501-3000\nOutput:\n${hugeOutput}`,
			createdAt: Date.now(),
			meta: { toolName: "read_files" },
		};

		const compactedReadTokens = estimateNKleinRequestMessageTokens(olderReadFilesMessage);
		const retainedReadTokens = estimateNKleinRequestMessageTokens(newestReadFilesMessage, {
			retainReadFilesOutput: true,
		});
		const historyTokens = estimateNKleinRequestHistoryTokens([olderReadFilesMessage, newestReadFilesMessage]);

		expect(compactedReadTokens).toBeLessThan(200);
		expect(retainedReadTokens).toBeGreaterThan(1_000);
		expect(historyTokens).toBe(compactedReadTokens + retainedReadTokens);
	});

	it("counts read_large_file output with the same newest-chunk policy", () => {
		const olderMessage: NKleinChatMessage = {
			id: "large-read-1",
			role: "tool",
			content: `Tool: read_large_file\nOutput:\n${"older source ".repeat(1_000)}`,
			createdAt: Date.now(),
			meta: { toolName: "read_large_file" },
		};
		const newestMessage: NKleinChatMessage = {
			id: "large-read-2",
			role: "tool",
			content: `Tool: read_large_file\nOutput:\n${"current source ".repeat(1_000)}`,
			createdAt: Date.now(),
			meta: { toolName: "read_large_file" },
		};

		const compactedTokens = estimateNKleinRequestMessageTokens(olderMessage);
		const retainedTokens = estimateNKleinRequestMessageTokens(newestMessage, {
			retainReadFilesOutput: true,
		});

		expect(estimateNKleinRequestHistoryTokens([olderMessage, newestMessage])).toBe(compactedTokens + retainedTokens);
	});

	it("formats waiting model activity before the first streamed token", () => {
		const text = formatNKleinModelActivityDisplay({
			summary: createSummary("running", null, {
				startedAt: 10_000,
				updatedAt: 10_000,
				lastTokenAt: null,
			}),
			messages: [],
			nowMs: 75_000,
		});

		expect(text).toBe("Model activity: waiting for response · processing since 1m 5s");
	});

	it("includes current request context in model activity", () => {
		const text = formatNKleinModelActivityDisplay({
			summary: createSummary("running", null, {
				startedAt: 10_000,
				updatedAt: 10_000,
				lastTokenAt: null,
			}),
			messages: [],
			nowMs: 75_000,
			currentRequestContextText: "request context ~12k tokens / 80k effective window (15% · healthy)",
		});

		expect(text).toBe(
			"Model activity: waiting for response · request context ~12k tokens / 80k effective window (15% · healthy) · processing since 1m 5s",
		);
	});

	it("formats streaming model activity with generated text token estimates", () => {
		const text = formatNKleinModelActivityDisplay({
			summary: createSummary("running", null, {
				startedAt: 10_000,
				updatedAt: 10_000,
				lastTokenAt: 70_000,
			}),
			messages: [
				{
					id: "user-1",
					role: "user",
					content: "Please continue",
					createdAt: 60_000,
				},
				{
					id: "assistant-1",
					role: "assistant",
					content: "Streaming text from the model",
					createdAt: 70_000,
				},
			],
			nowMs: 75_000,
		});

		expect(text).toBe("Model activity: streaming · processing since 15s");
	});

	it("formats reasoning activity as streaming when it belongs to the current turn", () => {
		const text = formatNKleinModelActivityDisplay({
			summary: createSummary("running", null, {
				startedAt: 10_000,
				updatedAt: 10_000,
				lastTokenAt: 70_000,
			}),
			messages: [
				{
					id: "assistant-previous",
					role: "assistant",
					content: "Previous answer",
					createdAt: 20_000,
				},
				{
					id: "user-2",
					role: "user",
					content: "Please continue",
					createdAt: 60_000,
				},
				{
					id: "reasoning-2",
					role: "reasoning",
					content: "Thinking through the next step",
					createdAt: 70_000,
				},
			],
			nowMs: 75_000,
		});

		expect(text).toBe("Model activity: streaming · processing since 15s");
	});

	it("does not report streaming from stale previous-turn output", () => {
		const text = formatNKleinModelActivityDisplay({
			summary: createSummary("running", null, {
				startedAt: 10_000,
				updatedAt: 10_000,
				lastTokenAt: 70_000,
			}),
			messages: [
				{
					id: "assistant-previous",
					role: "assistant",
					content: "Previous answer",
					createdAt: 20_000,
				},
				{
					id: "reasoning-previous",
					role: "reasoning",
					content: "Previous reasoning",
					createdAt: 30_000,
				},
				{
					id: "user-2",
					role: "user",
					content: "Please continue",
					createdAt: 60_000,
				},
			],
			nowMs: 75_000,
		});

		expect(text).toBe("Model activity: waiting for response · processing since 15s");
	});

	it("reports idle model activity after a response when the task is not running", () => {
		const text = formatNKleinModelActivityDisplay({
			summary: createSummary("idle", null, {
				lastTokenAt: 70_000,
			}),
			messages: [],
			nowMs: 75_000,
		});

		expect(text).toBe("Model activity: idle · last response 5s ago");
	});

	it("renders reasoning and tool messages with specialized UI", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "reasoning-1",
				role: "reasoning",
				content: "Thinking through the next edit",
				createdAt: 1,
			},
			{
				id: "tool-1",
				role: "tool",
				content: [
					"Tool: Read",
					"Input:",
					'{"file":"src/index.ts"}',
					"Output:",
					'{"ok":true}',
					"Duration: 21ms",
				].join("\n"),
				createdAt: 2,
				meta: {
					hookEventName: "tool_call_start",
					toolName: "Read",
					streamType: "tool",
				},
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Reasoning");
		expect(container.textContent).not.toContain("Thinking through the next edit");

		const reasoningToggle = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Reasoning"),
		);
		expect(reasoningToggle).toBeInstanceOf(HTMLButtonElement);
		if (!(reasoningToggle instanceof HTMLButtonElement)) {
			throw new Error("Expected reasoning toggle button");
		}
		await act(async () => {
			reasoningToggle.click();
		});

		expect(container.textContent).toContain("Thinking through the next edit");
		expect(container.textContent).toContain("Read");
		expect(container.textContent).toContain("src/index.ts");
		expect(container.textContent).not.toContain("Input");
		expect(container.textContent).not.toContain("Output");
		expect(container.textContent).not.toContain("21ms");

		const toolToggle = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Read"),
		);
		expect(toolToggle).toBeInstanceOf(HTMLButtonElement);
		if (!(toolToggle instanceof HTMLButtonElement)) {
			throw new Error("Expected tool toggle button");
		}

		await act(async () => {
			toolToggle.click();
		});

		expect(container.textContent).toContain("Output");
		expect(container.textContent).toContain('{"ok":true}');
	});

	it("shows a collapsed failure marker for structured run_commands failures", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "tool-1",
				role: "tool",
				content: [
					"Tool: run_commands",
					"Input:",
					JSON.stringify({ commands: ["npm test"] }),
					"Output:",
					JSON.stringify([
						{
							query: "npm test",
							result: "",
							success: false,
							error: "Command Failed: npm test",
						},
					]),
				].join("\n"),
				createdAt: 1,
				meta: {
					hookEventName: "tool_result",
					toolName: "run_commands",
					streamType: "tool",
				},
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("run_commands");
		expect(container.querySelector('[aria-label="Tool failed"]')).toBeInstanceOf(SVGElement);
	});

	it("renders message timestamps with duration tooltips and persists collapsed state", async () => {
		const createdAt = new Date(2026, 0, 2, 3, 4, 5).getTime();
		const expectedTime = new Intl.DateTimeFormat(undefined, {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(new Date(createdAt));
		const messages: NKleinChatMessage[] = [
			{
				id: "user-1",
				role: "user",
				content: "Please inspect the cache layer.",
				createdAt,
			},
			{
				id: "assistant-1",
				role: "assistant",
				content: "I will inspect it now.",
				createdAt: createdAt + 4_200,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={null}
					nowMs={createdAt + 6_000}
					onLoadMessages={async () => messages}
				/>,
			);
			await Promise.resolve();
		});

		const expandedTimestampButtons = container.querySelectorAll('button[aria-label="Collapse message timestamps"]');
		expect(expandedTimestampButtons.length).toBe(2);
		expect(expandedTimestampButtons[0]?.textContent).toBe(expectedTime);

		expect((expandedTimestampButtons[0] as HTMLButtonElement | undefined)?.title).toContain("took 4.2s");

		await act(async () => {
			(expandedTimestampButtons[0] as HTMLButtonElement | undefined)?.click();
		});

		expect(window.localStorage.getItem(LocalStorageKey.NKleinChatTimestampsCollapsed)).toBe("true");
		expect(container.querySelectorAll('button[aria-label="Show message timestamps"]').length).toBe(2);
	});

	it("collapses system prompt messages behind an explicit control", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "system-prompt-1",
				role: "system",
				content: "Inspect the codebase only as needed, then call decompose_project.",
				createdAt: 1,
				meta: {
					messageKind: "system_prompt",
					displayRole: "System prompt",
				},
			},
			{
				id: "user-1",
				role: "user",
				content: "Create at least ten dependent implementation cards.",
				createdAt: 2,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Show system prompt");
		expect(container.textContent).not.toContain("Inspect the codebase only as needed");

		const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
			candidate.textContent?.includes("Show system prompt"),
		);
		expect(button).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			(button as HTMLButtonElement).click();
		});

		expect(container.textContent).toContain("Hide system prompt");
		expect(container.textContent).toContain("Inspect the codebase only as needed");
		expect(container.textContent).toContain("Create at least ten dependent implementation cards.");
	});

	it("renders compact team progress telemetry when available", async () => {
		const teamProgress: RuntimeNKleinTeamProgressEvent[] = [
			{
				taskId: "task-1",
				teamName: "kanban-task-1",
				eventType: "teammate_spawned",
				agentId: "worker",
				role: "implementation",
				runId: null,
				status: null,
				message: "Spawned worker.",
				createdAt: Date.now() - 2_000,
			},
			{
				taskId: "task-1",
				teamName: "kanban-task-1",
				eventType: "run_progress",
				agentId: "worker",
				role: "implementation",
				runId: "run-1",
				status: "running",
				message: "Worker is updating the persistence adapter.",
				createdAt: Date.now() - 1_000,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={async () => []}
					teamProgress={teamProgress}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Worker is updating the persistence adapter.");
		expect(container.textContent).toContain("kanban-task-1");
		expect(container.textContent).toContain("worker");
		expect(container.textContent).toContain("implementation");
		expect(container.textContent).toContain("running");
	});

	it("renders the backend context budget bar when a breakdown is available", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", null, {
						contextBudgetBreakdown: {
							systemPromptTokens: 2_000,
							toolSchemaTokens: 500,
							taskPromptTokens: 3_000,
							userMessageTokens: 4_000,
							includedFileContentTokens: 0,
							otherHistoryTokens: 1_000,
							reservedPromptOverheadTokens: 1_200,
							reservedOutputTokens: 8_000,
							usedWorkingTokens: 11_700,
							freeWorkingTokens: 60_300,
							effectiveContextWindow: 80_000,
							projectedTokens: 19_700,
						},
					})}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Context");
		expect(container.textContent).toContain("20k / 80k tokens");
		expect(container.textContent).toContain("80k effective window");
		const contextBudgetGroup = container.querySelector('[aria-label^="Context budget"]');
		expect(contextBudgetGroup?.className).toContain("w-full");
		expect(contextBudgetGroup?.parentElement?.className).toContain("w-full");
		const segmentWidths = Array.from(
			contextBudgetGroup?.querySelectorAll<HTMLElement>("[title$='tokens']") ?? [],
		).map((segment) => Number.parseFloat(segment.style.width));
		const widthTotal = segmentWidths.reduce((total, width) => total + width, 0);
		expect(widthTotal).toBeCloseTo(24.625, 3);
	});

	it("caps context budget segment widths to prevent narrow-panel overflow", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", null, {
						contextBudgetBreakdown: {
							systemPromptTokens: 30_000,
							toolSchemaTokens: 20_000,
							taskPromptTokens: 15_000,
							userMessageTokens: 10_000,
							includedFileContentTokens: 8_000,
							otherHistoryTokens: 7_000,
							reservedPromptOverheadTokens: 6_000,
							reservedOutputTokens: 24_000,
							usedWorkingTokens: 90_000,
							freeWorkingTokens: 0,
							effectiveContextWindow: 80_000,
							projectedTokens: 120_000,
						},
					})}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const contextBudgetGroup = container.querySelector('[aria-label^="Context budget"]');
		const segmentWidths = Array.from(
			contextBudgetGroup?.querySelectorAll<HTMLElement>("[title$='tokens']") ?? [],
		).map((segment) => Number.parseFloat(segment.style.width));
		const widthTotal = segmentWidths.reduce((total, width) => total + width, 0);
		expect(widthTotal).toBeCloseTo(100, 3);
		expect(segmentWidths.every((width) => width > 0 && width <= 100)).toBe(true);
	});

	it("keeps completed reasoning collapsed after the stream finishes", async () => {
		const onLoadMessages = vi.fn(async () => []);
		const streamingReasoningMessage: NKleinChatMessage = {
			id: "reasoning-1",
			role: "reasoning",
			content: "Thinking through the next edit",
			createdAt: 1,
			meta: {
				hookEventName: "reasoning_delta",
				streamType: "reasoning",
			},
		};
		const completedReasoningMessage: NKleinChatMessage = {
			...streamingReasoningMessage,
			meta: {
				hookEventName: "reasoning_end",
				streamType: "reasoning",
			},
		};

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={onLoadMessages}
					incomingMessage={streamingReasoningMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Thinking through the next edit");

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={onLoadMessages}
					incomingMessage={completedReasoningMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).not.toContain("Thinking through the next edit");

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={onLoadMessages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).not.toContain("Thinking through the next edit");
	});

	it("shows running progress indicator while session is running", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={createSummary("running")} onLoadMessages={async () => []} />,
			);
			await Promise.resolve();
		});

		const thinkingSpinner = container.querySelector('[data-testid="nklein-thinking-spinner"]');
		expect(thinkingSpinner?.textContent).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
		expect(container.textContent).toContain("Thinking...");
		expect(container.textContent).not.toContain("NKlein chat");
	});

	it("shows a compact warning below the composer when the session has a warning", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={{
						...createSummary("running"),
						warningMessage:
							'Failed to load MCP server "linear": MCP server "linear" requires OAuth authorization.',
					}}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain('Failed to load MCP server "linear"');
	});

	it("defaults the task timeout from the global unlimited setting", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					runtimeConfig={createRuntimeConfig("unlimited")}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const timeoutSelect = Array.from(container.querySelectorAll("select")).find((select) =>
			select.textContent?.includes("Timeout: Unlimited"),
		);
		expect(timeoutSelect).toBeInstanceOf(HTMLSelectElement);
		if (!(timeoutSelect instanceof HTMLSelectElement)) {
			throw new Error("Expected timeout select.");
		}
		expect(timeoutSelect.value).toBe("unlimited");
	});

	it("renders a chat-level out-of-credits notice when credit-limit metadata is present", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary(
						"awaiting_review",
						{
							activityText: "Agent error: 402 Insufficient balance",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "402 Insufficient balance. Your NKlein Credits balance is $0.00",
							hookEventName: "agent_error",
							notificationType: "credit_limit",
							source: "nklein-sdk",
						},
						{ reviewReason: "error" },
					)}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		await vi.waitFor(() => {
			const buyCreditsLink = container.querySelector('a[href="https://app.nklein.bot/"]');
			expect(buyCreditsLink).toBeInstanceOf(HTMLAnchorElement);
		});
		expect(container.textContent).toContain("Out of NKlein credits.");
	});

	it("shows out-of-credits notice after interrupted state when credit-limit metadata persists", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary(
						"interrupted",
						{
							activityText: "Agent error: 402 Insufficient balance",
							toolName: null,
							toolInputSummary: null,
							finalMessage: "402 Insufficient balance. Your NKlein Credits balance is $0.00",
							hookEventName: "agent_end",
							notificationType: "credit_limit",
							source: "nklein-sdk",
						},
						{ reviewReason: "interrupted" },
					)}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		await vi.waitFor(() => {
			const buyCreditsLink = container.querySelector('a[href="https://app.nklein.bot/"]');
			expect(buyCreditsLink).toBeInstanceOf(HTMLAnchorElement);
		});
	});

	it("renders user message images inline without a task header", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={async () => [
						{
							id: "msg-1",
							role: "user",
							content: "Please inspect this screenshot",
							images: [
								{
									id: "img-1",
									data: "abc123",
									mimeType: "image/png",
									name: "error.png",
								},
							],
							createdAt: 1,
						},
					]}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Please inspect this screenshot");
		expect(container.textContent).toContain("error.png");
		expect(container.textContent).not.toContain("Task images");
		const image = container.querySelector('img[alt="error.png"]');
		expect(image).toBeInstanceOf(HTMLImageElement);
	});

	it("keeps the message list pinned to the bottom while new content streams in", async () => {
		const initialMessages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "First reply",
				createdAt: 1,
			},
		];
		const incomingMessage: NKleinChatMessage = {
			id: "assistant-2",
			role: "assistant",
			content: "Second reply",
			createdAt: 2,
		};

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => initialMessages} />,
			);
			await Promise.resolve();
		});

		const messageList = getMessageList(container);
		const scroll = mockScrollMetrics(messageList, {
			scrollHeight: 200,
			clientHeight: 100,
			scrollTop: 100,
		});
		scroll.setScrollHeight(260);

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => initialMessages}
					incomingMessage={incomingMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(scroll.getScrollTop()).toBe(260);
	});

	it("stops auto-scroll while the user is reading older messages and re-enables it at the bottom", async () => {
		const initialMessages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "First reply",
				createdAt: 1,
			},
		];
		const secondMessage: NKleinChatMessage = {
			id: "assistant-2",
			role: "assistant",
			content: "Second reply",
			createdAt: 2,
		};
		const thirdMessage: NKleinChatMessage = {
			id: "assistant-3",
			role: "assistant",
			content: "Third reply",
			createdAt: 3,
		};

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => initialMessages} />,
			);
			await Promise.resolve();
		});

		const messageList = getMessageList(container);
		const scroll = mockScrollMetrics(messageList, {
			scrollHeight: 200,
			clientHeight: 100,
			scrollTop: 100,
		});

		scroll.setScrollTop(20);
		await act(async () => {
			messageList.dispatchEvent(new Event("scroll", { bubbles: true }));
			await Promise.resolve();
		});

		scroll.setScrollHeight(260);
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => initialMessages}
					incomingMessage={secondMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(scroll.getScrollTop()).toBe(20);

		scroll.setScrollTop(160);
		await act(async () => {
			messageList.dispatchEvent(new Event("scroll", { bubbles: true }));
			await Promise.resolve();
		});

		scroll.setScrollHeight(320);
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={null}
					onLoadMessages={async () => initialMessages}
					incomingMessage={thirdMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(scroll.getScrollTop()).toBe(320);
	});

	it("shows the thinking indicator while assistant text is streaming", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Streaming reply",
				createdAt: 1,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", {
						activityText: "Agent active",
						toolName: null,
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "assistant_delta",
						notificationType: null,
						source: "nklein-sdk",
					})}
					onLoadMessages={async () => messages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Streaming reply");
		expect(container.textContent).toContain("Thinking...");
	});

	it("shows the thinking indicator while a tool call is streaming", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "tool-1",
				role: "tool",
				content: ["Tool: Read", "Input:", '{"file":"src/index.ts"}'].join("\n"),
				createdAt: 1,
				meta: {
					hookEventName: "tool_call_start",
					toolName: "Read",
					streamType: "tool",
				},
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", {
						activityText: "Using Read",
						toolName: "Read",
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "tool_call",
						notificationType: null,
						source: "nklein-sdk",
					})}
					onLoadMessages={async () => messages}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Read");
		expect(container.textContent).toContain("Thinking...");
	});

	it("renders assistant markdown including fenced code blocks", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Here is code:\n```ts\nconst value = 1;\n```",
				createdAt: 1,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		expect(container.textContent).toContain("Here is code:");
		expect(container.textContent).toContain("const value = 1;");
		expect(container.querySelector("pre code")).toBeTruthy();
	});

	it("applies wrapping styles to inline code in assistant markdown", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Use `averylongidentifierwithnobreakpointswhatsoever1234567890` here.",
				createdAt: 1,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel taskId="task-1" summary={null} onLoadMessages={async () => messages} />,
			);
			await Promise.resolve();
		});

		const inlineCode = container.querySelector("p code");
		expect(inlineCode).toBeInstanceOf(HTMLElement);
		expect(inlineCode?.className).toContain("whitespace-pre-wrap");
		expect(inlineCode?.className).toContain("break-all");
	});

	it("autofocuses the composer, grows it, sends on enter, and cancels on escape", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-1",
				role: "user" as const,
				content: "Ship it",
				createdAt: 2,
			},
		}));
		const onCancelTurn = vi.fn(async () => ({ ok: true }));

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running")}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
					onCancelTurn={onCancelTurn}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		expect(document.activeElement).toBe(textarea);
		expect(textarea.getAttribute("rows")).toBe("1");
		expect(container.textContent).toContain("Select model");
		const sendButton = container.querySelector('button[aria-label="Cancel request"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer action button");
		}
		expect(sendButton.disabled).toBe(false);

		Object.defineProperty(textarea, "scrollHeight", {
			configurable: true,
			value: 96,
		});

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Ship it");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		expect(textarea.style.height).toBe("96px");
		expect(sendButton.disabled).toBe(false);

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Ship it", { mode: "act" });

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		expect(onCancelTurn).toHaveBeenCalledWith("task-1");
	});

	it("sends the selected NKlein provider and model with each chat message", async () => {
		const onSendMessage = vi.fn(async () => ({ ok: true }));

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					taskNKleinSettings={{
						providerId: "lmstudio",
						modelId: "new-model",
						reasoningEffort: "high",
					}}
					taskHasExplicitNKleinSettings
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Use the new model");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Use the new model", {
			mode: "act",
			providerId: "lmstudio",
			modelId: "new-model",
			reasoningEffort: "high",
		});
	});

	it("extracts clarifying question options from assistant messages", () => {
		const prompt = extractClarifyingQuestionPrompt([
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					"Which launch scope should I assume?",
					"A. Minimal beta (recommended) - storage and UI only",
					"B. Full release - storage, UI, reminders, and sync",
				].join("\n"),
				createdAt: 1,
			},
		]);

		expect(prompt?.question).toBe("Which launch scope should I assume?");
		expect(prompt?.options).toEqual([
			{ id: "A", label: "Minimal beta", responseText: "Answer: A. Minimal beta" },
			{ id: "B", label: "Full release", responseText: "Answer: B. Full release" },
		]);
	});

	it("extracts protected-test approval payloads from blocked messages", () => {
		const prompt = extractProtectedTestApprovalPrompt([
			{
				id: "assistant-1",
				role: "assistant",
				content:
					'Blocked editor: test/protected/protected-tests.json is part of the protected test suite. {"intent":"Change protected test suite path test/protected/protected-tests.json via editor.","diff":"{}","reason":"Review exact edit.","expectedEffects":"Protected behavior changes."}',
				createdAt: 1,
			},
		]);

		expect(prompt?.request).toEqual({
			intent: "Change protected test suite path test/protected/protected-tests.json via editor.",
			diff: "{}",
			reason: "Review exact edit.",
			expectedEffects: "Protected behavior changes.",
		});
	});

	it("grants a protected-test approval from the chat panel", async () => {
		const onSendMessage = vi.fn(async () => ({ ok: true }));
		const onGrantProtectedTestApproval = vi.fn(async () => ({ ok: true }));
		const messages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content:
					'Blocked editor: test/protected/protected-tests.json is part of the protected test suite. {"intent":"Change protected test suite path test/protected/protected-tests.json via editor.","diff":"{}","reason":"Review exact edit.","expectedEffects":"Protected behavior changes."}',
				createdAt: 1,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => messages}
					onSendMessage={onSendMessage}
					onGrantProtectedTestApproval={onGrantProtectedTestApproval}
				/>,
			);
			await Promise.resolve();
		});

		const approveButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Approve Exact Edit",
		);
		expect(approveButton).toBeInstanceOf(HTMLButtonElement);
		if (!(approveButton instanceof HTMLButtonElement)) {
			throw new Error("Expected protected approval button.");
		}

		await act(async () => {
			approveButton.click();
			await Promise.resolve();
		});

		expect(onGrantProtectedTestApproval).toHaveBeenCalledWith("task-1", {
			intent: "Change protected test suite path test/protected/protected-tests.json via editor.",
			diff: "{}",
			reason: "Review exact edit.",
			expectedEffects: "Protected behavior changes.",
		});
		expect(onSendMessage).toHaveBeenCalledWith(
			"task-1",
			"Approved this exact protected-test edit. Retry the same edit once. Do not change any other protected test path without asking again.",
			{ mode: "act" },
		);
	});

	it("sends a clarifying question chip answer through the existing chat turn", async () => {
		const onSendMessage = vi.fn(async () => ({ ok: true }));
		const messages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: [
					"Which launch scope should I assume?",
					"A. Minimal beta (recommended) - storage and UI only",
					"B. Full release - storage, UI, reminders, and sync",
				].join("\n"),
				createdAt: 1,
			},
		];

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => messages}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const optionButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Minimal beta",
		);
		expect(optionButton).toBeInstanceOf(HTMLButtonElement);
		if (!(optionButton instanceof HTMLButtonElement)) {
			throw new Error("Expected clarifying option button.");
		}

		await act(async () => {
			optionButton.click();
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Answer: A. Minimal beta", { mode: "act" });
	});

	it("defaults the composer mode from the task and sends using the selected mode", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-2",
				role: "user" as const,
				content: "Investigate",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					defaultMode="plan"
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		const planToggle = Array.from(container.querySelectorAll('button[role="tab"]')).find((button) =>
			button.textContent?.includes("Plan"),
		);
		expect(planToggle?.getAttribute("aria-selected")).toBe("true");

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Investigate");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		const sendButton = container.querySelector('button[aria-label="Send message"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer send button");
		}

		await act(async () => {
			sendButton.click();
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Investigate", { mode: "plan" });
	});

	it("restores the previously selected mode when switching back to a task", async () => {
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					defaultMode="act"
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const planButton = Array.from(container.querySelectorAll('button[role="tab"]')).find((button) =>
			button.textContent?.includes("Plan"),
		);
		expect(planButton).toBeInstanceOf(HTMLButtonElement);
		if (!(planButton instanceof HTMLButtonElement)) {
			throw new Error("Expected plan mode toggle");
		}

		await act(async () => {
			planButton.click();
			await Promise.resolve();
		});
		expect(planButton.getAttribute("aria-selected")).toBe("true");

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-2"
					summary={createSummary("idle", null, { taskId: "task-2" })}
					defaultMode="act"
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					defaultMode="act"
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const restoredPlanButton = Array.from(container.querySelectorAll('button[role="tab"]')).find((button) =>
			button.textContent?.includes("Plan"),
		);
		expect(restoredPlanButton?.getAttribute("aria-selected")).toBe("true");
	});

	it("appends review comments into the composer draft through the panel handle", async () => {
		const panelRef = createRef<NKleinAgentChatPanelHandle>();

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					ref={panelRef}
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Keep this");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		await act(async () => {
			panelRef.current?.appendToDraft("src/example.ts:4 | value\n> Add tests");
			await Promise.resolve();
		});

		expect(textarea.value).toBe("Keep this\n\nsrc/example.ts:4 | value\n> Add tests");
	});

	it("sends review comments through the panel handle without overwriting the draft", async () => {
		const panelRef = createRef<NKleinAgentChatPanelHandle>();
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-review-comments",
				role: "user" as const,
				content: "src/example.ts:8 | done\n> Ship this",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					ref={panelRef}
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Keep acting");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		await act(async () => {
			await panelRef.current?.sendText("src/example.ts:8 | done\n> Ship this");
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "src/example.ts:8 | done\n> Ship this", { mode: "act" });
		expect(textarea.value).toBe("Keep acting");
	});

	it("toggles the composer mode with command shift a", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-3",
				role: "user" as const,
				content: "Switch it",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "A",
					metaKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Switch it");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		const sendButton = container.querySelector('button[aria-label="Send message"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer send button");
		}

		await act(async () => {
			sendButton.click();
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Switch it", { mode: "plan" });
	});

	it("hides the composer mode toggle when requested", async () => {
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-4",
				role: "user" as const,
				content: "Keep acting",
				createdAt: 2,
			},
		}));

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("idle")}
					showComposerModeToggle={false}
					onLoadMessages={async () => []}
					onSendMessage={onSendMessage}
				/>,
			);
			await Promise.resolve();
		});

		expect(container.querySelector('[aria-label="!Klein mode"]')).toBeNull();

		const textarea = container.querySelector("textarea");
		expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
		if (!(textarea instanceof HTMLTextAreaElement)) {
			throw new Error("Expected composer textarea");
		}

		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "A",
					metaKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
			await Promise.resolve();
		});

		await act(async () => {
			const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
			if (!valueSetter) {
				throw new Error("Expected textarea value setter");
			}
			valueSetter.call(textarea, "Keep acting");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
			await Promise.resolve();
		});

		const sendButton = container.querySelector('button[aria-label="Send message"]');
		expect(sendButton).toBeInstanceOf(HTMLButtonElement);
		if (!(sendButton instanceof HTMLButtonElement)) {
			throw new Error("Expected composer send button");
		}

		await act(async () => {
			sendButton.click();
			await Promise.resolve();
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Keep acting", { mode: "act" });
	});

	it("keeps chat pinned to bottom when action footer appears", async () => {
		const messages: NKleinChatMessage[] = [
			{
				id: "assistant-1",
				role: "assistant",
				content: "Done and ready for review.",
				createdAt: 1,
			},
		];
		setTaskWorkspaceSnapshot({
			taskId: "task-1",
			path: "/tmp/worktree",
			branch: "task-1",
			isDetached: false,
			headCommit: "abc1234",
			changedFiles: 2,
			additions: 3,
			deletions: 1,
		});

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={async () => messages}
					showMoveToTrash={false}
				/>,
			);
			await Promise.resolve();
		});

		const messageList = getMessageList(container);
		const scroll = mockScrollMetrics(messageList, {
			scrollHeight: 200,
			clientHeight: 100,
			scrollTop: 100,
		});
		scroll.setScrollHeight(240);

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={async () => messages}
					taskColumnId="review"
					onCommit={() => {}}
					onOpenPr={() => {}}
					onMoveToTrash={() => {}}
					showMoveToTrash
				/>,
			);
			await Promise.resolve();
		});

		expect(scroll.getScrollTop()).toBe(240);
	});

	it("does not show commit actions when the review workspace is clean", async () => {
		setTaskWorkspaceSnapshot({
			taskId: "task-1",
			path: "/tmp/worktree",
			branch: "task-1",
			isDetached: false,
			headCommit: "def5678",
			changedFiles: 0,
			additions: 0,
			deletions: 0,
		});

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("awaiting_review")}
					onLoadMessages={async () => []}
					taskColumnId="review"
					onCommit={() => {}}
					onOpenPr={() => {}}
					onMoveToTrash={() => {}}
					showMoveToTrash
				/>,
			);
			await Promise.resolve();
		});

		expect(container.textContent).not.toContain("Commit");
		expect(container.textContent).not.toContain("Open PR");
		expect(container.textContent).toContain("Move Card To Completed");
	});
});

describe("pending-input chip (F12.56)", () => {
	it("shows queued + steer counts for a running session and hides when empty", async () => {
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		resetWorkspaceMetadataStore();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", null, { pendingPromptCount: 3, pendingSteerCount: 1 })}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});
		expect(container.textContent).toContain("Pending input");
		expect(container.textContent).toContain("3 queued");
		expect(container.textContent).toContain("1 steer");

		await act(async () => {
			renderPanel(
				root,
				<NKleinAgentChatPanel
					taskId="task-1"
					summary={createSummary("running", null, { pendingPromptCount: 0, pendingSteerCount: 0 })}
					onLoadMessages={async () => []}
				/>,
			);
			await Promise.resolve();
		});
		expect(container.textContent).not.toContain("Pending input");
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
