import type { DropResult } from "@hello-pangea/dnd";
import { act, type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBoardInteractions } from "@/hooks/use-board-interactions";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";

const notifyErrorMock = vi.hoisted(() => vi.fn());
const showAppToastMock = vi.hoisted(() => vi.fn());
const useLinkedBacklogTaskActionsMock = vi.hoisted(() => vi.fn());
const useProgrammaticCardMovesMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/app-toaster", () => ({
	notifyError: notifyErrorMock,
	showAppToast: showAppToastMock,
}));

vi.mock("@/hooks/use-linked-backlog-task-actions", () => ({
	useLinkedBacklogTaskActions: useLinkedBacklogTaskActionsMock,
}));

vi.mock("@/hooks/use-programmatic-card-moves", () => ({
	useProgrammaticCardMoves: useProgrammaticCardMovesMock,
}));

vi.mock("@/hooks/use-review-auto-actions", () => ({
	useReviewAutoActions: () => ({}) as ReturnType<typeof useBoardInteractions>,
}));

function createTask(
	taskId: string,
	prompt: string,
	createdAt: number,
	options?: { startInPlanMode?: boolean; filesLikelyTouched?: string[] },
): BoardCard {
	return {
		id: taskId,
		title: prompt,
		prompt,
		startInPlanMode: options?.startInPlanMode ?? false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		filesLikelyTouched: options?.filesLikelyTouched,
		baseRef: "main",
		createdAt,
		updatedAt: createdAt,
	};
}

function createBoard(): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [createTask("task-1", "Backlog task", 1)],
			},
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function createRunningNKleinSession(taskId: string, providerId: string, modelId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId: "nklein",
		workspacePath: "/tmp/workspace",
		pid: null,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: 1,
		latestHookActivity: null,
		providerId,
		modelId,
	};
}

function createBoardWithPlanningCard(options?: { startInPlanMode?: boolean }): { board: BoardData; card: BoardCard } {
	const card = createTask("task-plan", "Approved planning card", 1, {
		startInPlanMode: options?.startInPlanMode ?? false,
	});
	const board: BoardData = {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "planning", title: "Planning", cards: [card] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
	return { board, card };
}

function buildPlanningToInProgressDrop(taskId: string): DropResult {
	return {
		draggableId: taskId,
		type: "CARD",
		reason: "DROP",
		mode: "FLUID",
		source: { droppableId: "planning", index: 0 },
		destination: { droppableId: "in_progress", index: 0 },
		combine: null,
	} as DropResult;
}

function setupDefaultBoardInteractionMocks(): void {
	useProgrammaticCardMovesMock.mockReturnValue({
		handleProgrammaticCardMoveReady: () => {},
		setRequestMoveTaskToTrashHandler: () => {},
		tryProgrammaticCardMove: () => "unavailable" as const,
		consumeProgrammaticCardMove: () => ({}),
		resolvePendingProgrammaticTrashMove: () => {},
		waitForProgrammaticCardMoveAvailability: async () => {},
		resetProgrammaticCardMoves: () => {},
		requestMoveTaskToTrashWithAnimation: async () => {},
		programmaticCardMoveCycle: 0,
	});
	useLinkedBacklogTaskActionsMock.mockReturnValue({
		handleCreateDependency: () => {},
		handleDeleteDependency: () => {},
		confirmMoveTaskToTrash: async () => {},
		requestMoveTaskToTrash: async () => {},
	});
}

const NOOP_STOP_SESSION = async (): Promise<void> => {};
const NOOP_CLEANUP_WORKSPACE = async (): Promise<null> => null;
const NOOP_FETCH_WORKSPACE_INFO = async (): Promise<null> => null;
const NOOP_SEND_TASK_INPUT = async (): Promise<{ ok: boolean }> => ({ ok: true });
const NOOP_RUN_AUTO_REVIEW = async (): Promise<boolean> => false;

interface HookSnapshot {
	handleRestoreTaskFromTrash: (taskId: string) => void;
	handleStartTask: (taskId: string) => void;
	handleStartAllBacklogTasks: (taskIds?: string[]) => void;
	handleDecomposeTask: (taskId: string) => void;
	handleReplayTask: (taskId: string) => void;
	handleCardSelect: (taskId: string) => void;
	handleConfirmClearTrash: () => void;
	handleDragEnd: (result: DropResult, options?: { selectDroppedTask?: boolean }) => void;
	setSessions: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
}

function createRect(width: number, height: number): DOMRect {
	return {
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		width,
		height,
		right: width,
		bottom: height,
		toJSON: () => ({}),
	} as DOMRect;
}

function HookHarness({
	board,
	setBoard,
	ensureTaskWorkspace,
	startTaskSession,
	stopTaskSession = NOOP_STOP_SESSION,
	cleanupTaskWorkspace = NOOP_CLEANUP_WORKSPACE,
	selectedCard = null,
	initialSessions = {},
	setSelectedTaskIdOverride,
	activeTaskSessionCount = 0,
	maxConcurrentTasks = 3,
	onSnapshot,
}: {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	ensureTaskWorkspace: UseTaskSessionsResult["ensureTaskWorkspace"];
	startTaskSession: UseTaskSessionsResult["startTaskSession"];
	stopTaskSession?: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace?: UseTaskSessionsResult["cleanupTaskWorkspace"];
	selectedCard?: {
		card: BoardCard;
		column: { id: "backlog" | "planning" | "in_progress" | "review" | "trash" };
	} | null;
	initialSessions?: Record<string, RuntimeTaskSessionSummary>;
	setSelectedTaskIdOverride?: Dispatch<SetStateAction<string | null>>;
	activeTaskSessionCount?: number;
	maxConcurrentTasks?: number;
	onSnapshot?: (snapshot: HookSnapshot) => void;
}): null {
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>(initialSessions);
	const [, setSelectedTaskId] = useState<string | null>(null);
	const [, setIsClearTrashDialogOpen] = useState(false);
	const [, setIsGitHistoryOpen] = useState(false);

	const actions = useBoardInteractions({
		board,
		setBoard,
		sessions,
		setSessions,
		selectedCard,
		selectedTaskId: null,
		currentProjectId: "project-1",
		setSelectedTaskId: setSelectedTaskIdOverride ?? setSelectedTaskId,
		setIsClearTrashDialogOpen,
		setIsGitHistoryOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkspaceInfo: NOOP_FETCH_WORKSPACE_INFO,
		sendTaskSessionInput: NOOP_SEND_TASK_INPUT,
		activeTaskSessionCount,
		maxConcurrentTasks,
		readyForReviewNotificationsEnabled: false,
		taskGitActionLoadingByTaskId: {},
		runAutoReviewGitAction: NOOP_RUN_AUTO_REVIEW,
	});

	useEffect(() => {
		onSnapshot?.({
			handleRestoreTaskFromTrash: actions.handleRestoreTaskFromTrash,
			handleStartTask: actions.handleStartTask,
			handleStartAllBacklogTasks: actions.handleStartAllBacklogTasks,
			handleDecomposeTask: actions.handleDecomposeTask,
			handleReplayTask: actions.handleReplayTask,
			handleCardSelect: actions.handleCardSelect,
			handleConfirmClearTrash: actions.handleConfirmClearTrash,
			handleDragEnd: actions.handleDragEnd,
			setSessions,
		});
	}, [
		actions.handleCardSelect,
		actions.handleConfirmClearTrash,
		actions.handleDecomposeTask,
		actions.handleDragEnd,
		actions.handleRestoreTaskFromTrash,
		actions.handleStartAllBacklogTasks,
		actions.handleStartTask,
		onSnapshot,
	]);

	return null;
}

describe("useBoardInteractions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(performance, "now").mockImplementation(() => Date.now());
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
			return window.setTimeout(() => {
				callback(performance.now());
			}, 16);
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle: number) => {
			window.clearTimeout(handle);
		});
		notifyErrorMock.mockReset();
		showAppToastMock.mockReset();
		useLinkedBacklogTaskActionsMock.mockReset();
		useProgrammaticCardMovesMock.mockReset();
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

	it("starts dependency-unblocked tasks even when setBoard updater is deferred", async () => {
		let startWaitingTaskWithAnimation: ((task: BoardCard, fromColumnId: BoardColumnId) => Promise<boolean>) | null =
			null;

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockImplementation(
			(input: {
				startWaitingTaskWithAnimation?: (task: BoardCard, fromColumnId: BoardColumnId) => Promise<boolean>;
			}) => {
				startWaitingTaskWithAnimation = input.startWaitingTaskWithAnimation ?? null;
				return {
					handleCreateDependency: () => {},
					handleDeleteDependency: () => {},
					confirmMoveTaskToTrash: async () => {},
					requestMoveTaskToTrash: async () => {},
				};
			},
		);

		const board = createBoard();
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((_nextBoard) => {
			// Simulate React deferring state updater execution.
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-1",
				baseRef: "main",
				baseCommit: "abc123",
			},
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
				/>,
			);
		});

		if (!startWaitingTaskWithAnimation) {
			throw new Error("Expected startWaitingTaskWithAnimation to be provided.");
		}

		const backlogTask = board.columns[0]?.cards[0];
		if (!backlogTask) {
			throw new Error("Expected a backlog task.");
		}

		let started = false;
		await act(async () => {
			started = await startWaitingTaskWithAnimation!(backlogTask, "backlog");
		});

		expect(started).toBe(true);
		expect(ensureTaskWorkspace).not.toHaveBeenCalled();
		expect(startTaskSession).toHaveBeenCalledWith(backlogTask, { queueOnEndpointBusy: true });
	});

	it("kicks off a session when an approved planning card is dragged into in_progress", async () => {
		setupDefaultBoardInteractionMocks();
		let latestSnapshot: HookSnapshot | null = null;
		const { board } = createBoardWithPlanningCard({ startInPlanMode: false });
		let currentBoard = board;
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: { ok: true as const, path: "/tmp/task-plan", baseRef: "main", baseCommit: "abc123" },
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleDragEnd(buildPlanningToInProgressDrop("task-plan"));
			await Promise.resolve();
			await Promise.resolve();
		});

		// The approved act-mode planning card has no Start button, so this drag is its only
		// kickoff path; it must launch a session and land in `in_progress`.
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-plan" }), {
			queueOnEndpointBusy: true,
		});
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id)).toEqual([
			"task-plan",
		]);
		expect(currentBoard.columns.find((column) => column.id === "planning")?.cards).toEqual([]);
	});

	it("does not restart a planning card that already has a session when dragged into in_progress", async () => {
		setupDefaultBoardInteractionMocks();
		let latestSnapshot: HookSnapshot | null = null;
		const { board } = createBoardWithPlanningCard({ startInPlanMode: false });
		let currentBoard = board;
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: { ok: true as const, path: "/tmp/task-plan", baseRef: "main", baseCommit: "abc123" },
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					initialSessions={{ "task-plan": createRunningNKleinSession("task-plan", "nklein", "model") }}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleDragEnd(buildPlanningToInProgressDrop("task-plan"));
			await Promise.resolve();
			await Promise.resolve();
		});

		// A card that already owns a live session keeps its existing continue/approve flow
		// and must not be relaunched (which would restart it from scratch) by the drag.
		expect(startTaskSession).not.toHaveBeenCalled();
	});

	it("does not kick off a plan-mode planning card dragged into in_progress", async () => {
		setupDefaultBoardInteractionMocks();
		let latestSnapshot: HookSnapshot | null = null;
		const { board } = createBoardWithPlanningCard({ startInPlanMode: true });
		let currentBoard = board;
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: { ok: true as const, path: "/tmp/task-plan", baseRef: "main", baseCommit: "abc123" },
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleDragEnd(buildPlanningToInProgressDrop("task-plan"));
			await Promise.resolve();
			await Promise.resolve();
		});

		// Plan-mode cards run their plan session before execution; dragging one into
		// in_progress must not silently launch it as an act-mode task.
		expect(startTaskSession).not.toHaveBeenCalled();
	});

	it("starts a plan-mode card in place when started from the planning column", async () => {
		setupDefaultBoardInteractionMocks();
		let latestSnapshot: HookSnapshot | null = null;
		const { board } = createBoardWithPlanningCard({ startInPlanMode: true });
		let currentBoard = board;
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: { ok: true as const, path: "/tmp/task-plan", baseRef: "main", baseCommit: "abc123" },
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartTask("task-plan");
			await Promise.resolve();
			await Promise.resolve();
		});

		// The Start (play) button on a planning card must launch its plan session in place,
		// without needing a column transition to animate.
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-plan" }), {
			queueOnEndpointBusy: true,
		});
		expect(currentBoard.columns.find((column) => column.id === "planning")?.cards.map((card) => card.id)).toEqual([
			"task-plan",
		]);
	});

	it("marks backlog tasks as needing decomposition when the start guard blocks them", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard = createBoard();
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-1",
				baseRef: "main",
				baseCommit: "abc123",
			},
		}));
		const startTaskSession = vi.fn(async () => ({
			ok: false as const,
			message: "Task start blocked: this card needs decomposition.",
			errorCode: "needs_decomposition" as const,
		}));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable" as const,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}
		await act(async () => {
			await Promise.resolve();
		});
		setBoard.mockClear();

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
			await Promise.resolve();
			await Promise.resolve();
		});

		const backlogTask = currentBoard.columns.find((column) => column.id === "backlog")?.cards[0];
		expect(backlogTask?.blockedKind).toBe("needs_decomposition");
		expect(backlogTask?.blockedReason).toBe("Task start blocked: this card needs decomposition.");
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards).toEqual([]);
	});

	it("marks tasks as blocked when Docker agent isolation is unavailable", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard = createBoard();
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-1",
				baseRef: "main",
				baseCommit: "abc123",
			},
		}));
		const startTaskSession = vi.fn(async () => ({
			ok: false as const,
			message: "Docker is required for !Klein agent isolation, but it is unavailable.",
			errorCode: "agent_sandbox_unavailable" as const,
		}));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable" as const,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}
		await act(async () => {
			await Promise.resolve();
		});
		setBoard.mockClear();

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		const backlogTask = currentBoard.columns.find((column) => column.id === "backlog")?.cards[0];
		expect(backlogTask?.blockedKind).toBe("agent_sandbox_unavailable");
		expect(backlogTask?.blockedReason).toBe("Docker is required for !Klein agent isolation, but it is unavailable.");
		expect(notifyErrorMock).toHaveBeenCalledWith(
			"Docker is required for !Klein agent isolation, but it is unavailable.",
		);
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards).toEqual([]);
	});

	it("caps manual start-all by available task capacity", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						createTask("task-1", "Backlog task 1", 1),
						createTask("task-2", "Backlog task 2", 2),
						createTask("task-3", "Backlog task 3", 3),
					],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable" as const,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					activeTaskSessionCount={1}
					maxConcurrentTasks={2}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartAllBacklogTasks();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(startTaskSession).toHaveBeenCalledTimes(1);
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), {
			queueOnEndpointBusy: undefined,
		});
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id)).toEqual([
			"task-1",
		]);
		expect(currentBoard.columns.find((column) => column.id === "backlog")?.cards.map((card) => card.id)).toEqual([
			"task-2",
			"task-3",
		]);
	});

	it("caps manual start-all by the swarm card batch budget", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: Array.from({ length: 15 }, (_, index) =>
						createTask(`task-${index + 1}`, `Backlog task ${index + 1}`, index + 1),
					),
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable" as const,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					maxConcurrentTasks={20}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartAllBacklogTasks();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(startTaskSession).toHaveBeenCalledTimes(12);
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards).toHaveLength(12);
		expect(currentBoard.columns.find((column) => column.id === "backlog")?.cards).toHaveLength(3);
	});

	it("discards saved workspace changes when clearing trash permanently", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [createTask("trash-task", "Trash task", 1)] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const stopTaskSession = vi.fn(async (_taskId: string) => {});
		const cleanupTaskWorkspace = vi.fn(async (_taskId: string) => ({ ok: true, removed: true }));
		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={vi.fn()}
					startTaskSession={vi.fn()}
					stopTaskSession={stopTaskSession}
					cleanupTaskWorkspace={cleanupTaskWorkspace}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleConfirmClearTrash();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(stopTaskSession).toHaveBeenCalledWith("trash-task");
		expect(cleanupTaskWorkspace).toHaveBeenCalledWith("trash-task", { preserveChanges: false });
		expect(currentBoard.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
	});

	it("prioritizes backlog cards for the already loaded NKlein model during manual start-all", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						createTask("task-cold", "Cold model task", 1, {
							filesLikelyTouched: ["src/cold.ts"],
						}),
						{
							...createTask("task-loaded", "Loaded model task", 2, {
								filesLikelyTouched: ["src/loaded.ts"],
							}),
							nkleinSettings: {
								providerId: "lmstudio",
								modelId: "qwen-loaded",
							},
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
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable" as const,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					activeTaskSessionCount={1}
					maxConcurrentTasks={2}
					initialSessions={{
						"running-loaded-model": createRunningNKleinSession("running-loaded-model", "lmstudio", "qwen-loaded"),
					}}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartAllBacklogTasks();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(startTaskSession).toHaveBeenCalledTimes(1);
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-loaded" }), {
			queueOnEndpointBusy: undefined,
		});
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id)).toEqual([
			"task-loaded",
		]);
	});

	it("blocks single-card starts when the active task capacity is full", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const board = createBoard();
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>(() => {});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));
		const tryProgrammaticCardMove = vi.fn(() => "unavailable" as const);

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					activeTaskSessionCount={2}
					maxConcurrentTasks={2}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
			await Promise.resolve();
		});

		expect(tryProgrammaticCardMove).not.toHaveBeenCalled();
		expect(ensureTaskWorkspace).not.toHaveBeenCalled();
		expect(startTaskSession).not.toHaveBeenCalled();
	});

	it("blocks single-card starts that overlap likely files with an active task", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [createTask("task-1", "Backlog task", 1, { filesLikelyTouched: ["src/shared.ts"] })],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{
					id: "in_progress",
					title: "In Progress",
					cards: [createTask("task-2", "Active task", 2, { filesLikelyTouched: ["./src/shared.ts"] })],
				},
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>(() => {});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));
		const tryProgrammaticCardMove = vi.fn(() => "unavailable" as const);

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					activeTaskSessionCount={1}
					maxConcurrentTasks={2}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.setSessions({
				"task-2": {
					taskId: "task-2",
					state: "running",
				} as RuntimeTaskSessionSummary,
			});
		});

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
			await Promise.resolve();
		});

		expect(tryProgrammaticCardMove).not.toHaveBeenCalled();
		expect(ensureTaskWorkspace).not.toHaveBeenCalled();
		expect(startTaskSession).not.toHaveBeenCalled();
	});

	it("skips overlapping likely files during manual start-all", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						createTask("task-1", "First task", 1, { filesLikelyTouched: ["src/shared.ts"] }),
						createTask("task-2", "Second task", 2, { filesLikelyTouched: ["src/shared.ts"] }),
						createTask("task-3", "Third task", 3, { filesLikelyTouched: ["src/other.ts"] }),
					],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((updater) => {
			currentBoard = typeof updater === "function" ? updater(currentBoard) : updater;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable" as const,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					maxConcurrentTasks={3}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartAllBacklogTasks();
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(startTaskSession).toHaveBeenCalledTimes(2);
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), {
			queueOnEndpointBusy: undefined,
		});
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-3" }), {
			queueOnEndpointBusy: undefined,
		});
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id)).toEqual([
			"task-3",
			"task-1",
		]);
		expect(currentBoard.columns.find((column) => column.id === "backlog")?.cards.map((card) => card.id)).toEqual([
			"task-2",
		]);
	});

	it("skips tasks parked for decomposition during manual start-all", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							...createTask("task-1", "Blocked task", 1),
							blockedKind: "needs_decomposition",
							blockedReason: "Task start blocked: this card needs decomposition.",
						},
						createTask("task-2", "Runnable task", 2),
					],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable" as const,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartAllBacklogTasks(["task-1", "task-2"]);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(startTaskSession).toHaveBeenCalledTimes(1);
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-2" }), {
			queueOnEndpointBusy: undefined,
		});
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id)).toEqual([
			"task-2",
		]);
		expect(currentBoard.columns.find((column) => column.id === "backlog")?.cards.map((card) => card.id)).toEqual([
			"task-1",
		]);
	});

	it("waits for a new backlog card height to settle before starting animation", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const tryProgrammaticCardMove = vi.fn(() => "unavailable" as const);
		let measurementCount = 0;
		const boardElement = document.createElement("section");
		boardElement.className = "kb-board";
		const taskElement = document.createElement("div");
		taskElement.dataset.taskId = "task-1";
		vi.spyOn(taskElement, "getBoundingClientRect").mockImplementation(() => {
			measurementCount += 1;
			if (measurementCount === 1) {
				return createRect(160, 44);
			}
			return createRect(160, 96);
		});
		boardElement.appendChild(taskElement);
		document.body.appendChild(boardElement);

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		const board = createBoard();
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>(() => {});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-1",
				baseRef: "main",
				baseCommit: "abc123",
			},
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
		});

		expect(tryProgrammaticCardMove).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(32);
			await Promise.resolve();
		});

		expect(tryProgrammaticCardMove).not.toHaveBeenCalled();

		await act(async () => {
			vi.advanceTimersByTime(16);
			await Promise.resolve();
		});

		expect(tryProgrammaticCardMove).toHaveBeenCalledWith("task-1", "backlog", "in_progress");
		boardElement.remove();
	});

	it("starts plan-mode backlog tasks into Planning", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const tryProgrammaticCardMove = vi.fn(() => "started" as const);
		const boardElement = document.createElement("section");
		boardElement.className = "kb-board";
		const taskElement = document.createElement("div");
		taskElement.dataset.taskId = "task-1";
		vi.spyOn(taskElement, "getBoundingClientRect").mockReturnValue(createRect(160, 44));
		boardElement.appendChild(taskElement);
		document.body.appendChild(boardElement);

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		const board = createBoard();
		const backlogColumn = board.columns.find((column) => column.id === "backlog");
		if (!backlogColumn?.cards[0]) {
			throw new Error("Expected a backlog card.");
		}
		backlogColumn.cards[0] = createTask("task-1", "Planning task", 1, { startInPlanMode: true });
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>(() => {});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
		});
		await act(async () => {
			vi.advanceTimersByTime(48);
			await Promise.resolve();
		});

		expect(tryProgrammaticCardMove).toHaveBeenCalledWith("task-1", "backlog", "planning");
		boardElement.remove();
	});

	it("starts runnable Planning cards into In Progress", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const tryProgrammaticCardMove = vi.fn(() => "unavailable" as const);
		let currentBoard: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [createTask("task-1", "Generated task", 1)] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const ensureTaskWorkspace = vi.fn(async () => ({ ok: true as const }));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
			await Promise.resolve();
		});

		expect(tryProgrammaticCardMove).toHaveBeenCalledWith("task-1", "planning", "in_progress");
		expect(startTaskSession).toHaveBeenCalledWith(expect.objectContaining({ id: "task-1" }), {
			queueOnEndpointBusy: true,
		});
		expect(currentBoard.columns.find((column) => column.id === "planning")?.cards).toEqual([]);
		expect(currentBoard.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id)).toEqual([
			"task-1",
		]);
	});

	it("starts backlog tasks immediately from detail view without waiting for card height to settle", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const tryProgrammaticCardMove = vi.fn(() => "unavailable" as const);
		let measurementCount = 0;
		const boardElement = document.createElement("section");
		boardElement.className = "kb-board";
		const taskElement = document.createElement("div");
		taskElement.dataset.taskId = "task-1";
		vi.spyOn(taskElement, "getBoundingClientRect").mockImplementation(() => {
			measurementCount += 1;
			if (measurementCount === 1) {
				return createRect(160, 44);
			}
			return createRect(160, 96);
		});
		boardElement.appendChild(taskElement);
		document.body.appendChild(boardElement);

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove,
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		const board = createBoard();
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>(() => {});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-1",
				baseRef: "main",
				baseCommit: "abc123",
			},
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					selectedCard={{ card: board.columns[0]!.cards[0]!, column: { id: "backlog" } }}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleStartTask("task-1");
		});

		expect(tryProgrammaticCardMove).not.toHaveBeenCalled();
		expect(measurementCount).toBe(0);
		expect(setBoard).toHaveBeenCalled();
		expect(startTaskSession).toHaveBeenCalledWith(board.columns[0]!.cards[0]!, { queueOnEndpointBusy: true });
		boardElement.remove();
	});

	it("replays a finished task from scratch after confirmation", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const reviewTask = {
			...createTask("task-review", "Finished task", 2),
			autoReviewStatus: "failed" as const,
			autoReviewMessage: "Old failure",
			blockedKind: "needs_decomposition" as const,
			blockedReason: "Old block",
		};
		let currentBoard: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [reviewTask] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			currentBoard = typeof nextBoard === "function" ? nextBoard(currentBoard) : nextBoard;
		});
		const stopTaskSession = vi.fn(async (_taskId: string) => {});
		const cleanupTaskWorkspace = vi.fn(async (_taskId: string) => ({ ok: true, removed: true }));
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-review",
				baseRef: "main",
				baseCommit: "abc123",
			},
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));
		vi.spyOn(window, "confirm").mockReturnValue(true);

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});
		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					stopTaskSession={stopTaskSession}
					cleanupTaskWorkspace={cleanupTaskWorkspace}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleReplayTask("task-review");
			for (let i = 0; i < 10; i++) {
				await Promise.resolve();
			}
		});

		expect(window.confirm).toHaveBeenCalledWith(
			'Replay "Finished task" from scratch? This stops any existing session and deletes the previous task workspace.',
		);
		expect(stopTaskSession).toHaveBeenCalledWith("task-review");
		expect(cleanupTaskWorkspace).toHaveBeenCalledWith("task-review", { preserveChanges: false });
		expect(ensureTaskWorkspace).not.toHaveBeenCalled();
		expect(startTaskSession).toHaveBeenCalledWith(reviewTask, { queueOnEndpointBusy: true });
		const replayedTask = currentBoard.columns.find((column) => column.id === "in_progress")?.cards[0];
		expect(replayedTask?.id).toBe("task-review");
		expect(replayedTask?.autoReviewStatus).toBeUndefined();
		expect(replayedTask?.autoReviewMessage).toBeUndefined();
		expect(replayedTask?.blockedKind).toBeUndefined();
		expect(replayedTask?.blockedReason).toBeUndefined();
	});

	it("shows a warning toast when restoring a trashed task with a saved patch warning", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		const trashTask: BoardCard = { ...createTask("task-trash", "Trash task", 2), agentId: "codex" };
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [trashTask] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((_nextBoard) => {
			// The optimistic move is not part of this assertion.
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-trash",
				baseRef: "main",
				baseCommit: "abc123",
				warning: "Saved task changes could not be reapplied automatically.",
			},
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleRestoreTaskFromTrash("task-trash");
			// resumeTaskFromTrash is fire-and-forget (void), so flush enough
			// microtasks for ensureTaskWorkspace and startTaskSession to resolve.
			for (let i = 0; i < 10; i++) {
				await Promise.resolve();
			}
		});

		// moveTaskToColumn updates updatedAt with Date.now(), so match fields except updatedAt.
		const expectedTask = expect.objectContaining({
			id: trashTask.id,
			prompt: trashTask.prompt,
			baseRef: trashTask.baseRef,
			createdAt: trashTask.createdAt,
		});
		expect(ensureTaskWorkspace).toHaveBeenCalledWith(expectedTask);
		expect(startTaskSession).toHaveBeenCalledWith(expectedTask, { resumeFromTrash: true });
		expect(showAppToastMock).toHaveBeenCalledWith({
			intent: "warning",
			icon: "warning-sign",
			message: "Saved task changes could not be reapplied automatically.",
			timeout: 7000,
		});
	});

	it("preserves model fields when restoring a trashed task", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		const trashTask: BoardCard = {
			id: "task-trash-model",
			title: "Trash task with model title",
			prompt: "Trash task with model",
			startInPlanMode: false,
			autoReviewEnabled: false,
			autoReviewMode: "commit",
			agentId: "codex",
			nkleinSettings: {
				providerId: "my-provider",
				modelId: "my-model",
			},
			baseRef: "main",
			createdAt: 2,
			updatedAt: 2,
		};
		let currentBoard: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [trashTask] },
			],
			dependencies: [],
		};
		const setBoard = vi.fn<Dispatch<SetStateAction<BoardData>>>((nextBoard) => {
			if (typeof nextBoard === "function") {
				currentBoard = nextBoard(currentBoard);
			} else {
				currentBoard = nextBoard;
			}
		});
		const ensureTaskWorkspace = vi.fn(async () => ({
			ok: true as const,
			response: {
				ok: true as const,
				path: "/tmp/task-trash-model",
				baseRef: "main",
				baseCommit: "abc123",
			},
		}));
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={ensureTaskWorkspace}
					startTaskSession={startTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleRestoreTaskFromTrash("task-trash-model");
			for (let i = 0; i < 10; i++) {
				await Promise.resolve();
			}
		});

		// After restore, disableTaskAutoReview is called via setBoard updater.
		// Verify model fields survived the restore flow.
		const reviewCards = currentBoard.columns.find((col) => col.id === "review")?.cards ?? [];
		const restoredTask = reviewCards.find((card) => card.id === "task-trash-model");
		expect(restoredTask).toBeDefined();
		expect(restoredTask?.nkleinSettings).toEqual({
			providerId: "my-provider",
			modelId: "my-model",
		});
		expect(restoredTask?.agentId).toBe("codex");
	});

	it("ignores card selection requests for trashed tasks", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		const trashTask = createTask("task-trash", "Trash task", 2);
		const board: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [trashTask] },
			],
			dependencies: [],
		};
		const setSelectedTaskId = vi.fn<Dispatch<SetStateAction<string | null>>>();

		await act(async () => {
			root.render(
				<HookHarness
					board={board}
					setBoard={() => board}
					ensureTaskWorkspace={async () => ({ ok: true as const })}
					startTaskSession={async () => ({ ok: true as const })}
					setSelectedTaskIdOverride={setSelectedTaskId}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (!latestSnapshot) {
			throw new Error("Expected a hook snapshot.");
		}

		await act(async () => {
			latestSnapshot!.handleCardSelect("task-trash");
		});

		expect(setSelectedTaskId).not.toHaveBeenCalled();
	});

	it("starts blocked backlog tasks in planning mode for decomposition", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							...createTask("task-1", "Build a large feature", 1),
							blockedKind: "needs_decomposition",
							blockedReason: "Task start blocked: this card needs decomposition.",
						},
					],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard: Dispatch<SetStateAction<BoardData>> = (next) => {
			currentBoard = typeof next === "function" ? next(currentBoard) : next;
		};
		const startTaskSession = vi.fn(async () => ({ ok: true as const }));
		const setSelectedTaskId = vi.fn<Dispatch<SetStateAction<string | null>>>();

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={async () => ({ ok: true as const })}
					startTaskSession={startTaskSession}
					setSelectedTaskIdOverride={setSelectedTaskId}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			latestSnapshot?.handleDecomposeTask("task-1");
		});

		expect(startTaskSession).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1" }),
			expect.objectContaining({
				mode: "plan",
				startInPlanMode: true,
				promptOverride: expect.stringContaining("Project-scale task to decompose:"),
			}),
		);
		const startOptions = (
			startTaskSession.mock.calls as unknown as Array<[unknown, { promptOverride?: string }]>
		)[0]?.[1];
		expect(startOptions?.promptOverride).not.toContain("/kanban-decompose");
		const planningTask = currentBoard.columns.find((column) => column.id === "planning")?.cards[0];
		expect(planningTask?.id).toBe("task-1");
		expect(planningTask?.blockedKind).toBeUndefined();
		expect(setSelectedTaskId).toHaveBeenCalledWith("task-1");
	});

	it("keeps planning-only tasks in Planning when the planning turn finishes", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		let currentBoard: BoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{
					id: "planning",
					title: "Planning",
					cards: [createTask("task-plan", "Plan a feature", 1, { startInPlanMode: true })],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};
		const setBoard: Dispatch<SetStateAction<BoardData>> = (next) => {
			currentBoard = typeof next === "function" ? next(currentBoard) : next;
		};

		useProgrammaticCardMovesMock.mockReturnValue({
			handleProgrammaticCardMoveReady: () => {},
			setRequestMoveTaskToTrashHandler: () => {},
			tryProgrammaticCardMove: () => "unavailable",
			consumeProgrammaticCardMove: () => ({}),
			resolvePendingProgrammaticTrashMove: () => {},
			waitForProgrammaticCardMoveAvailability: async () => {},
			resetProgrammaticCardMoves: () => {},
			requestMoveTaskToTrashWithAnimation: async () => {},
			programmaticCardMoveCycle: 0,
		});

		useLinkedBacklogTaskActionsMock.mockReturnValue({
			handleCreateDependency: () => {},
			handleDeleteDependency: () => {},
			confirmMoveTaskToTrash: async () => {},
			requestMoveTaskToTrash: async () => {},
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={currentBoard}
					setBoard={setBoard}
					ensureTaskWorkspace={async () => ({ ok: true as const })}
					startTaskSession={async () => ({ ok: true as const })}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			latestSnapshot?.setSessions({
				"task-plan": {
					taskId: "task-plan",
					state: "awaiting_review",
					mode: "act",
					agentId: "nklein",
					workspacePath: "/tmp/project",
					pid: null,
					startedAt: 1,
					updatedAt: 2,
					lastOutputAt: 2,
					lastTokenAt: null,
					lastHeartbeatAt: null,
					heartbeatStatus: null,
					reviewReason: null,
					exitCode: null,
					lastHookAt: null,
					latestHookActivity: null,
				},
			});
		});

		expect(currentBoard.columns.find((column) => column.id === "planning")?.cards.map((card) => card.id)).toEqual([
			"task-plan",
		]);
		expect(currentBoard.columns.find((column) => column.id === "review")?.cards).toEqual([]);
	});
});
