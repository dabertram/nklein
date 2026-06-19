import { useCallback, useEffect, useRef } from "react";

import type { TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { findCardSelection } from "@/state/board-state";
import { getTaskWorkspaceSnapshot, subscribeToAnyTaskMetadata } from "@/stores/workspace-metadata-store";
import type { BoardCard, BoardColumnId, BoardData, TaskAutoReviewMode } from "@/types";
import { resolveTaskAutoReviewMode } from "@/types";

const AUTO_REVIEW_ACTION_DELAY_MS = 500;
const AUTO_REVIEW_STUCK_AFTER_MS = 30_000;

function isTaskAutoReviewEnabled(task: BoardCard): boolean {
	return task.autoReviewEnabled === true;
}

interface TaskGitActionLoadingStateLike {
	commitSource: string | null;
	prSource: string | null;
}

interface RequestMoveTaskToTrashOptions {
	skipWorkingChangeWarning?: boolean;
}

interface AutoReviewNotice {
	status: "running" | "failed";
	message: string;
}

interface UseReviewAutoActionsOptions {
	board: BoardData;
	taskGitActionLoadingByTaskId: Record<string, TaskGitActionLoadingStateLike>;
	runAutoReviewGitAction: (taskId: string, action: TaskGitAction) => Promise<boolean>;
	requestMoveTaskToCompleted: (
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: RequestMoveTaskToTrashOptions,
	) => Promise<void>;
	onAutoReviewNoticeChange?: (taskId: string, notice: AutoReviewNotice | null) => void;
	resetKey?: string | null;
}

function getAutoReviewActionName(action: TaskGitAction): string {
	return action === "pr" ? "Auto-PR" : "Auto-commit";
}

function getAutoReviewRunningMessage(action: TaskGitAction): string {
	return `${getAutoReviewActionName(action)} is running. !Klein will move this task to Done once the task workspace is clean.`;
}

function getAutoReviewNoEffectMessage(action: TaskGitAction): string {
	return `${getAutoReviewActionName(action)} did not start. Review the task workspace, then run the action manually or cancel automation.`;
}

function getAutoReviewStuckMessage(action: TaskGitAction): string {
	return `${getAutoReviewActionName(action)} started, but the task workspace is still dirty. Review the remaining changes, then run the action manually or cancel automation.`;
}

function formatUnknownError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useReviewAutoActions({
	board,
	taskGitActionLoadingByTaskId,
	runAutoReviewGitAction,
	requestMoveTaskToCompleted,
	onAutoReviewNoticeChange,
	resetKey,
}: UseReviewAutoActionsOptions): void {
	const boardRef = useRef<BoardData>(board);
	const runAutoReviewGitActionRef = useRef(runAutoReviewGitAction);
	const requestMoveTaskToCompletedRef = useRef(requestMoveTaskToCompleted);
	const onAutoReviewNoticeChangeRef = useRef(onAutoReviewNoticeChange);
	const awaitingCleanActionByTaskIdRef = useRef<Record<string, TaskGitAction>>({});
	const awaitingCleanStartedAtByTaskIdRef = useRef<Record<string, number>>({});
	const timerByTaskIdRef = useRef<Record<string, number>>({});
	type ScheduledAutoReviewAction = TaskAutoReviewMode | "move_to_done_after_git_action";
	const scheduledActionByTaskIdRef = useRef<Record<string, ScheduledAutoReviewAction>>({});
	const moveToCompletedInFlightTaskIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		boardRef.current = board;
	}, [board]);

	useEffect(() => {
		runAutoReviewGitActionRef.current = runAutoReviewGitAction;
	}, [runAutoReviewGitAction]);

	useEffect(() => {
		requestMoveTaskToCompletedRef.current = requestMoveTaskToCompleted;
	}, [requestMoveTaskToCompleted]);

	useEffect(() => {
		onAutoReviewNoticeChangeRef.current = onAutoReviewNoticeChange;
	}, [onAutoReviewNoticeChange]);

	const setAutoReviewNotice = useCallback((taskId: string, notice: AutoReviewNotice | null) => {
		onAutoReviewNoticeChangeRef.current?.(taskId, notice);
	}, []);

	const clearAutoReviewTimer = useCallback((taskId: string) => {
		const timer = timerByTaskIdRef.current[taskId];
		if (typeof timer === "number") {
			window.clearTimeout(timer);
		}
		delete timerByTaskIdRef.current[taskId];
		delete scheduledActionByTaskIdRef.current[taskId];
	}, []);

	const clearAllAutoReviewState = useCallback(() => {
		for (const timer of Object.values(timerByTaskIdRef.current)) {
			window.clearTimeout(timer);
		}
		awaitingCleanActionByTaskIdRef.current = {};
		awaitingCleanStartedAtByTaskIdRef.current = {};
		timerByTaskIdRef.current = {};
		scheduledActionByTaskIdRef.current = {};
		moveToCompletedInFlightTaskIdsRef.current.clear();
	}, []);

	const scheduleAutoReviewAction = useCallback(
		(taskId: string, action: ScheduledAutoReviewAction, execute: () => void) => {
			const existingTimer = timerByTaskIdRef.current[taskId];
			const existingAction = scheduledActionByTaskIdRef.current[taskId];
			if (typeof existingTimer === "number" && existingAction === action) {
				return;
			}
			if (typeof existingTimer === "number") {
				window.clearTimeout(existingTimer);
			}
			scheduledActionByTaskIdRef.current[taskId] = action;
			timerByTaskIdRef.current[taskId] = window.setTimeout(() => {
				delete timerByTaskIdRef.current[taskId];
				delete scheduledActionByTaskIdRef.current[taskId];
				execute();
			}, AUTO_REVIEW_ACTION_DELAY_MS);
		},
		[],
	);

	useEffect(() => {
		return () => {
			clearAllAutoReviewState();
		};
	}, [clearAllAutoReviewState]);

	useEffect(() => {
		clearAllAutoReviewState();
	}, [clearAllAutoReviewState, resetKey]);

	const evaluateAutoReview = useCallback(
		(_trigger: { source: string; taskId?: string }) => {
			const columnByTaskId = new Map<string, BoardColumnId>();
			const reviewCardsForAutomation: BoardCard[] = [];
			for (const column of boardRef.current.columns) {
				for (const card of column.cards) {
					columnByTaskId.set(card.id, column.id);
					if (column.id === "review") {
						reviewCardsForAutomation.push(card);
					}
				}
			}

			for (const taskId of Object.keys(awaitingCleanActionByTaskIdRef.current)) {
				const columnId = columnByTaskId.get(taskId);
				if (!columnId || columnId === "completed" || columnId === "trash") {
					delete awaitingCleanActionByTaskIdRef.current[taskId];
					delete awaitingCleanStartedAtByTaskIdRef.current[taskId];
					clearAutoReviewTimer(taskId);
					moveToCompletedInFlightTaskIdsRef.current.delete(taskId);
				}
			}

			for (const taskId of moveToCompletedInFlightTaskIdsRef.current) {
				if (columnByTaskId.get(taskId) !== "review") {
					moveToCompletedInFlightTaskIdsRef.current.delete(taskId);
				}
			}

			const reviewTaskIds = new Set(reviewCardsForAutomation.map((card) => card.id));
			for (const taskId of Object.keys(timerByTaskIdRef.current)) {
				if (!reviewTaskIds.has(taskId)) {
					clearAutoReviewTimer(taskId);
				}
			}

			for (const reviewTask of reviewCardsForAutomation) {
				const autoReviewEnabled = isTaskAutoReviewEnabled(reviewTask);
				if (!autoReviewEnabled) {
					delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
					delete awaitingCleanStartedAtByTaskIdRef.current[reviewTask.id];
					clearAutoReviewTimer(reviewTask.id);
					setAutoReviewNotice(reviewTask.id, null);
					continue;
				}

				const autoReviewMode = resolveTaskAutoReviewMode(reviewTask.autoReviewMode);
				const loadingState = taskGitActionLoadingByTaskId[reviewTask.id];
				const isGitActionInFlight =
					autoReviewMode === "commit"
						? loadingState?.commitSource !== null && loadingState?.commitSource !== undefined
						: autoReviewMode === "pr"
							? loadingState?.prSource !== null && loadingState?.prSource !== undefined
							: false;

				// Commit/PR automation mental model:
				// - A task is only "armed" for auto-done after we actually see working changes in review and trigger commit/pr.
				// - Review entries with zero changes (common during start-in-plan-mode planning loops) are intentionally ignored.
				// - Once armed, a later review state with zero changes is treated as commit/pr success, then we auto-move to done.
				const changedFiles = getTaskWorkspaceSnapshot(reviewTask.id)?.changedFiles;
				const awaitingAction = awaitingCleanActionByTaskIdRef.current[reviewTask.id] ?? null;
				if (awaitingAction) {
					if (
						changedFiles === 0 &&
						!isGitActionInFlight &&
						!moveToCompletedInFlightTaskIdsRef.current.has(reviewTask.id)
					) {
						scheduleAutoReviewAction(reviewTask.id, "move_to_done_after_git_action", () => {
							const latestSelection = findCardSelection(boardRef.current, reviewTask.id);
							if (latestSelection?.column.id !== "review") {
								return;
							}
							if (!isTaskAutoReviewEnabled(latestSelection.card)) {
								return;
							}
							const latestMode = resolveTaskAutoReviewMode(latestSelection.card.autoReviewMode);
							if (latestMode !== autoReviewMode) {
								return;
							}
							moveToCompletedInFlightTaskIdsRef.current.add(reviewTask.id);
							setAutoReviewNotice(reviewTask.id, {
								status: "running",
								message: "Auto-review finished. Moving this task to Done.",
							});
							void requestMoveTaskToCompletedRef
								.current(reviewTask.id, "review", {
									skipWorkingChangeWarning: true,
								})
								.catch((error: unknown) => {
									setAutoReviewNotice(reviewTask.id, {
										status: "failed",
										message: `Auto-review finished, but !Klein could not move the task to Done. ${formatUnknownError(error)}`,
									});
								})
								.finally(() => {
									delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
									delete awaitingCleanStartedAtByTaskIdRef.current[reviewTask.id];
									moveToCompletedInFlightTaskIdsRef.current.delete(reviewTask.id);
								});
						});
					} else {
						clearAutoReviewTimer(reviewTask.id);
						const startedAt = awaitingCleanStartedAtByTaskIdRef.current[reviewTask.id] ?? Date.now();
						awaitingCleanStartedAtByTaskIdRef.current[reviewTask.id] = startedAt;
						if (!isGitActionInFlight && Date.now() - startedAt >= AUTO_REVIEW_STUCK_AFTER_MS) {
							setAutoReviewNotice(reviewTask.id, {
								status: "failed",
								message: getAutoReviewStuckMessage(awaitingAction),
							});
						}
					}
					continue;
				}

				if ((changedFiles ?? 0) <= 0 || isGitActionInFlight) {
					clearAutoReviewTimer(reviewTask.id);
					continue;
				}

				scheduleAutoReviewAction(reviewTask.id, autoReviewMode, () => {
					const latestSelection = findCardSelection(boardRef.current, reviewTask.id);
					if (latestSelection?.column.id !== "review") {
						return;
					}
					if (!isTaskAutoReviewEnabled(latestSelection.card)) {
						return;
					}
					const latestMode = resolveTaskAutoReviewMode(latestSelection.card.autoReviewMode);
					if (latestMode !== autoReviewMode) {
						return;
					}
					setAutoReviewNotice(reviewTask.id, null);
					awaitingCleanActionByTaskIdRef.current[reviewTask.id] = latestMode;
					awaitingCleanStartedAtByTaskIdRef.current[reviewTask.id] = Date.now();
					setAutoReviewNotice(reviewTask.id, {
						status: "running",
						message: getAutoReviewRunningMessage(latestMode),
					});
					void runAutoReviewGitActionRef
						.current(reviewTask.id, latestMode)
						.then((triggered) => {
							if (triggered) {
								return;
							}
							if (awaitingCleanActionByTaskIdRef.current[reviewTask.id] === latestMode) {
								delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
								delete awaitingCleanStartedAtByTaskIdRef.current[reviewTask.id];
								setAutoReviewNotice(reviewTask.id, {
									status: "failed",
									message: getAutoReviewNoEffectMessage(latestMode),
								});
							}
						})
						.catch((error: unknown) => {
							if (awaitingCleanActionByTaskIdRef.current[reviewTask.id] === latestMode) {
								delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
								delete awaitingCleanStartedAtByTaskIdRef.current[reviewTask.id];
								setAutoReviewNotice(reviewTask.id, {
									status: "failed",
									message: `${getAutoReviewActionName(latestMode)} failed. ${formatUnknownError(error)}`,
								});
							}
						});
				});
			}
		},
		[clearAutoReviewTimer, scheduleAutoReviewAction, setAutoReviewNotice, taskGitActionLoadingByTaskId],
	);

	useEffect(() => {
		evaluateAutoReview({
			source: "board_or_loading_change",
		});
	}, [board, evaluateAutoReview, taskGitActionLoadingByTaskId]);

	useEffect(() => {
		return subscribeToAnyTaskMetadata((taskId) => {
			const selection = findCardSelection(boardRef.current, taskId);
			if (selection?.column.id !== "review") {
				return;
			}
			evaluateAutoReview({
				source: "task_metadata_store",
				taskId,
			});
		});
	}, [evaluateAutoReview]);
}
