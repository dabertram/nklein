import { DEFAULT_RUNTIME_SWARM_GUARDRAILS } from "@runtime-contract";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanBoard, type RequestProgrammaticCardMove } from "@/components/kanban-board";
import type { RuntimeConfigResponse, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";

const dndMock = vi.hoisted(() => ({
	sensorApi: null as {
		tryGetLock: ReturnType<typeof vi.fn>;
	} | null,
}));
const runtimeConfigQueryMocks = vi.hoisted(() => ({
	collectTaskEvidence: vi.fn(),
	fetchMergeHistory: vi.fn(),
	fetchNKleinCodeIntelligenceStatus: vi.fn(),
	pauseTask: vi.fn(),
	resumeTask: vi.fn(),
	saveRuntimeConfig: vi.fn(),
}));
const runtimeTrpcMocks = vi.hoisted(() => ({
	getSwarmStop: vi.fn(),
	requestSwarmStop: vi.fn(),
	clearSwarmStop: vi.fn(),
}));

vi.mock("@hello-pangea/dnd", async () => {
	const React = await vi.importActual<typeof import("react")>("react");

	return {
		DragDropContext: ({
			children,
			sensors,
		}: {
			children: ReactNode;
			sensors?: Array<(api: NonNullable<typeof dndMock.sensorApi>) => void>;
		}): React.ReactElement => {
			React.useEffect(() => {
				if (!dndMock.sensorApi) {
					return;
				}
				for (const sensor of sensors ?? []) {
					sensor(dndMock.sensorApi);
				}
			}, [sensors]);

			return <>{children}</>;
		},
	};
});

vi.mock("@/components/board-column", () => ({
	BoardColumn: ({
		column,
		taskSessions,
		onCopyTaskEvidence,
		onPauseTask,
		onResumeTask,
	}: {
		column: BoardData["columns"][number];
		taskSessions?: Record<string, RuntimeTaskSessionSummary | undefined>;
		onCopyTaskEvidence?: (taskId: string) => void;
		onPauseTask?: (taskId: string) => void;
		onResumeTask?: (taskId: string) => void;
	}): React.ReactElement => (
		<section data-column-id={column.id}>
			<div className="kb-column-cards">
				{column.cards.map((card) => {
					const sessionSummary = taskSessions?.[card.id];
					const isPaused = sessionSummary?.paused === true || sessionSummary?.state === "paused";
					return (
						<div key={card.id} data-task-id={card.id}>
							{sessionSummary?.state === "running" && !isPaused && onPauseTask ? (
								<button type="button" aria-label="Pause task" onClick={() => onPauseTask(card.id)}>
									Pause task
								</button>
							) : null}
							{isPaused && onResumeTask ? (
								<button type="button" aria-label="Resume task" onClick={() => onResumeTask(card.id)}>
									Resume task
								</button>
							) : null}
							{onCopyTaskEvidence ? (
								<button type="button" onClick={() => onCopyTaskEvidence(card.id)}>
									Create evidence
								</button>
							) : null}
						</div>
					);
				})}
			</div>
		</section>
	),
}));

vi.mock("@/components/dependencies/dependency-overlay", () => ({
	DependencyOverlay: (): null => null,
}));

vi.mock("@/components/dependencies/use-dependency-linking", () => ({
	useDependencyLinking: () => ({
		draft: null,
		onDependencyPointerDown: vi.fn(),
		onDependencyPointerEnter: vi.fn(),
	}),
}));

vi.mock("@/runtime/runtime-config-query", () => ({
	collectTaskEvidence: runtimeConfigQueryMocks.collectTaskEvidence,
	fetchMergeHistory: runtimeConfigQueryMocks.fetchMergeHistory,
	fetchNKleinCodeIntelligenceStatus: runtimeConfigQueryMocks.fetchNKleinCodeIntelligenceStatus,
	pauseTask: runtimeConfigQueryMocks.pauseTask,
	resumeTask: runtimeConfigQueryMocks.resumeTask,
	saveRuntimeConfig: runtimeConfigQueryMocks.saveRuntimeConfig,
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		runtime: {
			getSwarmStop: { query: runtimeTrpcMocks.getSwarmStop },
			requestSwarmStop: { mutate: runtimeTrpcMocks.requestSwarmStop },
			clearSwarmStop: { mutate: runtimeTrpcMocks.clearSwarmStop },
		},
	}),
}));

function createRect(left: number, top: number, width: number, height: number): DOMRect {
	return {
		x: left,
		y: top,
		left,
		top,
		width,
		height,
		right: left + width,
		bottom: top + height,
		toJSON: () => ({}),
	} as DOMRect;
}

function createRuntimeConfig(maxConcurrentTasks: number): RuntimeConfigResponse {
	return {
		selectedAgentId: "nklein",
		selectedShortcutLabel: null,
		workspaceBaseDir: null,
		agentAutonomousModeEnabled: true,
		agentTimeoutMode: "normal",
		agentTimeoutProfile: "local",
		requestTimeoutMs: 300_000,
		streamTimeoutMs: 180_000,
		toolTimeoutMs: 600_000,
		agentTimeoutMs: 3_600_000,
		conversationTimeoutMs: 7_200_000,
		maxAgentWritableFileLines: 1000,
		maxConcurrentTasks,
		maxConcurrentTasksOverride: null,
		effectiveMaxConcurrentTasks: maxConcurrentTasks,
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
		concurrencyDefaults: { perProvider: {}, perModel: {} },
		concurrencyOverride: null,
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
		agentRulesetsOverride: null,
		swarmGuardrails: DEFAULT_RUNTIME_SWARM_GUARDRAILS,
		nkleinProviderSettings: {
			providerId: "lmstudio",
			modelId: "local-model",
			baseUrl: null,
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

function createRunningSession(taskId: string, sharedEndpointId: string, modelId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		mode: "act",
		agentId: "nklein",
		workspacePath: "/tmp/project",
		pid: 123,
		startedAt: Date.now() - 1000,
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		lastTokenAt: Date.now(),
		lastHeartbeatAt: Date.now(),
		heartbeatStatus: "healthy",
		providerId: "lmstudio",
		modelId,
		endpoint: null,
		sharedEndpointId,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestUsage: null,
		contextBudgetBreakdown: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

describe("KanbanBoard", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn(async () => undefined),
			},
		});
		runtimeConfigQueryMocks.collectTaskEvidence.mockReset();
		runtimeConfigQueryMocks.collectTaskEvidence.mockResolvedValue({
			bundlePath: "/tmp/evidence/task-1",
			summaryPath: "/tmp/evidence/task-1/summary.md",
			files: {
				summary: "/tmp/evidence/task-1/summary.md",
				telemetry: "/tmp/evidence/task-1/telemetry.jsonl",
				configSnapshot: "/tmp/evidence/task-1/config-snapshot.json",
				evalResult: "/tmp/evidence/task-1/eval.json",
				diffPatch: "/tmp/evidence/task-1/diff.patch",
				transcripts: ["/tmp/evidence/task-1/transcript/01-task-1.json"],
			},
			summaryText: "Task: Source task (task-source)",
			diffPatchText: "File: src/example.ts\nStatus: modified",
			promptBlock: "Here is evidence from a !Klein task.",
		});
		runtimeConfigQueryMocks.fetchNKleinCodeIntelligenceStatus.mockReset();
		runtimeConfigQueryMocks.fetchNKleinCodeIntelligenceStatus.mockResolvedValue(null);
		runtimeConfigQueryMocks.fetchMergeHistory.mockReset();
		runtimeConfigQueryMocks.fetchMergeHistory.mockResolvedValue({ records: [] });
		runtimeConfigQueryMocks.pauseTask.mockReset();
		runtimeConfigQueryMocks.pauseTask.mockResolvedValue({
			ok: true,
			summary: null,
			pausedTaskIds: ["task-1"],
		});
		runtimeConfigQueryMocks.resumeTask.mockReset();
		runtimeConfigQueryMocks.resumeTask.mockResolvedValue({
			ok: true,
			summary: null,
			pausedTaskIds: [],
		});
		runtimeConfigQueryMocks.saveRuntimeConfig.mockReset();
		runtimeConfigQueryMocks.saveRuntimeConfig.mockImplementation(
			async (_workspaceId: string | null, input: { maxConcurrentTasks?: number }) => ({
				...createRuntimeConfig(input.maxConcurrentTasks ?? 3),
			}),
		);
		runtimeTrpcMocks.getSwarmStop.mockReset();
		runtimeTrpcMocks.getSwarmStop.mockResolvedValue({ ok: true, signal: null });
		runtimeTrpcMocks.requestSwarmStop.mockReset();
		runtimeTrpcMocks.clearSwarmStop.mockReset();
		vi.spyOn(performance, "now").mockImplementation(() => Date.now());
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
			return window.setTimeout(() => {
				callback(performance.now());
			}, 16);
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number) => {
			window.clearTimeout(handle);
		});
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(
			this: HTMLElement,
		) {
			if (this.dataset.taskId === "source-task") {
				return createRect(20, 20, 160, 96);
			}
			if (this.dataset.taskId === "target-task-1") {
				return createRect(300, 20, 160, 96);
			}
			if (this.classList.contains("kb-column-cards")) {
				const columnId = this.closest<HTMLElement>("[data-column-id]")?.dataset.columnId;
				if (columnId === "backlog") {
					return createRect(12, 12, 176, 420);
				}
				if (columnId === "in_progress") {
					return createRect(292, 12, 176, 420);
				}
			}
			return createRect(0, 0, 0, 0);
		});
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
		dndMock.sensorApi = null;
		vi.restoreAllMocks();
		vi.useRealTimers();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("renders the swarm cockpit strip with board counts", async () => {
		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "task-1",
							title: "Ready",
							prompt: "Build",
							startInPlanMode: false,
							agentId: "nklein",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
						{
							id: "task-2",
							title: "Blocked",
							prompt: "Blocked",
							startInPlanMode: false,
							agentId: "nklein",
							baseRef: "main",
							blockedKind: "needs_decomposition",
							createdAt: 2,
							updatedAt: 2,
						},
					],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{
						"task-running": createRunningSession("task-running", "lmstudio:default", "qwen3"),
					}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});

		expect(container.textContent).toContain("Local swarm");
		expect(container.textContent).toContain("Running 1");
		expect(container.textContent).toContain("Waiting 1");
		expect(container.textContent).toContain("Blocked 1");
		expect(container.textContent).toContain("lmstudio:default 1 active (qwen3)");
		expect(container.textContent).toContain("One endpoint is serializing work");
		expect(container.textContent).toContain("Code intel");
		const pauseButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Pause"),
		);
		expect(pauseButton?.textContent).toContain("Pause");
		expect(pauseButton?.hasAttribute("disabled")).toBe(true);
	});

	it("surfaces an explicit sandbox queue count in the swarm header (§5.G)", async () => {
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "task-queued",
							title: "Queued task",
							prompt: "p",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{
						"task-queued": {
							...createRunningSession("task-queued", "lmstudio:default", "qwen3"),
							state: "queued",
						},
					}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});
		expect(container.textContent).toContain("Queued 1");
	});

	it("shows an empty-board getting-started banner with a working create-task CTA (§5.A)", async () => {
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const onCreateTask = vi.fn();
		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					currentProjectId="proj-1"
					onCardSelect={() => {}}
					onCreateTask={onCreateTask}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});
		expect(container.textContent).toContain("This board is empty");
		const createButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Create task"),
		);
		expect(createButton).toBeTruthy();
		act(() => {
			if (createButton) {
				Simulate.click(createButton);
			}
		});
		expect(onCreateTask).toHaveBeenCalledTimes(1);
	});

	it("hides the empty-board banner once the board has any card (§5.A)", async () => {
		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "task-1",
							title: "Ready",
							prompt: "Build",
							startInPlanMode: false,
							agentId: "nklein",
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
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					currentProjectId="proj-1"
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});
		expect(container.textContent).not.toContain("This board is empty");
	});

	it("surfaces durable merge history in the swarm header (§5.G)", async () => {
		runtimeConfigQueryMocks.fetchMergeHistory.mockResolvedValue({
			records: [
				{
					recordedAt: 2_000,
					taskId: "task-merge",
					ok: false,
					mergedTaskIds: [],
					skippedTaskIds: [],
					conflictedPaths: ["src/a.ts"],
					reason: "merge conflict",
				},
				{
					recordedAt: 1_000,
					taskId: "task-merge-prior",
					ok: true,
					mergedTaskIds: ["a", "b"],
					skippedTaskIds: [],
					conflictedPaths: [],
					reason: null,
				},
			],
		});
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					currentProjectId="proj-1"
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});
		expect(runtimeConfigQueryMocks.fetchMergeHistory).toHaveBeenCalledWith("proj-1");
		expect(container.textContent).toContain("Merge conflicts 1");
	});

	it("groups active work by role in the swarm header with click-to-focus (§5.G #425)", async () => {
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const onCardSelect = vi.fn();
		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{
						"task-a": { ...createRunningSession("task-a", "lmstudio:default", "qwen3"), role: "architect" },
						"task-w": { ...createRunningSession("task-w", "lmstudio:default", "qwen3"), role: "worker" },
					}}
					onCardSelect={onCardSelect}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});
		expect(container.textContent).toContain("Architect 1");
		expect(container.textContent).toContain("Worker 1");
		const architectButton = Array.from(container.querySelectorAll("button")).find((button) =>
			button.textContent?.includes("Architect 1"),
		);
		await act(async () => {
			architectButton?.click();
		});
		expect(onCardSelect).toHaveBeenCalledWith("task-a");
	});

	it("warns in the swarm header when Docker agent isolation is unavailable (§5.A)", async () => {
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const blockedConfig = createRuntimeConfig(3);
		blockedConfig.agentSandboxStatus = {
			state: "blocked",
			dockerAvailable: false,
			imageAvailable: null,
			image: "nklein/agent-sandbox:0.0.1",
			message: "Docker daemon is not running.",
			checkedAt: 1,
		};
		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					runtimeConfig={blockedConfig}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});
		expect(container.textContent).toContain("Sandbox unavailable");
	});

	it("collects and copies task evidence from board cards", async () => {
		const board: BoardData = {
			columns: [
				{
					id: "review",
					title: "Review",
					cards: [
						{
							id: "task-1",
							title: "Review task",
							prompt: "Fix the issue",
							startInPlanMode: false,
							agentId: "nklein",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					currentProjectId="workspace-1"
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});

		const evidenceButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.trim() === "Create evidence",
		);
		expect(evidenceButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			evidenceButton?.click();
			await Promise.resolve();
		});

		expect(runtimeConfigQueryMocks.collectTaskEvidence).toHaveBeenCalledWith("workspace-1", "task-1");
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Here is evidence from a !Klein task.");
	});

	it("pauses and resumes an individual running card from board controls", async () => {
		const pausedSummary = {
			...createRunningSession("task-1", "lmstudio:default", "qwen3"),
			paused: true,
		};
		const resumedSummary = {
			...createRunningSession("task-1", "lmstudio:default", "qwen3"),
			paused: false,
		};
		const handleTaskSessionSummary = vi.fn();
		runtimeConfigQueryMocks.pauseTask.mockResolvedValueOnce({
			ok: true,
			summary: pausedSummary,
			pausedTaskIds: ["task-1"],
		});
		runtimeConfigQueryMocks.resumeTask.mockResolvedValueOnce({
			ok: true,
			summary: resumedSummary,
			pausedTaskIds: [],
		});
		const board: BoardData = {
			columns: [
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "task-1",
							title: "Running task",
							prompt: "Keep working",
							startInPlanMode: false,
							agentId: "nklein",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{
						"task-1": createRunningSession("task-1", "lmstudio:default", "qwen3"),
					}}
					currentProjectId="workspace-1"
					onTaskSessionSummary={handleTaskSessionSummary}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});

		const pauseButton = container.querySelector<HTMLButtonElement>('button[aria-label="Pause task"]');
		expect(pauseButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			pauseButton?.click();
			await Promise.resolve();
		});

		expect(runtimeConfigQueryMocks.pauseTask).toHaveBeenCalledWith("workspace-1", "task-1");
		expect(handleTaskSessionSummary).toHaveBeenCalledWith(pausedSummary);
		expect(container.querySelector('button[aria-label="Pause task"]')).toBeNull();
		const resumeButton = container.querySelector<HTMLButtonElement>('button[aria-label="Resume task"]');
		expect(resumeButton).toBeInstanceOf(HTMLButtonElement);

		await act(async () => {
			resumeButton?.click();
			await Promise.resolve();
		});

		expect(runtimeConfigQueryMocks.resumeTask).toHaveBeenCalledWith("workspace-1", "task-1");
		expect(handleTaskSessionSummary).toHaveBeenLastCalledWith(resumedSummary);
		expect(container.querySelector('button[aria-label="Resume task"]')).toBeNull();
		expect(container.querySelector('button[aria-label="Pause task"]')).toBeInstanceOf(HTMLButtonElement);
	});

	it("saves the inline swarm concurrency cap", async () => {
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const handleRuntimeConfigChanged = vi.fn();

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					currentProjectId="project-1"
					runtimeConfig={createRuntimeConfig(3)}
					onRuntimeConfigChanged={handleRuntimeConfigChanged}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
				/>,
			);
		});

		const slider = container.querySelector<HTMLInputElement>('input[aria-label="Max concurrent tasks"]');
		expect(container.textContent).toContain("Cap 3");
		expect(slider?.disabled).toBe(false);

		await act(async () => {
			if (!slider) {
				throw new Error("Expected concurrency slider.");
			}
			slider.value = "5";
			Simulate.change(slider);
			await Promise.resolve();
		});
		await act(async () => {
			if (!slider) {
				throw new Error("Expected concurrency slider.");
			}
			Simulate.pointerUp(slider);
			await Promise.resolve();
		});

		expect(runtimeConfigQueryMocks.saveRuntimeConfig).toHaveBeenCalledWith("project-1", { maxConcurrentTasks: 5 });
		expect(handleRuntimeConfigChanged).toHaveBeenCalled();
	});

	it("marks the board while a programmatic move is active", async () => {
		const dragActions = {
			isActive: vi.fn(() => true),
			move: vi.fn(),
			drop: vi.fn(),
			cancel: vi.fn(),
		};
		const preDrag = {
			fluidLift: vi.fn(() => dragActions),
			isActive: vi.fn(() => true),
			abort: vi.fn(),
		};
		dndMock.sensorApi = {
			tryGetLock: vi.fn(() => preDrag),
		};

		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "source-task",
							title: "Source task",
							prompt: "Source task",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "target-task-1",
							title: "Target task 1",
							prompt: "Target task 1",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		let requestMove: RequestProgrammaticCardMove | null = null;

		await act(async () => {
			root.render(
				<KanbanBoard
					data={board}
					taskSessions={{}}
					onCardSelect={() => {}}
					onCreateTask={() => {}}
					dependencies={[]}
					onDragEnd={() => {}}
					onRequestProgrammaticCardMoveReady={(nextRequestMove) => {
						requestMove = nextRequestMove;
					}}
				/>,
			);
		});

		const boardElement = container.querySelector<HTMLElement>(".kb-board");
		expect(boardElement?.dataset.programmaticCardMove).toBeUndefined();

		await act(async () => {
			requestMove?.({
				taskId: "source-task",
				fromColumnId: "backlog",
				toColumnId: "in_progress",
				insertAtTop: true,
			});
		});

		expect(boardElement?.dataset.programmaticCardMove).toBe("true");
	});
});
