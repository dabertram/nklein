import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../config/runtime-config";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import {
	capabilitiesForTier,
	DEFAULT_AGENT_CAPABILITY_TIER,
	deliveryPolicyForTier,
	resolveEffectiveDeliveryTier,
} from "../core/agent-rulesets";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeCommandRunResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { readPausedTasks } from "../core/card-pause";
import { decideDeliveryAction } from "../core/delivery-decision";
import { deriveDeliveryGateEvidence, shouldHoldEmptyPatchResult } from "../core/delivery-evidence";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeTls,
	isKanbanRemoteHost,
} from "../core/runtime-endpoint";
import { readSwarmStopSignal } from "../core/swarm-guardrails";
import {
	completeTaskAndGetReadyLinkedTaskIds,
	getTaskColumnId,
	moveTaskToColumn,
	STARTED_CARD_ENTRY_LANE,
} from "../core/task-board-mutations";
import { findActiveTaskLikelyTouchedFileOverlap, getSharedLikelyTouchedPaths } from "../core/task-file-overlap";
import { isReviewableNKleinSummary } from "../core/task-session-guards";
import { AgentSandboxManager, resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox";
import { configureNKleinAiSdkWarnings } from "../nklein-agent/nklein-ai-sdk-warnings";
import type { NKleinDecompositionAppliedEvent } from "../nklein-agent/nklein-decomposition-tool";
import { handleNKleinMcpOauthCallback } from "../nklein-agent/nklein-mcp-runtime-service";
import {
	createInMemoryNKleinTaskSessionService,
	type NKleinTaskSessionService,
} from "../nklein-agent/nklein-task-session-service";
import { isTrustedAutoMergeProtectedPath } from "../nklein-agent/nklein-trusted-auto-merge";
import { createNKleinWatcherRegistry } from "../nklein-agent/nklein-watcher-registry";
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
import { APP_CONTENT_SECURITY_POLICY, buildTlsHardeningHeaders } from "../security/remote-security-policy";
import { recordMergeHistory } from "../state/merge-history-store";
import {
	isWorkspaceStateLockError,
	loadWorkspaceContextById,
	loadWorkspaceState,
	mutateWorkspaceState,
} from "../state/workspace-state";
import { recordKnowledgeToolUsageObservation } from "../telemetry/knowledge-tool-usage-stats";
import { recordModelPerformanceObservation } from "../telemetry/model-performance-stats";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { createTerminalWebSocketBridge } from "../terminal/ws-server";
import { type RuntimeTrpcContext, type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "../trpc/app-router";
import { createProjectsApi } from "../trpc/projects-api";
import { createRuntimeApi } from "../trpc/runtime-api";
import {
	createRuntimeTaskStartQueue,
	type RuntimeTaskStartQueue,
	replayPersistedQueuedTaskStarts,
} from "../trpc/runtime-task-start-queue";
import { loadQueuedTaskStartsFromDisk, saveQueuedTaskStartsToDisk } from "../trpc/runtime-task-start-queue-store";
import { createWorkspaceApi } from "../trpc/workspace-api";
import { getWorkspaceChangesBetweenRefs } from "../workspace/get-workspace-changes";
import { resolveRemoteBrowseRoots } from "../workspace/remote-path-confinement";
import { createTaskResultBranchRef, resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { mergeTaskWorktreesInDependencyOrder } from "../workspace/task-worktree-auto-merge";
import { buildAgentSandboxPoolConfig, createCheckingAgentSandboxStatus } from "./agent-sandbox-runtime-config";
import { getWebUiDir, normalizeRequestPath, readAsset } from "./assets";
import { handleHttpRequest, handleSocketUpgrade } from "./middleware";
import type { RuntimeStateHub } from "./runtime-state-hub";
import { runSecondOpinionReviewForTask } from "./second-opinion-review-runner";
import { readWorkspaceIdFromRequest } from "./workspace-id-from-request";
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
const SANDBOX_REVIEW_RESULT_POLL_DELAYS_MS = [100, 250, 500, 1_000, 2_000] as const;

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

function isEmptySandboxPatchSummary(summary: RuntimeTaskSessionSummary | null): boolean {
	return summary?.latestHookActivity?.hookEventName === "sandbox_patch_empty";
}

async function resolveReviewSandboxResult(options: {
	repoPath: string;
	service: NKleinTaskSessionService;
	taskId: string;
}): Promise<"result_branch" | "empty_patch" | "unknown"> {
	for (const delayMs of [0, ...SANDBOX_REVIEW_RESULT_POLL_DELAYS_MS]) {
		if (delayMs > 0) {
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
		if (isEmptySandboxPatchSummary(options.service.getSummary(options.taskId))) {
			return "empty_patch";
		}
		const resultCommit = await resolveTaskResultBranchCommit({
			repoPath: options.repoPath,
			taskId: options.taskId,
		});
		if (resultCommit) {
			return "result_branch";
		}
	}
	return "unknown";
}

export async function createRuntimeServer(deps: CreateRuntimeServerDependencies): Promise<RuntimeServer> {
	// Silence the external `ai` package's per-call "system messages in the prompt" warning (we pass them by
	// design) and log the rationale once, so it stops flooding the runtime log and burying the useful lines.
	configureNKleinAiSdkWarnings(deps.warn);
	// §5.Y #8: compute remote-mode confinement roots once at startup.
	const isRemoteMode = isKanbanRemoteHost();
	const globalConfig = await loadGlobalRuntimeConfig();
	const allowedBrowseRoots = resolveRemoteBrowseRoots({
		configuredWorkspaceBaseDir: globalConfig.workspaceBaseDir,
	});
	const webUiDir = getWebUiDir();
	const startupAgentSandboxManager = new AgentSandboxManager();
	let agentSandboxStatus = createCheckingAgentSandboxStatus();
	const refreshAgentSandboxStatus = async (): Promise<RuntimeAgentSandboxStatus> => {
		agentSandboxStatus = createCheckingAgentSandboxStatus();
		agentSandboxStatus = await startupAgentSandboxManager.checkAvailability();
		return agentSandboxStatus;
	};
	void (async () => {
		// Orphan-reaping `docker rm -f`s EVERY container carrying the sandbox label — correct for a normal single-instance
		// host (clean up leftovers from a crashed run), but DESTRUCTIVE when multiple !Klein instances share one host Docker
		// (each would reap the others' live containers, since container names are a fixed global slot). The integration
		// tests spawn many ephemeral backends in parallel ALONGSIDE the agent-sandbox unit test on the same host Docker, so
		// a spawned backend's startup reap would kill the unit test's in-flight container (its `docker exec` then returns
		// exit 137). Ephemeral/hermetic backends therefore opt out via NKLEIN_SANDBOX_SKIP_STARTUP_REAP=1 (set by the test
		// backend factory); production startup still reaps. (todo §5.AM, root-caused 2026-06-29.)
		// Also skip automatically under vitest (`VITEST`) — that covers IN-PROCESS server boots (e.g. ws-upgrade-passcode)
		// that run in a worker parallel to the agent-sandbox integration test and would otherwise reap its live container.
		const skipStartupReap = process.env.NKLEIN_SANDBOX_SKIP_STARTUP_REAP === "1" || process.env.VITEST === "true";
		if (!skipStartupReap) {
			await startupAgentSandboxManager.reapOrphanResources();
		}
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
	const nkleinTaskSessionServiceByWorkspaceId = new Map<string, NKleinTaskSessionService>();
	// §5.AA/§5.AI: cards auto-start SKIPPED because they likely touch the same files as an active task (the concurrency
	// guard below). Without this they orphan in planning/backlog — the completion handler only re-attempts dependency-edge
	// successors, and a file-overlap skip is not a dependency block. We remember them per workspace and retry them on the
	// next completion (when the overlapping task's file lock is released); `autoStartTaskIds` re-checks live overlap on
	// each retry, so a still-overlapping card is simply deferred again. (In-memory for now; §5.AF could persist it.)
	const deferredOverlapTaskIdsByWorkspaceId = new Map<string, Set<string>>();
	const queuedStartDrainUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const nkleinWatcherRegistry = createNKleinWatcherRegistry();
	// §5.AF durable queued-start store: one global JSONL snapshot under the runtime home, persisted on every queue
	// change and replayed at boot so a runtime restart resumes pending starts instead of silently dropping them.
	const taskStartQueuePath = join(resolveNkleinRuntimeHomePath(homedir()), "task-start-queue.jsonl");
	const taskStartQueue = createRuntimeTaskStartQueue({
		onChange: (entries) => {
			void saveQueuedTaskStartsToDisk(taskStartQueuePath, entries);
		},
	});
	const queuedStartDrainInFlightByWorkspaceId = new Set<string>();
	const autoReviewFinalizationInFlightTaskIds = new Set<string>();
	// W4.2a (run12 live finding): ONE automatic re-drive of an empty-patch worker before the fail-closed hold —
	// an unattended swarm otherwise stalls on a card the worker simply failed to do (the hold is correct; the
	// missing piece was recovery). Keyed workspace:task; bounded to a single attempt, then the operator owns it.
	const emptyPatchRedriveAttemptsByTaskKey = new Map<string, number>();
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
					// No longer a waiting card (started elsewhere, completed, trashed) — drop any deferred-overlap entry so
					// the set doesn't retain ids that can never be auto-started again (it would no-op here every completion).
					deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.delete(taskId);
					continue;
				}
				const task = state.board.columns
					.flatMap((column) => column.cards)
					.find((candidate) => candidate.id === taskId);
				if (!task) {
					continue;
				}
				const liveNKleinSessions =
					nkleinTaskSessionServiceByWorkspaceId.get(scope.workspaceId)?.listSummaries() ?? [];
				const sessions = {
					...state.sessions,
					...Object.fromEntries(liveNKleinSessions.map((summary) => [summary.taskId, summary])),
				};
				const overlappingTask = findActiveTaskLikelyTouchedFileOverlap({
					board: state.board,
					sessions,
					task,
				});
				if (overlappingTask) {
					const sharedPaths = getSharedLikelyTouchedPaths(task, overlappingTask);
					// Remember it so the completion handler retries it once the overlapping task releases its file lock —
					// otherwise this card orphans (no dependency edge re-triggers it). Re-checked on each retry.
					const deferred = deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId) ?? new Set<string>();
					deferred.add(task.id);
					deferredOverlapTaskIdsByWorkspaceId.set(scope.workspaceId, deferred);
					deps.warn(
						`Skipped auto-start for linked task ${task.id} because it likely touches the same files as active task ${overlappingTask.id} (shared: ${sharedPaths.join(", ") || "?"}); deferred for retry on next completion.`,
					);
					continue;
				}
				// About to start it — it is no longer deferred-for-overlap.
				deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.delete(task.id);
				// Every started card enters the Planning/Refinement lane first (todo §5.B), work or decompose alike.
				const targetColumnId = STARTED_CARD_ENTRY_LANE;
				const started = await runtimeApi.startTaskSession(scope, {
					taskId: task.id,
					prompt: task.prompt,
					taskTitle: task.title,
					images: task.images,
					filesLikelyTouched: task.filesLikelyTouched,
					startInPlanMode: task.startInPlanMode,
					baseRef: task.baseRef,
					agentId: task.agentId,
					nkleinSettings: task.nkleinSettings,
					queueOnEndpointBusy: true,
				});
				if (!started.ok && !started.queued) {
					// Live-found 2026-07-02 (runs 9/10 cascade deadlock): a CONCURRENCY-limit block is transient — a
					// just-finished session (e.g. the decompose seed at root-start time) can hold a slot for a moment —
					// but it was never retried (only overlap deferrals were), so one blocked root froze the whole
					// cascade. Defer it like an overlap conflict: the next completion re-attempts it.
					if (started.errorCode === "concurrency_limit") {
						const deferred = deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId) ?? new Set<string>();
						deferred.add(task.id);
						deferredOverlapTaskIdsByWorkspaceId.set(scope.workspaceId, deferred);
						deps.warn(
							`Auto-start of ${task.id} hit the concurrency limit; deferred for retry on the next completion.`,
						);
						continue;
					}
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
		event: NKleinDecompositionAppliedEvent,
	): Promise<void> => {
		await autoStartTaskIds(scope, event.rootTaskIds);
	};
	const moveStartedQueuedTask = async (
		scope: RuntimeTrpcWorkspaceScope,
		input: { taskId: string; startInPlanMode?: boolean },
	): Promise<void> => {
		// Every started card enters the Planning/Refinement lane first (todo §5.B), work or decompose alike.
		const targetColumnId = STARTED_CARD_ENTRY_LANE;
		await mutateWorkspaceState(scope.workspacePath, (latestState) => {
			const movement = moveTaskToColumn(latestState.board, input.taskId, targetColumnId);
			return {
				board: movement.board,
				save: movement.moved,
				value: null,
			};
		});
	};
	const completeDecompositionSourceTask = async (
		scope: RuntimeTrpcWorkspaceScope,
		event: NKleinDecompositionAppliedEvent,
	): Promise<void> => {
		const sourceTaskId = event.sourceTaskId?.trim();
		if (!sourceTaskId) {
			return;
		}
		// Causal ordering (todo §5.U S5): the caller already awaits autoStartDecompositionRootTasks before this, so the
		// source-task completion runs after the root starts deterministically — no arbitrary settle delay needed. Errors
		// stay non-fatal (warn) so a failed completion can't break the decomposition-applied handler.
		try {
			const service = nkleinTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
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
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(
				`Could not complete decomposition source task ${sourceTaskId} for ${scope.workspacePath}: ${message}`,
			);
		}
	};
	const recordNKleinModelPerformance = (
		scope: RuntimeTrpcWorkspaceScope,
		summary: RuntimeTaskSessionSummary,
	): void => {
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
	const recordNKleinKnowledgeToolUsage = (
		scope: RuntimeTrpcWorkspaceScope,
		summary: RuntimeTaskSessionSummary,
	): void => {
		void (async () => {
			const [workspaceState, runtimeConfig] = await Promise.all([
				loadWorkspaceState(scope.workspacePath).catch(() => null),
				loadRuntimeConfig(scope.workspacePath).catch(() => null),
			]);
			const cards = workspaceState?.board.columns.flatMap((column) => column.cards) ?? [];
			const card = cards.find((candidate) => candidate.id === summary.taskId) ?? null;
			await recordKnowledgeToolUsageObservation({
				workspaceId: scope.workspaceId,
				workspacePath: scope.workspacePath,
				card,
				runtimeConfig,
				summary,
			});
		})().catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not record knowledge tool usage for ${summary.taskId}: ${message}`);
		});
	};
	const finalizeHeadlessAutoReviewTask = (
		scope: RuntimeTrpcWorkspaceScope,
		service: NKleinTaskSessionService,
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
					const sandboxResult = await resolveReviewSandboxResult({
						repoPath: scope.workspacePath,
						service,
						taskId,
					});
					// Second-opinion review gate (todo §5.K). Runs for EVERY reviewable result — including an
					// `empty_patch` (no file changes), since a no-op is usually a red flag (bad planning / mis-processed
					// task) that deserves judgment, not a silent auto-complete. The result branch (when there is one) is
					// ready by now, so the reviewer has the diff. bounced → already back in In Progress with the worker
					// re-driven; parked → left in Review — either way skip delivery. Any error (or a skip when review is
					// disabled) falls through to the prior auto-merge/complete, so the review can't block delivery on a
					// failure of its own.
					const reviewOutcome = await runSecondOpinionReviewForTask({
						workspacePath: scope.workspacePath,
						taskId,
						service,
						warn: deps.warn,
					}).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						deps.warn(`Second-opinion review errored for ${taskId}; proceeding to delivery: ${message}`);
						return { type: "skipped" as const, reason: "card_not_found" as const };
					});
					const reviewReason = "reason" in reviewOutcome ? ` (${reviewOutcome.reason})` : "";
					deps.warn(`Second-opinion review outcome for ${taskId}: ${reviewOutcome.type}${reviewReason}`);
					if (reviewOutcome.type === "bounced" || reviewOutcome.type === "parked") {
						return;
					}
					// FAIL-CLOSED delivery evidence (audit 2026-07-02 W0.1 — supersedes the prior fail-open hardcode).
					// See deriveDeliveryGateEvidence for the posture: only a delivered review sign-off approves, and
					// only a FRESH present-and-passed acceptance run at this seam counts as tests passing.
					const deliveryCard = reviewState.board.columns
						.flatMap((column) => column.cards)
						.find((c) => c.id === taskId);
					const acceptance = deliveryCard
						? await (async () => {
								try {
									return await service.verifyTaskAcceptanceInSandbox({
										taskId,
										projectRepoPath: scope.workspacePath,
										baseRef: deliveryCard.baseRef,
										taskPrompt: deliveryCard.prompt,
									});
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									deps.warn(`Acceptance re-check unavailable for ${taskId} (fail-closed): ${message}`);
									return null;
								}
							})()
						: null;
					const evidence = deriveDeliveryGateEvidence({
						reviewOutcomeType: reviewOutcome.type,
						acceptance,
					});
					if (evidence.testsDetail) {
						deps.warn(`Delivery gate evidence for ${taskId}: tests NOT passed — ${evidence.testsDetail}.`);
					}

					if (shouldHoldEmptyPatchResult({ sandboxResult, reviewApproved: evidence.reviewApproved })) {
						// A no-op result may only complete (and release its dependents) on an explicit reviewer
						// sign-off. Before the fail-closed hold, RE-DRIVE the worker once (W4.2a): an empty patch
						// usually means the worker burned its turn (guard churn / truncation) and simply needs to be
						// told the task is not done — parking straight to the operator stalls an unattended swarm.
						const redriveAttempts = emptyPatchRedriveAttemptsByTaskKey.get(inFlightKey) ?? 0;
						if (redriveAttempts < 1) {
							emptyPatchRedriveAttemptsByTaskKey.set(inFlightKey, redriveAttempts + 1);
							deps.warn(
								`Empty-patch card ${taskId}: re-driving the worker once before holding (no file changes were captured).`,
							);
							await mutateWorkspaceState(scope.workspacePath, (latestState) => {
								const movement = moveTaskToColumn(latestState.board, taskId, "in_progress");
								return { board: movement.board, save: movement.moved, value: null };
							});
							await service
								.sendTaskSessionInput(
									taskId,
									"Your previous run ended with NO file changes captured — the task is NOT done. Complete the task now: make the required code changes, keep tool use focused (avoid re-reading files you have already seen), and finish with the acceptance check passing.",
									"act",
								)
								.catch((error) => {
									const message = error instanceof Error ? error.message : String(error);
									deps.warn(`Empty-patch re-drive of ${taskId} failed (${message}); holding in Review.`);
								});
							return;
						}
						deps.warn(
							`Empty-patch card ${taskId} held in Review (fail-closed): no reviewer sign-off after a re-drive, so a no-op result cannot auto-complete.`,
						);
						return;
					}

					if (sandboxResult !== "empty_patch") {
						// Delivery-autonomy gate (todo §5.L): the resolved delivery tier + safety gates decide whether
						// this card auto-merges. Self-merge IS allowed (2026-06-23 decision) at the open tiers; a diff that
						// touches protected safety paths always holds. Missing/unavailable evidence fails CLOSED (held in
						// Review with the reason logged above). Regression delta is not yet measured (null → self-merge
						// only at the most-open tier). Any non-merge action (manual / commit / open_pr) leaves the card
						// in Review.
						const deliveryConfig = await loadRuntimeConfig(scope.workspacePath).catch(() => null);
						const changedFiles = await getWorkspaceChangesBetweenRefs({
							cwd: scope.workspacePath,
							fromRef: deliveryCard?.baseRef ?? "HEAD",
							toRef: createTaskResultBranchRef(taskId),
						})
							.then((changes) => changes.files.map((file) => file.path))
							.catch(() => [] as string[]);
						const deliveryDecision = decideDeliveryAction(
							deliveryPolicyForTier(
								resolveEffectiveDeliveryTier(deliveryConfig?.effectiveAgentRulesets?.delivery, "worker", {
									cardTier: deliveryCard?.deliveryTierOverride ?? null,
								}),
							),
							{
								reviewApproved: evidence.reviewApproved,
								testsPassed: evidence.testsPassed,
								regressionDelta: null,
								hasProtectedPathChanges: changedFiles.some(isTrustedAutoMergeProtectedPath),
							},
						);
						if (deliveryDecision.action !== "merge") {
							deps.warn(
								`Delivery held for ${taskId} (delivery tier → ${deliveryDecision.action}): ${deliveryDecision.reason} Left in Review.`,
							);
							return;
						}
						const mergeResult = await mergeTaskWorktreesInDependencyOrder({
							repoPath: scope.workspacePath,
							board: reviewState.board,
							columns: ["review"],
							taskIds: [taskId],
						});
						// Durable board-level merge history (todo §5.G) — best-effort, never blocks the merge flow.
						void recordMergeHistory({ workspacePath: scope.workspacePath, taskId, result: mergeResult });
						if (!mergeResult.ok) {
							const reason =
								mergeResult.blocked?.reason ??
								mergeResult.conflict?.message ??
								"unknown task result merge failure";
							deps.warn(`Could not auto-merge task result ${taskId} for ${scope.workspacePath}: ${reason}`);
							return;
						}
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
					// §5.AA/§5.AI: retry cards deferred for file-overlap (this completion may have released the file lock)
					// alongside the dependency-newly-ready ones, so an overlap-skipped card can no longer orphan. The just-
					// completed task is excluded; `autoStartTaskIds` re-checks overlap and re-defers any still-conflicting card.
					const deferredOverlapTaskIds = [
						...(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId) ?? []),
					].filter((deferredTaskId) => deferredTaskId !== taskId);
					await autoStartTaskIds(scope, [...new Set([...readyTaskIds, ...deferredOverlapTaskIds])]);
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
		service: NKleinTaskSessionService,
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
		snapshot: () => taskStartQueue.snapshot(),
		hydrate: (entries) => taskStartQueue.hydrate(entries),
	};
	const getScopedNKleinTaskSessionService = async (
		scope: RuntimeTrpcWorkspaceScope,
	): Promise<NKleinTaskSessionService> => {
		const runtimeConfig = await loadRuntimeConfig(scope.workspacePath);
		const sandboxPoolConfig = buildAgentSandboxPoolConfig(runtimeConfig);
		// The shared container pool's egress is governed by the GLOBAL capability ruleset preset (default
		// fully_open -> full egress). Per-role network overrides would need policy-keyed pools (follow-up).
		const sandboxNetworkPolicy = capabilitiesForTier(
			runtimeConfig.effectiveAgentRulesets?.capability.globalPreset ?? DEFAULT_AGENT_CAPABILITY_TIER,
		).network;
		let service = nkleinTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
		if (!service) {
			service = createInMemoryNKleinTaskSessionService({
				watcherRegistry: nkleinWatcherRegistry,
				swarmGuardrails: runtimeConfig.swarmGuardrails,
				knowsTodayEnabled: runtimeConfig.knowsTodayEnabled,
				sandboxMcpServersEnabled: runtimeConfig.sandboxMcpServersEnabled,
				agentSandboxManager: new AgentSandboxManager({
					poolConfig: sandboxPoolConfig,
					networkPolicy: sandboxNetworkPolicy,
				}),
				onDecompositionApplied: async (event) => {
					if (event.workspacePath !== scope.workspacePath) {
						return;
					}
					await autoStartDecompositionRootTasks(scope, event);
					await completeDecompositionSourceTask(scope, event);
				},
				onCardPromoted: (event) => {
					// The promotion tool already persisted the Planning→In Progress move; just push the new board
					// state so the UI reflects the card leaving the refinement lane (todo §5.B).
					if (event.workspacePath !== scope.workspacePath) {
						return;
					}
					void deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated(scope.workspaceId, scope.workspacePath);
				},
				onFocusChainUpdated: async (taskId, chain) => {
					// Persist the agent's focus chain (todo §5.N) onto its card so the UI renders a live todo list.
					await mutateWorkspaceState(scope.workspacePath, (state) => ({
						board: {
							...state.board,
							columns: state.board.columns.map((column) => ({
								...column,
								cards: column.cards.map((card) =>
									card.id === taskId ? { ...card, focusChain: chain, updatedAt: Date.now() } : card,
								),
							})),
						},
						value: null,
					})).catch(() => undefined);
					void deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated(scope.workspaceId, scope.workspacePath);
				},
			});
			service.setBoardPaused((await readSwarmStopSignal(scope.workspacePath)) !== null);
			for (const taskId of await readPausedTasks(scope.workspacePath)) {
				service.setCardPaused(taskId, true);
			}
			const trackedService = service;
			nkleinTaskSessionServiceByWorkspaceId.set(scope.workspaceId, service);
			deps.runtimeStateHub.trackNKleinTaskSessionService(scope.workspaceId, scope.workspacePath, service);
			const unsubscribeQueueDrain = service.onSummary((summary) => {
				recordNKleinKnowledgeToolUsage(scope, summary);
				recordNKleinModelPerformance(scope, summary);
				if (isReviewableNKleinSummary(summary)) {
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
			service.setSwarmGuardrails(runtimeConfig.swarmGuardrails);
			service.setKnowsTodayEnabled(runtimeConfig.knowsTodayEnabled);
			service.setSandboxMcpServersEnabled(runtimeConfig.sandboxMcpServersEnabled);
		}
		return service;
	};
	const disposeNKleinTaskSessionServiceAsync = async (workspaceId: string): Promise<void> => {
		const service = nkleinTaskSessionServiceByWorkspaceId.get(workspaceId);
		if (!service) {
			return;
		}
		nkleinTaskSessionServiceByWorkspaceId.delete(workspaceId);
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
	const disposeNKleinTaskSessionService = (workspaceId: string): void => {
		void disposeNKleinTaskSessionServiceAsync(workspaceId);
	};
	const prepareForStateReset = async (): Promise<void> => {
		const workspaceIds = new Set<string>();
		for (const { workspaceId } of deps.workspaceRegistry.listManagedWorkspaces()) {
			workspaceIds.add(workspaceId);
		}
		for (const workspaceId of nkleinTaskSessionServiceByWorkspaceId.keys()) {
			workspaceIds.add(workspaceId);
		}
		const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
		if (activeWorkspaceId) {
			workspaceIds.add(activeWorkspaceId);
		}
		for (const workspaceId of workspaceIds) {
			await disposeNKleinTaskSessionServiceAsync(workspaceId);
			deps.disposeWorkspace(workspaceId, {
				stopTerminalSessions: true,
			});
		}
		deps.workspaceRegistry.clearActiveWorkspace();
	};

	runtimeApi = createRuntimeApi({
		getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
		getActiveWorkspacePath: deps.workspaceRegistry.getActiveWorkspacePath,
		getActiveRuntimeConfig: deps.workspaceRegistry.getActiveRuntimeConfig,
		loadScopedRuntimeConfig: deps.workspaceRegistry.loadScopedRuntimeConfig,
		setActiveRuntimeConfig: deps.workspaceRegistry.setActiveRuntimeConfig,
		getScopedTerminalManager,
		getScopedNKleinTaskSessionService,
		getLoadedScopedNKleinTaskSessionService: (workspaceScope) =>
			nkleinTaskSessionServiceByWorkspaceId.get(workspaceScope.workspaceId) ?? null,
		resolveInteractiveShellCommand: deps.resolveInteractiveShellCommand,
		runCommand: deps.runCommand,
		broadcastNKleinMcpAuthStatusesUpdated: deps.runtimeStateHub.broadcastNKleinMcpAuthStatusesUpdated,
		broadcastTaskChatCleared: deps.runtimeStateHub.broadcastTaskChatCleared,
		bumpNKleinSessionContextVersion: deps.runtimeStateHub.bumpNKleinSessionContextVersion,
		prepareForStateReset,
		taskStartQueue: scheduledTaskStartQueue,
		getUpdateStatus: deps.getUpdateStatus,
		runUpdateNow: deps.runUpdateNow,
		getAgentSandboxStatus: () => agentSandboxStatus,
		refreshAgentSandboxStatus,
		isRemoteMode,
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
				getScopedNKleinTaskSessionService,
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
					disposeNKleinTaskSessionService(workspaceId);
					return deps.disposeWorkspace(workspaceId, options);
				},
				collectProjectWorktreeTaskIdsForRemoval: deps.collectProjectWorktreeTaskIdsForRemoval,
				warn: deps.warn,
				buildProjectsPayload: deps.workspaceRegistry.buildProjectsPayload,
				pickDirectoryPathFromSystemDialog: deps.pickDirectoryPathFromSystemDialog,
				serverCwd: process.cwd(),
				isRemoteMode,
				allowedBrowseRoots,
			}),
		};
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => await createTrpcContext(req),
	});

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
	// HSTS on the served app + auth responses exactly when TLS is on (§5.Y #7).
	const tlsHardeningHeaders = buildTlsHardeningHeaders(tlsConfig !== null);
	const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
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
					...tlsHardeningHeaders,
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

			const oauthCallbackResponse = await handleNKleinMcpOauthCallback(requestUrl);
			if (oauthCallbackResponse) {
				res.writeHead(oauthCallbackResponse.statusCode, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(oauthCallbackResponse.body);
				return;
			}
			// ── Desktop nonce handshake (§5.Y #10) ───────────────────────────────
			// Expose the nonce only when the runtime was spawned by the desktop
			// shell (env var set). Readable only by someone who already knows the
			// URL; never logged or written to disk by this handler.
			if (pathname === "/api/desktop-health" && req.method === "GET") {
				const nonce = process.env.NKLEIN_DESKTOP_NONCE?.trim() || null;
				if (!nonce) {
					res.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
					res.end('{"error":"Not found"}');
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
				res.end(JSON.stringify({ nonce }));
				return;
			}
			// ── End desktop nonce handshake ────────────────────────────────────
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
				// Defense-in-depth hardening headers for the served app (§5.Y #12).
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "no-referrer",
				"X-Frame-Options": "DENY",
				"Content-Security-Policy": APP_CONTENT_SECURITY_POLICY,
				// HSTS only when actually served over TLS (§5.Y #7).
				...tlsHardeningHeaders,
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

	// §5.AF: replay the persisted queue once, now that the API + drain scheduler are wired. Awaited before returning,
	// so it completes before the caller serves any request that could enqueue (so the snapshot we just read is never
	// clobbered). The hydrate + per-start drain re-arming is the pure `replayPersistedQueuedTaskStarts` helper.
	replayPersistedQueuedTaskStarts({
		entries: await loadQueuedTaskStartsFromDisk(taskStartQueuePath),
		queue: taskStartQueue,
		scheduleDrain: scheduleQueuedTaskStartDrain,
	});

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
				Array.from(nkleinTaskSessionServiceByWorkspaceId.values()).map(async (service) => {
					await service.dispose();
				}),
			);
			nkleinTaskSessionServiceByWorkspaceId.clear();
			await nkleinWatcherRegistry.close();
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
