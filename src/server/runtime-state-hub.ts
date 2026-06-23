// Streams live runtime state to browser clients over websocket.
// It listens to terminal and native NKlein updates, normalizes them into the
// shared API contract, and fans out workspace-scoped snapshots and deltas.
import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type {
	RuntimeNKleinMcpServerAuthStatus,
	RuntimeNKleinTeamProgressEvent,
	RuntimeStateStreamErrorMessage,
	RuntimeStateStreamMcpAuthUpdatedMessage,
	RuntimeStateStreamMessage,
	RuntimeStateStreamNKleinSessionContextUpdatedMessage,
	RuntimeStateStreamNKleinTeamProgressMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskChatClearedMessage,
	RuntimeStateStreamTaskChatMessage,
	RuntimeStateStreamTaskReadyForReviewMessage,
	RuntimeStateStreamTaskSessionsMessage,
	RuntimeStateStreamWorkspaceMetadataMessage,
	RuntimeStateStreamWorkspaceStateMessage,
	RuntimeTaskSessionSummary,
} from "../core/api-contract";
import { runNKleinAcceptanceAutoRepair } from "../nklein-sdk/nklein-acceptance-auto-repair";
import type { NKleinTaskMessage, NKleinTaskSessionService } from "../nklein-sdk/nklein-task-session-service";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { createWorkspaceMetadataMonitor } from "./workspace-metadata-monitor";
import type { ResolvedWorkspaceStreamTarget, WorkspaceRegistry } from "./workspace-registry";

const TASK_SESSION_STREAM_BATCH_MS = 150;

export interface DisposeRuntimeStateWorkspaceOptions {
	disconnectClients?: boolean;
	closeClientErrorMessage?: string;
}

export interface CreateRuntimeStateHubDependencies {
	workspaceRegistry: Pick<
		WorkspaceRegistry,
		"resolveWorkspaceForStream" | "buildProjectsPayload" | "buildWorkspaceStateSnapshot"
	>;
}

export interface RuntimeStateHub {
	trackTerminalManager: (workspaceId: string, manager: TerminalSessionManager) => void;
	trackNKleinTaskSessionService: (
		workspaceId: string,
		workspacePath: string,
		service: NKleinTaskSessionService,
	) => void;
	broadcastTaskChatMessage: (workspaceId: string, taskId: string, message: NKleinTaskMessage) => void;
	broadcastTaskChatCleared: (workspaceId: string, taskId: string) => void;
	handleUpgrade: (
		request: IncomingMessage,
		socket: Parameters<WebSocketServer["handleUpgrade"]>[1],
		head: Buffer,
		context: {
			requestedWorkspaceId: string | null;
		},
	) => void;
	disposeWorkspace: (workspaceId: string, options?: DisposeRuntimeStateWorkspaceOptions) => void;
	broadcastRuntimeWorkspaceStateUpdated: (workspaceId: string, workspacePath: string) => Promise<void>;
	broadcastRuntimeProjectsUpdated: (preferredCurrentProjectId: string | null) => Promise<void>;
	broadcastNKleinMcpAuthStatusesUpdated: (statuses: RuntimeNKleinMcpServerAuthStatus[]) => void;
	bumpNKleinSessionContextVersion: () => void;
	broadcastTaskReadyForReview: (workspaceId: string, taskId: string) => void;
	close: () => Promise<void>;
}

export function createRuntimeStateHub(deps: CreateRuntimeStateHubDependencies): RuntimeStateHub {
	const terminalSummaryUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const nkleinSummaryUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const nkleinMessageUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const nkleinTeamProgressUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const nkleinPreviousSummaryByWorkspaceId = new Map<string, Map<string, RuntimeTaskSessionSummary>>();
	const pendingTaskSessionSummariesByWorkspaceId = new Map<string, Map<string, RuntimeTaskSessionSummary>>();
	const taskSessionBroadcastTimersByWorkspaceId = new Map<string, NodeJS.Timeout>();
	const acceptanceRepairAttemptStoreByWorkspaceId = new Map<string, Map<string, number>>();
	const runtimeStateClientsByWorkspaceId = new Map<string, Set<WebSocket>>();
	const runtimeStateClients = new Set<WebSocket>();
	const runtimeStateWorkspaceIdByClient = new Map<WebSocket, string>();
	let nkleinSessionContextVersion = 0;
	const runtimeStateWebSocketServer = new WebSocketServer({ noServer: true });
	const workspaceMetadataMonitor = createWorkspaceMetadataMonitor({
		onMetadataUpdated: (workspaceId, workspaceMetadata) => {
			const clients = runtimeStateClientsByWorkspaceId.get(workspaceId);
			if (!clients || clients.size === 0) {
				return;
			}
			const payload: RuntimeStateStreamWorkspaceMetadataMessage = {
				type: "workspace_metadata_updated",
				workspaceId,
				workspaceMetadata,
			};
			for (const client of clients) {
				sendRuntimeStateMessage(client, payload);
			}
		},
	});

	const sendRuntimeStateMessage = (client: WebSocket, payload: RuntimeStateStreamMessage) => {
		if (client.readyState !== WebSocket.OPEN) {
			return;
		}
		try {
			client.send(JSON.stringify(payload));
		} catch {
			// Ignore websocket write errors; close handlers clean up disconnected sockets.
		}
	};

	const broadcastRuntimeProjectsUpdated = async (preferredCurrentProjectId: string | null): Promise<void> => {
		if (runtimeStateClients.size === 0) {
			return;
		}
		try {
			const payload = await deps.workspaceRegistry.buildProjectsPayload(preferredCurrentProjectId);
			for (const client of runtimeStateClients) {
				sendRuntimeStateMessage(client, {
					type: "projects_updated",
					currentProjectId: payload.currentProjectId,
					projects: payload.projects,
				} satisfies RuntimeStateStreamProjectsMessage);
			}
		} catch {
			// Ignore transient project summary failures; next update will resync.
		}
	};

	const broadcastNKleinMcpAuthStatusesUpdated = (statuses: RuntimeNKleinMcpServerAuthStatus[]) => {
		if (runtimeStateClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamMcpAuthUpdatedMessage = {
			type: "mcp_auth_updated",
			statuses,
		};
		for (const client of runtimeStateClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const bumpNKleinSessionContextVersion = () => {
		nkleinSessionContextVersion += 1;
		if (runtimeStateClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamNKleinSessionContextUpdatedMessage = {
			type: "nklein_session_context_updated",
			version: nkleinSessionContextVersion,
		};
		for (const client of runtimeStateClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const flushTaskSessionSummaries = (workspaceId: string) => {
		const pending = pendingTaskSessionSummariesByWorkspaceId.get(workspaceId);
		if (!pending || pending.size === 0) {
			return;
		}
		pendingTaskSessionSummariesByWorkspaceId.delete(workspaceId);
		const summaries = Array.from(pending.values());
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (runtimeClients && runtimeClients.size > 0) {
			const payload: RuntimeStateStreamTaskSessionsMessage = {
				type: "task_sessions_updated",
				workspaceId,
				summaries,
			};
			for (const client of runtimeClients) {
				sendRuntimeStateMessage(client, payload);
			}
		}
		void broadcastRuntimeProjectsUpdated(workspaceId);
	};

	const queueTaskSessionSummaryBroadcast = (workspaceId: string, summary: RuntimeTaskSessionSummary) => {
		const pending =
			pendingTaskSessionSummariesByWorkspaceId.get(workspaceId) ?? new Map<string, RuntimeTaskSessionSummary>();
		pending.set(summary.taskId, summary);
		pendingTaskSessionSummariesByWorkspaceId.set(workspaceId, pending);
		if (taskSessionBroadcastTimersByWorkspaceId.has(workspaceId)) {
			return;
		}
		const timer = setTimeout(() => {
			taskSessionBroadcastTimersByWorkspaceId.delete(workspaceId);
			flushTaskSessionSummaries(workspaceId);
		}, TASK_SESSION_STREAM_BATCH_MS);
		timer.unref();
		taskSessionBroadcastTimersByWorkspaceId.set(workspaceId, timer);
	};

	const broadcastTaskChatMessage = (workspaceId: string, taskId: string, message: NKleinTaskMessage) => {
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamTaskChatMessage = {
			type: "task_chat_message",
			workspaceId,
			taskId,
			message,
		};
		for (const client of runtimeClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const broadcastTaskChatCleared = (workspaceId: string, taskId: string) => {
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamTaskChatClearedMessage = {
			type: "task_chat_cleared",
			workspaceId,
			taskId,
		};
		for (const client of runtimeClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const broadcastNKleinTeamProgress = (workspaceId: string, taskId: string, event: RuntimeNKleinTeamProgressEvent) => {
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamNKleinTeamProgressMessage = {
			type: "nklein_team_progress",
			workspaceId,
			taskId,
			event,
		};
		for (const client of runtimeClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const disposeTaskSessionSummaryBroadcast = (workspaceId: string) => {
		const timer = taskSessionBroadcastTimersByWorkspaceId.get(workspaceId);
		if (timer) {
			clearTimeout(timer);
		}
		taskSessionBroadcastTimersByWorkspaceId.delete(workspaceId);
		pendingTaskSessionSummariesByWorkspaceId.delete(workspaceId);
	};

	const cleanupRuntimeStateClient = (client: WebSocket) => {
		const workspaceId = runtimeStateWorkspaceIdByClient.get(client);
		if (workspaceId) {
			workspaceMetadataMonitor.disconnectWorkspace(workspaceId);
			const clients = runtimeStateClientsByWorkspaceId.get(workspaceId);
			if (clients) {
				clients.delete(client);
				if (clients.size === 0) {
					runtimeStateClientsByWorkspaceId.delete(workspaceId);
				}
			}
		}
		runtimeStateWorkspaceIdByClient.delete(client);
		runtimeStateClients.delete(client);
	};

	const disposeWorkspace = (workspaceId: string, options?: DisposeRuntimeStateWorkspaceOptions) => {
		const unsubscribeSummary = terminalSummaryUnsubscribeByWorkspaceId.get(workspaceId);
		if (unsubscribeSummary) {
			try {
				unsubscribeSummary();
			} catch {
				// Ignore listener cleanup errors during project removal.
			}
		}
		terminalSummaryUnsubscribeByWorkspaceId.delete(workspaceId);
		const unsubscribeNKleinSummary = nkleinSummaryUnsubscribeByWorkspaceId.get(workspaceId);
		if (unsubscribeNKleinSummary) {
			try {
				unsubscribeNKleinSummary();
			} catch {
				// Ignore listener cleanup errors during project removal.
			}
		}
		nkleinSummaryUnsubscribeByWorkspaceId.delete(workspaceId);
		nkleinPreviousSummaryByWorkspaceId.delete(workspaceId);
		acceptanceRepairAttemptStoreByWorkspaceId.delete(workspaceId);
		const unsubscribeNKleinMessage = nkleinMessageUnsubscribeByWorkspaceId.get(workspaceId);
		if (unsubscribeNKleinMessage) {
			try {
				unsubscribeNKleinMessage();
			} catch {
				// Ignore listener cleanup errors during project removal.
			}
		}
		nkleinMessageUnsubscribeByWorkspaceId.delete(workspaceId);
		const unsubscribeNKleinTeamProgress = nkleinTeamProgressUnsubscribeByWorkspaceId.get(workspaceId);
		if (unsubscribeNKleinTeamProgress) {
			try {
				unsubscribeNKleinTeamProgress();
			} catch {
				// Ignore listener cleanup errors during project removal.
			}
		}
		nkleinTeamProgressUnsubscribeByWorkspaceId.delete(workspaceId);
		disposeTaskSessionSummaryBroadcast(workspaceId);
		workspaceMetadataMonitor.disposeWorkspace(workspaceId);

		if (!options?.disconnectClients) {
			return;
		}

		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			runtimeStateClientsByWorkspaceId.delete(workspaceId);
			return;
		}

		for (const runtimeClient of runtimeClients) {
			if (options.closeClientErrorMessage) {
				sendRuntimeStateMessage(runtimeClient, {
					type: "error",
					message: options.closeClientErrorMessage,
				} satisfies RuntimeStateStreamErrorMessage);
			}
			try {
				runtimeClient.close();
			} catch {
				// Ignore close failures while disposing removed workspace clients.
			}
			cleanupRuntimeStateClient(runtimeClient);
		}
		runtimeStateClientsByWorkspaceId.delete(workspaceId);
	};

	const broadcastRuntimeWorkspaceStateUpdated = async (workspaceId: string, workspacePath: string): Promise<void> => {
		const clients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!clients || clients.size === 0) {
			return;
		}
		try {
			const workspaceState = await deps.workspaceRegistry.buildWorkspaceStateSnapshot(workspaceId, workspacePath);
			const payload: RuntimeStateStreamWorkspaceStateMessage = {
				type: "workspace_state_updated",
				workspaceId,
				workspaceState,
			};
			for (const client of clients) {
				sendRuntimeStateMessage(client, payload);
			}
			await workspaceMetadataMonitor.updateWorkspaceState({
				workspaceId,
				workspacePath,
			});
		} catch {
			// Ignore transient state read failures; next update will resync.
		}
	};

	const broadcastTaskReadyForReview = (workspaceId: string, taskId: string) => {
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamTaskReadyForReviewMessage = {
			type: "task_ready_for_review",
			workspaceId,
			taskId,
			triggeredAt: Date.now(),
		};
		for (const client of runtimeClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const getAcceptanceRepairAttemptStore = (workspaceId: string) => {
		let attempts = acceptanceRepairAttemptStoreByWorkspaceId.get(workspaceId);
		if (!attempts) {
			attempts = new Map<string, number>();
			acceptanceRepairAttemptStoreByWorkspaceId.set(workspaceId, attempts);
		}
		return {
			get: (taskId: string) => attempts.get(taskId),
			set: (taskId: string, attempt: number) => {
				attempts.set(taskId, attempt);
			},
			delete: (taskId: string) => {
				attempts.delete(taskId);
			},
		};
	};

	const verifyNKleinTaskBeforeReady = (
		workspaceId: string,
		workspacePath: string,
		service: NKleinTaskSessionService,
		summary: RuntimeTaskSessionSummary,
	) => {
		void runNKleinAcceptanceAutoRepair({
			workspacePath,
			taskId: summary.taskId,
			summary,
			service,
			attemptStore: getAcceptanceRepairAttemptStore(workspaceId),
		})
			.then((outcome) => {
				if (outcome.type !== "repair_sent") {
					broadcastTaskReadyForReview(workspaceId, summary.taskId);
				}
			})
			.catch(() => {
				broadcastTaskReadyForReview(workspaceId, summary.taskId);
			});
	};

	const isReviewableNKleinSummary = (summary: RuntimeTaskSessionSummary): boolean =>
		summary.state === "awaiting_review" &&
		(summary.reviewReason === "hook" ||
			summary.reviewReason === "exit" ||
			summary.reviewReason === "attention" ||
			summary.reviewReason === "error");

	runtimeStateWebSocketServer.on("connection", async (client: WebSocket, context: unknown) => {
		client.on("close", () => {
			cleanupRuntimeStateClient(client);
		});
		try {
			const requestedWorkspaceId =
				typeof context === "object" &&
				context !== null &&
				"requestedWorkspaceId" in context &&
				typeof (context as { requestedWorkspaceId?: unknown }).requestedWorkspaceId === "string"
					? (context as { requestedWorkspaceId: string }).requestedWorkspaceId || null
					: null;
			const workspace: ResolvedWorkspaceStreamTarget = await deps.workspaceRegistry.resolveWorkspaceForStream(
				requestedWorkspaceId,
				{
					onRemovedWorkspace: ({ workspaceId, message }) => {
						disposeWorkspace(workspaceId, {
							disconnectClients: true,
							closeClientErrorMessage: message,
						});
					},
				},
			);
			if (client.readyState !== WebSocket.OPEN) {
				cleanupRuntimeStateClient(client);
				return;
			}

			/*
				Connection setup for workspace-scoped runtime streams is intentionally split into two phases.

				We need the initial snapshot to already contain the first workspace metadata payload, but we do not want
				the client to receive a separate "workspace_metadata_updated" event before that snapshot arrives.

				That race can happen if we register the websocket in runtimeStateClientsByWorkspaceId first and then call
				workspaceMetadataMonitor.connectWorkspace(...). connectWorkspace() performs an immediate refresh, and that
				refresh may broadcast "workspace_metadata_updated" to every currently registered workspace client. In that
				old ordering, a newly connected client could observe:

				1. workspace_metadata_updated
				2. snapshot

				which makes the initial load look wrong and forces the UI to process the same logical data twice in the
				opposite order from what readers expect.

				To avoid that, we:

				1. add the socket only to the global runtimeStateClients set so project-wide broadcasts still work
				2. build workspace state and connect the metadata monitor to get the initial metadata snapshot
				3. send the combined "snapshot" message
				4. only then register the socket in runtimeStateClientsByWorkspaceId so future incremental
				   workspace_metadata_updated events can flow normally

				The extra readyState checks and monitor cleanup below are paired with this delayed registration. If the
				socket closes while we are still assembling or sending the initial snapshot, we must disconnect the
				temporary metadata monitor subscription before returning, otherwise we would leave behind subscriber count
				state for a client that never finished the handshake.
			*/
			runtimeStateClients.add(client);
			let monitorWorkspaceId: string | null = null;
			let didConnectWorkspaceMonitor = false;

			try {
				let projectsPayload: {
					currentProjectId: string | null;
					projects: RuntimeStateStreamProjectsMessage["projects"];
				};
				let workspaceState: RuntimeStateStreamSnapshotMessage["workspaceState"];
				let workspaceMetadata: RuntimeStateStreamSnapshotMessage["workspaceMetadata"];
				if (workspace.workspaceId && workspace.workspacePath) {
					monitorWorkspaceId = workspace.workspaceId;
					[projectsPayload, workspaceState] = await Promise.all([
						deps.workspaceRegistry.buildProjectsPayload(workspace.workspaceId),
						deps.workspaceRegistry.buildWorkspaceStateSnapshot(workspace.workspaceId, workspace.workspacePath),
					]);
					workspaceMetadata = await workspaceMetadataMonitor.connectWorkspace({
						workspaceId: workspace.workspaceId,
						workspacePath: workspace.workspacePath,
					});
					didConnectWorkspaceMonitor = true;
				} else {
					projectsPayload = await deps.workspaceRegistry.buildProjectsPayload(null);
					workspaceState = null;
					workspaceMetadata = null;
				}
				if (client.readyState !== WebSocket.OPEN) {
					if (monitorWorkspaceId) {
						workspaceMetadataMonitor.disconnectWorkspace(monitorWorkspaceId);
					}
					cleanupRuntimeStateClient(client);
					return;
				}
				sendRuntimeStateMessage(client, {
					type: "snapshot",
					currentProjectId: projectsPayload.currentProjectId,
					projects: projectsPayload.projects,
					workspaceState,
					workspaceMetadata,
					nkleinSessionContextVersion,
				} satisfies RuntimeStateStreamSnapshotMessage);
				if (client.readyState !== WebSocket.OPEN) {
					if (monitorWorkspaceId) {
						workspaceMetadataMonitor.disconnectWorkspace(monitorWorkspaceId);
					}
					cleanupRuntimeStateClient(client);
					return;
				}
				if (monitorWorkspaceId) {
					const workspaceClients =
						runtimeStateClientsByWorkspaceId.get(monitorWorkspaceId) ?? new Set<WebSocket>();
					workspaceClients.add(client);
					runtimeStateClientsByWorkspaceId.set(monitorWorkspaceId, workspaceClients);
					runtimeStateWorkspaceIdByClient.set(client, monitorWorkspaceId);
					const nkleinSummaries = Array.from(
						nkleinPreviousSummaryByWorkspaceId.get(monitorWorkspaceId)?.values() ?? [],
					);
					if (nkleinSummaries.length > 0) {
						sendRuntimeStateMessage(client, {
							type: "task_sessions_updated",
							workspaceId: monitorWorkspaceId,
							summaries: nkleinSummaries,
						} satisfies RuntimeStateStreamTaskSessionsMessage);
					}
				}
				if (workspace.removedRequestedWorkspacePath) {
					sendRuntimeStateMessage(client, {
						type: "error",
						message: `Project no longer exists on disk and was removed: ${workspace.removedRequestedWorkspacePath}`,
					} satisfies RuntimeStateStreamErrorMessage);
				}
				if (workspace.didPruneProjects) {
					void broadcastRuntimeProjectsUpdated(workspace.workspaceId);
				}
			} catch (error) {
				if (didConnectWorkspaceMonitor && monitorWorkspaceId) {
					workspaceMetadataMonitor.disconnectWorkspace(monitorWorkspaceId);
				}
				const message = error instanceof Error ? error.message : String(error);
				sendRuntimeStateMessage(client, {
					type: "error",
					message,
				} satisfies RuntimeStateStreamErrorMessage);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			sendRuntimeStateMessage(client, {
				type: "error",
				message,
			} satisfies RuntimeStateStreamErrorMessage);
			client.close();
		}
	});

	return {
		trackTerminalManager: (workspaceId: string, manager: TerminalSessionManager) => {
			if (terminalSummaryUnsubscribeByWorkspaceId.has(workspaceId)) {
				return;
			}
			const unsubscribe = manager.onSummary((summary) => {
				queueTaskSessionSummaryBroadcast(workspaceId, summary);
			});
			terminalSummaryUnsubscribeByWorkspaceId.set(workspaceId, unsubscribe);
		},
		trackNKleinTaskSessionService: (
			workspaceId: string,
			workspacePath: string,
			service: NKleinTaskSessionService,
		) => {
			if (nkleinSummaryUnsubscribeByWorkspaceId.has(workspaceId)) {
				return;
			}
			const previousSummariesByTaskId = new Map<string, RuntimeTaskSessionSummary>();
			nkleinPreviousSummaryByWorkspaceId.set(workspaceId, previousSummariesByTaskId);
			for (const summary of service.listSummaries()) {
				previousSummariesByTaskId.set(summary.taskId, summary);
				queueTaskSessionSummaryBroadcast(workspaceId, summary);
				if (isReviewableNKleinSummary(summary)) {
					verifyNKleinTaskBeforeReady(workspaceId, workspacePath, service, summary);
				}
			}
			const unsubscribe = service.onSummary((summary) => {
				const previousSummary = previousSummariesByTaskId.get(summary.taskId);
				previousSummariesByTaskId.set(summary.taskId, summary);
				queueTaskSessionSummaryBroadcast(workspaceId, summary);
				const didCheckpointChange =
					previousSummary?.latestTurnCheckpoint?.commit !== summary.latestTurnCheckpoint?.commit ||
					previousSummary?.previousTurnCheckpoint?.commit !== summary.previousTurnCheckpoint?.commit;
				if (didCheckpointChange) {
					void broadcastRuntimeWorkspaceStateUpdated(workspaceId, workspacePath);
				}
				if (previousSummary && previousSummary.state !== "awaiting_review" && isReviewableNKleinSummary(summary)) {
					verifyNKleinTaskBeforeReady(workspaceId, workspacePath, service, summary);
				}
			});
			nkleinSummaryUnsubscribeByWorkspaceId.set(workspaceId, unsubscribe);
			const unsubscribeMessage = service.onMessage((taskId, message) => {
				broadcastTaskChatMessage(workspaceId, taskId, message);
			});
			nkleinMessageUnsubscribeByWorkspaceId.set(workspaceId, unsubscribeMessage);
			const unsubscribeTeamProgress = service.onTeamProgress((taskId, event) => {
				broadcastNKleinTeamProgress(workspaceId, taskId, event);
			});
			nkleinTeamProgressUnsubscribeByWorkspaceId.set(workspaceId, unsubscribeTeamProgress);
		},
		broadcastTaskChatMessage,
		broadcastTaskChatCleared,
		handleUpgrade: (request, socket, head, context) => {
			runtimeStateWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
				runtimeStateWebSocketServer.emit("connection", ws, context);
			});
		},
		disposeWorkspace,
		broadcastRuntimeWorkspaceStateUpdated,
		broadcastRuntimeProjectsUpdated,
		broadcastNKleinMcpAuthStatusesUpdated,
		bumpNKleinSessionContextVersion,
		broadcastTaskReadyForReview,
		close: async () => {
			for (const timer of taskSessionBroadcastTimersByWorkspaceId.values()) {
				clearTimeout(timer);
			}
			taskSessionBroadcastTimersByWorkspaceId.clear();
			pendingTaskSessionSummariesByWorkspaceId.clear();
			for (const unsubscribe of terminalSummaryUnsubscribeByWorkspaceId.values()) {
				try {
					unsubscribe();
				} catch {
					// Ignore listener cleanup errors during shutdown.
				}
			}
			terminalSummaryUnsubscribeByWorkspaceId.clear();
			for (const unsubscribe of nkleinSummaryUnsubscribeByWorkspaceId.values()) {
				try {
					unsubscribe();
				} catch {
					// Ignore listener cleanup errors during shutdown.
				}
			}
			nkleinSummaryUnsubscribeByWorkspaceId.clear();
			nkleinPreviousSummaryByWorkspaceId.clear();
			for (const unsubscribe of nkleinTeamProgressUnsubscribeByWorkspaceId.values()) {
				try {
					unsubscribe();
				} catch {
					// Ignore listener cleanup errors during shutdown.
				}
			}
			nkleinTeamProgressUnsubscribeByWorkspaceId.clear();
			acceptanceRepairAttemptStoreByWorkspaceId.clear();
			for (const unsubscribe of nkleinMessageUnsubscribeByWorkspaceId.values()) {
				try {
					unsubscribe();
				} catch {
					// Ignore listener cleanup errors during shutdown.
				}
			}
			nkleinMessageUnsubscribeByWorkspaceId.clear();
			workspaceMetadataMonitor.close();
			for (const client of runtimeStateClients) {
				try {
					client.terminate();
				} catch {
					// Ignore websocket termination errors during shutdown.
				}
			}
			runtimeStateClients.clear();
			runtimeStateClientsByWorkspaceId.clear();
			runtimeStateWorkspaceIdByClient.clear();
			await new Promise<void>((resolveCloseWebSockets) => {
				runtimeStateWebSocketServer.close(() => {
					resolveCloseWebSockets();
				});
			});
		},
	};
}
