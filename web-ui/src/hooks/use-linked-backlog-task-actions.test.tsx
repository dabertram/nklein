import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLinkedBacklogTaskActions } from "@/hooks/use-linked-backlog-task-actions";
import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import type { BoardCard, BoardColumnId, BoardData, BoardDependency } from "@/types";

const trackTaskDependencyCreatedMock = vi.hoisted(() => vi.fn());
const trackTasksAutoStartedFromDependencyMock = vi.hoisted(() => vi.fn());

vi.mock("@/telemetry/events", () => ({
	trackTaskDependencyCreated: trackTaskDependencyCreatedMock,
	trackTasksAutoStartedFromDependency: trackTasksAutoStartedFromDependencyMock,
}));

function createTask(taskId: string, prompt: string, createdAt: number, filesLikelyTouched?: string[]): BoardCard {
	return {
		id: taskId,
		title: prompt,
		prompt,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		filesLikelyTouched,
		baseRef: "main",
		createdAt,
		updatedAt: createdAt,
	};
}

function createBoard(dependencies: BoardDependency[] = []): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [createTask("task-1", "Backlog task", 1), createTask("task-3", "Second backlog task", 3)],
			},
			{ id: "planning", title: "Planning", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [createTask("task-2", "Review task", 2)],
			},
			{ id: "completed", title: "Completed", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies,
	};
}

interface HookSnapshot {
	board: BoardData;
	handleCreateDependency: (fromTaskId: string, toTaskId: string) => void;
	confirmMoveTaskToTrash: (task: BoardCard, currentBoard?: BoardData) => Promise<void>;
	requestMoveTaskToTrash: (
		taskId: string,
		fromColumnId: "backlog" | "in_progress" | "review" | "trash",
	) => Promise<void>;
	requestMoveTaskToCompleted: (taskId: string, fromColumnId: BoardColumnId) => Promise<void>;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function HookHarness({
	boardFactory,
	onSnapshot,
	kickoffTaskInProgress,
	startWaitingTaskWithAnimation,
	waitForBacklogStartAnimationAvailability,
	stopTaskSession,
	cleanupTaskArtifacts,
	activeTaskSessionCount = 1,
	maxConcurrentTasks = 3,
}: {
	boardFactory?: () => BoardData;
	onSnapshot: (snapshot: HookSnapshot) => void;
	kickoffTaskInProgress?: (
		task: BoardCard,
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: { optimisticMove?: boolean; queueOnEndpointBusy?: boolean },
	) => Promise<boolean>;
	startWaitingTaskWithAnimation?: (task: BoardCard, fromColumnId: BoardColumnId) => Promise<boolean>;
	waitForBacklogStartAnimationAvailability?: () => Promise<void>;
	stopTaskSession?: (taskId: string) => Promise<void>;
	cleanupTaskArtifacts?: (taskId: string) => Promise<unknown>;
	activeTaskSessionCount?: number;
	maxConcurrentTasks?: number;
}): null {
	const [board, setBoard] = useState<BoardData>(() => (boardFactory ? boardFactory() : createBoard()));
	const actions = useLinkedBacklogTaskActions({
		board,
		setBoard,
		setSelectedTaskId: () => {},
		stopTaskSession: stopTaskSession ?? (async () => {}),
		cleanupTaskArtifacts: cleanupTaskArtifacts ?? (async () => null),
		maybeRequestNotificationPermissionForTaskStart: () => {},
		kickoffTaskInProgress: kickoffTaskInProgress ?? (async () => true),
		activeTaskSessionCount,
		maxConcurrentTasks,
		startWaitingTaskWithAnimation,
		waitForBacklogStartAnimationAvailability,
	});

	useEffect(() => {
		onSnapshot({
			board,
			handleCreateDependency: actions.handleCreateDependency,
			confirmMoveTaskToTrash: actions.confirmMoveTaskToTrash,
			requestMoveTaskToTrash: actions.requestMoveTaskToTrash,
			requestMoveTaskToCompleted: actions.requestMoveTaskToCompleted,
		});
	}, [
		actions.confirmMoveTaskToTrash,
		actions.handleCreateDependency,
		actions.requestMoveTaskToCompleted,
		actions.requestMoveTaskToTrash,
		board,
		onSnapshot,
	]);

	return null;
}

describe("useLinkedBacklogTaskActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		trackTaskDependencyCreatedMock.mockReset();
		trackTasksAutoStartedFromDependencyMock.mockReset();
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

	it("tracks dependency creation after a valid link is added", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;

		await act(async () => {
			initialSnapshot.handleCreateDependency("task-1", "task-2");
		});

		if (latestSnapshot === null) {
			throw new Error("Expected an updated hook snapshot.");
		}
		const snapshot = latestSnapshot as HookSnapshot;

		expect(trackTaskDependencyCreatedMock).toHaveBeenCalledTimes(1);
		expect(snapshot.board.dependencies).toHaveLength(1);
		expect(snapshot.board.dependencies[0]).toMatchObject({
			fromTaskId: "task-1",
			toTaskId: "task-2",
		});
	});

	it("tracks how many linked tasks were auto-started when a parent task is trashed", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const kickoffTaskInProgress = vi.fn(async () => true);
		const boardFactory = () =>
			createBoard([
				{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 },
				{ id: "dep-2", fromTaskId: "task-3", toTaskId: "task-2", createdAt: 11 },
			]);

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					kickoffTaskInProgress={kickoffTaskInProgress}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		const reviewTask = initialSnapshot.board.columns.find((column) => column.id === "review")?.cards[0];
		if (!reviewTask) {
			throw new Error("Expected a review task.");
		}

		await act(async () => {
			await initialSnapshot.confirmMoveTaskToTrash(reviewTask, initialSnapshot.board);
		});

		expect(kickoffTaskInProgress).toHaveBeenCalledTimes(2);
		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(2);
	});

	it("moves review tasks to completed and auto-starts linked backlog tasks", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const kickoffTaskInProgress = vi.fn(async () => true);
		const boardFactory = () =>
			createBoard([{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 }]);

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					kickoffTaskInProgress={kickoffTaskInProgress}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;

		await act(async () => {
			await initialSnapshot.requestMoveTaskToCompleted("task-2", "review");
		});

		const finalSnapshot = latestSnapshot as HookSnapshot;
		const completedCards = finalSnapshot.board.columns.find((column) => column.id === "completed")?.cards ?? [];
		const trashCards = finalSnapshot.board.columns.find((column) => column.id === "trash")?.cards ?? [];
		expect(completedCards.map((card) => card.id)).toContain("task-2");
		expect(trashCards).toEqual([]);
		expect(kickoffTaskInProgress).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1" }),
			"task-1",
			"backlog",
			{ optimisticMove: true, queueOnEndpointBusy: true },
		);
		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(1);
	});

	it("caps dependency-unblocked task starts by available task capacity", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const kickoffTaskInProgress = vi.fn(async () => true);
		const boardFactory = () =>
			createBoard([
				{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 },
				{ id: "dep-2", fromTaskId: "task-3", toTaskId: "task-2", createdAt: 11 },
			]);

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					kickoffTaskInProgress={kickoffTaskInProgress}
					activeTaskSessionCount={2}
					maxConcurrentTasks={2}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;

		await act(async () => {
			await initialSnapshot.requestMoveTaskToCompleted("task-2", "review");
		});

		const finalSnapshot = latestSnapshot as HookSnapshot;
		const inProgressTaskIds =
			finalSnapshot.board.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id) ?? [];
		const backlogTaskIds =
			finalSnapshot.board.columns.find((column) => column.id === "backlog")?.cards.map((card) => card.id) ?? [];
		expect(kickoffTaskInProgress).toHaveBeenCalledTimes(1);
		expect(kickoffTaskInProgress).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1" }),
			"task-1",
			"backlog",
			{ optimisticMove: true, queueOnEndpointBusy: true },
		);
		expect(inProgressTaskIds).toEqual(["task-1"]);
		expect(backlogTaskIds).toEqual(["task-3"]);
		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(1);
	});

	it("skips dependency-unblocked tasks that overlap likely files with another selected start", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const kickoffTaskInProgress = vi.fn(async () => true);
		const boardFactory = (): BoardData => ({
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						createTask("task-1", "Backlog task", 1, ["src/shared.ts"]),
						createTask("task-3", "Second backlog task", 3, ["./src/shared.ts"]),
					],
				},
				{ id: "planning", title: "Planning", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{
					id: "review",
					title: "Review",
					cards: [createTask("task-2", "Review task", 2)],
				},
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [
				{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 },
				{ id: "dep-2", fromTaskId: "task-3", toTaskId: "task-2", createdAt: 11 },
			],
		});

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					kickoffTaskInProgress={kickoffTaskInProgress}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;

		await act(async () => {
			await initialSnapshot.requestMoveTaskToCompleted("task-2", "review");
		});

		const finalSnapshot = latestSnapshot as HookSnapshot;
		const inProgressTaskIds =
			finalSnapshot.board.columns.find((column) => column.id === "in_progress")?.cards.map((card) => card.id) ?? [];
		const backlogTaskIds =
			finalSnapshot.board.columns.find((column) => column.id === "backlog")?.cards.map((card) => card.id) ?? [];
		expect(kickoffTaskInProgress).toHaveBeenCalledTimes(1);
		expect(kickoffTaskInProgress).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task-1" }),
			"task-1",
			"backlog",
			{ optimisticMove: true, queueOnEndpointBusy: true },
		);
		expect(inProgressTaskIds).toEqual(["task-1"]);
		expect(backlogTaskIds).toEqual(["task-3"]);
	});

	it("uses animated backlog starts for dependency-unblocked tasks when available", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const kickoffTaskInProgress = vi.fn(async () => true);
		const startWaitingTaskWithAnimation = vi.fn(
			async (task: BoardCard, _fromColumnId: BoardColumnId) => task.id === "task-1",
		);
		const waitForBacklogStartAnimationAvailability = vi.fn(async () => {});
		const boardFactory = () =>
			createBoard([
				{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 },
				{ id: "dep-2", fromTaskId: "task-3", toTaskId: "task-2", createdAt: 11 },
			]);

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					kickoffTaskInProgress={kickoffTaskInProgress}
					startWaitingTaskWithAnimation={startWaitingTaskWithAnimation}
					waitForBacklogStartAnimationAvailability={waitForBacklogStartAnimationAvailability}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		const reviewTask = initialSnapshot.board.columns.find((column) => column.id === "review")?.cards[0];
		if (!reviewTask) {
			throw new Error("Expected a review task.");
		}

		await act(async () => {
			await initialSnapshot.confirmMoveTaskToTrash(reviewTask, initialSnapshot.board);
		});

		expect(startWaitingTaskWithAnimation).toHaveBeenCalledTimes(2);
		expect(startWaitingTaskWithAnimation.mock.calls[0]?.[0]).toMatchObject({ id: "task-1" });
		expect(startWaitingTaskWithAnimation.mock.calls[0]?.[1]).toBe("backlog");
		expect(startWaitingTaskWithAnimation.mock.calls[1]?.[0]).toMatchObject({ id: "task-3" });
		expect(startWaitingTaskWithAnimation.mock.calls[1]?.[1]).toBe("backlog");
		expect(waitForBacklogStartAnimationAvailability).toHaveBeenCalledTimes(1);
		expect(kickoffTaskInProgress).not.toHaveBeenCalled();
		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(1);
	});

	it("uses animated Planning starts for dependency-unblocked Planning tasks", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const startWaitingTaskWithAnimation = vi.fn(async (_task: BoardCard, _fromColumnId: BoardColumnId) => true);
		const boardFactory = (): BoardData => ({
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "planning", title: "Planning", cards: [createTask("task-1", "Generated task", 1)] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [createTask("task-2", "Review task", 2)] },
				{ id: "completed", title: "Completed", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 }],
		});

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					startWaitingTaskWithAnimation={startWaitingTaskWithAnimation}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		const reviewTask = initialSnapshot.board.columns.find((column) => column.id === "review")?.cards[0];
		if (!reviewTask) {
			throw new Error("Expected a review task.");
		}

		await act(async () => {
			await initialSnapshot.confirmMoveTaskToTrash(reviewTask, initialSnapshot.board);
		});

		expect(startWaitingTaskWithAnimation).toHaveBeenCalledTimes(1);
		expect(startWaitingTaskWithAnimation.mock.calls[0]?.[0]).toMatchObject({ id: "task-1" });
		expect(startWaitingTaskWithAnimation.mock.calls[0]?.[1]).toBe("planning");
		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(1);
	});

	it("stops the main task session and its detail terminal shell when a task is trashed", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const stopTaskSession = vi.fn(async (_taskId: string) => {});

		await act(async () => {
			root.render(
				<HookHarness
					stopTaskSession={stopTaskSession}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		const reviewTask = initialSnapshot.board.columns.find((column) => column.id === "review")?.cards[0];
		if (!reviewTask) {
			throw new Error("Expected a review task.");
		}

		await act(async () => {
			await initialSnapshot.confirmMoveTaskToTrash(reviewTask, initialSnapshot.board);
		});

		expect(stopTaskSession).toHaveBeenCalledTimes(2);
		expect(stopTaskSession).toHaveBeenNthCalledWith(1, reviewTask.id);
		expect(stopTaskSession).toHaveBeenNthCalledWith(2, getDetailTerminalTaskId(reviewTask.id));
	});

	it("trashes tasks directly through the request handler", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const cleanupTaskArtifacts = vi.fn(async (_taskId: string) => null);

		await act(async () => {
			root.render(
				<HookHarness
					cleanupTaskArtifacts={cleanupTaskArtifacts}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;

		await act(async () => {
			await initialSnapshot.requestMoveTaskToTrash("task-2", "review");
		});

		if (latestSnapshot === null) {
			throw new Error("Expected an updated hook snapshot.");
		}
		const nextSnapshot = latestSnapshot as HookSnapshot;
		expect(nextSnapshot.board.columns.find((column) => column.id === "review")?.cards).toHaveLength(0);
		expect(nextSnapshot.board.columns.find((column) => column.id === "trash")?.cards[0]?.id).toBe("task-2");
		expect(cleanupTaskArtifacts).toHaveBeenCalledWith("task-2");
	});

	it("can queue the next dependency-unblocked animation before the previous start resolves", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const firstKickoff = createDeferred<boolean>();
		const secondKickoff = createDeferred<boolean>();
		const waitForSecondAnimation = createDeferred<void>();
		const startWaitingTaskWithAnimation = vi.fn((task: BoardCard, _fromColumnId: BoardColumnId) => {
			if (task.id === "task-1") {
				return firstKickoff.promise;
			}
			return secondKickoff.promise;
		});
		const waitForBacklogStartAnimationAvailability = vi.fn(async () => {
			await waitForSecondAnimation.promise;
		});
		const boardFactory = () =>
			createBoard([
				{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 },
				{ id: "dep-2", fromTaskId: "task-3", toTaskId: "task-2", createdAt: 11 },
			]);

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					startWaitingTaskWithAnimation={startWaitingTaskWithAnimation}
					waitForBacklogStartAnimationAvailability={waitForBacklogStartAnimationAvailability}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		const reviewTask = initialSnapshot.board.columns.find((column) => column.id === "review")?.cards[0];
		if (!reviewTask) {
			throw new Error("Expected a review task.");
		}

		let movePromise: Promise<void> | null = null;
		await act(async () => {
			movePromise = initialSnapshot.confirmMoveTaskToTrash(reviewTask, initialSnapshot.board);
			await Promise.resolve();
		});

		expect(startWaitingTaskWithAnimation).toHaveBeenCalledTimes(1);
		expect(startWaitingTaskWithAnimation.mock.calls[0]?.[0]).toMatchObject({ id: "task-1" });
		expect(startWaitingTaskWithAnimation.mock.calls[0]?.[1]).toBe("backlog");

		await act(async () => {
			waitForSecondAnimation.resolve();
			await Promise.resolve();
		});

		expect(startWaitingTaskWithAnimation).toHaveBeenCalledTimes(2);
		expect(startWaitingTaskWithAnimation.mock.calls[1]?.[0]).toMatchObject({ id: "task-3" });
		expect(startWaitingTaskWithAnimation.mock.calls[1]?.[1]).toBe("backlog");

		await act(async () => {
			firstKickoff.resolve(true);
			secondKickoff.resolve(true);
			await movePromise;
		});

		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(2);
	});
});
