import { useEffect, useReducer, useRef } from "react";

import type {
	RuntimeNKleinMcpServerAuthStatus,
	RuntimeNKleinTeamProgressEvent,
	RuntimeProjectSummary,
	RuntimeStateStreamMcpAuthUpdatedMessage,
	RuntimeStateStreamMessage,
	RuntimeStateStreamNKleinSessionContextUpdatedMessage,
	RuntimeStateStreamNKleinTeamProgressMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskChatClearedMessage,
	RuntimeStateStreamTaskChatMessage,
	RuntimeStateStreamTaskReadyForReviewMessage,
	RuntimeTaskChatMessage,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceMetadata,
	RuntimeWorkspaceStateResponse,
} from "@/runtime/types";

const STREAM_RECONNECT_BASE_DELAY_MS = 500;
const STREAM_RECONNECT_MAX_DELAY_MS = 5_000;
const MAX_TEAM_PROGRESS_EVENTS_PER_TASK = 30;
/**
 * High-frequency WS frames (a running agent emits hundreds of `task_chat_message` frames/sec; multiple parallel
 * sessions compound it) are COALESCED into one batched reducer dispatch every ~this-many ms, so the React tree
 * re-renders at most ~10×/sec instead of once per frame. No data is dropped — every queued action is still folded in
 * order; only the render storm is throttled. (Found via the §5.AI dev-test rail: 14.7k frames on one project made the
 * UI sluggish with 2 parallel sessions.)
 */
const STREAM_BATCH_FLUSH_MS = 100;

function mergeTaskSessionSummaries(
	currentSessions: Record<string, RuntimeTaskSessionSummary>,
	summaries: RuntimeTaskSessionSummary[],
): Record<string, RuntimeTaskSessionSummary> {
	if (summaries.length === 0) {
		return currentSessions;
	}
	const nextSessions = { ...currentSessions };
	for (const summary of summaries) {
		const existing = nextSessions[summary.taskId];
		if (!existing || existing.updatedAt <= summary.updatedAt) {
			nextSessions[summary.taskId] = summary;
		}
	}
	return nextSessions;
}

function getRuntimeStreamUrl(workspaceId: string | null): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/api/runtime/ws`);
	if (workspaceId) {
		url.searchParams.set("workspaceId", workspaceId);
	}
	return url.toString();
}

export interface UseRuntimeStateStreamResult {
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
	workspaceState: RuntimeWorkspaceStateResponse | null;
	workspaceMetadata: RuntimeWorkspaceMetadata | null;
	latestTaskChatMessage: RuntimeStateStreamTaskChatMessage | null;
	taskChatMessagesByTaskId: Record<string, RuntimeTaskChatMessage[]>;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
	latestNKleinTeamProgress: RuntimeStateStreamNKleinTeamProgressMessage | null;
	nkleinTeamProgressByTaskId: Record<string, RuntimeNKleinTeamProgressEvent[]>;
	latestMcpAuthStatuses: RuntimeNKleinMcpServerAuthStatus[] | null;
	nkleinSessionContextVersion: number;
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
}

interface RuntimeStateStreamStore {
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
	workspaceState: RuntimeWorkspaceStateResponse | null;
	workspaceMetadata: RuntimeWorkspaceMetadata | null;
	latestTaskChatMessage: RuntimeStateStreamTaskChatMessage | null;
	taskChatMessagesByTaskId: Record<string, RuntimeTaskChatMessage[]>;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
	latestNKleinTeamProgress: RuntimeStateStreamNKleinTeamProgressMessage | null;
	nkleinTeamProgressByTaskId: Record<string, RuntimeNKleinTeamProgressEvent[]>;
	latestMcpAuthStatuses: RuntimeNKleinMcpServerAuthStatus[] | null;
	nkleinSessionContextVersion: number;
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
}

type RuntimeStateStreamAction =
	| { type: "requested_workspace_changed" }
	| { type: "stream_connected" }
	| { type: "snapshot"; payload: RuntimeStateStreamSnapshotMessage }
	| {
			type: "projects_updated";
			payload: RuntimeStateStreamProjectsMessage;
			nextProjectId: string | null;
	  }
	| { type: "task_chat_message"; payload: RuntimeStateStreamTaskChatMessage }
	| { type: "task_chat_cleared"; payload: RuntimeStateStreamTaskChatClearedMessage }
	| { type: "nklein_team_progress"; payload: RuntimeStateStreamNKleinTeamProgressMessage }
	| { type: "workspace_metadata_updated"; workspaceMetadata: RuntimeWorkspaceMetadata }
	| { type: "task_ready_for_review"; payload: RuntimeStateStreamTaskReadyForReviewMessage }
	| { type: "mcp_auth_updated"; payload: RuntimeStateStreamMcpAuthUpdatedMessage }
	| { type: "nklein_session_context_updated"; payload: RuntimeStateStreamNKleinSessionContextUpdatedMessage }
	| { type: "workspace_state_updated"; workspaceState: RuntimeWorkspaceStateResponse }
	| { type: "task_sessions_updated"; summaries: RuntimeTaskSessionSummary[] }
	| { type: "stream_error"; message: string }
	| { type: "stream_disconnected"; message: string }
	| { type: "batch"; actions: RuntimeStateStreamAction[] };

export function createInitialRuntimeStateStreamStore(requestedWorkspaceId: string | null): RuntimeStateStreamStore {
	return {
		currentProjectId: requestedWorkspaceId,
		projects: [],
		workspaceState: null,
		workspaceMetadata: null,
		latestTaskChatMessage: null,
		taskChatMessagesByTaskId: {},
		latestTaskReadyForReview: null,
		latestNKleinTeamProgress: null,
		nkleinTeamProgressByTaskId: {},
		latestMcpAuthStatuses: null,
		nkleinSessionContextVersion: 0,
		streamError: null,
		isRuntimeDisconnected: false,
		hasReceivedSnapshot: false,
	};
}

function upsertTaskChatMessage(
	currentMessages: RuntimeTaskChatMessage[],
	nextMessage: RuntimeTaskChatMessage,
): RuntimeTaskChatMessage[] {
	const existingIndex = currentMessages.findIndex((message) => message.id === nextMessage.id);
	if (existingIndex < 0) {
		return [...currentMessages, nextMessage];
	}
	const existingMessage = currentMessages[existingIndex];
	if (
		existingMessage &&
		existingMessage.content === nextMessage.content &&
		existingMessage.role === nextMessage.role &&
		existingMessage.createdAt === nextMessage.createdAt &&
		JSON.stringify(existingMessage.meta ?? null) === JSON.stringify(nextMessage.meta ?? null)
	) {
		return currentMessages;
	}
	const nextMessages = [...currentMessages];
	nextMessages[existingIndex] = nextMessage;
	return nextMessages;
}

function resolveProjectIdAfterProjectsUpdate(
	currentProjectId: string | null,
	payload: RuntimeStateStreamProjectsMessage,
): string | null {
	if (currentProjectId && payload.projects.some((project) => project.id === currentProjectId)) {
		return currentProjectId;
	}
	return payload.currentProjectId;
}

export function runtimeStateStreamReducer(
	state: RuntimeStateStreamStore,
	action: RuntimeStateStreamAction,
): RuntimeStateStreamStore {
	if (action.type === "batch") {
		// Fold every coalesced action into ONE state transition (one re-render for the whole batch). Order-preserving.
		return action.actions.reduce(runtimeStateStreamReducer, state);
	}
	if (action.type === "requested_workspace_changed") {
		return {
			...state,
			workspaceState: null,
			workspaceMetadata: null,
			latestTaskChatMessage: null,
			taskChatMessagesByTaskId: {},
			latestNKleinTeamProgress: null,
			nkleinTeamProgressByTaskId: {},
			streamError: null,
			isRuntimeDisconnected: false,
			hasReceivedSnapshot: false,
			latestMcpAuthStatuses: state.latestMcpAuthStatuses,
			nkleinSessionContextVersion: state.nkleinSessionContextVersion,
		};
	}
	if (action.type === "stream_connected") {
		return {
			...state,
			streamError: null,
			isRuntimeDisconnected: false,
		};
	}
	if (action.type === "snapshot") {
		const nextWorkspaceState = action.payload.workspaceState
			? {
					...action.payload.workspaceState,
					sessions: mergeTaskSessionSummaries(
						state.workspaceState?.sessions ?? {},
						Object.values(action.payload.workspaceState.sessions ?? {}),
					),
				}
			: null;
		return {
			currentProjectId: action.payload.currentProjectId,
			projects: action.payload.projects,
			workspaceState: nextWorkspaceState,
			workspaceMetadata: action.payload.workspaceMetadata,
			latestTaskChatMessage: null,
			taskChatMessagesByTaskId: {},
			latestTaskReadyForReview: state.latestTaskReadyForReview,
			latestNKleinTeamProgress: null,
			nkleinTeamProgressByTaskId: {},
			latestMcpAuthStatuses: state.latestMcpAuthStatuses,
			nkleinSessionContextVersion: action.payload.nkleinSessionContextVersion,
			streamError: null,
			isRuntimeDisconnected: false,
			hasReceivedSnapshot: true,
		};
	}
	if (action.type === "projects_updated") {
		const didProjectChange = action.nextProjectId !== state.currentProjectId;
		return {
			...state,
			currentProjectId: action.nextProjectId,
			projects: action.payload.projects,
			workspaceState: didProjectChange ? null : state.workspaceState,
			workspaceMetadata: didProjectChange ? null : state.workspaceMetadata,
			latestTaskChatMessage: didProjectChange ? null : state.latestTaskChatMessage,
			taskChatMessagesByTaskId: didProjectChange ? {} : state.taskChatMessagesByTaskId,
			latestTaskReadyForReview: didProjectChange ? null : state.latestTaskReadyForReview,
			latestNKleinTeamProgress: didProjectChange ? null : state.latestNKleinTeamProgress,
			nkleinTeamProgressByTaskId: didProjectChange ? {} : state.nkleinTeamProgressByTaskId,
			hasReceivedSnapshot: true,
		};
	}
	if (action.type === "task_chat_message") {
		const currentTaskMessages = state.taskChatMessagesByTaskId[action.payload.taskId] ?? [];
		return {
			...state,
			latestTaskChatMessage: action.payload,
			taskChatMessagesByTaskId: {
				...state.taskChatMessagesByTaskId,
				[action.payload.taskId]: upsertTaskChatMessage(currentTaskMessages, action.payload.message),
			},
		};
	}
	if (action.type === "nklein_team_progress") {
		const currentEvents = state.nkleinTeamProgressByTaskId[action.payload.taskId] ?? [];
		const nextEvents = [...currentEvents, action.payload.event].slice(-MAX_TEAM_PROGRESS_EVENTS_PER_TASK);
		return {
			...state,
			latestNKleinTeamProgress: action.payload,
			nkleinTeamProgressByTaskId: {
				...state.nkleinTeamProgressByTaskId,
				[action.payload.taskId]: nextEvents,
			},
		};
	}
	if (action.type === "task_chat_cleared") {
		return {
			...state,
			latestTaskChatMessage: null,
			taskChatMessagesByTaskId: {
				...state.taskChatMessagesByTaskId,
				[action.payload.taskId]: [],
			},
			nkleinTeamProgressByTaskId: {
				...state.nkleinTeamProgressByTaskId,
				[action.payload.taskId]: [],
			},
		};
	}
	if (action.type === "workspace_metadata_updated") {
		return {
			...state,
			workspaceMetadata: action.workspaceMetadata,
		};
	}
	if (action.type === "task_ready_for_review") {
		return {
			...state,
			latestTaskReadyForReview: action.payload,
		};
	}
	if (action.type === "mcp_auth_updated") {
		return {
			...state,
			latestMcpAuthStatuses: action.payload.statuses,
		};
	}
	if (action.type === "nklein_session_context_updated") {
		return {
			...state,
			nkleinSessionContextVersion: action.payload.version,
		};
	}
	if (action.type === "workspace_state_updated") {
		const mergedWorkspaceState = {
			...action.workspaceState,
			sessions: mergeTaskSessionSummaries(
				state.workspaceState?.sessions ?? {},
				Object.values(action.workspaceState.sessions ?? {}),
			),
		};
		return {
			...state,
			workspaceState: mergedWorkspaceState,
		};
	}
	if (action.type === "task_sessions_updated") {
		if (!state.workspaceState) {
			return state;
		}
		return {
			...state,
			workspaceState: {
				...state.workspaceState,
				sessions: mergeTaskSessionSummaries(state.workspaceState.sessions, action.summaries),
			},
		};
	}
	if (action.type === "stream_error") {
		return {
			...state,
			streamError: action.message,
			isRuntimeDisconnected: false,
		};
	}
	if (action.type === "stream_disconnected") {
		return {
			...state,
			streamError: action.message,
			isRuntimeDisconnected: true,
		};
	}
	return state;
}

export function useRuntimeStateStream(requestedWorkspaceId: string | null): UseRuntimeStateStreamResult {
	const [state, dispatch] = useReducer(
		runtimeStateStreamReducer,
		requestedWorkspaceId,
		createInitialRuntimeStateStreamStore,
	);
	// Coalesce high-frequency WS frames into batched dispatches (see STREAM_BATCH_FLUSH_MS) so the tree re-renders
	// ~10×/sec instead of once per frame. Refs survive effect re-runs; the effect owns the queue + flush timer.
	const pendingActionsRef = useRef<RuntimeStateStreamAction[]>([]);
	const flushTimerRef = useRef<number | null>(null);
	useEffect(() => {
		let cancelled = false;
		let socket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		let reconnectAttempt = 0;
		let activeWorkspaceId = requestedWorkspaceId;
		let requestedWorkspaceForConnection = requestedWorkspaceId;

		const flushPending = () => {
			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
				flushTimerRef.current = null;
			}
			if (pendingActionsRef.current.length === 0) {
				return;
			}
			const actions = pendingActionsRef.current;
			pendingActionsRef.current = [];
			dispatch({ type: "batch", actions });
		};
		const enqueueDispatch = (action: RuntimeStateStreamAction) => {
			pendingActionsRef.current.push(action);
			if (flushTimerRef.current === null) {
				flushTimerRef.current = window.setTimeout(flushPending, STREAM_BATCH_FLUSH_MS);
			}
		};

		// The workspace-change reset stays immediate (snappy project switching, no 100ms batch delay).
		dispatch({ type: "requested_workspace_changed" });

		const cleanupSocket = () => {
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
				socket = null;
			}
		};

		const scheduleReconnect = () => {
			if (cancelled) {
				return;
			}
			if (reconnectTimer !== null) {
				return;
			}
			const delay = Math.min(STREAM_RECONNECT_MAX_DELAY_MS, STREAM_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt);
			reconnectAttempt += 1;
			reconnectTimer = window.setTimeout(() => {
				connect();
			}, delay);
		};

		const connect = () => {
			if (cancelled) {
				return;
			}
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			cleanupSocket();
			try {
				socket = new WebSocket(getRuntimeStreamUrl(requestedWorkspaceForConnection));
			} catch (error) {
				enqueueDispatch({
					type: "stream_disconnected",
					message: error instanceof Error ? error.message : String(error),
				});
				scheduleReconnect();
				return;
			}
			socket.onopen = () => {
				reconnectAttempt = 0;
				enqueueDispatch({ type: "stream_connected" });
			};
			socket.onmessage = (event) => {
				try {
					const payload = JSON.parse(String(event.data)) as RuntimeStateStreamMessage;
					if (payload.type === "snapshot") {
						activeWorkspaceId = payload.currentProjectId;
						enqueueDispatch({ type: "snapshot", payload });
						return;
					}
					if (payload.type === "projects_updated") {
						const previousWorkspaceId = activeWorkspaceId;
						const nextProjectId = resolveProjectIdAfterProjectsUpdate(activeWorkspaceId, payload);
						activeWorkspaceId = nextProjectId;
						enqueueDispatch({
							type: "projects_updated",
							payload,
							nextProjectId,
						});
						if (nextProjectId && nextProjectId !== previousWorkspaceId) {
							requestedWorkspaceForConnection = nextProjectId;
							enqueueDispatch({ type: "requested_workspace_changed" });
							connect();
						}
						return;
					}
					if (payload.type === "workspace_state_updated") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						enqueueDispatch({
							type: "workspace_state_updated",
							workspaceState: payload.workspaceState,
						});
						return;
					}
					if (payload.type === "workspace_metadata_updated") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						enqueueDispatch({
							type: "workspace_metadata_updated",
							workspaceMetadata: payload.workspaceMetadata,
						});
						return;
					}
					if (payload.type === "task_chat_message") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						enqueueDispatch({
							type: "task_chat_message",
							payload,
						});
						return;
					}
					if (payload.type === "task_chat_cleared") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						enqueueDispatch({
							type: "task_chat_cleared",
							payload,
						});
						return;
					}
					if (payload.type === "nklein_team_progress") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						enqueueDispatch({
							type: "nklein_team_progress",
							payload,
						});
						return;
					}
					if (payload.type === "task_sessions_updated") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						enqueueDispatch({
							type: "task_sessions_updated",
							summaries: payload.summaries,
						});
						return;
					}
					if (payload.type === "task_ready_for_review") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						enqueueDispatch({
							type: "task_ready_for_review",
							payload,
						});
						return;
					}
					if (payload.type === "mcp_auth_updated") {
						enqueueDispatch({
							type: "mcp_auth_updated",
							payload,
						});
						return;
					}
					if (payload.type === "nklein_session_context_updated") {
						enqueueDispatch({
							type: "nklein_session_context_updated",
							payload,
						});
						return;
					}
					if (payload.type === "error") {
						enqueueDispatch({
							type: "stream_error",
							message: payload.message,
						});
					}
				} catch {
					// Ignore malformed stream messages.
				}
			};
			socket.onclose = () => {
				if (cancelled) {
					return;
				}
				enqueueDispatch({
					type: "stream_disconnected",
					message: "Runtime stream disconnected.",
				});
				scheduleReconnect();
			};
			socket.onerror = () => {
				if (cancelled) {
					return;
				}
				enqueueDispatch({
					type: "stream_disconnected",
					message: "Runtime stream connection failed.",
				});
			};
		};

		connect();

		return () => {
			cancelled = true;
			if (reconnectTimer != null) {
				window.clearTimeout(reconnectTimer);
			}
			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
				flushTimerRef.current = null;
			}
			// Drop any queued frames for the old socket/workspace — they're stale for the next connection.
			pendingActionsRef.current = [];
			cleanupSocket();
		};
	}, [requestedWorkspaceId]);

	return {
		currentProjectId: state.currentProjectId,
		projects: state.projects,
		workspaceState: state.workspaceState,
		workspaceMetadata: state.workspaceMetadata,
		latestTaskChatMessage: state.latestTaskChatMessage,
		taskChatMessagesByTaskId: state.taskChatMessagesByTaskId,
		latestTaskReadyForReview: state.latestTaskReadyForReview,
		latestNKleinTeamProgress: state.latestNKleinTeamProgress,
		nkleinTeamProgressByTaskId: state.nkleinTeamProgressByTaskId,
		latestMcpAuthStatuses: state.latestMcpAuthStatuses,
		nkleinSessionContextVersion: state.nkleinSessionContextVersion,
		streamError: state.streamError,
		isRuntimeDisconnected: state.isRuntimeDisconnected,
		hasReceivedSnapshot: state.hasReceivedSnapshot,
	};
}
