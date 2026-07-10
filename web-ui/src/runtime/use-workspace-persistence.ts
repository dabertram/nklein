import { useEffect, useRef, useState } from "react";
import type { RuntimeWorkspaceStateResponse, RuntimeWorkspaceStateSaveRequest } from "@/runtime/types";
import { fetchWorkspaceState, WorkspaceStateConflictError } from "@/runtime/workspace-state-query";
import type { BoardData } from "@/types";

const WORKSPACE_STATE_PERSIST_DEBOUNCE_MS = 120;

export interface UseWorkspacePersistenceParams {
	board: BoardData;
	currentProjectId: string | null;
	workspaceRevision: number | null;
	hydrationNonce: number;
	canPersistWorkspaceState: boolean;
	isDocumentVisible: boolean;
	isWorkspaceStateRefreshing: boolean;
	persistWorkspaceState: (input: {
		workspaceId: string;
		payload: RuntimeWorkspaceStateSaveRequest;
	}) => Promise<RuntimeWorkspaceStateResponse>;
	refetchWorkspaceState: () => Promise<unknown>;
	onWorkspaceRevisionChange: (revision: number) => void;
	onBoardRebased?: (board: BoardData) => void;
	onWorkspaceStateConflict?: (input: {
		workspaceId: string;
		currentRevision: number;
		localBoard: BoardData;
		recoveredBoard: BoardData | null;
	}) => void;
}

interface CardLocation {
	columnId: BoardData["columns"][number]["id"];
	index: number;
}

type BoardOperation =
	| {
			kind: "move_card";
			taskId: string;
			fromColumnId: BoardData["columns"][number]["id"];
			toColumnId: BoardData["columns"][number]["id"];
			targetIndex: number;
			previousTaskId: string | null;
			nextTaskId: string | null;
	  }
	| {
			kind: "update_card";
			taskId: string;
			nextCard: BoardData["columns"][number]["cards"][number];
	  }
	| {
			kind: "add_dependency" | "remove_dependency";
			dependency: BoardData["dependencies"][number];
	  };

function omitCardUpdatedAt<T extends { updatedAt?: number }>(card: T): Omit<T, "updatedAt"> {
	const { updatedAt: _updatedAt, ...rest } = card;
	return rest;
}

function collectCardLocations(board: BoardData): Map<string, CardLocation> {
	const locations = new Map<string, CardLocation>();
	for (const column of board.columns) {
		for (const [index, card] of column.cards.entries()) {
			locations.set(card.id, {
				columnId: column.id,
				index,
			});
		}
	}
	return locations;
}

function boardsShareColumnShape(baseBoard: BoardData, nextBoard: BoardData): boolean {
	if (baseBoard.columns.length !== nextBoard.columns.length) {
		return false;
	}
	return baseBoard.columns.every((column, index) => {
		const nextColumn = nextBoard.columns[index];
		return Boolean(nextColumn && nextColumn.id === column.id && nextColumn.title === column.title);
	});
}

function findSingleCardUpdateOperation(baseBoard: BoardData, nextBoard: BoardData): BoardOperation | null {
	const baseLocations = collectCardLocations(baseBoard);
	const nextLocations = collectCardLocations(nextBoard);
	if (baseLocations.size !== nextLocations.size) {
		return null;
	}
	const changedTaskIds: string[] = [];
	for (const baseColumn of baseBoard.columns) {
		for (const card of baseColumn.cards) {
			const nextLocation = nextLocations.get(card.id);
			if (!nextLocation) {
				return null;
			}
			const baseLocation = baseLocations.get(card.id);
			if (!baseLocation) {
				return null;
			}
			if (baseLocation.columnId !== nextLocation.columnId || baseLocation.index !== nextLocation.index) {
				return null;
			}
			const nextCard =
				nextBoard.columns.find((column) => column.id === nextLocation.columnId)?.cards[nextLocation.index] ?? null;
			if (!nextCard) {
				return null;
			}
			if (JSON.stringify(omitCardUpdatedAt(card)) !== JSON.stringify(omitCardUpdatedAt(nextCard))) {
				changedTaskIds.push(card.id);
			}
		}
	}
	if (changedTaskIds.length !== 1) {
		return null;
	}
	const taskId = changedTaskIds[0];
	if (!taskId) {
		return null;
	}
	const nextLocation = nextLocations.get(taskId);
	if (!nextLocation) {
		return null;
	}
	const nextCard =
		nextBoard.columns.find((column) => column.id === nextLocation.columnId)?.cards[nextLocation.index] ?? null;
	if (!nextCard) {
		return null;
	}
	return {
		kind: "update_card",
		taskId,
		nextCard,
	};
}

function findSingleDependencyOperation(baseBoard: BoardData, nextBoard: BoardData): BoardOperation | null {
	const baseCards = JSON.stringify(baseBoard.columns);
	const nextCards = JSON.stringify(nextBoard.columns);
	if (baseCards !== nextCards) {
		return null;
	}
	const baseDependencies = new Map(baseBoard.dependencies.map((dependency) => [dependency.id, dependency]));
	const nextDependencies = new Map(nextBoard.dependencies.map((dependency) => [dependency.id, dependency]));
	const added = nextBoard.dependencies.filter((dependency) => !baseDependencies.has(dependency.id));
	const removed = baseBoard.dependencies.filter((dependency) => !nextDependencies.has(dependency.id));
	const addedDependency = added[0];
	const removedDependency = removed[0];
	if (added.length === 1 && removed.length === 0 && addedDependency) {
		return {
			kind: "add_dependency",
			dependency: addedDependency,
		};
	}
	if (removed.length === 1 && added.length === 0 && removedDependency) {
		return {
			kind: "remove_dependency",
			dependency: removedDependency,
		};
	}
	return null;
}

function findReplayableBoardOperations(baseBoard: BoardData | null, nextBoard: BoardData): BoardOperation[] | null {
	if (!baseBoard) {
		return null;
	}
	if (!boardsShareColumnShape(baseBoard, nextBoard)) {
		return null;
	}
	if (JSON.stringify(baseBoard.dependencies) === JSON.stringify(nextBoard.dependencies)) {
		const moveOperations = findCardMoveOperations(baseBoard, nextBoard);
		if (moveOperations && moveOperations.length > 0) {
			return moveOperations;
		}
		const updateOperation = findSingleCardUpdateOperation(baseBoard, nextBoard);
		return updateOperation ? [updateOperation] : null;
	}
	const dependencyOperation = findSingleDependencyOperation(baseBoard, nextBoard);
	return dependencyOperation ? [dependencyOperation] : null;
}

/**
 * The pure-moves diff: every card content-identical, only positions changed. Returns one move op per moved
 * card, or null when any non-move change exists. Multi-move matters on a BUSY board: the session→lane mirror
 * effect relocates SEVERAL cards in one commit (live-found 2026-07-10 on a simulated swarm — the single-move
 * replay bailed, so pure lane mirroring kept escalating to the "Board changed elsewhere" banner with no user
 * edit anywhere).
 */
function findCardMoveOperations(
	baseBoard: BoardData,
	nextBoard: BoardData,
): Array<Extract<BoardOperation, { kind: "move_card" }>> | null {
	const baseLocations = collectCardLocations(baseBoard);
	const nextLocations = collectCardLocations(nextBoard);
	if (baseLocations.size !== nextLocations.size) {
		return null;
	}
	const movedTaskIds: string[] = [];
	for (const baseColumn of baseBoard.columns) {
		for (const card of baseColumn.cards) {
			const nextLocation = nextLocations.get(card.id);
			if (!nextLocation) {
				return null;
			}
			const nextCard =
				nextBoard.columns.find((column) => column.id === nextLocation.columnId)?.cards[nextLocation.index] ?? null;
			if (!nextCard) {
				return null;
			}
			if (JSON.stringify(omitCardUpdatedAt(card)) !== JSON.stringify(omitCardUpdatedAt(nextCard))) {
				return null;
			}
			const baseLocation = baseLocations.get(card.id);
			if (!baseLocation) {
				return null;
			}
			if (baseLocation.columnId !== nextLocation.columnId || baseLocation.index !== nextLocation.index) {
				movedTaskIds.push(card.id);
			}
		}
	}
	if (movedTaskIds.length === 0) {
		return null;
	}
	const operations: Array<Extract<BoardOperation, { kind: "move_card" }>> = [];
	for (const taskId of movedTaskIds) {
		const fromLocation = baseLocations.get(taskId);
		const toLocation = nextLocations.get(taskId);
		if (!fromLocation || !toLocation) {
			return null;
		}
		const nextColumn = nextBoard.columns.find((column) => column.id === toLocation.columnId);
		const previousTaskId = toLocation.index > 0 ? (nextColumn?.cards[toLocation.index - 1]?.id ?? null) : null;
		const nextTaskId = nextColumn?.cards[toLocation.index + 1]?.id ?? null;
		operations.push({
			kind: "move_card",
			taskId,
			fromColumnId: fromLocation.columnId,
			toColumnId: toLocation.columnId,
			targetIndex: toLocation.index,
			previousTaskId,
			nextTaskId,
		});
	}
	return operations;
}

function reapplySimpleCardMoveOperation(
	board: BoardData,
	operation: Extract<BoardOperation, { kind: "move_card" }>,
): BoardData | null {
	const sourceColumn = board.columns.find((column) => column.cards.some((card) => card.id === operation.taskId));
	const targetColumn = board.columns.find((column) => column.id === operation.toColumnId);
	if (!sourceColumn || !targetColumn) {
		return null;
	}
	const movingCard = sourceColumn.cards.find((card) => card.id === operation.taskId);
	if (!movingCard) {
		return null;
	}
	const columns = board.columns.map((column) => {
		if (column.id !== sourceColumn.id) {
			return column;
		}
		return {
			...column,
			cards: column.cards.filter((card) => card.id !== operation.taskId),
		};
	});
	const targetColumnIndex = columns.findIndex((column) => column.id === operation.toColumnId);
	const nextTargetColumn = columns[targetColumnIndex];
	if (!nextTargetColumn) {
		return null;
	}
	let insertIndex = operation.targetIndex;
	if (operation.nextTaskId) {
		const anchorIndex = nextTargetColumn.cards.findIndex((card) => card.id === operation.nextTaskId);
		if (anchorIndex >= 0) {
			insertIndex = anchorIndex;
		}
	} else if (operation.previousTaskId) {
		const anchorIndex = nextTargetColumn.cards.findIndex((card) => card.id === operation.previousTaskId);
		if (anchorIndex >= 0) {
			insertIndex = anchorIndex + 1;
		}
	} else {
		insertIndex = 0;
	}
	const boundedInsertIndex = Math.max(0, Math.min(insertIndex, nextTargetColumn.cards.length));
	const nextCards = [...nextTargetColumn.cards];
	nextCards.splice(boundedInsertIndex, 0, movingCard);
	columns[targetColumnIndex] = {
		...nextTargetColumn,
		cards: nextCards,
	};
	return {
		...board,
		columns,
	};
}

function reapplyCardUpdateOperation(
	board: BoardData,
	operation: Extract<BoardOperation, { kind: "update_card" }>,
): BoardData | null {
	let found = false;
	const columns = board.columns.map((column) => ({
		...column,
		cards: column.cards.map((card) => {
			if (card.id !== operation.taskId) {
				return card;
			}
			found = true;
			return operation.nextCard;
		}),
	}));
	if (!found) {
		return null;
	}
	return {
		...board,
		columns,
	};
}

function reapplyDependencyOperation(
	board: BoardData,
	operation: Extract<BoardOperation, { kind: "add_dependency" | "remove_dependency" }>,
): BoardData {
	if (operation.kind === "add_dependency") {
		if (board.dependencies.some((dependency) => dependency.id === operation.dependency.id)) {
			return board;
		}
		return {
			...board,
			dependencies: [...board.dependencies, operation.dependency],
		};
	}
	return {
		...board,
		dependencies: board.dependencies.filter((dependency) => dependency.id !== operation.dependency.id),
	};
}

function reapplyBoardOperation(board: BoardData, operation: BoardOperation): BoardData | null {
	if (operation.kind === "move_card") {
		return reapplySimpleCardMoveOperation(board, operation);
	}
	if (operation.kind === "update_card") {
		return reapplyCardUpdateOperation(board, operation);
	}
	return reapplyDependencyOperation(board, operation);
}

export function useWorkspacePersistence({
	board,
	currentProjectId,
	workspaceRevision,
	hydrationNonce,
	canPersistWorkspaceState,
	isDocumentVisible,
	isWorkspaceStateRefreshing,
	persistWorkspaceState,
	refetchWorkspaceState,
	onWorkspaceRevisionChange,
	onBoardRebased,
	onWorkspaceStateConflict,
}: UseWorkspacePersistenceParams): void {
	const [persistCycle, setPersistCycle] = useState(0);
	const skipNextPersistRef = useRef(false);
	const latestHydrationNonceRef = useRef(hydrationNonce);
	const latestPersistRequestIdRef = useRef(0);
	const persistInFlightRef = useRef(false);
	const persistQueuedRef = useRef(false);
	const currentProjectIdRef = useRef<string | null>(currentProjectId);
	const lastPersistedBoardRef = useRef<BoardData | null>(null);
	const lastPersistedWorkspaceIdRef = useRef<string | null>(null);

	useEffect(() => {
		currentProjectIdRef.current = currentProjectId;
		if (lastPersistedWorkspaceIdRef.current !== currentProjectId) {
			lastPersistedWorkspaceIdRef.current = currentProjectId;
			lastPersistedBoardRef.current = null;
		}
	}, [currentProjectId]);

	useEffect(() => {
		if (latestHydrationNonceRef.current === hydrationNonce) {
			return;
		}
		latestHydrationNonceRef.current = hydrationNonce;
		skipNextPersistRef.current = true;
		lastPersistedWorkspaceIdRef.current = currentProjectId;
		lastPersistedBoardRef.current = board;
	}, [board, currentProjectId, hydrationNonce]);

	useEffect(() => {
		if (!canPersistWorkspaceState || !isDocumentVisible || isWorkspaceStateRefreshing || workspaceRevision == null) {
			return;
		}
		if (persistInFlightRef.current) {
			persistQueuedRef.current = true;
			return;
		}
		if (skipNextPersistRef.current) {
			skipNextPersistRef.current = false;
			return;
		}
		if (
			currentProjectId != null &&
			lastPersistedWorkspaceIdRef.current === currentProjectId &&
			lastPersistedBoardRef.current === board
		) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			const requestId = latestPersistRequestIdRef.current + 1;
			latestPersistRequestIdRef.current = requestId;
			const persistWorkspaceId = currentProjectId;
			if (!persistWorkspaceId) {
				return;
			}
			const payload: RuntimeWorkspaceStateSaveRequest = {
				board,
				expectedRevision: workspaceRevision,
			};
			void (async () => {
				persistInFlightRef.current = true;
				try {
					const saved = await persistWorkspaceState({
						workspaceId: persistWorkspaceId,
						payload,
					});
					if (
						requestId !== latestPersistRequestIdRef.current ||
						currentProjectIdRef.current !== persistWorkspaceId
					) {
						return;
					}
					lastPersistedWorkspaceIdRef.current = persistWorkspaceId;
					lastPersistedBoardRef.current = board;
					onWorkspaceRevisionChange(saved.revision);
				} catch (error) {
					if (error instanceof WorkspaceStateConflictError) {
						if (
							requestId === latestPersistRequestIdRef.current &&
							currentProjectIdRef.current === persistWorkspaceId
						) {
							onWorkspaceRevisionChange(error.currentRevision);
						}
						const replayableOperations = findReplayableBoardOperations(lastPersistedBoardRef.current, board);
						if (
							replayableOperations &&
							requestId === latestPersistRequestIdRef.current &&
							currentProjectIdRef.current === persistWorkspaceId
						) {
							try {
								const latestWorkspaceState = await fetchWorkspaceState(persistWorkspaceId);
								let rebasedBoard: BoardData | null = latestWorkspaceState.board as BoardData;
								for (const operation of replayableOperations) {
									rebasedBoard = rebasedBoard ? reapplyBoardOperation(rebasedBoard, operation) : null;
								}
								if (rebasedBoard) {
									const retried = await persistWorkspaceState({
										workspaceId: persistWorkspaceId,
										payload: {
											board: rebasedBoard,
											expectedRevision: latestWorkspaceState.revision,
										},
									});
									if (
										requestId === latestPersistRequestIdRef.current &&
										currentProjectIdRef.current === persistWorkspaceId
									) {
										lastPersistedWorkspaceIdRef.current = persistWorkspaceId;
										lastPersistedBoardRef.current = rebasedBoard;
										onBoardRebased?.(rebasedBoard);
										onWorkspaceRevisionChange(retried.revision);
										return;
									}
								}
							} catch {
								// Fall through to the existing conflict recovery path.
							}
						}
						if (
							requestId === latestPersistRequestIdRef.current &&
							currentProjectIdRef.current === persistWorkspaceId
						) {
							let recoveredBoard: BoardData | null = null;
							let recoveredBoardApplied = false;
							try {
								const latestWorkspaceState = await fetchWorkspaceState(persistWorkspaceId);
								recoveredBoard = latestWorkspaceState.board as BoardData;
								if (
									requestId === latestPersistRequestIdRef.current &&
									currentProjectIdRef.current === persistWorkspaceId
								) {
									lastPersistedWorkspaceIdRef.current = persistWorkspaceId;
									lastPersistedBoardRef.current = recoveredBoard;
									onBoardRebased?.(recoveredBoard);
									onWorkspaceRevisionChange(latestWorkspaceState.revision);
									recoveredBoardApplied = true;
								}
							} catch {
								// Fall back to a regular refresh if we cannot fetch the latest board directly.
							}
							onWorkspaceStateConflict?.({
								workspaceId: persistWorkspaceId,
								currentRevision: error.currentRevision,
								localBoard: board,
								recoveredBoard,
							});
							if (currentProjectIdRef.current !== persistWorkspaceId) {
								return;
							}
							if (!recoveredBoardApplied) {
								await refetchWorkspaceState();
							}
							return;
						}
						return;
					}
					// Keep the UI usable even if persistence is temporarily unavailable.
				} finally {
					persistInFlightRef.current = false;
					if (persistQueuedRef.current) {
						persistQueuedRef.current = false;
						setPersistCycle((current) => current + 1);
					}
				}
			})();
		}, WORKSPACE_STATE_PERSIST_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [
		board,
		canPersistWorkspaceState,
		currentProjectId,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		onWorkspaceRevisionChange,
		onBoardRebased,
		persistCycle,
		persistWorkspaceState,
		refetchWorkspaceState,
		onWorkspaceStateConflict,
		workspaceRevision,
	]);
}
