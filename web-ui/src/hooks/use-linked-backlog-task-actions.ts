import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";

import { showAppToast } from "@/components/app-toaster";
import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import {
	addTaskDependency,
	completeTaskAndGetReadyLinkedTaskIds,
	findCardSelection,
	moveTaskToColumn,
	removeTaskDependency,
	trashTaskAndGetReadyLinkedTaskIds,
} from "@/state/board-state";
import { trackTaskDependencyCreated, trackTasksAutoStartedFromDependency } from "@/telemetry/events";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";
import { getNextDetailTaskIdAfterTrashMove } from "@/utils/detail-view-task-order";
import { getBoardActiveTaskCardsForFileOverlap, hasLikelyTouchedFileOverlap } from "@/utils/task-file-overlap";

interface RequestMoveTaskToTrashOptions {
	optimisticMoveApplied?: boolean;
	skipWorkingChangeWarning?: boolean;
}

type FinishTaskTarget = "completed" | "trash";

export function useLinkedBacklogTaskActions({
	board,
	setBoard,
	setSelectedTaskId,
	stopTaskSession,
	cleanupTaskWorkspace,
	maybeRequestNotificationPermissionForTaskStart,
	kickoffTaskInProgress,
	activeTaskSessionCount,
	maxConcurrentTasks,
	startWaitingTaskWithAnimation,
	waitForBacklogStartAnimationAvailability,
}: {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	stopTaskSession: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace: (taskId: string) => Promise<unknown>;
	maybeRequestNotificationPermissionForTaskStart: () => void;
	kickoffTaskInProgress: (
		task: BoardCard,
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: { optimisticMove?: boolean; queueOnEndpointBusy?: boolean },
	) => Promise<boolean>;
	activeTaskSessionCount: number;
	maxConcurrentTasks: number;
	startWaitingTaskWithAnimation?: (task: BoardCard, fromColumnId: BoardColumnId) => Promise<boolean>;
	waitForBacklogStartAnimationAvailability?: () => Promise<void>;
}): {
	handleCreateDependency: (fromTaskId: string, toTaskId: string) => void;
	handleDeleteDependency: (dependencyId: string) => void;
	confirmMoveTaskToTrash: (task: BoardCard, currentBoard?: BoardData) => Promise<void>;
	requestMoveTaskToTrash: (
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: RequestMoveTaskToTrashOptions,
	) => Promise<void>;
	requestMoveTaskToCompleted: (taskId: string, fromColumnId: BoardColumnId) => Promise<void>;
} {
	const boardRef = useRef(board);

	useEffect(() => {
		boardRef.current = board;
	}, [board]);

	const handleCreateDependency = useCallback(
		(fromTaskId: string, toTaskId: string) => {
			const result = addTaskDependency(boardRef.current, fromTaskId, toTaskId);
			if (!result.added) {
				const message =
					result.reason === "same_task"
						? "A task cannot be linked to itself."
						: result.reason === "duplicate"
							? "Link already exists."
							: result.reason === "trash_task"
								? "Links cannot include done tasks."
								: result.reason === "non_backlog"
									? "Links must include at least one waiting task."
									: "Could not create link.";
				showAppToast({
					intent: "warning",
					icon: "warning-sign",
					message,
					timeout: 3000,
				});
				return;
			}

			setBoard((currentBoard) => {
				const latestResult = addTaskDependency(currentBoard, fromTaskId, toTaskId);
				return latestResult.added ? latestResult.board : currentBoard;
			});
			trackTaskDependencyCreated();
		},
		[setBoard],
	);

	const handleDeleteDependency = useCallback(
		(dependencyId: string) => {
			setBoard((currentBoard) => {
				const removed = removeTaskDependency(currentBoard, dependencyId);
				return removed.removed ? removed.board : currentBoard;
			});
		},
		[setBoard],
	);

	const performFinishTask = useCallback(
		async (task: BoardCard, target: FinishTaskTarget, currentBoard?: BoardData): Promise<void> => {
			const boardBeforeFinish = currentBoard ?? boardRef.current;
			const finished =
				target === "completed"
					? completeTaskAndGetReadyLinkedTaskIds(boardBeforeFinish, task.id)
					: trashTaskAndGetReadyLinkedTaskIds(boardBeforeFinish, task.id);
			if (!finished.moved) {
				await stopTaskSession(task.id);
				await cleanupTaskWorkspace(task.id);
				return;
			}

			setBoard((currentBoardState) => {
				const latestFinishResult =
					target === "completed"
						? completeTaskAndGetReadyLinkedTaskIds(currentBoardState, task.id)
						: trashTaskAndGetReadyLinkedTaskIds(currentBoardState, task.id);
				return latestFinishResult.moved ? latestFinishResult.board : currentBoardState;
			});
			setSelectedTaskId((currentSelectedTaskId) =>
				currentSelectedTaskId === task.id
					? getNextDetailTaskIdAfterTrashMove(boardBeforeFinish, task.id)
					: currentSelectedTaskId,
			);

			const readyTaskSelections = finished.readyTaskIds
				.map((readyTaskId) => findCardSelection(finished.board, readyTaskId))
				.filter((readyTaskSelection): readyTaskSelection is NonNullable<typeof readyTaskSelection> => {
					return readyTaskSelection !== null;
				});
			const normalizedMaxConcurrentTasks = Math.max(1, Math.trunc(maxConcurrentTasks));
			const activeTasksAfterFinish = Math.max(0, activeTaskSessionCount - 1);
			const availableStartSlots = Math.max(0, normalizedMaxConcurrentTasks - activeTasksAfterFinish);
			const activeFileOwners = getBoardActiveTaskCardsForFileOverlap(finished.board, new Set([task.id]));
			const readyTasksToStart: typeof readyTaskSelections = [];
			for (const readyTaskSelection of readyTaskSelections) {
				if (readyTasksToStart.length >= availableStartSlots) {
					break;
				}
				if (
					hasLikelyTouchedFileOverlap(readyTaskSelection.card, [
						...activeFileOwners,
						...readyTasksToStart.map((selection) => selection.card),
					])
				) {
					continue;
				}
				readyTasksToStart.push(readyTaskSelection);
			}

			if (readyTasksToStart.length > 0) {
				maybeRequestNotificationPermissionForTaskStart();
				let startedTaskCount = 0;
				if (startWaitingTaskWithAnimation) {
					const startedTaskPromises: Promise<boolean>[] = [];
					for (const [index, readyTaskSelection] of readyTasksToStart.entries()) {
						startedTaskPromises.push(
							startWaitingTaskWithAnimation(readyTaskSelection.card, readyTaskSelection.column.id),
						);
						if (index < readyTasksToStart.length - 1) {
							await waitForBacklogStartAnimationAvailability?.();
						}
					}
					const startedTasks = await Promise.all(startedTaskPromises);
					startedTaskCount = startedTasks.filter(Boolean).length;
				} else {
					setBoard((currentBoardState) => {
						let nextBoardState = currentBoardState;
						for (const readyTaskSelection of readyTasksToStart) {
							const moved = moveTaskToColumn(nextBoardState, readyTaskSelection.card.id, "in_progress", {
								insertAtTop: true,
							});
							if (moved.moved) {
								nextBoardState = moved.board;
							}
						}
						return nextBoardState;
					});
					for (const readyTaskSelection of readyTasksToStart) {
						const started = await kickoffTaskInProgress(
							readyTaskSelection.card,
							readyTaskSelection.card.id,
							readyTaskSelection.column.id,
							{
								optimisticMove: true,
								queueOnEndpointBusy: true,
							},
						);
						if (started) {
							startedTaskCount += 1;
						}
					}
				}
				if (startedTaskCount > 0) {
					trackTasksAutoStartedFromDependency(startedTaskCount);
				}
			}

			await Promise.all([stopTaskSession(task.id), stopTaskSession(getDetailTerminalTaskId(task.id))]);
			await cleanupTaskWorkspace(task.id);
		},
		[
			activeTaskSessionCount,
			cleanupTaskWorkspace,
			kickoffTaskInProgress,
			maxConcurrentTasks,
			maybeRequestNotificationPermissionForTaskStart,
			setBoard,
			setSelectedTaskId,
			startWaitingTaskWithAnimation,
			stopTaskSession,
			waitForBacklogStartAnimationAvailability,
		],
	);

	const performMoveTaskToTrash = useCallback(
		async (task: BoardCard, currentBoard?: BoardData): Promise<void> => {
			await performFinishTask(task, "trash", currentBoard);
		},
		[performFinishTask],
	);

	const requestMoveTaskToTrash = useCallback(
		async (taskId: string, _fromColumnId: BoardColumnId, options?: RequestMoveTaskToTrashOptions): Promise<void> => {
			const boardSnapshot = boardRef.current;
			const selection = findCardSelection(boardSnapshot, taskId);
			if (!selection) {
				return;
			}

			const moveSelectionIfOptimisticMoveIsConfirmed = () => {
				if (!options?.optimisticMoveApplied) {
					return;
				}
				setSelectedTaskId((currentSelectedTaskId) =>
					currentSelectedTaskId === taskId
						? getNextDetailTaskIdAfterTrashMove(boardSnapshot, taskId)
						: currentSelectedTaskId,
				);
			};

			if (options?.skipWorkingChangeWarning) {
				moveSelectionIfOptimisticMoveIsConfirmed();
				await performMoveTaskToTrash(selection.card, boardSnapshot);
				return;
			}

			moveSelectionIfOptimisticMoveIsConfirmed();
			await performMoveTaskToTrash(selection.card, boardSnapshot);
		},
		[performMoveTaskToTrash, setSelectedTaskId],
	);

	const requestMoveTaskToCompleted = useCallback(
		async (taskId: string, fromColumnId: BoardColumnId): Promise<void> => {
			if (fromColumnId !== "review") {
				return;
			}
			const boardSnapshot = boardRef.current;
			const selection = findCardSelection(boardSnapshot, taskId);
			if (selection?.column.id !== "review") {
				return;
			}
			await performFinishTask(selection.card, "completed", boardSnapshot);
		},
		[performFinishTask],
	);

	return {
		handleCreateDependency,
		handleDeleteDependency,
		confirmMoveTaskToTrash: async (task: BoardCard, currentBoard?: BoardData) => {
			await performMoveTaskToTrash(task, currentBoard);
		},
		requestMoveTaskToTrash,
		requestMoveTaskToCompleted,
	};
}
