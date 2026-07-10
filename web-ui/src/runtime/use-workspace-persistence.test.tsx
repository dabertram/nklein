import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeWorkspaceStateResponse, RuntimeWorkspaceStateSaveRequest } from "@/runtime/types";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import * as workspaceStateQuery from "@/runtime/workspace-state-query";
import type { BoardData } from "@/types";

function createBoard(columns: {
	backlog?: string[];
	review?: string[];
	inProgress?: string[];
	planning?: string[];
	completed?: string[];
	trash?: string[];
	dependencies?: Array<{ id: string; fromTaskId: string; toTaskId: string; createdAt?: number }>;
}): BoardData {
	const createCard = (id: string) => ({
		id,
		title: `Task ${id}`,
		prompt: `Prompt ${id}`,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit" as const,
		baseRef: "main",
		createdAt: 1,
		updatedAt: id === "b" ? 2 : 1,
	});
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: (columns.backlog ?? []).map(createCard) },
			{ id: "planning", title: "Planning", cards: (columns.planning ?? []).map(createCard) },
			{ id: "in_progress", title: "In Progress", cards: (columns.inProgress ?? []).map(createCard) },
			{ id: "review", title: "Review", cards: (columns.review ?? []).map(createCard) },
			{ id: "completed", title: "Done", cards: (columns.completed ?? []).map(createCard) },
			{ id: "trash", title: "Trash", cards: (columns.trash ?? []).map(createCard) },
		],
		dependencies: (columns.dependencies ?? []).map((dependency) => ({
			...dependency,
			createdAt: dependency.createdAt ?? 1,
		})),
	};
}

function createWorkspaceState(board: BoardData, revision: number): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/tmp/project-a",
		statePath: "/tmp/project-a/.nklein/nklein",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board,
		sessions: {},
		revision,
	};
}

interface HookHarnessSnapshot {
	setBoard: (board: BoardData) => void;
	setHydrationNonce: (nonce: number) => void;
}

function HookHarness(props: {
	initialBoard: BoardData;
	initialWorkspaceRevision: number | null;
	initialHydrationNonce: number;
	persistWorkspaceState: (input: {
		workspaceId: string;
		payload: RuntimeWorkspaceStateSaveRequest;
	}) => Promise<RuntimeWorkspaceStateResponse>;
	refetchWorkspaceState: () => Promise<unknown>;
	onWorkspaceRevisionChange: (revision: number) => void;
	onWorkspaceStateConflict?: (input: { workspaceId: string; currentRevision: number }) => void;
	onBoardRebased?: (board: BoardData) => void;
	onSnapshot: (snapshot: HookHarnessSnapshot) => void;
}): null {
	const [board, setBoard] = useState(props.initialBoard);
	const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(props.initialWorkspaceRevision);
	const [hydrationNonce, setHydrationNonce] = useState(props.initialHydrationNonce);

	useWorkspacePersistence({
		board,
		currentProjectId: "project-a",
		workspaceRevision,
		hydrationNonce,
		canPersistWorkspaceState: true,
		isDocumentVisible: true,
		isWorkspaceStateRefreshing: false,
		persistWorkspaceState: props.persistWorkspaceState,
		refetchWorkspaceState: props.refetchWorkspaceState,
		onWorkspaceRevisionChange: (revision) => {
			setWorkspaceRevision(revision);
			props.onWorkspaceRevisionChange(revision);
		},
		onWorkspaceStateConflict: props.onWorkspaceStateConflict,
		onBoardRebased: (nextBoard) => {
			setBoard(nextBoard);
			props.onBoardRebased?.(nextBoard);
		},
	});

	useEffect(() => {
		props.onSnapshot({
			setBoard,
			setHydrationNonce,
		});
	}, [props, setBoard, setHydrationNonce]);

	return null;
}

describe("useWorkspacePersistence", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.restoreAllMocks();
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
		vi.useRealTimers();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("retries a conflicting simple card move against the latest board state", async () => {
		const baseBoard = createBoard({ backlog: ["a", "b"] });
		const movedBoard = createBoard({ backlog: ["a"], review: ["b"] });
		const latestBoard = createBoard({ backlog: ["c", "a", "b"] });
		const rebasedBoard = createBoard({ backlog: ["c", "a"], review: ["b"] });
		const fetchWorkspaceStateSpy = vi
			.spyOn(workspaceStateQuery, "fetchWorkspaceState")
			.mockResolvedValue(createWorkspaceState(latestBoard, 2));
		const persistWorkspaceState = vi
			.fn<
				(input: {
					workspaceId: string;
					payload: RuntimeWorkspaceStateSaveRequest;
				}) => Promise<RuntimeWorkspaceStateResponse>
			>()
			.mockRejectedValueOnce(new workspaceStateQuery.WorkspaceStateConflictError(2))
			.mockResolvedValueOnce(createWorkspaceState(rebasedBoard, 3));
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();
		const onWorkspaceStateConflict = vi.fn();
		const onBoardRebased = vi.fn();
		let latestSnapshot: HookHarnessSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={baseBoard}
					initialWorkspaceRevision={1}
					initialHydrationNonce={0}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
					onBoardRebased={onBoardRebased}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (latestSnapshot === null) {
			throw new Error("Expected hook snapshot.");
		}
		await act(async () => {
			latestSnapshot?.setHydrationNonce(1);
		});
		await act(async () => {
			latestSnapshot?.setBoard(movedBoard);
		});
		await act(async () => {});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(2);
		expect(persistWorkspaceState.mock.calls[0]?.[0]).toMatchObject({
			workspaceId: "project-a",
			payload: {
				board: movedBoard,
				expectedRevision: 1,
			},
		});
		expect(fetchWorkspaceStateSpy).toHaveBeenCalledWith("project-a");
		expect(persistWorkspaceState.mock.calls[1]?.[0]).toMatchObject({
			workspaceId: "project-a",
			payload: {
				board: rebasedBoard,
				expectedRevision: 2,
			},
		});
		expect(refetchWorkspaceState).not.toHaveBeenCalled();
		expect(onWorkspaceStateConflict).not.toHaveBeenCalled();
		expect(onBoardRebased).toHaveBeenCalledWith(rebasedBoard);
		expect(onWorkspaceRevisionChange).toHaveBeenCalledWith(2);
		expect(onWorkspaceRevisionChange).toHaveBeenCalledWith(3);
	});

	it("retries a conflicting MULTI-card pure-move batch against the latest board state (busy-board lane mirror)", async () => {
		// The session→lane mirror effect relocates several cards in ONE commit on a busy board; a conflict there
		// must replay ALL the moves instead of escalating to the "Board changed elsewhere" banner (live-found
		// 2026-07-10 on a simulated swarm with zero user edits).
		const baseBoard = createBoard({ backlog: ["a", "b"], inProgress: ["c"] });
		const movedBoard = createBoard({ backlog: ["a"], review: ["b", "c"] });
		const latestBoard = createBoard({ backlog: ["d", "a", "b"], inProgress: ["c"] });
		const rebasedBoard = createBoard({ backlog: ["d", "a"], review: ["b", "c"] });
		const fetchWorkspaceStateSpy = vi
			.spyOn(workspaceStateQuery, "fetchWorkspaceState")
			.mockResolvedValue(createWorkspaceState(latestBoard, 2));
		const persistWorkspaceState = vi
			.fn<
				(input: {
					workspaceId: string;
					payload: RuntimeWorkspaceStateSaveRequest;
				}) => Promise<RuntimeWorkspaceStateResponse>
			>()
			.mockRejectedValueOnce(new workspaceStateQuery.WorkspaceStateConflictError(2))
			.mockResolvedValueOnce(createWorkspaceState(rebasedBoard, 3));
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();
		const onWorkspaceStateConflict = vi.fn();
		const onBoardRebased = vi.fn();
		let latestSnapshot: HookHarnessSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={baseBoard}
					initialWorkspaceRevision={1}
					initialHydrationNonce={0}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
					onBoardRebased={onBoardRebased}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (latestSnapshot === null) {
			throw new Error("Expected hook snapshot.");
		}
		await act(async () => {
			latestSnapshot?.setHydrationNonce(1);
		});
		await act(async () => {
			latestSnapshot?.setBoard(movedBoard);
		});
		await act(async () => {});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(2);
		expect(fetchWorkspaceStateSpy).toHaveBeenCalledWith("project-a");
		const retriedBoard = persistWorkspaceState.mock.calls[1]?.[0]?.payload.board as BoardData;
		const columnCards = (columnId: string): string[] =>
			retriedBoard.columns.find((column) => column.id === columnId)?.cards.map((card) => card.id) ?? [];
		expect(columnCards("backlog")).toEqual(["d", "a"]);
		expect(columnCards("review")).toEqual(["b", "c"]);
		expect(columnCards("in_progress")).toEqual([]);
		expect(onWorkspaceStateConflict).not.toHaveBeenCalled();
		expect(refetchWorkspaceState).not.toHaveBeenCalled();
	});

	it("falls back to the existing conflict refresh path for non-move edits", async () => {
		const baseBoard = createBoard({ backlog: ["a", "b"] });
		const editedBoard: BoardData = {
			...createBoard({ backlog: ["a", "b"] }),
			columns: [
				{
					...createBoard({ backlog: ["a", "b"] }).columns[0]!,
					cards: [
						{
							...createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[0]!,
							title: "Renamed A",
						},
						createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[1]!,
					],
				},
				...createBoard({ backlog: ["a", "b"] }).columns.slice(1),
			],
			dependencies: [{ id: "dep-1", fromTaskId: "a", toTaskId: "b", createdAt: 1 }],
		};
		const latestBoard = createBoard({ backlog: ["server-a", "b"] });
		const fetchWorkspaceStateSpy = vi
			.spyOn(workspaceStateQuery, "fetchWorkspaceState")
			.mockResolvedValue(createWorkspaceState(latestBoard, 5));
		const persistWorkspaceState = vi
			.fn<
				(input: {
					workspaceId: string;
					payload: RuntimeWorkspaceStateSaveRequest;
				}) => Promise<RuntimeWorkspaceStateResponse>
			>()
			.mockRejectedValueOnce(new workspaceStateQuery.WorkspaceStateConflictError(5));
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();
		const onWorkspaceStateConflict = vi.fn();
		const onBoardRebased = vi.fn();
		let latestSnapshot: HookHarnessSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={baseBoard}
					initialWorkspaceRevision={4}
					initialHydrationNonce={0}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
					onBoardRebased={onBoardRebased}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (latestSnapshot === null) {
			throw new Error("Expected hook snapshot.");
		}
		await act(async () => {
			latestSnapshot?.setHydrationNonce(1);
		});
		await act(async () => {
			latestSnapshot?.setBoard(editedBoard);
		});
		await act(async () => {});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});

		expect(persistWorkspaceState).toHaveBeenCalledTimes(1);
		expect(fetchWorkspaceStateSpy).toHaveBeenCalledWith("project-a");
		expect(onWorkspaceStateConflict).toHaveBeenCalledWith({
			workspaceId: "project-a",
			currentRevision: 5,
			localBoard: editedBoard,
			recoveredBoard: latestBoard,
		});
		expect(refetchWorkspaceState).not.toHaveBeenCalled();
		expect(onBoardRebased).toHaveBeenCalledWith(latestBoard);
		expect(onWorkspaceRevisionChange).toHaveBeenCalledWith(5);
	});

	it("retries a conflicting single-card edit against the latest board state", async () => {
		const baseBoard = createBoard({ backlog: ["a", "b"] });
		const editedBoard: BoardData = {
			...createBoard({ backlog: ["a", "b"] }),
			columns: [
				{
					...createBoard({ backlog: ["a", "b"] }).columns[0]!,
					cards: [
						{
							...createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[0]!,
							title: "Renamed A",
						},
						createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[1]!,
					],
				},
				...createBoard({ backlog: ["a", "b"] }).columns.slice(1),
			],
		};
		const latestBoard = createBoard({ backlog: ["a", "b", "c"] });
		const rebasedBoard: BoardData = {
			...createBoard({ backlog: ["a", "b", "c"] }),
			columns: [
				{
					...createBoard({ backlog: ["a", "b", "c"] }).columns[0]!,
					cards: [
						{
							...createBoard({ backlog: ["a", "b", "c"] }).columns[0]!.cards[0]!,
							title: "Renamed A",
						},
						createBoard({ backlog: ["a", "b", "c"] }).columns[0]!.cards[1]!,
						createBoard({ backlog: ["a", "b", "c"] }).columns[0]!.cards[2]!,
					],
				},
				...createBoard({ backlog: ["a", "b", "c"] }).columns.slice(1),
			],
		};
		const fetchWorkspaceStateSpy = vi
			.spyOn(workspaceStateQuery, "fetchWorkspaceState")
			.mockResolvedValue(createWorkspaceState(latestBoard, 2));
		const persistWorkspaceState = vi
			.fn<
				(input: {
					workspaceId: string;
					payload: RuntimeWorkspaceStateSaveRequest;
				}) => Promise<RuntimeWorkspaceStateResponse>
			>()
			.mockRejectedValueOnce(new workspaceStateQuery.WorkspaceStateConflictError(2))
			.mockResolvedValueOnce(createWorkspaceState(rebasedBoard, 3));
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();
		const onWorkspaceStateConflict = vi.fn();
		const onBoardRebased = vi.fn();
		let latestSnapshot: HookHarnessSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={baseBoard}
					initialWorkspaceRevision={1}
					initialHydrationNonce={0}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
					onBoardRebased={onBoardRebased}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (latestSnapshot === null) {
			throw new Error("Expected hook snapshot.");
		}
		await act(async () => {
			latestSnapshot?.setHydrationNonce(1);
		});
		await act(async () => {
			latestSnapshot?.setBoard(editedBoard);
		});
		await act(async () => {});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});

		expect(fetchWorkspaceStateSpy).toHaveBeenCalledWith("project-a");
		expect(persistWorkspaceState).toHaveBeenCalledTimes(2);
		expect(persistWorkspaceState.mock.calls[1]?.[0]).toMatchObject({
			workspaceId: "project-a",
			payload: {
				board: rebasedBoard,
				expectedRevision: 2,
			},
		});
		expect(refetchWorkspaceState).not.toHaveBeenCalled();
		expect(onWorkspaceStateConflict).not.toHaveBeenCalled();
		expect(onBoardRebased).toHaveBeenCalledWith(rebasedBoard);
		expect(onWorkspaceRevisionChange).toHaveBeenCalledWith(2);
		expect(onWorkspaceRevisionChange).toHaveBeenCalledWith(3);
	});

	it("retries a conflicting dependency change against the latest board state", async () => {
		const baseBoard = createBoard({ backlog: ["a", "b"] });
		const editedBoard = createBoard({
			backlog: ["a", "b"],
			dependencies: [{ id: "dep-1", fromTaskId: "a", toTaskId: "b" }],
		});
		const latestBoard = createBoard({ backlog: ["c", "a", "b"] });
		const rebasedBoard = createBoard({
			backlog: ["c", "a", "b"],
			dependencies: [{ id: "dep-1", fromTaskId: "a", toTaskId: "b" }],
		});
		const fetchWorkspaceStateSpy = vi
			.spyOn(workspaceStateQuery, "fetchWorkspaceState")
			.mockResolvedValue(createWorkspaceState(latestBoard, 4));
		const persistWorkspaceState = vi
			.fn<
				(input: {
					workspaceId: string;
					payload: RuntimeWorkspaceStateSaveRequest;
				}) => Promise<RuntimeWorkspaceStateResponse>
			>()
			.mockRejectedValueOnce(new workspaceStateQuery.WorkspaceStateConflictError(4))
			.mockResolvedValueOnce(createWorkspaceState(rebasedBoard, 5));
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();
		const onWorkspaceStateConflict = vi.fn();
		const onBoardRebased = vi.fn();
		let latestSnapshot: HookHarnessSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={baseBoard}
					initialWorkspaceRevision={3}
					initialHydrationNonce={0}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
					onBoardRebased={onBoardRebased}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (latestSnapshot === null) {
			throw new Error("Expected hook snapshot.");
		}
		await act(async () => {
			latestSnapshot?.setHydrationNonce(1);
		});
		await act(async () => {
			latestSnapshot?.setBoard(editedBoard);
		});
		await act(async () => {});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});

		expect(fetchWorkspaceStateSpy).toHaveBeenCalledWith("project-a");
		expect(persistWorkspaceState.mock.calls[1]?.[0]).toMatchObject({
			workspaceId: "project-a",
			payload: {
				board: rebasedBoard,
				expectedRevision: 4,
			},
		});
		expect(refetchWorkspaceState).not.toHaveBeenCalled();
		expect(onWorkspaceStateConflict).not.toHaveBeenCalled();
		expect(onBoardRebased).toHaveBeenCalledWith(rebasedBoard);
	});

	it("refreshes the workspace when conflict recovery cannot fetch the latest board", async () => {
		const baseBoard = createBoard({ backlog: ["a", "b"] });
		const editedBoard: BoardData = {
			...createBoard({ backlog: ["a", "b"] }),
			columns: [
				{
					...createBoard({ backlog: ["a", "b"] }).columns[0]!,
					cards: [
						{
							...createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[0]!,
							title: "Renamed A",
						},
						createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[1]!,
					],
				},
				...createBoard({ backlog: ["a", "b"] }).columns.slice(1),
			],
		};
		const fetchWorkspaceStateSpy = vi
			.spyOn(workspaceStateQuery, "fetchWorkspaceState")
			.mockRejectedValue(new Error("network down"));
		const persistWorkspaceState = vi
			.fn<
				(input: {
					workspaceId: string;
					payload: RuntimeWorkspaceStateSaveRequest;
				}) => Promise<RuntimeWorkspaceStateResponse>
			>()
			.mockRejectedValueOnce(new workspaceStateQuery.WorkspaceStateConflictError(5));
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();
		const onWorkspaceStateConflict = vi.fn();
		const onBoardRebased = vi.fn();
		let latestSnapshot: HookHarnessSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={baseBoard}
					initialWorkspaceRevision={4}
					initialHydrationNonce={0}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
					onBoardRebased={onBoardRebased}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (latestSnapshot === null) {
			throw new Error("Expected hook snapshot.");
		}
		await act(async () => {
			latestSnapshot?.setHydrationNonce(1);
		});
		await act(async () => {
			latestSnapshot?.setBoard(editedBoard);
		});
		await act(async () => {});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});

		expect(fetchWorkspaceStateSpy).toHaveBeenCalledWith("project-a");
		expect(onWorkspaceStateConflict).toHaveBeenCalledWith({
			workspaceId: "project-a",
			currentRevision: 5,
			localBoard: editedBoard,
			recoveredBoard: null,
		});
		expect(refetchWorkspaceState).toHaveBeenCalledTimes(1);
		expect(onBoardRebased).not.toHaveBeenCalled();
		expect(onWorkspaceRevisionChange).toHaveBeenCalledWith(5);
	});

	it("preserves the later local board edit during a multi-tab conflict", async () => {
		const baseBoard = createBoard({ backlog: ["a", "b"] });
		const laterTabBoard: BoardData = {
			...createBoard({ backlog: ["a", "b"] }),
			columns: [
				{
					...createBoard({ backlog: ["a", "b"] }).columns[0]!,
					cards: [
						createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[0]!,
						{
							...createBoard({ backlog: ["a", "b"] }).columns[0]!.cards[1]!,
							title: "Later tab title",
						},
					],
				},
				...createBoard({ backlog: ["a", "b"] }).columns.slice(1),
			],
		};
		const serverBoard = createBoard({ backlog: ["remote-a"], review: ["b"] });
		vi.spyOn(workspaceStateQuery, "fetchWorkspaceState").mockResolvedValue(createWorkspaceState(serverBoard, 8));
		const persistWorkspaceState = vi
			.fn<
				(input: {
					workspaceId: string;
					payload: RuntimeWorkspaceStateSaveRequest;
				}) => Promise<RuntimeWorkspaceStateResponse>
			>()
			.mockRejectedValueOnce(new workspaceStateQuery.WorkspaceStateConflictError(8));
		const refetchWorkspaceState = vi.fn(async () => undefined);
		const onWorkspaceRevisionChange = vi.fn();
		const onWorkspaceStateConflict = vi.fn();
		const onBoardRebased = vi.fn();
		let latestSnapshot: HookHarnessSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={baseBoard}
					initialWorkspaceRevision={7}
					initialHydrationNonce={0}
					persistWorkspaceState={persistWorkspaceState}
					refetchWorkspaceState={refetchWorkspaceState}
					onWorkspaceRevisionChange={onWorkspaceRevisionChange}
					onWorkspaceStateConflict={onWorkspaceStateConflict}
					onBoardRebased={onBoardRebased}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});
		if (latestSnapshot === null) {
			throw new Error("Expected hook snapshot.");
		}
		await act(async () => {
			latestSnapshot?.setHydrationNonce(1);
		});
		await act(async () => {
			latestSnapshot?.setBoard(laterTabBoard);
		});
		await act(async () => {});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(150);
		});

		expect(onBoardRebased).toHaveBeenCalledWith(serverBoard);
		expect(onWorkspaceStateConflict).toHaveBeenCalledWith({
			workspaceId: "project-a",
			currentRevision: 8,
			localBoard: laterTabBoard,
			recoveredBoard: serverBoard,
		});
		expect(refetchWorkspaceState).not.toHaveBeenCalled();
	});
});
