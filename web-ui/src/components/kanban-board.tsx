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
import type { OperatorSignalOverrides } from "@runtime-operator-board-health";
import {
	Database,
	PauseCircle,
	PlayCircle,
	Plus,
	ShieldAlert,
	SlidersHorizontal,
	Sparkles,
	Waypoints,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { BoardColumn } from "@/components/board-column";
import { BoardHealthSummary } from "@/components/board-health-summary";
import { DependencyOverlay } from "@/components/dependencies/dependency-overlay";
import { useDependencyLinking } from "@/components/dependencies/use-dependency-linking";
import { FleetStrip } from "@/components/fleet-strip";
import { composeFleetRows } from "@/components/fleet-strip-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { fetchCardMailboxCounts, fetchFleetStatus } from "@/runtime/queries/config";
import { fetchNKleinModelRegistry } from "@/runtime/queries/model-registry";
import {
	collectTaskEvidence,
	fetchMergeHistory,
	fetchNKleinCodeIntelligenceStatus,
	pauseTask,
	resumeTask,
	saveRuntimeConfig,
} from "@/runtime/runtime-config-query";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeConfigResponse,
	RuntimeFleetStatusResponse,
	RuntimeMergeHistoryRecord,
	RuntimeNKleinCodeIntelligenceStatusResponse,
	RuntimeNKleinModelRegistryEntry,
	RuntimeSwarmStopSignal,
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { canCreateTaskDependency } from "@/state/board-state";
import { findCardColumnId, type ProgrammaticCardMoveInFlight } from "@/state/drag-rules";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
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

// Condensed board-header view of the durable merge history (todo §5.G). Highlights the most recent
// dependency-ordered auto-merge pass and whether any of the recent passes hit a conflict.
interface MergeHistorySummary {
	latest: RuntimeMergeHistoryRecord;
	conflictCount: number;
}

function summarizeMergeHistory(records: readonly RuntimeMergeHistoryRecord[]): MergeHistorySummary | null {
	const latest = records[0];
	if (!latest) {
		return null;
	}
	return { latest, conflictCount: records.filter((record) => !record.ok).length };
}

function formatMergeHistoryTooltip(records: readonly RuntimeMergeHistoryRecord[]): string {
	return records
		.slice(0, 8)
		.map((record) => {
			const when = new Date(record.recordedAt).toLocaleString();
			if (record.ok) {
				return `✓ ${when} — merged ${record.mergedTaskIds.length}, skipped ${record.skippedTaskIds.length}`;
			}
			const where = record.conflictedPaths.length > 0 ? ` (${record.conflictedPaths.length} paths)` : "";
			return `✗ ${when} — ${record.reason ?? "conflict"}${where}`;
		})
		.join("\n");
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
	onManageDependencies,
	onDragEnd,
	onRequestProgrammaticCardMoveReady,
	workspacePath,
	currentProjectId,
	runtimeConfig,
	onRuntimeConfigChanged,
	onTaskSessionSummary,
	replayCardsEnabled = false,
	forceFleetExpanded = false,
	defaultNKleinModelId,
	reasoningSnippetByTaskId,
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
	onManageDependencies?: (taskId: string) => void;
	onDragEnd: (result: DropResult) => void;
	onRequestProgrammaticCardMoveReady?: (requestMove: RequestProgrammaticCardMove | null) => void;
	workspacePath?: string | null;
	currentProjectId?: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	onRuntimeConfigChanged?: () => void;
	onTaskSessionSummary?: (summary: RuntimeTaskSessionSummary) => void;
	replayCardsEnabled?: boolean;
	/** §5.BB Zoom 3 (Professional): render the fleet block expanded regardless of the stored toggle. */
	forceFleetExpanded?: boolean;
	defaultNKleinModelId?: string | null;
	/** §5.V: live reasoning-phase snippets per task (derived at App level from task-chat reasoning messages). */
	reasoningSnippetByTaskId?: Record<string, string>;
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
	// §5.BC (user pick: treatment C — all edges behind a toggle): persisted, OFF by default so the board
	// stays clean at rest; the linking draft always draws regardless.
	const [dependencyEdgesVisible, setDependencyEdgesVisible] = useState(
		() => readLocalStorageItem(LocalStorageKey.BoardDependencyEdgesVisible) === "1",
	);
	const handleToggleDependencyEdges = useCallback(() => {
		setDependencyEdgesVisible((current) => {
			writeLocalStorageItem(LocalStorageKey.BoardDependencyEdgesVisible, current ? "0" : "1");
			return !current;
		});
	}, []);
	// §5.AX: the expandable per-model fleet block below the swarm counts. Persisted TRI-STATE: unset defers to the
	// zoom default (§5.BB Professional opens it, other zooms keep it collapsed), while an EXPLICIT user toggle wins
	// everywhere — the previous force-open on Professional made the toggle a dead click there (live-found 2026-07-09).
	// The loaded-model registry only polls while the block is open.
	const [fleetStripPref, setFleetStripPref] = useState<string | null>(() =>
		readLocalStorageItem(LocalStorageKey.BoardFleetStripExpanded),
	);
	const fleetStripExpanded = fleetStripPref === null ? forceFleetExpanded : fleetStripPref === "1";
	const handleToggleFleetStrip = useCallback(() => {
		const next = fleetStripExpanded ? "0" : "1";
		writeLocalStorageItem(LocalStorageKey.BoardFleetStripExpanded, next);
		setFleetStripPref(next);
	}, [fleetStripExpanded]);
	// §5.AG/W3.3: feed the board-health rollup the per-task off-summary signals it can't derive from state alone, from
	// data the client already has — the card's `blockedKind` and a session parked with reviewReason "attention" (held
	// for the operator). Fixes the "needs you" / risky counts that were always 0 (no overrides were threaded). The
	// remaining ASK signals (host-action ack, clarifying question) need server state not yet on the client.
	const resolveBoardHealthOverrides = useCallback(
		(taskId: string): OperatorSignalOverrides => {
			const card = data.columns.flatMap((column) => column.cards).find((entry) => entry.id === taskId);
			return {
				blockedKind: card?.blockedKind ?? null,
				deliveryGateHeld: taskSessions[taskId]?.reviewReason === "attention",
			};
		},
		[data, taskSessions],
	);
	const [fleetRegistryModels, setFleetRegistryModels] = useState<RuntimeNKleinModelRegistryEntry[]>([]);
	const [fleetStatus, setFleetStatus] = useState<RuntimeFleetStatusResponse | null>(null);
	const [isConcurrencyCapSaving, setIsConcurrencyCapSaving] = useState(false);
	const [codeIntelligenceStatus, setCodeIntelligenceStatus] =
		useState<RuntimeNKleinCodeIntelligenceStatusResponse | null>(null);
	const [mergeHistory, setMergeHistory] = useState<RuntimeMergeHistoryRecord[]>([]);
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
	// Active work grouped by the persisted launch role (todo §5.G #425), for a board-header strip with
	// click-to-focus. Reads `summary.role` (stamped at start) — no startInPlanMode inference.
	const roleGroups = useMemo(() => {
		const groups: Record<"architect" | "worker" | "reviewer", { count: number; firstTaskId: string | null }> = {
			architect: { count: 0, firstTaskId: null },
			worker: { count: 0, firstTaskId: null },
			reviewer: { count: 0, firstTaskId: null },
		};
		for (const summary of Object.values(taskSessions)) {
			if (summary.state !== "running") {
				continue;
			}
			const role = summary.role === "architect" || summary.role === "reviewer" ? summary.role : "worker";
			groups[role].count += 1;
			groups[role].firstTaskId ??= summary.taskId;
		}
		return groups;
	}, [taskSessions]);
	const mergeSummary = useMemo(() => summarizeMergeHistory(mergeHistory), [mergeHistory]);
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

	// Refresh the durable merge history (todo §5.G) on project switch and whenever the running count
	// changes — the dependency-ordered auto-merge runs as tasks complete, so a drop in `running` is the
	// cheapest signal that a new merge record may have landed.
	useEffect(() => {
		if (!currentProjectId) {
			setMergeHistory([]);
			return;
		}
		let cancelled = false;
		void fetchMergeHistory(currentProjectId).then(
			(response) => {
				if (!cancelled) {
					setMergeHistory(response.records);
				}
			},
			() => {
				if (!cancelled) {
					setMergeHistory([]);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [currentProjectId, swarmCounts.running]);

	// §5.AX: poll the loaded-model registry (the fleet rows) every ~15s, but only while the fleet block is expanded —
	// there is no reason to hit the endpoint when the block is collapsed (its default).
	useEffect(() => {
		if (!currentProjectId || !fleetStripExpanded) {
			setFleetRegistryModels([]);
			return;
		}
		let cancelled = false;
		const loadRegistry = () => {
			void fetchNKleinModelRegistry(currentProjectId).then(
				(response) => {
					if (!cancelled) {
						setFleetRegistryModels(response.models);
					}
				},
				() => {
					if (!cancelled) {
						setFleetRegistryModels([]);
					}
				},
			);
			// Machine names + prompt-shell warmth ride the same cadence; both fail soft to null (labels/idle fall back).
			void fetchFleetStatus(currentProjectId).then(
				(response) => {
					if (!cancelled) {
						setFleetStatus(response);
					}
				},
				() => {
					if (!cancelled) {
						setFleetStatus(null);
					}
				},
			);
		};
		loadRegistry();
		const intervalId = window.setInterval(loadRegistry, 15_000);
		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [currentProjectId, fleetStripExpanded]);

	// W3.4 mailbox badge: pending §5.AU note counts per card, polled on the fleet cadence (15s, board visible).
	const [mailboxCountByTaskId, setMailboxCountByTaskId] = useState<Record<string, number>>({});
	const boardTaskIds = useMemo(
		() => data.columns.flatMap((column) => (column.id === "trash" ? [] : column.cards.map((card) => card.id))),
		[data.columns],
	);
	const boardTaskIdsRef = useRef(boardTaskIds);
	boardTaskIdsRef.current = boardTaskIds;
	useEffect(() => {
		if (!currentProjectId) {
			setMailboxCountByTaskId({});
			return;
		}
		let cancelled = false;
		const loadCounts = () => {
			const taskIds = boardTaskIdsRef.current;
			if (taskIds.length === 0) {
				setMailboxCountByTaskId({});
				return;
			}
			void fetchCardMailboxCounts(currentProjectId, taskIds).then(
				(response) => {
					if (!cancelled) {
						setMailboxCountByTaskId(response.counts);
					}
				},
				() => {
					// Fail soft — a missing count just hides the badge.
				},
			);
		};
		loadCounts();
		const intervalId = window.setInterval(loadCounts, 15_000);
		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [currentProjectId]);

	const cardTitleByTaskId = useMemo(() => {
		const titles = new Map<string, string>();
		for (const column of data.columns) {
			for (const card of column.cards) {
				titles.set(card.id, card.title);
			}
		}
		return titles;
	}, [data.columns]);

	const fleetGroups = useMemo(
		() =>
			composeFleetRows({
				registryModels: fleetRegistryModels,
				runningSessions: Object.values(taskSessions),
				cardTitleByTaskId,
				...(fleetStatus ? { machineByModelId: fleetStatus.machineByModelId } : {}),
				...(fleetStatus ? { warmthByModelId: fleetStatus.warmthByModelId } : {}),
			}),
		[fleetRegistryModels, taskSessions, cardTitleByTaskId, fleetStatus],
	);

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
				if (!response?.promptBlock) {
					throw new Error("Evidence could not be created (the runtime returned no prompt block).");
				}
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

	const renderColumn = (column: (typeof data.columns)[number]) => (
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
			onManageDependencies={onManageDependencies}
			workspacePath={workspacePath}
			replayCardsEnabled={replayCardsEnabled}
			defaultNKleinModelId={defaultNKleinModelId}
			mailboxCountByTaskId={mailboxCountByTaskId}
			reasoningSnippetByTaskId={reasoningSnippetByTaskId}
			onCardClick={(card) => {
				if (!dragOccurredRef.current) {
					onCardSelect(card.id);
				}
			}}
		/>
	);
	// Trash sits stacked *below* Completed (smaller, ~1/5 height) rather than as its own full column (user request).
	const stackedColumnIds = new Set(["completed", "trash"]);
	const flowColumns = data.columns.filter((column) => !stackedColumnIds.has(column.id));
	const completedColumn = data.columns.find((column) => column.id === "completed");
	const trashColumn = data.columns.find((column) => column.id === "trash");

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
					{(["architect", "worker", "reviewer"] as const).map((role) => {
						const group = roleGroups[role];
						if (group.count === 0) {
							return null;
						}
						const label = role === "architect" ? "Architect" : role === "worker" ? "Worker" : "Reviewer";
						return (
							<button
								key={role}
								type="button"
								onClick={() => {
									if (group.firstTaskId) {
										onCardSelect(group.firstTaskId);
									}
								}}
								className="rounded-md border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-accent hover:bg-accent/20"
								title={`Focus a running ${label} agent`}
							>
								{label} {group.count}
							</button>
						);
					})}
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
					{mergeSummary ? (
						<span
							className={cn(
								"cursor-help rounded-md border px-1.5 py-0.5",
								mergeSummary.conflictCount > 0
									? "border-status-red/40 bg-status-red/10 text-status-red"
									: "border-status-green/40 bg-status-green/10 text-status-green",
							)}
							title={formatMergeHistoryTooltip(mergeHistory)}
						>
							{mergeSummary.conflictCount > 0
								? `Merge conflicts ${mergeSummary.conflictCount}`
								: `Merged ${mergeSummary.latest.mergedTaskIds.length}`}
						</span>
					) : null}
					<ElementTooltip id="board.code-intel" side="bottom">
						<span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-text-secondary">
							<Database size={12} />
							{formatCodeIntelligenceChip(codeIntelligenceStatus)}
						</span>
					</ElementTooltip>
					<BoardHealthSummary
						board={data}
						taskSessions={taskSessions}
						resolveOverrides={resolveBoardHealthOverrides}
					/>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<ElementTooltip id="board.fleet-strip" side="bottom">
						<button
							type="button"
							onClick={handleToggleFleetStrip}
							aria-expanded={fleetStripExpanded}
							className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-xs text-text-tertiary hover:text-text-secondary"
						>
							<span aria-hidden>{fleetStripExpanded ? "▾" : "▸"}</span>
							fleet
						</button>
					</ElementTooltip>
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
					<ElementTooltip id="board.dependency-edges" side="bottom">
						<Button
							variant={dependencyEdgesVisible ? "default" : "ghost"}
							size="sm"
							icon={<Waypoints size={14} />}
							onClick={handleToggleDependencyEdges}
						>
							Deps
						</Button>
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
			{fleetStripExpanded ? (
				<div className="shrink-0 border-b border-border bg-surface-1">
					<FleetStrip groups={fleetGroups} />
				</div>
			) : null}
			{currentProjectId && data.columns.every((column) => column.id === "trash" || column.cards.length === 0) ? (
				<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-1 px-4 py-3 text-sm">
					<div className="flex min-w-0 items-center gap-2 text-text-secondary">
						<Sparkles size={16} className="shrink-0 text-accent" />
						<span>This board is empty — create your first task to start the local swarm on it.</span>
					</div>
					<div className="flex items-center gap-3">
						{runtimeConfig?.agentSandboxStatus?.state === "blocked" ? (
							<span
								className="inline-flex items-center gap-1 text-status-red"
								title={
									runtimeConfig.agentSandboxStatus.message ??
									"Docker agent isolation is unavailable, so agent tasks cannot start (fail-closed)."
								}
							>
								<ShieldAlert size={14} />
								Isolation unavailable
							</span>
						) : null}
						<Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onCreateTask}>
							Create task
						</Button>
					</div>
				</div>
			) : null}
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
					{flowColumns.map((column) => renderColumn(column))}
					{completedColumn || trashColumn ? (
						<div className="flex min-w-0 min-h-0 flex-col gap-2" style={{ flex: "1 1 0" }}>
							{completedColumn ? (
								<div className="flex min-h-0 min-w-0 flex-col" style={{ flex: "4 1 0" }}>
									{renderColumn(completedColumn)}
								</div>
							) : null}
							{trashColumn ? (
								<div className="flex min-h-0 min-w-0 flex-col" style={{ flex: "1 1 0" }}>
									{renderColumn(trashColumn)}
								</div>
							) : null}
						</div>
					) : null}
					<DependencyOverlay
						containerRef={boardRef}
						dependencies={dependencyEdgesVisible || dependencyLinking.draft ? dependencies : []}
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
