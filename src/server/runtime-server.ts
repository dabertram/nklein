import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { join } from "node:path";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import {
	AgentSandboxManager,
	type AgentSandboxPoolConfig,
	resolveAgentSandboxImageName,
} from "../cline-sdk/cline-agent-sandbox";
import type { ClineDecompositionAppliedEvent } from "../cline-sdk/cline-decomposition-tool";
import { handleClineMcpOauthCallback } from "../cline-sdk/cline-mcp-runtime-service";
import {
	type ClineTaskSessionService,
	createInMemoryClineTaskSessionService,
} from "../cline-sdk/cline-task-session-service";
import { createClineWatcherRegistry } from "../cline-sdk/cline-watcher-registry";
import { loadRuntimeConfig, type RuntimeConfigState } from "../config/runtime-config";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeCommandRunResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { readPausedTasks } from "../core/card-pause";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeTls,
	isKanbanRemoteHost,
} from "../core/runtime-endpoint";
import { readSwarmStopSignal } from "../core/swarm-guardrails";
import { completeTaskAndGetReadyLinkedTaskIds, getTaskColumnId, moveTaskToColumn } from "../core/task-board-mutations";
import { findActiveTaskLikelyTouchedFileOverlap } from "../core/task-file-overlap";
import { LEGACY_WORKSPACE_ID_HEADER, WORKSPACE_ID_HEADER } from "../core/workspace-scope";
import {
	buildSessionCookieHeader,
	checkRateLimit,
	clearRateLimit,
	extractBearerToken,
	extractSessionTokenFromCookie,
	isPasscodeEnabled,
	issueSession,
	recordFailedAttempt,
	validateInternalToken,
	validatePasscode,
	validateSession,
} from "../security/passcode-manager";
import { loadWorkspaceContextById, loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { recordModelPerformanceObservation } from "../telemetry/model-performance-stats";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { createTerminalWebSocketBridge } from "../terminal/ws-server";
import { type RuntimeTrpcContext, type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "../trpc/app-router";
import { createHooksApi } from "../trpc/hooks-api";
import { createProjectsApi } from "../trpc/projects-api";
import { createRuntimeApi } from "../trpc/runtime-api";
import { createRuntimeTaskStartQueue, type RuntimeTaskStartQueue } from "../trpc/runtime-task-start-queue";
import { createWorkspaceApi } from "../trpc/workspace-api";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { mergeTaskWorktreesInDependencyOrder } from "../workspace/task-worktree-auto-merge";
import { getWebUiDir, normalizeRequestPath, readAsset } from "./assets";
import { handleHttpRequest, handleSocketUpgrade } from "./middleware";
import type { RuntimeStateHub } from "./runtime-state-hub";
import type { WorkspaceRegistry } from "./workspace-registry";

interface DisposeTrackedWorkspaceResult {
	terminalManager: TerminalSessionManager | null;
	workspacePath: string | null;
}

export interface CreateRuntimeServerDependencies {
	workspaceRegistry: WorkspaceRegistry;
	runtimeStateHub: RuntimeStateHub;
	warn: (message: string) => void;
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	resolveProjectInputPath: (inputPath: string, basePath: string) => string;
	assertPathIsDirectory: (targetPath: string) => Promise<void>;
	hasGitRepository: (path: string) => boolean;
	disposeWorkspace: (
		workspaceId: string,
		options?: {
			stopTerminalSessions?: boolean;
		},
	) => DisposeTrackedWorkspaceResult;
	collectProjectWorktreeTaskIdsForRemoval: (board: RuntimeWorkspaceStateResponse["board"]) => Set<string>;
	pickDirectoryPathFromSystemDialog: () => string | null;
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
}

export interface RuntimeServer {
	url: string;
	close: () => Promise<void>;
}

const WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

function readWorkspaceIdFromRequest(request: IncomingMessage, requestUrl: URL): string | null {
	for (const headerName of [WORKSPACE_ID_HEADER, LEGACY_WORKSPACE_ID_HEADER]) {
		const headerValue = request.headers[headerName];
		const headerWorkspaceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
		if (typeof headerWorkspaceId === "string") {
			const normalized = headerWorkspaceId.trim();
			if (normalized) {
				return normalized;
			}
		}
	}
	const queryWorkspaceId = requestUrl.searchParams.get("workspaceId");
	if (typeof queryWorkspaceId === "string") {
		const normalized = queryWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	return null;
}

function isWorkspaceStateLockError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Lock file is already being held");
}

async function retryWorkspaceStateLock<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt <= WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			const delayMs = WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS[attempt];
			if (!isWorkspaceStateLockError(error) || delayMs === undefined) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
	throw lastError;
}

function buildAgentSandboxPoolConfig(runtimeConfig: RuntimeConfigState): AgentSandboxPoolConfig {
	return {
		maxContainers: runtimeConfig.sandboxMaxContainers,
		agentsPerContainer: runtimeConfig.sandboxAgentsPerContainer,
		memoryPerContainerMb: runtimeConfig.sandboxMemoryPerContainerMb,
		cpusPerContainer: runtimeConfig.sandboxCpusPerContainer,
		idleTimeoutMs: runtimeConfig.sandboxIdleTimeoutMinutes * 60 * 1000,
	};
}

function createCheckingAgentSandboxStatus(): RuntimeAgentSandboxStatus {
	return {
		state: "checking",
		dockerAvailable: null,
		imageAvailable: null,
		image: resolveAgentSandboxImageName(),
		message: null,
		checkedAt: null,
	};
}

export async function createRuntimeServer(deps: CreateRuntimeServerDependencies): Promise<RuntimeServer> {
	const webUiDir = getWebUiDir();
	const startupAgentSandboxManager = new AgentSandboxManager();
	let agentSandboxStatus = createCheckingAgentSandboxStatus();
	const refreshAgentSandboxStatus = async (): Promise<RuntimeAgentSandboxStatus> => {
		agentSandboxStatus = createCheckingAgentSandboxStatus();
		agentSandboxStatus = await startupAgentSandboxManager.checkAvailability();
		return agentSandboxStatus;
	};
	void (async () => {
		await startupAgentSandboxManager.reapOrphanResources();
		await refreshAgentSandboxStatus();
	})().catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		agentSandboxStatus = {
			state: "blocked",
			dockerAvailable: false,
			imageAvailable: false,
			image: resolveAgentSandboxImageName(),
			message,
			checkedAt: Date.now(),
		};
	});

	try {
		await readFile(join(webUiDir, "index.html"));
	} catch {
		throw new Error("Could not find web UI assets. Run `npm run build` to generate and package the web UI.");
	}

	const resolveWorkspaceScopeFromRequest = async (
		request: IncomingMessage,
		requestUrl: URL,
	): Promise<{
		requestedWorkspaceId: string | null;
		workspaceScope: RuntimeTrpcWorkspaceScope | null;
	}> => {
		const requestedWorkspaceId = readWorkspaceIdFromRequest(request, requestUrl);
		if (!requestedWorkspaceId) {
			return {
				requestedWorkspaceId: null,
				workspaceScope: null,
			};
		}
		const requestedWorkspaceContext = await retryWorkspaceStateLock(async () =>
			loadWorkspaceContextById(requestedWorkspaceId, {
				resolutionSource: "explicit_id",
			}),
		);
		if (!requestedWorkspaceContext) {
			return {
				requestedWorkspaceId,
				workspaceScope: null,
			};
		}
		return {
			requestedWorkspaceId,
			workspaceScope: {
				workspaceId: requestedWorkspaceContext.workspaceId,
				workspacePath: requestedWorkspaceContext.repoPath,
			},
		};
	};

	const getScopedTerminalManager = async (scope: RuntimeTrpcWorkspaceScope): Promise<TerminalSessionManager> =>
		await deps.ensureTerminalManagerForWorkspace(scope.workspaceId, scope.workspacePath);
	const clineTaskSessionServiceByWorkspaceId = new Map<string, ClineTaskSessionService>();
	const queuedStartDrainUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const clineWatcherRegistry = createClineWatcherRegistry();
	const taskStartQueue = createRuntimeTaskStartQueue();
	const queuedStartDrainInFlightByWorkspaceId = new Set<string>();
	const autoReviewFinalizationInFlightTaskIds = new Set<string>();
	const queuedStartDrainTimersByWorkspaceId = new Map<
		string,
		{
			dueAt: number;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	let runtimeApi: RuntimeTrpcContext["runtimeApi"];
	const autoStartTaskIds = async (scope: RuntimeTrpcWorkspaceScope, taskIds: readonly string[]): Promise<void> => {
		for (const taskId of taskIds) {
			try {
				const state = await loadWorkspaceState(scope.workspacePath);
				const sourceColumnId = getTaskColumnId(state.board, taskId);
				if (sourceColumnId !== "backlog" && sourceColumnId !== "planning") {
					continue;
				}
				const task = state.board.columns
					.flatMap((column) => column.cards)
					.find((candidate) => candidate.id === taskId);
				if (!task) {
					continue;
				}
				const liveClineSessions =
					clineTaskSessionServiceByWorkspaceId.get(scope.workspaceId)?.listSummaries() ?? [];
				const sessions = {
					...state.sessions,
					...Object.fromEntries(liveClineSessions.map((summary) => [summary.taskId, summary])),
				};
				const overlappingTask = findActiveTaskLikelyTouchedFileOverlap({
					board: state.board,
					sessions,
					task,
				});
				if (overlappingTask) {
					deps.warn(
						`Skipped auto-start for linked task ${task.id} because it likely touches the same files as active task ${overlappingTask.id}.`,
					);
					continue;
				}
				const targetColumnId = task.startInPlanMode ? "planning" : "in_progress";
				const started = await runtimeApi.startTaskSession(scope, {
					taskId: task.id,
					prompt: task.prompt,
					taskTitle: task.title,
					images: task.images,
					filesLikelyTouched: task.filesLikelyTouched,
					startInPlanMode: task.startInPlanMode,
					baseRef: task.baseRef,
					agentId: task.agentId,
					clineSettings: task.clineSettings,
					queueOnEndpointBusy: true,
				});
				if (!started.ok && !started.queued) {
					deps.warn(
						`Could not auto-start linked task ${task.id} for ${scope.workspacePath}: ${
							started.error ?? "unknown error"
						}`,
					);
					continue;
				}
				if (started.queued) {
					continue;
				}
				await mutateWorkspaceState(scope.workspacePath, (latestState) => {
					const movement = moveTaskToColumn(latestState.board, task.id, targetColumnId);
					return {
						board: movement.board,
						save: movement.moved,
						value: null,
					};
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Could not auto-start linked task ${taskId} for ${scope.workspacePath}: ${message}`);
			}
		}
	};
	const autoStartDecompositionRootTasks = async (
		scope: RuntimeTrpcWorkspaceScope,
		event: ClineDecompositionAppliedEvent,
	): Promise<void> => {
		await autoStartTaskIds(scope, event.rootTaskIds);
	};
	const moveStartedQueuedTask = async (
		scope: RuntimeTrpcWorkspaceScope,
		input: { taskId: string; startInPlanMode?: boolean },
	): Promise<void> => {
		const targetColumnId = input.startInPlanMode ? "planning" : "in_progress";
		await mutateWorkspaceState(scope.workspacePath, (latestState) => {
			const movement = moveTaskToColumn(latestState.board, input.taskId, targetColumnId);
			return {
				board: movement.board,
				save: movement.moved,
				value: null,
			};
		});
	};
	const completeDecompositionSourceTask = (
		scope: RuntimeTrpcWorkspaceScope,
		event: ClineDecompositionAppliedEvent,
	): void => {
		const sourceTaskId = event.sourceTaskId?.trim();
		if (!sourceTaskId) {
			return;
		}
		setTimeout(() => {
			void (async () => {
				const service = clineTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
				await service?.completeTaskSessionAfterDecomposition(sourceTaskId);
				await mutateWorkspaceState(scope.workspacePath, (latestState) => {
					const movement = moveTaskToColumn(latestState.board, sourceTaskId, "completed");
					return {
						board: movement.board,
						save: movement.moved,
						value: null,
					};
				});
				drainQueuedTaskStarts(scope, { force: true });
			})().catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(
					`Could not complete decomposition source task ${sourceTaskId} for ${scope.workspacePath}: ${message}`,
				);
			});
		}, 250);
	};
	const isReviewableClineSummary = (summary: RuntimeTaskSessionSummary): boolean =>
		summary.state === "awaiting_review" &&
		(summary.reviewReason === "hook" ||
			summary.reviewReason === "exit" ||
			summary.reviewReason === "attention" ||
			summary.reviewReason === "error");
	const recordClineModelPerformance = (scope: RuntimeTrpcWorkspaceScope, summary: RuntimeTaskSessionSummary): void => {
		void (async () => {
			const [workspaceState, runtimeConfig] = await Promise.all([
				loadWorkspaceState(scope.workspacePath).catch(() => null),
				loadRuntimeConfig(scope.workspacePath).catch(() => null),
			]);
			const cards = workspaceState?.board.columns.flatMap((column) => column.cards) ?? [];
			const card = cards.find((candidate) => candidate.id === summary.taskId) ?? null;
			await recordModelPerformanceObservation({
				workspaceId: scope.workspaceId,
				workspacePath: scope.workspacePath,
				card,
				runtimeConfig,
				summary,
			});
		})().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not record model performance for ${summary.taskId}: ${message}`);
		});
	};
	const finalizeHeadlessAutoReviewTask = (
		scope: RuntimeTrpcWorkspaceScope,
		service: ClineTaskSessionService,
		taskId: string,
	): void => {
		const inFlightKey = `${scope.workspaceId}:${taskId}`;
		if (autoReviewFinalizationInFlightTaskIds.has(inFlightKey)) {
			return;
		}
		autoReviewFinalizationInFlightTaskIds.add(inFlightKey);
		void (async () => {
			try {
				await retryWorkspaceStateLock(async () => {
					let shouldAutoComplete = false;
					await mutateWorkspaceState(scope.workspacePath, (latestState) => {
						const record = latestState.board.columns
							.flatMap((column) => column.cards.map((card) => ({ columnId: column.id, card })))
							.find((candidate) => candidate.card.id === taskId);
						if (!record) {
							return { board: latestState.board, save: false, value: null };
						}
						if (record.columnId === "completed") {
							return { board: latestState.board, save: false, value: null };
						}
						if (record.card.startInPlanMode) {
							return { board: latestState.board, save: false, value: null };
						}
						shouldAutoComplete =
							record.card.autoReviewEnabled === true && (record.card.autoReviewMode ?? "commit") === "commit";
						if (record.columnId === "review") {
							return { board: latestState.board, save: false, value: null };
						}
						const movement = moveTaskToColumn(latestState.board, taskId, "review");
						return {
							board: movement.board,
							save: movement.moved,
							value: null,
						};
					});
					if (!shouldAutoComplete) {
						return;
					}
					const reviewState = await loadWorkspaceState(scope.workspacePath);
					const mergeResult = await mergeTaskWorktreesInDependencyOrder({
						repoPath: scope.workspacePath,
						board: reviewState.board,
						columns: ["review"],
						taskIds: [taskId],
					});
					if (!mergeResult.ok) {
						const reason =
							mergeResult.blocked?.reason ??
							mergeResult.conflict?.message ??
							"unknown task result merge failure";
						deps.warn(`Could not auto-merge task result ${taskId} for ${scope.workspacePath}: ${reason}`);
						return;
					}
					let readyTaskIds: string[] = [];
					await mutateWorkspaceState(scope.workspacePath, (latestState) => {
						const completed = completeTaskAndGetReadyLinkedTaskIds(latestState.board, taskId);
						readyTaskIds = completed.readyTaskIds;
						return {
							board: completed.board,
							save: completed.moved,
							value: null,
						};
					});
					await service.stopTaskSession(taskId).catch(() => null);
					drainQueuedTaskStarts(scope, { force: true });
					await autoStartTaskIds(scope, readyTaskIds);
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Could not finalize auto-review task ${taskId} for ${scope.workspacePath}: ${message}`);
			} finally {
				autoReviewFinalizationInFlightTaskIds.delete(inFlightKey);
			}
		})();
	};
	const reconcileCapturedHeadlessAutoReviewTasks = (
		scope: RuntimeTrpcWorkspaceScope,
		service: ClineTaskSessionService,
	): void => {
		void (async () => {
			const state = await loadWorkspaceState(scope.workspacePath);
			const candidates = state.board.columns
				.filter((column) => column.id === "in_progress" || column.id === "review")
				.flatMap((column) => column.cards)
				.filter((card) => card.autoReviewEnabled === true && (card.autoReviewMode ?? "commit") === "commit");
			for (const card of candidates) {
				const resultCommit = await resolveTaskResultBranchCommit({
					repoPath: scope.workspacePath,
					taskId: card.id,
				});
				if (resultCommit) {
					finalizeHeadlessAutoReviewTask(scope, service, card.id);
				}
			}
		})().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not reconcile captured auto-review tasks for ${scope.workspacePath}: ${message}`);
		});
	};
	const drainQueuedTaskStarts = (scope: RuntimeTrpcWorkspaceScope, options?: { force?: boolean }): void => {
		const scheduledDrain = queuedStartDrainTimersByWorkspaceId.get(scope.workspaceId);
		if (scheduledDrain) {
			clearTimeout(scheduledDrain.timer);
			queuedStartDrainTimersByWorkspaceId.delete(scope.workspaceId);
		}
		if (queuedStartDrainInFlightByWorkspaceId.has(scope.workspaceId)) {
			return;
		}
		queuedStartDrainInFlightByWorkspaceId.add(scope.workspaceId);
		queueMicrotask(() => {
			void (async () => {
				try {
					const queuedStarts = taskStartQueue.takeReady(scope.workspaceId, { force: options?.force });
					for (const queuedStart of queuedStarts) {
						try {
							const started = await runtimeApi.startTaskSession(queuedStart.workspaceScope, queuedStart.input);
							if (started.ok) {
								await moveStartedQueuedTask(queuedStart.workspaceScope, queuedStart.input);
							}
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							deps.warn(
								`Queued task start failed for ${queuedStart.workspaceScope.workspacePath} task ${queuedStart.input.taskId}: ${message}`,
							);
						}
					}
				} finally {
					queuedStartDrainInFlightByWorkspaceId.delete(scope.workspaceId);
				}
			})();
		});
	};
	const scheduleQueuedTaskStartDrain = (scope: RuntimeTrpcWorkspaceScope, delayMs: number): void => {
		const delay = Math.max(0, Math.trunc(delayMs));
		const dueAt = Date.now() + delay;
		const existing = queuedStartDrainTimersByWorkspaceId.get(scope.workspaceId);
		if (existing && existing.dueAt <= dueAt) {
			return;
		}
		if (existing) {
			clearTimeout(existing.timer);
		}
		const timer = setTimeout(() => {
			queuedStartDrainTimersByWorkspaceId.delete(scope.workspaceId);
			drainQueuedTaskStarts(scope);
		}, delay);
		queuedStartDrainTimersByWorkspaceId.set(scope.workspaceId, { dueAt, timer });
	};
	const scheduledTaskStartQueue: RuntimeTaskStartQueue = {
		enqueue(input) {
			const queued = taskStartQueue.enqueue(input);
			scheduleQueuedTaskStartDrain(
				queued.workspaceScope,
				Math.max(0, queued.nextAttemptAt - (input.now ?? Date.now())),
			);
			return queued;
		},
		remove: (workspaceId, taskId) => taskStartQueue.remove(workspaceId, taskId),
		takeReady: (workspaceId, options) => taskStartQueue.takeReady(workspaceId, options),
		clearWorkspace: (workspaceId) => taskStartQueue.clearWorkspace(workspaceId),
		size: (workspaceId) => taskStartQueue.size(workspaceId),
	};
	const getScopedClineTaskSessionService = async (
		scope: RuntimeTrpcWorkspaceScope,
	): Promise<ClineTaskSessionService> => {
		const runtimeConfig = await loadRuntimeConfig(scope.workspacePath);
		const sandboxPoolConfig = buildAgentSandboxPoolConfig(runtimeConfig);
		let service = clineTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
		if (!service) {
			service = createInMemoryClineTaskSessionService({
				watcherRegistry: clineWatcherRegistry,
				agentSandboxManager: new AgentSandboxManager({ poolConfig: sandboxPoolConfig }),
				onDecompositionApplied: async (event) => {
					if (event.workspacePath !== scope.workspacePath) {
						return;
					}
					await autoStartDecompositionRootTasks(scope, event);
					completeDecompositionSourceTask(scope, event);
				},
			});
			service.setBoardPaused((await readSwarmStopSignal(scope.workspacePath)) !== null);
			for (const taskId of await readPausedTasks(scope.workspacePath)) {
				service.setCardPaused(taskId, true);
			}
			const trackedService = service;
			clineTaskSessionServiceByWorkspaceId.set(scope.workspaceId, service);
			deps.runtimeStateHub.trackClineTaskSessionService(scope.workspaceId, scope.workspacePath, service);
			const unsubscribeQueueDrain = service.onSummary((summary) => {
				recordClineModelPerformance(scope, summary);
				if (isReviewableClineSummary(summary)) {
					finalizeHeadlessAutoReviewTask(scope, trackedService, summary.taskId);
				}
				if (summary.state !== "queued" && summary.state !== "running") {
					drainQueuedTaskStarts(scope, { force: true });
				}
			});
			queuedStartDrainUnsubscribeByWorkspaceId.set(scope.workspaceId, unsubscribeQueueDrain);
			reconcileCapturedHeadlessAutoReviewTasks(scope, trackedService);
		} else {
			await service.updateAgentSandboxPoolConfig(sandboxPoolConfig);
		}
		return service;
	};
	const disposeClineTaskSessionServiceAsync = async (workspaceId: string): Promise<void> => {
		const service = clineTaskSessionServiceByWorkspaceId.get(workspaceId);
		if (!service) {
			return;
		}
		clineTaskSessionServiceByWorkspaceId.delete(workspaceId);
		queuedStartDrainUnsubscribeByWorkspaceId.get(workspaceId)?.();
		queuedStartDrainUnsubscribeByWorkspaceId.delete(workspaceId);
		const drainTimer = queuedStartDrainTimersByWorkspaceId.get(workspaceId);
		if (drainTimer) {
			clearTimeout(drainTimer.timer);
			queuedStartDrainTimersByWorkspaceId.delete(workspaceId);
		}
		taskStartQueue.clearWorkspace(workspaceId);
		await service.dispose();
	};
	const disposeClineTaskSessionService = (workspaceId: string): void => {
		void disposeClineTaskSessionServiceAsync(workspaceId);
	};
	const prepareForStateReset = async (): Promise<void> => {
		const workspaceIds = new Set<string>();
		for (const { workspaceId } of deps.workspaceRegistry.listManagedWorkspaces()) {
			workspaceIds.add(workspaceId);
		}
		for (const workspaceId of clineTaskSessionServiceByWorkspaceId.keys()) {
			workspaceIds.add(workspaceId);
		}
		const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
		if (activeWorkspaceId) {
			workspaceIds.add(activeWorkspaceId);
		}
		for (const workspaceId of workspaceIds) {
			await disposeClineTaskSessionServiceAsync(workspaceId);
			deps.disposeWorkspace(workspaceId, {
				stopTerminalSessions: true,
			});
		}
		deps.workspaceRegistry.clearActiveWorkspace();
	};

	runtimeApi = createRuntimeApi({
		getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
		getActiveRuntimeConfig: deps.workspaceRegistry.getActiveRuntimeConfig,
		loadScopedRuntimeConfig: deps.workspaceRegistry.loadScopedRuntimeConfig,
		setActiveRuntimeConfig: deps.workspaceRegistry.setActiveRuntimeConfig,
		getScopedTerminalManager,
		getScopedClineTaskSessionService,
		getLoadedScopedClineTaskSessionService: (workspaceScope) =>
			clineTaskSessionServiceByWorkspaceId.get(workspaceScope.workspaceId) ?? null,
		resolveInteractiveShellCommand: deps.resolveInteractiveShellCommand,
		runCommand: deps.runCommand,
		broadcastClineMcpAuthStatusesUpdated: deps.runtimeStateHub.broadcastClineMcpAuthStatusesUpdated,
		broadcastTaskChatCleared: deps.runtimeStateHub.broadcastTaskChatCleared,
		bumpClineSessionContextVersion: deps.runtimeStateHub.bumpClineSessionContextVersion,
		prepareForStateReset,
		taskStartQueue: scheduledTaskStartQueue,
		getUpdateStatus: deps.getUpdateStatus,
		runUpdateNow: deps.runUpdateNow,
		getAgentSandboxStatus: () => agentSandboxStatus,
		refreshAgentSandboxStatus,
	});

	const createTrpcContext = async (req: IncomingMessage): Promise<RuntimeTrpcContext> => {
		const requestUrl = new URL(req.url ?? "/", "http://localhost");
		const scope = await resolveWorkspaceScopeFromRequest(req, requestUrl);
		return {
			requestedWorkspaceId: scope.requestedWorkspaceId,
			workspaceScope: scope.workspaceScope,
			runtimeApi,
			workspaceApi: createWorkspaceApi({
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				getScopedClineTaskSessionService,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastRuntimeProjectsUpdated: deps.runtimeStateHub.broadcastRuntimeProjectsUpdated,
				buildWorkspaceStateSnapshot: deps.workspaceRegistry.buildWorkspaceStateSnapshot,
			}),
			projectsApi: createProjectsApi({
				getActiveWorkspacePath: deps.workspaceRegistry.getActiveWorkspacePath,
				getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
				rememberWorkspace: deps.workspaceRegistry.rememberWorkspace,
				setActiveWorkspace: deps.workspaceRegistry.setActiveWorkspace,
				clearActiveWorkspace: deps.workspaceRegistry.clearActiveWorkspace,
				resolveProjectInputPath: deps.resolveProjectInputPath,
				assertPathIsDirectory: deps.assertPathIsDirectory,
				hasGitRepository: deps.hasGitRepository,
				summarizeProjectTaskCounts: deps.workspaceRegistry.summarizeProjectTaskCounts,
				createProjectSummary: deps.workspaceRegistry.createProjectSummary,
				broadcastRuntimeProjectsUpdated: deps.runtimeStateHub.broadcastRuntimeProjectsUpdated,
				getTerminalManagerForWorkspace: deps.workspaceRegistry.getTerminalManagerForWorkspace,
				disposeWorkspace: (workspaceId, options) => {
					disposeClineTaskSessionService(workspaceId);
					return deps.disposeWorkspace(workspaceId, options);
				},
				collectProjectWorktreeTaskIdsForRemoval: deps.collectProjectWorktreeTaskIdsForRemoval,
				warn: deps.warn,
				buildProjectsPayload: deps.workspaceRegistry.buildProjectsPayload,
				pickDirectoryPathFromSystemDialog: deps.pickDirectoryPathFromSystemDialog,
				serverCwd: process.cwd(),
			}),
			hooksApi: createHooksApi({
				getWorkspacePathById: deps.workspaceRegistry.getWorkspacePathById,
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastTaskReadyForReview: deps.runtimeStateHub.broadcastTaskReadyForReview,
			}),
		};
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => await createTrpcContext(req),
	});

	const isRemoteMode = isKanbanRemoteHost();

	const readRequestBody = (req: IncomingMessage, maxBytes = 4096): Promise<string> =>
		new Promise((resolve, reject) => {
			let body = "";
			let size = 0;
			req.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > maxBytes) {
					reject(new Error("Request body too large"));
					return;
				}
				body += chunk.toString("utf8");
			});
			req.on("end", () => resolve(body));
			req.on("error", reject);
		});

	const getRemoteIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? "unknown";

	const tlsConfig = getKanbanRuntimeTls();
	const requestHandler = async (req: IncomingMessage, res: import("node:http").ServerResponse) => {
		try {
			if (handleHttpRequest(req, res).end) {
				return;
			}

			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);

			// ── Passcode gate (remote mode only) ──────────────────────────────
			const passcodeActive = isRemoteMode && isPasscodeEnabled();
			if (pathname === "/api/passcode/status") {
				if (passcodeActive) {
					const token = extractSessionTokenFromCookie(req.headers.cookie);
					const authenticated = token !== null && validateSession(token);
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ required: true, authenticated }));
				} else {
					res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ required: false, authenticated: true }));
				}
				return;
			}
			if (passcodeActive && req.method === "POST" && pathname === "/api/passcode/verify") {
				const ip = getRemoteIp(req);
				const rateLimit = checkRateLimit(ip);
				if (!rateLimit.allowed) {
					const retryAfterSec = rateLimit.lockedUntilMs
						? Math.ceil((rateLimit.lockedUntilMs - Date.now()) / 1000)
						: 30;
					res.writeHead(429, {
						"Content-Type": "application/json; charset=utf-8",
						"Cache-Control": "no-store",
						"Retry-After": String(retryAfterSec),
					});
					res.end(JSON.stringify({ error: "Too many attempts. Please wait before trying again." }));
					return;
				}
				let body: string;
				try {
					body = await readRequestBody(req);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Invalid request body." }));
					return;
				}
				let parsed: unknown;
				try {
					parsed = JSON.parse(body);
				} catch {
					res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ error: "Invalid JSON." }));
					return;
				}
				const submitted =
					parsed !== null &&
					typeof parsed === "object" &&
					"passcode" in parsed &&
					typeof (parsed as Record<string, unknown>).passcode === "string"
						? ((parsed as Record<string, unknown>).passcode as string)
						: "";
				if (!validatePasscode(submitted)) {
					recordFailedAttempt(ip);
					res.writeHead(401, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end(JSON.stringify({ error: "Invalid passcode." }));
					return;
				}
				clearRateLimit(ip);
				const token = issueSession();
				res.writeHead(200, {
					"Content-Type": "application/json; charset=utf-8",
					"Cache-Control": "no-store",
					"Set-Cookie": buildSessionCookieHeader(token, { secure: tlsConfig !== null }),
				});
				res.end(JSON.stringify({ ok: true }));
				return;
			}
			if (passcodeActive) {
				// Check session cookie (browser flow) first, then internal bearer token (CLI flow).
				const sessionToken = extractSessionTokenFromCookie(req.headers.cookie);
				const sessionAuth = sessionToken !== null && validateSession(sessionToken);
				const bearerToken = extractBearerToken(req.headers.authorization);
				const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
				const authenticated = sessionAuth || internalAuth;
				if (!authenticated) {
					// Static assets (JS, CSS, images, fonts, icons, manifest) are served
					// freely even when unauthenticated. They contain no user data and are
					// required for the React app to boot and render the passcode gate.
					// Only API routes are hard-blocked; index.html is served normally so
					// PasscodeGateProvider in React can intercept before any API calls.
					if (pathname.startsWith("/api/")) {
						res.writeHead(401, {
							"Content-Type": "application/json; charset=utf-8",
							"Cache-Control": "no-store",
						});
						res.end(JSON.stringify({ error: "Authentication required." }));
						return;
					}
					// Fall through — let the normal asset/index.html serving below handle it.
					// PasscodeGateProvider in main.tsx will render the gate before any
					// authenticated API calls are made.
				}
			}
			// ── End passcode gate ──────────────────────────────────────────────

			const oauthCallbackResponse = await handleClineMcpOauthCallback(requestUrl);
			if (oauthCallbackResponse) {
				res.writeHead(oauthCallbackResponse.statusCode, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(oauthCallbackResponse.body);
				return;
			}
			if (pathname.startsWith("/api/trpc")) {
				await trpcHttpHandler(req, res);
				return;
			}
			if (pathname.startsWith("/api/")) {
				res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
				res.end('{"error":"Not found"}');
				return;
			}

			const asset = await readAsset(webUiDir, pathname);
			res.writeHead(200, {
				"Content-Type": asset.contentType,
				"Cache-Control": "no-store",
			});
			res.end(asset.content);
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Not Found");
		}
	};
	const server = tlsConfig
		? createHttpsServer({ key: tlsConfig.key, cert: tlsConfig.cert }, requestHandler)
		: createServer(requestHandler);
	server.on("upgrade", (request, socket, head) => {
		if (handleSocketUpgrade(request, socket).end) {
			return;
		}

		let requestUrl: URL;
		try {
			requestUrl = new URL(request.url ?? "/", getKanbanRuntimeOrigin());
		} catch {
			socket.destroy();
			return;
		}
		if (normalizeRequestPath(requestUrl.pathname) !== "/api/runtime/ws") {
			return;
		}
		// ── Passcode gate for WebSocket upgrades (remote mode only) ──────────
		const passcodeActive = isRemoteMode && isPasscodeEnabled();
		if (passcodeActive) {
			const sessionToken = extractSessionTokenFromCookie(request.headers.cookie);
			const sessionAuth = sessionToken !== null && validateSession(sessionToken);
			const bearerToken = extractBearerToken(request.headers.authorization);
			const internalAuth = bearerToken !== null && validateInternalToken(bearerToken);
			if (!sessionAuth && !internalAuth) {
				socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				socket.destroy();
				return;
			}
		}
		// ── End passcode gate ─────────────────────────────────────────────────
		(request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled = true;
		const requestedWorkspaceId = requestUrl.searchParams.get("workspaceId")?.trim() || null;
		deps.runtimeStateHub.handleUpgrade(request, socket, head, { requestedWorkspaceId });
	});
	const terminalWebSocketBridge = createTerminalWebSocketBridge({
		server,
		resolveTerminalManager: (workspaceId) => deps.workspaceRegistry.getTerminalManagerForWorkspace(workspaceId),
		isTerminalIoWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/io",
		isTerminalControlWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/control",
		validateUpgradeSession:
			isRemoteMode && isPasscodeEnabled()
				? (cookieHeader) => {
						const token = extractSessionTokenFromCookie(cookieHeader);
						return token !== null && validateSession(token);
					}
				: undefined,
	});
	server.on("upgrade", (request, socket) => {
		const handled = (request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled;
		if (handled) {
			return;
		}
		socket.destroy();
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(getKanbanRuntimePort(), getKanbanRuntimeHost(), () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to start local server.");
	}
	const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
	const url = activeWorkspaceId
		? buildKanbanRuntimeUrl(`/${encodeURIComponent(activeWorkspaceId)}`)
		: getKanbanRuntimeOrigin();

	return {
		url,
		close: async () => {
			for (const drainTimer of queuedStartDrainTimersByWorkspaceId.values()) {
				clearTimeout(drainTimer.timer);
			}
			queuedStartDrainTimersByWorkspaceId.clear();
			for (const unsubscribe of queuedStartDrainUnsubscribeByWorkspaceId.values()) {
				unsubscribe();
			}
			queuedStartDrainUnsubscribeByWorkspaceId.clear();
			await Promise.all(
				Array.from(clineTaskSessionServiceByWorkspaceId.values()).map(async (service) => {
					await service.dispose();
				}),
			);
			clineTaskSessionServiceByWorkspaceId.clear();
			await clineWatcherRegistry.close();
			await deps.runtimeStateHub.close();
			await terminalWebSocketBridge.close();
			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => {
					if (error) {
						rejectClose(error);
						return;
					}
					resolveClose();
				});
			});
		},
	};
}
