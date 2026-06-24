import {
	type BeforeCapture,
	DragDropContext,
	type DragStart,
	type DropResult,
	type FluidDragActions,
	type Sensor,
	type SensorAPI,
	type SnapDragActions,
} from "@hello-pangea/dnd";
import { Database, PauseCircle, PlayCircle, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { BoardColumn } from "@/components/board-column";
import { DependencyOverlay } from "@/components/dependencies/dependency-overlay";
import { useDependencyLinking } from "@/components/dependencies/use-dependency-linking";
import { Button } from "@/components/ui/button";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { Spinner } from "@/components/ui/spinner";
import {
	collectTaskEvidence,
	fetchNKleinCodeIntelligenceStatus,
	pauseTask,
	resumeTask,
	saveRuntimeConfig,
} from "@/runtime/runtime-config-query";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeConfigResponse,
	RuntimeNKleinCodeIntelligenceStatusResponse,
	RuntimeSwarmStopSignal,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { canCreateTaskDependency } from "@/state/board-state";
import { findCardColumnId, type ProgrammaticCardMoveInFlight } from "@/state/drag-rules";
import type { BoardCard, BoardColumnId, BoardData, BoardDependency } from "@/types";

const BOARD_COLUMN_ORDER: BoardColumnId[] = ["backlog", "planning", "in_progress", "review", "completed", "trash"];

export type RequestProgrammaticCardMove = (move: ProgrammaticCardMoveInFlight) => boolean;

function formatCodeIntelligenceChip(status: RuntimeNKleinCodeIntelligenceStatusResponse | null): string {
	if (!status) {
		return "Code intel ...";
	}
	if (status.repoMap.error || status.codeIndex.error) {
		return "Code intel issue";
	}
	if (status.repoMap.available && status.codeIndex.searchAvailable) {
		return "Code intel ready";
	}
	if (status.codeIndex.totalChunks > 0) {
		const percent = Math.round((status.codeIndex.indexedChunks / status.codeIndex.totalChunks) * 100);
		return `Code index ${percent}%`;
	}
	return status.repoMap.available ? "Repo map ready" : "Code intel warming";
}

interface EndpointUtilizationSummary {
	endpointId: string;
	running: number;
	modelIds: string[];
}

function formatEndpointUtilizationChip(endpoint: EndpointUtilizationSummary): string {
	const modelLabel = endpoint.modelIds.slice(0, 2).join(", ");
	const extraModelCount = Math.max(0, endpoint.modelIds.length - 2);
	const suffix = extraModelCount > 0 ? ` +${extraModelCount}` : "";
	return `${endpoint.endpointId} ${endpoint.running} active${modelLabel ? ` (${modelLabel}${suffix})` : ""}`;
}

function buildEndpointParallelismNudge(input: {
	waiting: number;
	running: number;
	endpoints: readonly EndpointUtilizationSummary[];
}): string | null {
	if (input.waiting <= 0 || input.running <= 0 || input.endpoints.length !== 1) {
		return null;
	}
	return "One endpoint is serializing work; add another Ollama or LM Studio endpoint for parallel starts.";
}

function isRectVerticallyVisibleWithinContainer(rect: DOMRect, containerRect: DOMRect): boolean {
	return rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
}

export function KanbanBoard({
	data,
	taskSessions,
	onCardSelect,
	onCreateTask,
	onStartTask,
	onDecomposeTask,
	onReplayTask,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onSaveTaskTitle,
	onCommitTask,
	onOpenPrTask,
	onCancelAutomaticTaskAction,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	moveToTrashLoadingById,
	replayTaskLoadingById,
	dependencies,
	onCreateDependency,
	onDeleteDependency,
	onDragEnd,
	onRequestProgrammaticCardMoveReady,
	workspacePath,
	currentProjectId,
	runtimeConfig,
	onRuntimeConfigChanged,
	onTaskSessionSummary,
	replayCardsEnabled = false,
	defaultNKleinModelId,
}: {
	data: BoardData;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCardSelect: (taskId: string) => void;
	onCreateTask: () => void;
	onStartTask?: (taskId: string) => void;
	onDecomposeTask?: (taskId: string) => void;
	onReplayTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onSaveTaskTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	replayTaskLoadingById?: Record<string, boolean>;
	dependencies: BoardDependency[];
	onCreateDependency?: (fromTaskId: string, toTaskId: string) => void;
	onDeleteDependency?: (dependencyId: string) => void;
	onDragEnd: (result: DropResult) => void;
	onRequestProgrammaticCardMoveReady?: (requestMove: RequestProgrammaticCardMove | null) => void;
	workspacePath?: string | null;
	currentProjectId?: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	onRuntimeConfigChanged?: () => void;
	onTaskSessionSummary?: (summary: RuntimeTaskSessionSummary) => void;
	replayCardsEnabled?: boolean;
	defaultNKleinModelId?: string | null;
}): React.ReactElement {
	const dragOccurredRef = useRef(false);
	const boardRef = useRef<HTMLElement>(null);
	const sensorApiRef = useRef<SensorAPI | null>(null);
	const latestDataRef = useRef<BoardData>(data);
	const programmaticCardMoveInFlightRef = useRef<ProgrammaticCardMoveInFlight | null>(null);
	const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);

	const [activeDragSourceColumnId, setActiveDragSourceColumnId] = useState<BoardColumnId | null>(null);
	const [programmaticCardMoveInFlight, setProgrammaticCardMoveInFlight] =
		useState<ProgrammaticCardMoveInFlight | null>(null);
	const [swarmStopSignal, setSwarmStopSignal] = useState<RuntimeSwarmStopSignal | null>(null);
	const [isSwarmStopLoading, setIsSwarmStopLoading] = useState(false);
	const [pausedTaskIds, setPausedTaskIds] = useState<Set<string>>(() => new Set());
	const [copyEvidenceTaskId, setCopyEvidenceTaskId] = useState<string | null>(null);
	const configuredConcurrencyCap = Math.max(1, Math.trunc(runtimeConfig?.maxConcurrentTasks ?? 3));
	const [concurrencyCapDraft, setConcurrencyCapDraft] = useState(configuredConcurrencyCap);
	const [isConcurrencyCapSaving, setIsConcurrencyCapSaving] = useState(false);
	const [codeIntelligenceStatus, setCodeIntelligenceStatus] =
		useState<RuntimeNKleinCodeIntelligenceStatusResponse | null>(null);
	const displayTaskSessions = useMemo(() => {
		if (pausedTaskIds.size === 0) {
			return taskSessions;
		}
		const nextSessions: Record<string, RuntimeTaskSessionSummary> = { ...taskSessions };
		for (const taskId of pausedTaskIds) {
			const summary = nextSessions[taskId];
			if (summary) {
				nextSessions[taskId] = { ...summary, paused: true };
			}
		}
		return nextSessions;
	}, [pausedTaskIds, taskSessions]);
	const dependencyLinking = useDependencyLinking({
		canLinkTasks: (fromTaskId, toTaskId) => canCreateTaskDependency(data, fromTaskId, toTaskId),
		onCreateDependency,
	});
	const swarmCounts = useMemo(() => {
		const cards = data.columns.flatMap((column) => column.cards);
		const titleByTaskId = new Map(cards.map((card) => [card.id, card.title]));
		const running = Object.values(taskSessions).filter((summary) => summary.state === "running").length;
		const blocked = cards.filter((card) => card.blockedKind).length;
		const waiting = data.columns
			.filter((column) => column.id === "backlog" || column.id === "planning")
			.reduce((total, column) => total + column.cards.filter((card) => !card.blockedKind).length, 0);
		// Tasks admitted to the sandbox pool's FIFO queue, waiting for a free container (todo §5.G — surface the
		// explicit queue, not just a per-card state). Ordered by start time so the list reads as the wait order.
		const queuedTitles = Object.values(taskSessions)
			.filter((summary) => summary.state === "queued")
			.sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
			.map((summary) => titleByTaskId.get(summary.taskId) ?? summary.taskId);
		return { running, waiting, blocked, queued: queuedTitles.length, queuedTitles };
	}, [data.columns, taskSessions]);
	const endpointUtilization = useMemo<EndpointUtilizationSummary[]>(() => {
		const endpoints = new Map<string, { running: number; modelIds: Set<string> }>();
		for (const summary of Object.values(taskSessions)) {
			const endpointId = summary.state === "running" ? summary.sharedEndpointId?.trim() : "";
			if (!endpointId) {
				continue;
			}
			const current = endpoints.get(endpointId) ?? { running: 0, modelIds: new Set<string>() };
			current.running += 1;
			const modelId = summary.modelId?.trim();
			if (modelId) {
				current.modelIds.add(modelId);
			}
			endpoints.set(endpointId, current);
		}
		return [...endpoints.entries()]
			.map(([endpointId, value]) => ({
				endpointId,
				running: value.running,
				modelIds: [...value.modelIds].sort((left, right) => left.localeCompare(right)),
			}))
			.sort((left, right) => right.running - left.running || left.endpointId.localeCompare(right.endpointId));
	}, [taskSessions]);
	const endpointParallelismNudge = useMemo(
		() =>
			buildEndpointParallelismNudge({
				waiting: swarmCounts.waiting,
				running: swarmCounts.running,
				endpoints: endpointUtilization,
			}),
		[endpointUtilization, swarmCounts.running, swarmCounts.waiting],
	);

	useEffect(() => {
		setConcurrencyCapDraft(configuredConcurrencyCap);
	}, [configuredConcurrencyCap]);

	useEffect(() => {
		if (!currentProjectId) {
			setSwarmStopSignal(null);
			setCodeIntelligenceStatus(null);
			return;
		}
		let cancelled = false;
		const trpcClient = getRuntimeTrpcClient(currentProjectId);
		void trpcClient.runtime.getSwarmStop.query().then(
			(response) => {
				if (!cancelled && response.ok) {
					setSwarmStopSignal(response.signal);
				}
			},
			() => {
				if (!cancelled) {
					setSwarmStopSignal(null);
				}
			},
		);
		void fetchNKleinCodeIntelligenceStatus(currentProjectId).then(
			(response) => {
				if (!cancelled) {
					setCodeIntelligenceStatus(response);
				}
			},
			() => {
				if (!cancelled) {
					setCodeIntelligenceStatus(null);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [currentProjectId]);

	const handleSaveConcurrencyCap = useCallback(
		async (nextCap: number) => {
			const normalizedNextCap = Math.max(1, Math.trunc(nextCap));
			if (
				!currentProjectId ||
				!runtimeConfig ||
				isConcurrencyCapSaving ||
				normalizedNextCap === configuredConcurrencyCap
			) {
				return;
			}
			setIsConcurrencyCapSaving(true);
			try {
				await saveRuntimeConfig(currentProjectId, { maxConcurrentTasks: normalizedNextCap });
				onRuntimeConfigChanged?.();
				showAppToast({
					intent: "success",
					message: `Swarm cap set to ${normalizedNextCap}.`,
					timeout: 3000,
				});
			} catch (error) {
				setConcurrencyCapDraft(configuredConcurrencyCap);
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setIsConcurrencyCapSaving(false);
			}
		},
		[currentProjectId, runtimeConfig, isConcurrencyCapSaving, configuredConcurrencyCap, onRuntimeConfigChanged],
	);

	const handleToggleSwarmStop = useCallback(async () => {
		if (!currentProjectId || isSwarmStopLoading) {
			return;
		}
		setIsSwarmStopLoading(true);
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const response = swarmStopSignal
				? await trpcClient.runtime.clearSwarmStop.mutate()
				: await trpcClient.runtime.requestSwarmStop.mutate({ reason: "Paused from the !Klein board." });
			if (!response.ok) {
				throw new Error(response.error ?? "Could not update swarm pause state.");
			}
			setSwarmStopSignal(response.signal);
			showAppToast({
				intent: "success",
				message: response.signal ? "Swarm paused." : "Swarm resumed.",
				timeout: 3000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsSwarmStopLoading(false);
		}
	}, [currentProjectId, isSwarmStopLoading, swarmStopSignal]);

	const handlePauseTask = useCallback(
		async (taskId: string) => {
			if (!currentProjectId) {
				return;
			}
			try {
				const response = await pauseTask(currentProjectId, taskId);
				if (!response.ok) {
					throw new Error(response.error ?? "Could not pause task.");
				}
				setPausedTaskIds(new Set(response.pausedTaskIds));
				if (response.summary) {
					onTaskSessionSummary?.(response.summary);
				}
				showAppToast({
					intent: "success",
					message: "Task pause queued.",
					timeout: 3000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			}
		},
		[currentProjectId, onTaskSessionSummary],
	);

	const handleResumeTask = useCallback(
		async (taskId: string) => {
			if (!currentProjectId) {
				return;
			}
			try {
				const response = await resumeTask(currentProjectId, taskId);
				if (!response.ok) {
					throw new Error(response.error ?? "Could not resume task.");
				}
				setPausedTaskIds(new Set(response.pausedTaskIds));
				if (response.summary) {
					onTaskSessionSummary?.(response.summary);
				}
				showAppToast({
					intent: "success",
					message: "Task resumed.",
					timeout: 3000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			}
		},
		[currentProjectId, onTaskSessionSummary],
	);

	const handleCopyTaskEvidence = useCallback(
		async (taskId: string) => {
			if (!currentProjectId || copyEvidenceTaskId) {
				return;
			}
			setCopyEvidenceTaskId(taskId);
			try {
				const response = await collectTaskEvidence(currentProjectId, taskId);
				await navigator.clipboard.writeText(response.promptBlock);
				showAppToast({
					intent: "success",
					message: `Evidence created and copied. ${response.bundlePath}`,
					timeout: 5000,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : "Could not collect task evidence.";
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setCopyEvidenceTaskId(null);
			}
		},
		[currentProjectId, copyEvidenceTaskId],
	);

	useEffect(() => {
		latestDataRef.current = data;
	}, [data]);

	const programmaticSensor: Sensor = useCallback((api: SensorAPI) => {
		sensorApiRef.current = api;
	}, []);

	const getElementClientCenter = useCallback((element: HTMLElement): { x: number; y: number } => {
		const rect = element.getBoundingClientRect();
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
		};
	}, []);

	const canAnimateProgrammaticTopInsertion = useCallback((taskId: string, targetColumnId: BoardColumnId): boolean => {
		const boardElement = boardRef.current;
		if (!boardElement) {
			return false;
		}
		const sourceCardElement = boardElement.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
		const sourceColumnId = findCardColumnId(latestDataRef.current.columns, taskId);
		const sourceColumnElement = sourceColumnId
			? boardElement.querySelector<HTMLElement>(`section[data-column-id="${sourceColumnId}"]`)
			: null;
		const sourceCardsElement = sourceColumnElement?.querySelector<HTMLElement>(".kb-column-cards");
		const targetColumnElement = boardElement.querySelector<HTMLElement>(`[data-column-id="${targetColumnId}"]`);
		const targetCardsElement = targetColumnElement?.querySelector<HTMLElement>(".kb-column-cards");
		if (!sourceCardElement || !sourceCardsElement || !targetCardsElement) {
			return false;
		}

		const sourceCardRect = sourceCardElement.getBoundingClientRect();
		const sourceCardsRect = sourceCardsElement.getBoundingClientRect();
		if (!isRectVerticallyVisibleWithinContainer(sourceCardRect, sourceCardsRect)) {
			return false;
		}

		if (targetCardsElement.scrollTop > 1) {
			return false;
		}

		const firstTargetCardElement = targetCardsElement.querySelector<HTMLElement>("[data-task-id]");
		if (firstTargetCardElement) {
			const firstTargetCardRect = firstTargetCardElement.getBoundingClientRect();
			return isRectVerticallyVisibleWithinContainer(firstTargetCardRect, targetCardsElement.getBoundingClientRect());
		}

		return true;
	}, []);

	const getProgrammaticTopTargetClientSelection = useCallback(
		(taskId: string, targetColumnId: BoardColumnId): { x: number; y: number } | null => {
			const boardElement = boardRef.current;
			if (!boardElement) {
				return null;
			}
			const sourceCardElement = boardElement.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
			const targetColumnElement = boardElement.querySelector<HTMLElement>(`[data-column-id="${targetColumnId}"]`);
			const targetCardsElement = targetColumnElement?.querySelector<HTMLElement>(".kb-column-cards");
			if (!sourceCardElement || !targetCardsElement) {
				return null;
			}

			const sourceCardRect = sourceCardElement.getBoundingClientRect();
			const firstTargetCardElement = targetCardsElement.querySelector<HTMLElement>("[data-task-id]");
			if (firstTargetCardElement) {
				const targetRect = firstTargetCardElement.getBoundingClientRect();
				const desiredCenterY = targetRect.top + sourceCardRect.height / 2;
				const maxTopInsertCenterY = targetRect.top + targetRect.height / 2 - 1;
				return {
					x: targetRect.left + sourceCardRect.width / 2,
					y: Math.min(desiredCenterY, maxTopInsertCenterY),
				};
			}
			const targetRect = targetCardsElement.getBoundingClientRect();
			const targetCardsStyle = window.getComputedStyle(targetCardsElement);
			const paddingTop = Number.parseFloat(targetCardsStyle.paddingTop) || 0;
			const paddingLeft = Number.parseFloat(targetCardsStyle.paddingLeft) || 0;
			return {
				x: targetRect.left + paddingLeft + sourceCardRect.width / 2,
				y: targetRect.top + paddingTop + sourceCardRect.height / 2,
			};
		},
		[],
	);

	const clearProgrammaticCardMoveInFlight = useCallback((taskId?: string) => {
		if (taskId && programmaticCardMoveInFlightRef.current?.taskId !== taskId) {
			return;
		}
		programmaticCardMoveInFlightRef.current = null;
		setProgrammaticCardMoveInFlight(null);
	}, []);

	const requestProgrammaticCardMove = useCallback<RequestProgrammaticCardMove>(
		(move) => {
			const { taskId, toColumnId: targetColumnId } = move;
			const board = latestDataRef.current;
			const sourceColumnId = findCardColumnId(board.columns, taskId);
			if (!sourceColumnId || sourceColumnId !== move.fromColumnId || sourceColumnId === targetColumnId) {
				return false;
			}

			const sensorApi = sensorApiRef.current;
			if (!sensorApi) {
				return false;
			}

			const sourceOrderIndex = BOARD_COLUMN_ORDER.indexOf(sourceColumnId);
			const targetOrderIndex = BOARD_COLUMN_ORDER.indexOf(targetColumnId);
			if (sourceOrderIndex < 0 || targetOrderIndex < 0) {
				return false;
			}
			if (move.insertAtTop && !canAnimateProgrammaticTopInsertion(taskId, targetColumnId)) {
				return false;
			}

			const horizontalSteps = targetOrderIndex - sourceOrderIndex;
			programmaticCardMoveInFlightRef.current = move;
			setProgrammaticCardMoveInFlight(move);
			const preDrag = sensorApi.tryGetLock(taskId);
			if (!preDrag) {
				clearProgrammaticCardMoveInFlight(taskId);
				return false;
			}

			const sourceCardElement = boardRef.current?.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`) ?? null;
			const topTargetClientSelection = move.insertAtTop
				? getProgrammaticTopTargetClientSelection(taskId, targetColumnId)
				: null;
			if (sourceCardElement && topTargetClientSelection) {
				let dragActions: FluidDragActions;
				try {
					dragActions = preDrag.fluidLift(getElementClientCenter(sourceCardElement));
				} catch {
					clearProgrammaticCardMoveInFlight(taskId);
					if (preDrag.isActive()) {
						preDrag.abort();
					}
					return false;
				}

				const startClientSelection = getElementClientCenter(sourceCardElement);
				const startTime = performance.now();
				const deltaX = topTargetClientSelection.x - startClientSelection.x;
				const deltaY = topTargetClientSelection.y - startClientSelection.y;
				const travelDistance = Math.hypot(deltaX, deltaY);
				const durationMs = Math.min(224, Math.max(133, 102 + travelDistance * 0.126)) * 0.5;
				const easeInOutCubic = (value: number) => (value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2);
				const animate = (frameTime: number) => {
					if (!dragActions.isActive()) {
						return;
					}
					try {
						const progress = Math.min((frameTime - startTime) / durationMs, 1);
						const easedProgress = easeInOutCubic(progress);
						dragActions.move({
							x: startClientSelection.x + deltaX * easedProgress,
							y: startClientSelection.y + deltaY * easedProgress,
						});
						if (progress >= 1) {
							dragActions.drop();
							return;
						}
						window.requestAnimationFrame(animate);
					} catch {
						clearProgrammaticCardMoveInFlight(taskId);
						if (dragActions.isActive()) {
							dragActions.cancel();
						}
					}
				};

				window.requestAnimationFrame(animate);
				return true;
			}

			let dragActions: SnapDragActions;
			try {
				dragActions = preDrag.snapLift();
			} catch {
				clearProgrammaticCardMoveInFlight(taskId);
				if (preDrag.isActive()) {
					preDrag.abort();
				}
				return false;
			}

			const moveOneStep = horizontalSteps > 0 ? dragActions.moveRight : dragActions.moveLeft;
			const moveSteps: Array<() => void> = [];
			for (let step = 0; step < Math.abs(horizontalSteps); step += 1) {
				moveSteps.push(moveOneStep);
			}

			const performStep = (stepIndex: number) => {
				if (!dragActions.isActive()) {
					return;
				}
				try {
					if (stepIndex >= moveSteps.length) {
						dragActions.drop();
						return;
					}
					moveSteps[stepIndex]?.();
					window.setTimeout(() => {
						performStep(stepIndex + 1);
					}, 90);
				} catch {
					clearProgrammaticCardMoveInFlight(taskId);
					if (dragActions.isActive()) {
						dragActions.cancel();
					}
				}
			};

			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(() => {
					performStep(0);
				});
			});
			return true;
		},
		[
			canAnimateProgrammaticTopInsertion,
			clearProgrammaticCardMoveInFlight,
			getElementClientCenter,
			getProgrammaticTopTargetClientSelection,
		],
	);

	useEffect(() => {
		onRequestProgrammaticCardMoveReady?.(requestProgrammaticCardMove);
		return () => {
			onRequestProgrammaticCardMoveReady?.(null);
		};
	}, [onRequestProgrammaticCardMoveReady, requestProgrammaticCardMove]);

	const handleBeforeCapture = useCallback(
		(start: BeforeCapture) => {
			setActiveDragTaskId(start.draggableId);
			setActiveDragSourceColumnId(findCardColumnId(data.columns, start.draggableId));
		},
		[data],
	);

	const handleDragStart = useCallback((_start: DragStart) => {
		dragOccurredRef.current = true;
	}, []);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			setActiveDragTaskId(null);
			setActiveDragSourceColumnId(null);
			clearProgrammaticCardMoveInFlight(result.draggableId);
			requestAnimationFrame(() => {
				dragOccurredRef.current = false;
			});
			onDragEnd(result);
		},
		[clearProgrammaticCardMoveInFlight, onDragEnd],
	);

	// Dependency links should reroute as soon as motion starts, not only after drop.
	// Treat the active card as already belonging to its destination/effective column
	// so the edge transition can animate alongside the move.
	const activeTaskEffectiveColumnId =
		programmaticCardMoveInFlight?.toColumnId ??
		(activeDragTaskId !== null && activeDragSourceColumnId === "backlog" ? "in_progress" : null);

	return (
		<div className="flex flex-1 min-h-0 min-w-0 flex-col">
			<div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface-1 px-3">
				<div className="flex min-w-0 items-center gap-2 text-xs text-text-secondary">
					<span className="font-medium text-text-primary">Local swarm</span>
					<span>Running {swarmCounts.running}</span>
					<span>Waiting {swarmCounts.waiting}</span>
					<span>Blocked {swarmCounts.blocked}</span>
					{swarmCounts.queued > 0 ? (
						<span
							className="cursor-help rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-status-gold"
							title={`Sandbox queue — waiting for a free container (in order):\n${swarmCounts.queuedTitles
								.map((title, index) => `${index + 1}. ${title}`)
								.join("\n")}`}
						>
							Queued {swarmCounts.queued}
						</span>
					) : null}
					{endpointUtilization.slice(0, 2).map((endpoint) => (
						<span
							key={endpoint.endpointId}
							className="inline-flex max-w-64 items-center truncate rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-text-secondary"
						>
							{formatEndpointUtilizationChip(endpoint)}
						</span>
					))}
					{endpointUtilization.length > 2 ? (
						<span className="text-text-tertiary">+{endpointUtilization.length - 2} endpoints</span>
					) : null}
					{endpointParallelismNudge ? (
						<span className="hidden max-w-80 truncate text-status-gold lg:inline">
							{endpointParallelismNudge}
						</span>
					) : null}
					{swarmStopSignal ? <span className="text-status-orange">Paused</span> : null}
					{runtimeConfig?.agentSandboxStatus?.state === "blocked" ? (
						<span
							className="rounded-md border border-status-red/40 bg-status-red/10 px-1.5 py-0.5 text-status-red"
							title={
								runtimeConfig.agentSandboxStatus.message ??
								"Docker agent isolation is unavailable, so agent tasks cannot start (fail-closed)."
							}
						>
							Sandbox unavailable
						</span>
					) : null}
					<ElementTooltip id="board.code-intel" side="bottom">
						<span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-text-secondary">
							<Database size={12} />
							{formatCodeIntelligenceChip(codeIntelligenceStatus)}
						</span>
					</ElementTooltip>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<ElementTooltip id="board.concurrency-cap" side="bottom">
						<label className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-secondary">
							<SlidersHorizontal size={12} />
							<span className="font-medium text-text-primary">Cap {concurrencyCapDraft}</span>
							<input
								type="range"
								min={1}
								max={12}
								step={1}
								value={concurrencyCapDraft}
								disabled={!currentProjectId || !runtimeConfig || isConcurrencyCapSaving}
								aria-label="Max concurrent tasks"
								className="h-1.5 w-20 accent-accent disabled:opacity-50"
								onChange={(event) => {
									setConcurrencyCapDraft(Number(event.currentTarget.value));
								}}
								onBlur={() => {
									void handleSaveConcurrencyCap(concurrencyCapDraft);
								}}
								onPointerUp={() => {
									void handleSaveConcurrencyCap(concurrencyCapDraft);
								}}
								onKeyUp={(event) => {
									if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
										void handleSaveConcurrencyCap(concurrencyCapDraft);
									}
								}}
							/>
							{isConcurrencyCapSaving ? <Spinner size={12} /> : null}
						</label>
					</ElementTooltip>
					<ElementTooltip id="board.swarm-pause" side="bottom">
						<Button
							variant={swarmStopSignal ? "default" : "danger"}
							size="sm"
							icon={
								isSwarmStopLoading ? (
									<Spinner size={14} />
								) : swarmStopSignal ? (
									<PlayCircle size={14} />
								) : (
									<PauseCircle size={14} />
								)
							}
							disabled={!currentProjectId || isSwarmStopLoading}
							onClick={() => {
								void handleToggleSwarmStop();
							}}
						>
							{swarmStopSignal ? "Resume" : "Pause"}
						</Button>
					</ElementTooltip>
				</div>
			</div>
			<DragDropContext
				onBeforeCapture={handleBeforeCapture}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
				sensors={[programmaticSensor]}
			>
				<section
					ref={boardRef}
					className="kb-board kb-dependency-surface"
					data-programmatic-card-move={programmaticCardMoveInFlight ? "true" : undefined}
				>
					{data.columns.map((column) => (
						<BoardColumn
							key={column.id}
							column={column}
							taskSessions={displayTaskSessions}
							onCreateTask={column.id === "backlog" ? onCreateTask : undefined}
							onStartTask={column.id === "backlog" || column.id === "planning" ? onStartTask : undefined}
							onPauseTask={currentProjectId ? handlePauseTask : undefined}
							onResumeTask={currentProjectId ? handleResumeTask : undefined}
							onReplayTask={onReplayTask}
							onDecomposeTask={column.id === "backlog" ? onDecomposeTask : undefined}
							onStartAllTasks={column.id === "backlog" ? onStartAllTasks : undefined}
							onClearTrash={column.id === "trash" ? onClearTrash : undefined}
							editingTaskId={column.id === "backlog" ? editingTaskId : null}
							inlineTaskEditor={column.id === "backlog" ? inlineTaskEditor : undefined}
							onEditTask={column.id === "backlog" ? onEditTask : undefined}
							onSaveTitle={column.id !== "trash" ? onSaveTaskTitle : undefined}
							onCommitTask={column.id === "review" ? onCommitTask : undefined}
							onOpenPrTask={column.id === "review" ? onOpenPrTask : undefined}
							onCopyTaskEvidence={currentProjectId ? handleCopyTaskEvidence : undefined}
							onCancelAutomaticTaskAction={onCancelAutomaticTaskAction}
							onMoveToTrashTask={column.id === "review" ? onMoveToTrashTask : undefined}
							onRestoreFromTrashTask={column.id === "trash" ? onRestoreFromTrashTask : undefined}
							commitTaskLoadingById={column.id === "review" ? commitTaskLoadingById : undefined}
							openPrTaskLoadingById={column.id === "review" ? openPrTaskLoadingById : undefined}
							copyEvidenceLoadingById={copyEvidenceTaskId ? { [copyEvidenceTaskId]: true } : undefined}
							moveToTrashLoadingById={column.id === "review" ? moveToTrashLoadingById : undefined}
							replayTaskLoadingById={replayTaskLoadingById}
							activeDragTaskId={activeDragTaskId}
							activeDragSourceColumnId={activeDragSourceColumnId}
							programmaticCardMoveInFlight={programmaticCardMoveInFlight}
							onDependencyPointerDown={dependencyLinking.onDependencyPointerDown}
							onDependencyPointerEnter={dependencyLinking.onDependencyPointerEnter}
							dependencySourceTaskId={dependencyLinking.draft?.sourceTaskId ?? null}
							dependencyTargetTaskId={dependencyLinking.draft?.targetTaskId ?? null}
							isDependencyLinking={dependencyLinking.draft !== null}
							workspacePath={workspacePath}
							replayCardsEnabled={replayCardsEnabled}
							defaultNKleinModelId={defaultNKleinModelId}
							onCardClick={(card) => {
								if (!dragOccurredRef.current) {
									onCardSelect(card.id);
								}
							}}
						/>
					))}
					<DependencyOverlay
						containerRef={boardRef}
						dependencies={dependencies}
						draft={dependencyLinking.draft}
						activeTaskId={activeDragTaskId ?? programmaticCardMoveInFlight?.taskId ?? null}
						activeTaskEffectiveColumnId={activeTaskEffectiveColumnId}
						isMotionActive={activeDragTaskId !== null || programmaticCardMoveInFlight !== null}
						onDeleteDependency={onDeleteDependency}
					/>
				</section>
			</DragDropContext>
		</div>
	);
}
