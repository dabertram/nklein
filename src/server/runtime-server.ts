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
	resolveAgentToolAccess,
	resolveEffectiveDeliveryTier,
} from "../core/agent-rulesets";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeBoardData,
	RuntimeCardReview,
	RuntimeCommandRunResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { readPausedTasks } from "../core/card-pause";
import { decideDeliveryAction } from "../core/delivery-decision";
import { deriveDeliveryGateEvidence, shouldHoldEmptyPatchResult } from "../core/delivery-evidence";
import { isTruthyEnv } from "../core/env-flag";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { decideOpportunisticIdleWork, findReviewCandidateTaskIds } from "../core/opportunistic-idle-work";
import {
	findJustCompletedPlans,
	resolvePlanAcceptanceCommand,
	resolvePlanFailureSurfaceCardId,
} from "../core/plan-integration-gate";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeTls,
	isKanbanRemoteHost,
} from "../core/runtime-endpoint";
import { decideSpeculativeMirror } from "../core/speculative-mirror";
import { reconcileOrphanedInProgressCards } from "../core/startup-orphan-reconcile";
import { readSwarmStopSignal } from "../core/swarm-guardrails";
import {
	completeTaskAndGetReadyLinkedTaskIds,
	getTaskColumnId,
	moveTaskToColumn,
	STARTED_CARD_ENTRY_LANE,
} from "../core/task-board-mutations";
import { listStartableUnstartedTaskIds } from "../core/task-board-ready-sweep";
import { findActiveTaskLikelyTouchedFileOverlap, getSharedLikelyTouchedPaths } from "../core/task-file-overlap";
import { isReviewableNKleinSummary } from "../core/task-session-guards";
import { AgentSandboxManager, resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox";
import { configureNKleinAiSdkWarnings } from "../nklein-agent/nklein-ai-sdk-warnings";
import type { NKleinDecompositionAppliedEvent } from "../nklein-agent/nklein-decomposition-tool";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";
import { handleNKleinMcpOauthCallback } from "../nklein-agent/nklein-mcp-runtime-service";
import {
	createInMemoryNKleinTaskSessionService,
	type NKleinTaskSessionService,
} from "../nklein-agent/nklein-task-session-service";
import { isTrustedAutoMergeProtectedPath } from "../nklein-agent/nklein-trusted-auto-merge";
import { createNKleinWatcherRegistry } from "../nklein-agent/nklein-watcher-registry";
import { deriveTaskFitnessRecord } from "../nklein-agent/task-fitness-recording";
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
import { appendAgentLedgerEvent, readAgentLedger } from "../state/agent-attempt-ledger-store";
import { recordMergeHistory } from "../state/merge-history-store";
import {
	isWorkspaceStateLockError,
	loadWorkspaceContextById,
	loadWorkspaceState,
	mutateWorkspaceState,
} from "../state/workspace-state";
import { recordTaskFitnessOutcome } from "../telemetry/fitness-table-store";
import { recordKnowledgeToolUsageObservation } from "../telemetry/knowledge-tool-usage-stats";
import { persistModelBehaviorOutcome } from "../telemetry/model-behavior-profile-store";
import { recordModelPerformanceObservation } from "../telemetry/model-performance-stats";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
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
import {
	createTaskResultBranchRef,
	deleteTaskResultBranch,
	resolveTaskResultBranchCommit,
} from "../workspace/task-result-branches";
import { mergeTaskWorktreesInDependencyOrder } from "../workspace/task-worktree-auto-merge";
import { buildAgentSandboxPoolConfig, createCheckingAgentSandboxStatus } from "./agent-sandbox-runtime-config";
import { getWebUiDir, normalizeRequestPath, readAsset } from "./assets";
import { createDurableRunWiring, type DurableRunWiring } from "./durable-run-wiring";
import { handleHttpRequest, handleSocketUpgrade } from "./middleware";
import type { RuntimeStateHub } from "./runtime-state-hub";
import { applyCardReviewToBoard, runSecondOpinionReviewForTask } from "./second-opinion-review-runner";
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
/** Head of a failed plan-gate's output persisted on the surfaced card / in the self-observation (§5.0.5). */
const PLAN_GATE_OUTPUT_HEAD_BUDGET = 400;
/** Project-level build+test budget: 3× the per-card acceptance default — it checks the whole merged tree. */
const PLAN_GATE_TIMEOUT_MS = 15 * 60 * 1000;
// C3 (§5.AF): how often the durable-run reclaim/dispatch timer fires. Long enough not to busy-loop, short enough to
// re-dispatch a reclaimed orphan (30s backoff) promptly. Only armed when NKLEIN_DURABLE_SCHEDULER is set.
const DURABLE_RUN_TICK_INTERVAL_MS = 15_000;

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
	// C3 (§5.AF): the durable-run wiring drives starts for a workspace with an active run when NKLEIN_DURABLE_SCHEDULER is
	// set (default OFF ⇒ inert / byte-identical). `scopeByWorkspaceId` lets the controller's `startCard` port re-enter the
	// start path from a timer/summary callback that has no scope in closure. `durableRunWiring` is assigned once
	// `autoStartTaskIds` exists (its `startCard` delegates back to it with the durable guard bypassed).
	const scopeByWorkspaceId = new Map<string, RuntimeTrpcWorkspaceScope>();
	let durableRunWiring: DurableRunWiring | null = null;
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
	// LOST-WAKEUP fix (found deterministically by the W2.1 v2 harness): a drain request arriving while another
	// drain is IN FLIGHT used to clear the pending retry timer and then bail on the in-flight check — destroying
	// the only scheduled wakeup while the in-flight drain (whose retry had just re-enqueued and hit "busy" again)
	// never re-armed. Net: a queued start slept FOREVER (the live runs' "queued behind a busy endpoint" stall).
	// Requests that arrive mid-drain are remembered here and re-run when the in-flight drain finishes.
	const queuedStartDrainRerunRequestByWorkspaceId = new Map<string, { force: boolean }>();
	const autoReviewFinalizationInFlightTaskIds = new Set<string>();
	// §5.AK Phase B (adversarial review, 2026-07): per-workspace MERGE SERIALIZATION. Delivery finalizations
	// dedupe per-taskId only, so two cards finishing simultaneously could interleave merge attempts on the SAME
	// host repo — task B's fall-through `git merge --abort` then destroys task A's in-flight (possibly agent-
	// resolving, multi-minute) merge and can wedge the repo dirty. Chain merge attempts per workspace so they
	// run strictly one-at-a-time; a failed predecessor never blocks the next attempt (errors are swallowed in
	// the chain link, each caller still sees its OWN result/rejection).
	const mergeChainByWorkspaceId = new Map<string, Promise<unknown>>();
	const runWorkspaceMergeSerialized = <T>(workspaceId: string, doMerge: () => Promise<T>): Promise<T> => {
		const prev = mergeChainByWorkspaceId.get(workspaceId) ?? Promise.resolve();
		const next = prev.catch(() => undefined).then(() => doMerge());
		const tail = next
			.catch(() => undefined)
			.finally(() => {
				if (mergeChainByWorkspaceId.get(workspaceId) === tail) {
					mergeChainByWorkspaceId.delete(workspaceId);
				}
			});
		mergeChainByWorkspaceId.set(workspaceId, tail);
		return next;
	};
	// LOST-WAKEUP fix #2 (harness v3, same pattern as the queued-start drain): a finalization request arriving
	// while one is IN FLIGHT was silently dropped — a fast bounce→re-work round-trip finalizes AGAIN while the
	// bounce round is still persisting, so round 2's review never ran (and a later stray trigger raced the
	// bounce persist into "not_reviewable"). Requests that arrive mid-finalization are remembered and re-run.
	const autoReviewFinalizationRerunRequestedKeys = new Set<string>();
	// W4.2a (run12 live finding): ONE automatic re-drive of an empty-patch worker before the fail-closed hold —
	// an unattended swarm otherwise stalls on a card the worker simply failed to do (the hold is correct; the
	// missing piece was recovery). Keyed workspace:task; bounded to a single attempt, then the operator owns it.
	const emptyPatchRedriveAttemptsByTaskKey = new Map<string, number>();
	// #28 (run30, user-observed frozen fleet): an APPROVED-but-acceptance-failed hold had NO re-drive rung —
	// bounces fire only on request_changes and the empty-patch re-drive only on empty patches, so the card sat
	// held in Review forever with the whole fleet idle. ONE re-drive carries the failing acceptance output back
	// to the worker; a second failure leaves the hold for the operator.
	const acceptanceFailureRedriveAttemptsByTaskKey = new Map<string, number>();
	// Plan-level integration gate (todo §5.0.5 — decision 2026-07-02: "YES, gate the plan"): ONE gate run per plan
	// slug per process, keyed workspace:slug — a re-delivery/re-finalization of the plan's last card must not
	// re-fire the (minutes-long) project-level acceptance run.
	const completedPlanGateRunKeys = new Set<string>();
	// run16 live finding: recovery (deferred-retry + ready-sweep) only fired on COMPLETION — a card that dies
	// (interrupted/failed, e.g. mid-write on a slow model) produces NO completion, so the board froze with
	// retryable cards waiting. Debounced per workspace so a burst of summary updates costs one sweep.
	const lastTerminalRetrySweepAtByWorkspaceId = new Map<string, number>();
	const TERMINAL_RETRY_SWEEP_DEBOUNCE_MS = 5_000;
	// #26 (run28): event-only deferral rescue has a terminal gap — the retry fired on every completion but each
	// raced the completing session's still-held slot, and after the LAST completion no event ever fires again.
	// A concurrency-limit deferral therefore also arms a one-shot TIMER sweep (clears the debounce window).
	const deferredRetryTimerByWorkspaceId = new Map<string, ReturnType<typeof setTimeout>>();
	// #29 (user directive: "improve detection of stall"): a RUNTIME-level board-liveness watchdog. Every tick,
	// if NO session is alive but actionable work exists (startable-unstarted cards or a non-empty deferred set),
	// the board is FROZEN — self-heal by sweeping, and say so loudly. Legitimately-idle boards (everything
	// terminal or held for the operator) never trip it.
	const boardLivenessWatchdogByWorkspaceId = new Map<string, ReturnType<typeof setInterval>>();
	// 30s (was 60s): run36 gave the watchdog exactly ONE tick inside the harness's 90s dead-stall window — a
	// single swallowed error meant no rescue. Halving the tick doubles the chances and the sweep is cheap.
	const BOARD_LIVENESS_TICK_MS = 30_000;
	// #35 (run36): the tick's failures were INVISIBLE (empty catch) — record the first error per workspace so a
	// throwing tick (e.g. workspace-state lock contention) can never silently disable the watchdog again.
	const watchdogErrorReportedWorkspaceIds = new Set<string>();
	// §5.AW opportunistic best-of-N (user decision 2026-07-02): the per-workspace mirror tick + its budgets.
	// The tick mirrors the hardest RUNNING card onto a lineage-diverse idle model as a `::spec` session; the
	// A/B arbitration at the review seam picks the winner. Real work always outranks speculation (queued or
	// overlap-deferred cards veto a mirror AND preempt running specs), and each card is mirrored at most once
	// per process lifetime. KNOWN GAP (needs the `lms ps` machineId feed, not the /api/v1/models descriptors):
	// the idle set is machine-blind — an "idle" model sharing a machine with the busy primary can slow it
	// (legion CPU/GPU co-model ≈4× measured). Revisit with §5.AB machine-aware pools.
	const speculativeMirrorTickByWorkspaceId = new Map<string, ReturnType<typeof setInterval>>();
	const speculativeConfigByWorkspaceId = new Map<
		string,
		{ enabled: boolean; maxConcurrentSpecs: number; maxSpecsPerRun: number }
	>();
	const speculativeSpecsStartedByWorkspaceId = new Map<string, number>();
	const speculativeMirroredTaskIdsByWorkspaceId = new Map<string, Set<string>>();
	// Specs between "tick fired" and "session visible" (sandbox prep) — invisible to listModelEndpointSessions,
	// so the ceiling must count them explicitly or a 45s tick can double-book the one idle model.
	const speculativeSpecsInFlightByWorkspaceId = new Map<string, number>();
	const SPECULATIVE_MIRROR_TICK_MS = 45_000;
	// §5.AW opportunistic idle-work sweep (flag-gated, default OFF): when the swarm is genuinely idle, the ranker picks
	// the highest-value available opportunistic task. Today only the `review` picker is wired (a review-lane card whose
	// review the event path missed) — its per-workspace idempotency set stops re-reviewing the same card each tick.
	const opportunisticIdleWorkTickByWorkspaceId = new Map<string, ReturnType<typeof setInterval>>();
	const idleReviewDispatchedByWorkspaceId = new Map<string, Set<string>>();
	const OPPORTUNISTIC_IDLE_WORK_TICK_MS = 60_000;
	const DEFERRED_RETRY_TIMER_MS = 7_000;
	const queuedStartDrainTimersByWorkspaceId = new Map<
		string,
		{
			dueAt: number;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	let runtimeApi: RuntimeTrpcContext["runtimeApi"];
	const autoStartTaskIds = async (
		scope: RuntimeTrpcWorkspaceScope,
		taskIds: readonly string[],
		opts?: { bypassDurableGuard?: boolean },
	): Promise<void> => {
		if (taskIds.length === 0) {
			return;
		}
		// C3 (§5.AF): when a durable run owns this workspace, ITS controller drives starts (lease → dispatch → cascade) —
		// so the foreground cascade defers to it here. The controller's own `startCard` re-enters with `bypassDurableGuard`
		// to perform the actual start. No-op when NKLEIN_DURABLE_SCHEDULER is off (`hasRun` is always false) ⇒ byte-identical.
		if (!opts?.bypassDurableGuard && durableRunWiring?.hasRun(scope.workspaceId)) {
			return;
		}
		// §5.AK Phase A: resolve the effective file-overlap policy ONCE per auto-start batch (project override ??
		// global). A failed config load fails safe to "serialize" — today's defer-on-overlap behavior.
		const overlapRuntimeConfig = await loadRuntimeConfig(scope.workspacePath).catch(() => null);
		const fileOverlapParallelism = overlapRuntimeConfig?.effectiveFileOverlapParallelism ?? "serialize";
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
				// C3 review #1: a DURABLE-driven start (the controller already decided the lease) must NOT be silently
				// deferred here — deferring orphans the lease (no live start → reclaim → burns an attempt → wrongly failed),
				// and the foreground deferred-overlap recovery is disabled while a durable run owns the workspace. The
				// controller owns scheduling (its own concurrency), and §5.AK's "allow" policy already permits overlap
				// parallel starts (the merge agent resolves conflicts at delivery), so a durable start proceeds regardless.
				if (overlappingTask && fileOverlapParallelism === "serialize" && !opts?.bypassDurableGuard) {
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
				if (overlappingTask) {
					// §5.AK Phase A "allow": an overlap no longer defers — record the parallel start (both task ids +
					// the shared paths) as a self-observation and fall through to the normal start logic. Phase B's
					// merge agent owns resolving any resulting conflicts at delivery time.
					const sharedPaths = getSharedLikelyTouchedPaths(task, overlappingTask);
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `File-overlap parallel start: task ${task.id} starts alongside active task ${overlappingTask.id} (shared: ${sharedPaths.join(", ") || "?"}).`,
						taskId: task.id,
						workspacePath: scope.workspacePath,
						metadata: {
							category: "file_overlap_parallel_start",
							overlappingTaskId: overlappingTask.id,
							sharedPaths,
						},
					});
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
						// #26: also retry on a TIMER — the completion-event retry can race the releasing slot, and
						// after the last completion no event ever fires again (run28 stranded its final card this way).
						const existingTimer = deferredRetryTimerByWorkspaceId.get(scope.workspaceId);
						if (existingTimer) {
							clearTimeout(existingTimer);
						}
						deferredRetryTimerByWorkspaceId.set(
							scope.workspaceId,
							setTimeout(() => {
								deferredRetryTimerByWorkspaceId.delete(scope.workspaceId);
								const timerService = nkleinTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
								if (timerService) {
									retryWaitingCardsAfterTerminal(scope, timerService);
								}
							}, DEFERRED_RETRY_TIMER_MS),
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
					// Run14 live finding: a silently-queued start is INVISIBLE — 17 minutes of dead air with no way
					// to tell queued-and-stuck from never-started. Always say so (the queue's drain timers do the rest).
					deps.warn(
						`Auto-start of ${task.id} queued behind a busy endpoint${
							started.retryAfterMs ? ` (retry in ~${Math.round(started.retryAfterMs / 1000)}s)` : ""
						}.`,
					);
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
	// C3 (§5.AF, live-found 2026-07-04 real-model mid_task STALL): the two legacy rescue sweeps below re-drive
	// `autoStartTaskIds` WITHOUT the durable-guard bypass, so under a durable run they no-op — which strands a card the
	// controller ALREADY leased+dispatched that then hit the board's `concurrency_limit` (its lease frees at
	// awaiting_review, but the board cap still counts those cards, so a just-leased dependent is deferred). The
	// controller treats the lease as running and only re-dispatches on the 5-min reclaim, long after the harness gives
	// up. Split the rescue: under a durable run, retry ONLY the deferred set (durable-sanctioned dispatches that were
	// concurrency/overlap-deferred — nothing else will restart them) WITH the bypass; the discovery legs (ready/sweep/
	// redrive) stay the controller's job (lease → dispatch, reclaim → retry), so we never start a card its DAG hasn't
	// unblocked. Off durable (`hasRun` false) ⇒ today's full-candidate union, byte-identical.
	const startRescueCandidates = async (
		scope: RuntimeTrpcWorkspaceScope,
		deferredTaskIds: readonly string[],
		// The FULL ordered union for the off-durable path — passed explicitly so the byte-identical default preserves
		// each call site's original candidate ORDER (order decides which card wins a scarce slot in autoStartTaskIds).
		orderedCandidates: readonly string[],
	): Promise<void> => {
		if (durableRunWiring?.hasRun(scope.workspaceId)) {
			const deferred = [...new Set(deferredTaskIds)];
			if (deferred.length > 0) {
				await autoStartTaskIds(scope, deferred, { bypassDurableGuard: true });
			}
			return;
		}
		const candidates = [...new Set(orderedCandidates)];
		if (candidates.length > 0) {
			await autoStartTaskIds(scope, candidates);
		}
	};
	/** run16: retry waiting cards when a card DIES (no completion will fire) — deferred set ∪ ready-sweep. */
	// run25 strand class (#24): an interrupted card with NO captured work has no rescue path — the prior-work
	// rebound (#21) needs a result branch, and the sweep below only rescues OTHER waiting cards. The dead card
	// itself gets ONE fresh restart (bounded by this set), then it is left for the operator (attention).
	const terminalRedriveAttemptedTaskKeys = new Set<string>();
	const retryWaitingCardsAfterTerminal = (
		scope: RuntimeTrpcWorkspaceScope,
		service: NKleinTaskSessionService,
		terminalTaskId?: string,
	): void => {
		const now = Date.now();
		const last = lastTerminalRetrySweepAtByWorkspaceId.get(scope.workspaceId) ?? 0;
		// The debounce guards against sweep storms — but a pending one-shot dead-card rescue (#24) must not be
		// swallowed by a neighboring terminal's window (losing it would strand the card permanently).
		const redrivePending =
			terminalTaskId !== undefined &&
			!terminalRedriveAttemptedTaskKeys.has(`${scope.workspaceId}:${terminalTaskId}`);
		if (!redrivePending && now - last < TERMINAL_RETRY_SWEEP_DEBOUNCE_MS) {
			return;
		}
		lastTerminalRetrySweepAtByWorkspaceId.set(scope.workspaceId, now);
		void (async () => {
			try {
				const state = await loadWorkspaceState(scope.workspacePath);
				const activeSessionTaskIds = new Set(
					service
						.listSummaries()
						.filter(
							(summary) =>
								summary.state === "running" ||
								summary.state === "queued" ||
								summary.state === "awaiting_review",
						)
						.map((summary) => summary.taskId),
				);
				const sweepTaskIds = listStartableUnstartedTaskIds(state.board, activeSessionTaskIds);
				const deferredTaskIds = [...(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId) ?? [])];
				const redriveTaskIds: string[] = [];
				if (terminalTaskId && !activeSessionTaskIds.has(terminalTaskId)) {
					const redriveKey = `${scope.workspaceId}:${terminalTaskId}`;
					const lane = state.board.columns.find((column) =>
						column.cards.some((card) => card.id === terminalTaskId),
					)?.id;
					if (
						(lane === "in_progress" || lane === "planning") &&
						!terminalRedriveAttemptedTaskKeys.has(redriveKey)
					) {
						const resultCommit = await resolveTaskResultBranchCommit({
							repoPath: scope.workspacePath,
							taskId: terminalTaskId,
						}).catch(() => null);
						// A result branch means the #21 prior-work rebound owns recovery (review judges the work);
						// only the NO-work dead card needs a fresh attempt here.
						if (!resultCommit) {
							terminalRedriveAttemptedTaskKeys.add(redriveKey);
							deps.warn(
								`Dead card ${terminalTaskId} left no captured work — attempting ONE fresh restart before leaving it for the operator.`,
							);
							redriveTaskIds.push(terminalTaskId);
						}
					}
				}
				// Under a durable run only the deferred set is ours to restart; sweep/redrive are the controller's (see
				// startRescueCandidates). Off durable this is the same union as before.
				await startRescueCandidates(scope, deferredTaskIds, [
					...deferredTaskIds,
					...sweepTaskIds,
					...redriveTaskIds,
				]);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Terminal retry sweep failed for ${scope.workspacePath}: ${message}`);
			}
		})();
	};
	// C3 (§5.AF): construct the durable-run wiring now that `autoStartTaskIds` + `scopeByWorkspaceId` exist. Its
	// `startCard` port re-enters the start path with the durable guard bypassed (the controller already decided the lease);
	// `appendEvent`/`readLedger` are the §5.AF agent-ledger store (persist-before-dispatch + boot-replay). Disabled by
	// default (NKLEIN_DURABLE_SCHEDULER off) ⇒ every method is inert and the runtime is byte-identical.
	// DEFAULT-ON DEFERRED (2026-07-04): the concurrency-defer fix is proven (deterministic guard + cap=1/cap=2 real-model
	// PASS), but SWEEP-to-validate flipping the default found swarm-deterministic-BOUNCE fails under the flag. DIAGNOSIS
	// (from the preserved task-run: gamma reaches awaiting_review, re-works to awaiting_review AGAIN, then is INTERRUPTED):
	// the re-work DOES run — the failure is the SECOND review firing `not_reviewable` (the known finalize-again-while-the-
	// bounce-round-still-persists race, guarded at finalizeHeadlessAutoReviewTask ~L995) → card HELD → session stopped →
	// interrupted → the round-2 review never lands → stuck in Review. The durable `observeSummary` on the first
	// awaiting_review runs CONCURRENTLY with the review finalization (both fire on the same onSummary) and deterministically
	// shifts the bounce→re-work→re-review timing past the in-flight guard. So the fix is NOT a durable reopen-on-bounce
	// (an earlier wrong hypothesis — the re-work runs); it's making the finalization re-run robust to the durable-shifted
	// timing (e.g. the durable observeSummary should not race the finalization for the same task, or the finalize in-flight
	// guard must re-run reliably after a bounce persist). Subtle timing fix — needs a focused pass. See todo §5.AF.
	// (The 3-file swarm integration batch also flakes on parallel Docker-pool contention under the flag; hold passes ALONE.)
	const durableSchedulerEnabled = isTruthyEnv(process.env.NKLEIN_DURABLE_SCHEDULER);
	durableRunWiring = createDurableRunWiring({
		enabled: durableSchedulerEnabled,
		appendEvent: (event) => appendAgentLedgerEvent(event),
		startCard: (workspaceId, taskId) => {
			const startScope = scopeByWorkspaceId.get(workspaceId);
			if (startScope) {
				void autoStartTaskIds(startScope, [taskId], { bypassDurableGuard: true });
			}
		},
		// Scope the boot-resume read to THIS workspace's ledger file (not every workspace's — review finding #6), keyed by
		// the same path hash the events were stamped with.
		readLedger: (workspaceId) => {
			const ledgerScope = scopeByWorkspaceId.get(workspaceId);
			return ledgerScope
				? readAgentLedger({ workspacePathHash: hashWorkspacePathForLedger(ledgerScope.workspacePath) })
				: [];
		},
		hashWorkspacePath: hashWorkspacePathForLedger,
		workflowIdFor: (workspaceId) => `durable-run:${workspaceId}`,
	});
	// Build/resume the workspace's durable run from its current board (idempotent; no-op when disabled or already running).
	const ensureDurableRunForScope = async (
		scope: RuntimeTrpcWorkspaceScope,
		options?: { resumeOnly?: boolean },
	): Promise<void> => {
		if (!durableSchedulerEnabled || !durableRunWiring) {
			return;
		}
		const state = await loadWorkspaceState(scope.workspacePath).catch(() => null);
		if (state) {
			// Review #5: cap the run's leases at the board's own concurrency cap so the controller never over-leases past
			// what the runtime will start (over-leasing → concurrency_limit → an orphaned lease). Fail-open to no cap.
			const overlapConfig = await loadRuntimeConfig(scope.workspacePath).catch(() => null);
			const boardCap = overlapConfig?.effectiveMaxConcurrentTasks;
			await durableRunWiring.ensureRun(scope.workspaceId, scope.workspacePath, state.board, {
				...options,
				...(typeof boardCap === "number" ? { maxConcurrentLeases: boardCap } : {}),
			});
		}
	};
	// C3: the reclaim/dispatch timer — ticks every active run so a DEAD-lease worker (missed heartbeat) is reclaimed and
	// its card re-dispatched, and a card held off by reclaim backoff eventually starts. Created ONLY when enabled (no extra
	// timer on the default path ⇒ byte-identical); cleared on server close.
	// Report which of a workspace's cards still have a RUNNING session, so the tick heartbeats their leases (a
	// slow-but-alive local worker emits sparse summaries; without this its lease would age out to a spurious reclaim).
	const liveTaskIdsForWorkspace = (workspaceId: string): readonly string[] =>
		(nkleinTaskSessionServiceByWorkspaceId.get(workspaceId)?.listSummaries() ?? [])
			.filter((summary) => summary.state === "running")
			.map((summary) => summary.taskId);
	const durableTickTimer: ReturnType<typeof setInterval> | null = durableSchedulerEnabled
		? setInterval(() => {
				void durableRunWiring?.tickAll(liveTaskIdsForWorkspace);
			}, DURABLE_RUN_TICK_INTERVAL_MS)
		: null;
	const autoStartDecompositionRootTasks = async (
		scope: RuntimeTrpcWorkspaceScope,
		event: NKleinDecompositionAppliedEvent,
	): Promise<void> => {
		// C3: a decompose is a run start — build the durable run first so it drives the roots (no-op when the flag is off,
		// in which case `autoStartTaskIds` starts them exactly as before).
		await ensureDurableRunForScope(scope);
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
			// #25 (run27, maxConcurrent=1): a root card deferred on the CONCURRENCY limit at decompose time (the
			// seed session held the only slot) was only retried "on the next completion" — but with one slot no
			// other card ever completes, so the whole cascade stranded 90s after decompose. The seed's completion
			// IS the slot release: sweep the deferred set + startable cards now, not just the queued-start queue.
			if (service) {
				retryWaitingCardsAfterTerminal(scope, service, sourceTaskId);
			}
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
			// §5.AB fitness store: fold this terminal outcome into its (model × role × difficulty) cell (best-effort,
			// serialized write). Returns null + skips for synthetic / non-terminal / model-less sessions.
			const fitnessRecord = deriveTaskFitnessRecord({ summary, card });
			if (fitnessRecord) {
				await recordTaskFitnessOutcome(fitnessRecord.key, fitnessRecord.outcome).catch(() => {});
				// §5.AA ModelBehaviorProfile: also fold the coarse terminal outcome into the model's cross-session
				// reliability profile (successRate + retry budget). Append-only ⇒ concurrency-safe. Best-effort.
				await persistModelBehaviorOutcome(fitnessRecord.key.modelKey, {
					kind: fitnessRecord.outcome.success ? "success" : "other_failure",
				}).catch(() => {});
			}
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
	/**
	 * Surface a plan-gate FAILURE on the board (§5.0.5): move the plan's SOURCE card (or, when it is gone, the
	 * plan's first member) into the Review lane with a parked review note carrying the command, exit code and
	 * output head — so the operator sees the plan-level breakage where they already look, instead of a log line.
	 */
	const surfacePlanIntegrationGateFailure = async (
		scope: RuntimeTrpcWorkspaceScope,
		planSlug: string,
		failure: { command: string; exitCode: number | null; outputHead: string },
	): Promise<void> => {
		let surfacedTaskId: string | null = null;
		await retryWorkspaceStateLock(() =>
			mutateWorkspaceState(scope.workspacePath, (latestState) => {
				const surfaceTaskId = resolvePlanFailureSurfaceCardId(latestState.board, planSlug);
				const surfaceCard = latestState.board.columns
					.flatMap((column) => column.cards)
					.find((card) => card.id === surfaceTaskId);
				if (!surfaceTaskId || !surfaceCard) {
					return { board: latestState.board, save: false, value: null };
				}
				surfacedTaskId = surfaceTaskId;
				const review: RuntimeCardReview = {
					status: "parked",
					round: surfaceCard.review?.round ?? 0,
					history: surfaceCard.review?.history ?? [],
					lastVerdict: "request_changes",
					lastSummary:
						`Plan-level integration gate FAILED for plan "${planSlug}": \`${failure.command}\` exited ` +
						`${failure.exitCode ?? "?"} on the fully-merged tree.`,
					lastFeedback: failure.outputHead || null,
					lastInsight: null,
					signOff: null,
					parkedReason:
						"Plan integration gate failed — every card passed in isolation but the merged tree does not. " +
						"Operator repair owed (v1 opens no repair cards; the re-decompose rung will own that).",
					updatedAt: Date.now(),
				};
				return {
					board: applyCardReviewToBoard(latestState.board, surfaceTaskId, review, "review"),
					value: null,
				};
			}),
		);
		if (surfacedTaskId) {
			deps.warn(
				`Plan integration gate FAILED for plan "${planSlug}" (exit ${failure.exitCode ?? "?"}): surfaced on card ${surfacedTaskId} in Review.`,
			);
		} else {
			deps.warn(
				`Plan integration gate FAILED for plan "${planSlug}" (exit ${failure.exitCode ?? "?"}), but no source/member card remains on the board to surface it on.`,
			);
		}
	};
	/**
	 * Plan-level integration gate (todo §5.0.5 — decision 2026-07-02: "YES, gate the plan"). When the LAST
	 * non-terminal card of a decomposition completes, run the plan's project-level acceptance command against the
	 * fully-MERGED tree. Fire-and-forget from the completion path: the (minutes-long) check must not delay
	 * releasing dependents/queued starts. No merge-mutex is needed — the sandbox acceptance CLONES the host repo
	 * (at `baseRef: "HEAD"` = the merged tree, since the synthetic `plan::<slug>` id has no result branch) into
	 * its own `plan--<slug>--acceptance` workspace (`normalizeTaskIdForSandboxPath` maps `::` to `--`), so it
	 * never touches host git state and never collides with a live worker's sandbox.
	 */
	const runPlanIntegrationGateForCompletion = (
		scope: RuntimeTrpcWorkspaceScope,
		service: NKleinTaskSessionService,
		completedTaskId: string,
		board: RuntimeBoardData,
	): void => {
		for (const planSlug of findJustCompletedPlans({ board, completedTaskId })) {
			const gateKey = `${scope.workspaceId}:${planSlug}`;
			if (completedPlanGateRunKeys.has(gateKey)) {
				continue;
			}
			completedPlanGateRunKeys.add(gateKey);
			void (async () => {
				const command = resolvePlanAcceptanceCommand({ board, planSlug });
				if (!command) {
					deps.warn(
						`Plan integration gate skipped for plan "${planSlug}": no member card carries an acceptance command.`,
					);
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Plan integration gate skipped for plan "${planSlug}": no acceptance command.`,
						workspacePath: scope.workspacePath,
						metadata: { category: "plan_integration_gate", planSlug, verdict: "skipped" },
					});
					return;
				}
				deps.warn(`Plan integration gate for plan "${planSlug}": running \`${command}\` on the merged tree.`);
				const acceptance = await service.verifyTaskAcceptanceInSandbox({
					taskId: `plan::${planSlug}`,
					projectRepoPath: scope.workspacePath,
					baseRef: "HEAD",
					taskPrompt: `Acceptance check: ${command}`,
					timeoutMs: PLAN_GATE_TIMEOUT_MS,
				});
				if (acceptance.passed === true) {
					deps.warn(`Plan integration gate PASSED for plan "${planSlug}": ${command}`);
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Plan integration gate passed for plan "${planSlug}".`,
						workspacePath: scope.workspacePath,
						metadata: { category: "plan_integration_gate", planSlug, command, verdict: "pass" },
					});
					return;
				}
				const outputHead = acceptance.output.slice(0, PLAN_GATE_OUTPUT_HEAD_BUDGET);
				recordSelfObservation({
					signal: "verification_failed",
					severity: "error",
					message: `Plan integration gate FAILED for plan "${planSlug}": ${command}`,
					workspacePath: scope.workspacePath,
					metadata: {
						category: "plan_integration_gate",
						planSlug,
						command,
						verdict: "fail",
						exitCode: acceptance.exitCode,
						outputHead,
					},
				});
				await surfacePlanIntegrationGateFailure(scope, planSlug, {
					command,
					exitCode: acceptance.exitCode,
					outputHead,
				});
			})().catch((error) => {
				// An ERRORED gate (sandbox down, lock storm) is not a pass — keep it loud, but don't park cards on
				// infrastructure noise: only a real FAIL of the command moves the source card to Review.
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Plan integration gate errored for plan "${planSlug}" (result unknown — NOT a pass): ${message}`);
				recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `Plan integration gate unavailable for plan "${planSlug}": ${message}`,
					workspacePath: scope.workspacePath,
					metadata: { category: "plan_integration_gate", planSlug, verdict: "unavailable" },
				});
			});
		}
	};
	const finalizeHeadlessAutoReviewTask = (
		scope: RuntimeTrpcWorkspaceScope,
		service: NKleinTaskSessionService,
		taskId: string,
	): void => {
		const inFlightKey = `${scope.workspaceId}:${taskId}`;
		if (autoReviewFinalizationInFlightTaskIds.has(inFlightKey)) {
			// Remember the request instead of dropping it — the in-flight finalization re-runs it on completion
			// (a fast re-drive round can finalize again while the previous round is still persisting its bounce).
			autoReviewFinalizationRerunRequestedKeys.add(inFlightKey);
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
					// §5.AW arbitration: when the reviewer compared candidates A/B and preferred the SPECULATIVE
					// one, every delivery step below (acceptance evidence, protected-path scan, the merge itself)
					// must target the ::spec result branch while all board bookkeeping stays on the card id. The
					// in-process reviewOutcome.preferred is authoritative; the persisted review.preferredCandidate
					// is the DURABLE fallback so a restart between the verdict and this delivery still ships the
					// winner (the persistence is written by the review orchestrator's onDeliver).
					const persistedPreferred = reviewState.board.columns
						.flatMap((column) => column.cards)
						.find((c) => c.id === taskId)?.review?.preferredCandidate;
					let preferredSpeculative =
						reviewOutcome.type === "delivered" &&
						(reviewOutcome.preferred ?? persistedPreferred ?? null) === "speculative";
					let deliveredBranchTaskId = preferredSpeculative ? `${taskId}::spec` : taskId;
					if (reviewOutcome.type === "delivered" && (reviewOutcome.preferred ?? null) !== null) {
						recordSelfObservation({
							signal: "custom",
							severity: "info",
							message: `Best-of-N arbitration for ${taskId}: reviewer preferred the ${reviewOutcome.preferred} candidate.`,
							taskId,
							workspacePath: scope.workspacePath,
							metadata: { category: "speculative_arbitration", preferred: reviewOutcome.preferred ?? "primary" },
						});
					}
					if (
						reviewOutcome.type === "bounced" ||
						reviewOutcome.type === "parked" ||
						reviewOutcome.type === "escalated"
					) {
						return;
					}
					// FAIL-CLOSED delivery evidence (audit 2026-07-02 W0.1 — supersedes the prior fail-open hardcode).
					// See deriveDeliveryGateEvidence for the posture: only a delivered review sign-off approves, and
					// only a FRESH present-and-passed acceptance run at this seam counts as tests passing.
					const deliveryCard = reviewState.board.columns
						.flatMap((column) => column.cards)
						.find((c) => c.id === taskId);
					const runAcceptance = async (resultBranchTaskId?: string) => {
						if (!deliveryCard) {
							return null;
						}
						try {
							return await service.verifyTaskAcceptanceInSandbox({
								taskId,
								projectRepoPath: scope.workspacePath,
								baseRef: deliveryCard.baseRef,
								taskPrompt: deliveryCard.prompt,
								...(resultBranchTaskId ? { resultBranchTaskId } : {}),
							});
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							deps.warn(`Acceptance re-check unavailable for ${taskId} (fail-closed): ${message}`);
							return null;
						}
					};
					let acceptance = await runAcceptance(preferredSpeculative ? deliveredBranchTaskId : undefined);
					// #39 (runs 32/35/36/38 — the scope-vs-acceptance trap): when the card's acceptance command
					// fails on the DELIVERED tree, sample it once against the BASE tree. An identical baseline
					// failure means the breakage predates this card (broken test infra, a sibling's debt) — the
					// worker can NEVER fix it inside its declared file scope, so holding/bouncing on it just
					// traps the card (blocked out-of-scope writes → 3 strikes → abandoned, seen in four runs).
					// WAIVE tests for this delivery: the reviewer's judgment alone gates (run19's base-red lesson
					// completed). A failure that is NOT present at baseline stays the worker's to fix.
					if (deliveryCard && acceptance?.present === true && acceptance.passed === false) {
						const baseline = await (async () => {
							try {
								return await service.verifyTaskAcceptanceInSandbox({
									taskId,
									projectRepoPath: scope.workspacePath,
									baseRef: deliveryCard.baseRef,
									taskPrompt: deliveryCard.prompt,
									useBaseTree: true,
								});
							} catch {
								return null;
							}
						})();
						if (baseline?.present === true && baseline.passed === false) {
							recordSelfObservation({
								signal: "custom",
								severity: "warning",
								message: `Acceptance waived for ${taskId}: "${acceptance.command ?? "?"}" fails identically on the BASE tree (exit ${baseline.exitCode ?? "?"}) — the breakage predates this card; the review verdict alone gates this delivery.`,
								taskId,
								workspacePath: scope.workspacePath,
								metadata: {
									category: "acceptance_baseline_waiver",
									command: acceptance.command ?? null,
									resultExit: String(acceptance.exitCode ?? ""),
									baselineExit: String(baseline.exitCode ?? ""),
								},
							});
							deps.warn(
								`Acceptance for ${taskId} fails on the base tree too — waived (pre-existing breakage); review verdict gates delivery.`,
							);
							acceptance = { ...acceptance, passed: true };
						}
					}
					// §5.AW (adversarial finding): a preferred-but-failing SPECULATIVE tree must not poison the
					// primary's re-drive rung with an alien failure. Fall back to the PRIMARY candidate: if its
					// tree passes acceptance, deliver it instead; if both fail, the hold/#28 rung below reasons
					// about the primary tree (the card's own worker owns it).
					if (preferredSpeculative && acceptance && !(acceptance.present === true && acceptance.passed === true)) {
						const primaryAcceptance = await runAcceptance(undefined);
						const primaryPasses = primaryAcceptance?.present === true && primaryAcceptance.passed === true;
						recordSelfObservation({
							signal: "custom",
							severity: "info",
							message: `Best-of-N: the preferred speculative candidate for ${taskId} failed acceptance — ${
								primaryPasses
									? "delivering the primary candidate instead"
									: "falling back to the primary tree for the hold/re-drive rungs"
							}.`,
							taskId,
							workspacePath: scope.workspacePath,
							metadata: { category: "speculative_arbitration_fallback", primaryPasses: String(primaryPasses) },
						});
						preferredSpeculative = false;
						deliveredBranchTaskId = taskId;
						acceptance = primaryAcceptance;
					}
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
							const scopeNote =
								Array.isArray(deliveryCard?.filesLikelyTouched) && deliveryCard.filesLikelyTouched.length > 0
									? ` This card's declared file scope (writes outside it are blocked): ${deliveryCard.filesLikelyTouched.join(", ")}.`
									: "";
							await service
								.sendTaskSessionInput(
									taskId,
									`Your previous run ended with NO file changes captured — the task is NOT done. Complete the task now: make the required code changes, keep tool use focused (avoid re-reading files you have already seen), and finish with the acceptance check passing.${scopeNote}`,
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
						// #33 v2: final hold — stop the session so the held card frees its slot (see delivery-hold).
						await service.stopTaskSession(taskId).catch(() => null);
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
							toRef: createTaskResultBranchRef(deliveredBranchTaskId),
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
							// #28: the reviewer APPROVED but the fresh acceptance failed ⇒ the worker never learns why the
							// card is stuck. Re-drive ONCE with the acceptance failure (mirrors the W4.2a empty-patch
							// re-drive); a repeat failure leaves the hold for the operator as before.
							if (evidence.reviewApproved && !evidence.testsPassed && acceptance) {
								const acceptanceRedrives = acceptanceFailureRedriveAttemptsByTaskKey.get(inFlightKey) ?? 0;
								if (acceptanceRedrives < 1) {
									acceptanceFailureRedriveAttemptsByTaskKey.set(inFlightKey, acceptanceRedrives + 1);
									deps.warn(
										`Approved-but-acceptance-failed card ${taskId}: re-driving the worker once with the failing acceptance output.`,
									);
									await mutateWorkspaceState(scope.workspacePath, (latestState) => {
										const movement = moveTaskToColumn(latestState.board, taskId, "in_progress");
										return { board: movement.board, save: movement.moved, value: null };
									});
									const failureHead = (acceptance.output ?? "").slice(0, 700);
									await service
										.sendTaskSessionInput(
											taskId,
											`The reviewer APPROVED your work, but the acceptance check still FAILS — the card cannot merge until it passes. Command: ${acceptance.command ?? "(unknown)"} (exit ${acceptance.exitCode ?? "?"}).\nFailing output (head):\n${failureHead}\n\nFix the failure and finish with the acceptance check passing. Stay within the card's declared file scope.`,
											"act",
										)
										.catch((error) => {
											const message = error instanceof Error ? error.message : String(error);
											deps.warn(
												`Acceptance-failure re-drive of ${taskId} failed (${message}); leaving held in Review.`,
											);
										});
									return;
								}
							}
							deps.warn(
								`Delivery held for ${taskId} (delivery tier → ${deliveryDecision.action}): ${deliveryDecision.reason} Left in Review.`,
							);
							// #33 (run34 live, v2 after run35): a HELD card must not keep owning a concurrency slot —
							// an abandoned reviewer (no-verdict hold) on a 1-wide rail starved every deferred card
							// forever. v1 used cancelTaskTurn, which no-ops unless the session is RUNNING — but a
							// held session sits in awaiting_review (which the concurrency gate counts as active).
							// stopTaskSession is the proven slot-freeing call (delivery uses it after every merge);
							// the card stays in Review as the operator surface and a re-drive restarts cleanly.
							await service.stopTaskSession(taskId).catch(() => null);
							return;
						}
						// Serialized per workspace (see runWorkspaceMergeSerialized): concurrent finalizations must
						// never interleave merge attempts on the same host repo.
						const mergeResult = await runWorkspaceMergeSerialized(scope.workspaceId, () =>
							mergeTaskWorktreesInDependencyOrder({
								repoPath: scope.workspacePath,
								board: reviewState.board,
								columns: ["review"],
								taskIds: [taskId],
								...(preferredSpeculative
									? { resultBranchTaskIdOverrides: { [taskId]: deliveredBranchTaskId } }
									: {}),
								// §5.AK Phase B: on a result-branch merge conflict, run the bounded `::merge` resolution
								// session instead of hard-aborting. Wired UNCONDITIONALLY — conflicts can happen even under
								// "serialize" (coarse-path edits), and the agent is strictly better than abort in all cases:
								// every non-"resolved" outcome maps to null, which keeps the abort-and-surface fail-safe
								// byte-identical to before.
								resolveConflict: async ({ taskId: conflictTaskId, headCommit, conflictedPaths }) => {
									try {
										const session = await service.runMergeResolutionSession({
											taskId: conflictTaskId,
											projectRepoPath: scope.workspacePath,
											mainRef: deliveryCard?.baseRef ?? "HEAD",
											resultCommit: headCommit,
											conflictedPaths,
										});
										if (session?.outcome === "resolved") {
											return { resolvedFiles: session.resolvedFiles };
										}
										if (session?.outcome === "cannot_resolve") {
											deps.warn(
												`Merge-resolution agent could not resolve ${conflictTaskId} (falling back to abort): ${session.reason}`,
											);
										}
										return null;
									} catch (error) {
										const message = error instanceof Error ? error.message : String(error);
										deps.warn(
											`Merge-resolution session errored for ${conflictTaskId} (falling back to abort): ${message}`,
										);
										return null;
									}
								},
							}),
						);
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
						// §5.AW (adversarial finding): prune the LOSING candidate after an arbitration merge — a
						// rejected branch left mergeable can be silently delivered by a later merge seam. The ::spec
						// branch always goes (its content is merged or rejected); a spec-preferred delivery also
						// deletes the rejected primary branch so no seam resolves it again.
						if (reviewOutcome.type === "delivered" && (reviewOutcome.preferred ?? null) !== null) {
							await deleteTaskResultBranch({ repoPath: scope.workspacePath, taskId: `${taskId}::spec` }).catch(
								() => false,
							);
							if (preferredSpeculative) {
								await deleteTaskResultBranch({ repoPath: scope.workspacePath, taskId }).catch(() => false);
							}
						}
					}
					let readyTaskIds: string[] = [];
					let completedBoard: RuntimeBoardData | null = null;
					await mutateWorkspaceState(scope.workspacePath, (latestState) => {
						const completed = completeTaskAndGetReadyLinkedTaskIds(latestState.board, taskId);
						readyTaskIds = completed.readyTaskIds;
						completedBoard = completed.board;
						return {
							board: completed.board,
							save: completed.moved,
							value: null,
						};
					});
					// §5.0.5 plan-level integration gate: if this delivery completed a decomposition's LAST card, run
					// the plan's project-level acceptance on the fully-merged tree (fire-and-forget + per-slug debounced
					// inside — must not delay releasing dependents below).
					if (completedBoard) {
						runPlanIntegrationGateForCompletion(scope, service, taskId, completedBoard);
					}
					await service.stopTaskSession(taskId).catch(() => null);
					drainQueuedTaskStarts(scope, { force: true });
					// §5.AA/§5.AI: retry cards deferred for file-overlap (this completion may have released the file lock)
					// alongside the dependency-newly-ready ones, so an overlap-skipped card can no longer orphan. The just-
					// completed task is excluded; `autoStartTaskIds` re-checks overlap and re-defers any still-conflicting card.
					const deferredOverlapTaskIds = [
						...(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId) ?? []),
					].filter((deferredTaskId) => deferredTaskId !== taskId);
					// READY-SWEEP (runs 12/14/15): also attempt EVERY dependency-free waiting card, not just the ones
					// this completion released — a card can become startable outside the release/defer paths (edge
					// reorientation, missed plan roots) and previously fell through every crack. autoStartTaskIds
					// re-checks lane/overlap/concurrency per card, so the superset is safe.
					const sweepState = await loadWorkspaceState(scope.workspacePath).catch(() => null);
					const activeSessionTaskIds = new Set(
						service
							.listSummaries()
							.filter(
								(summary) =>
									summary.state === "running" ||
									summary.state === "queued" ||
									summary.state === "awaiting_review",
							)
							.map((summary) => summary.taskId),
					);
					const sweepTaskIds = sweepState
						? listStartableUnstartedTaskIds(sweepState.board, activeSessionTaskIds)
						: [];
					// Under a durable run the controller owns ready/sweep (dependency_unblocked → lease); only the
					// deferred set is ours to restart here (startRescueCandidates). Off durable this is the same union.
					await startRescueCandidates(scope, deferredOverlapTaskIds, [
						...readyTaskIds,
						...deferredOverlapTaskIds,
						...sweepTaskIds,
					]);
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Could not finalize auto-review task ${taskId} for ${scope.workspacePath}: ${message}`);
			} finally {
				autoReviewFinalizationInFlightTaskIds.delete(inFlightKey);
				if (autoReviewFinalizationRerunRequestedKeys.delete(inFlightKey)) {
					finalizeHeadlessAutoReviewTask(scope, service, taskId);
				}
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
		if (queuedStartDrainInFlightByWorkspaceId.has(scope.workspaceId)) {
			// Remember the request instead of dropping it (and DON'T touch the pending timer — it stays as a
			// backstop): the in-flight drain re-runs it on completion. Force-ness is sticky across coalesced asks.
			const pending = queuedStartDrainRerunRequestByWorkspaceId.get(scope.workspaceId);
			queuedStartDrainRerunRequestByWorkspaceId.set(scope.workspaceId, {
				force: Boolean(options?.force) || Boolean(pending?.force),
			});
			return;
		}
		const scheduledDrain = queuedStartDrainTimersByWorkspaceId.get(scope.workspaceId);
		if (scheduledDrain) {
			clearTimeout(scheduledDrain.timer);
			queuedStartDrainTimersByWorkspaceId.delete(scope.workspaceId);
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
					const rerun = queuedStartDrainRerunRequestByWorkspaceId.get(scope.workspaceId);
					if (rerun) {
						queuedStartDrainRerunRequestByWorkspaceId.delete(scope.workspaceId);
						drainQueuedTaskStarts(scope, { force: rerun.force });
					}
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
		const globalAgentCapabilities = capabilitiesForTier(
			runtimeConfig.effectiveAgentRulesets?.capability.globalPreset ?? DEFAULT_AGENT_CAPABILITY_TIER,
		);
		const sandboxNetworkPolicy = globalAgentCapabilities.network;
		// §5.L: the resolved capability ruleset gates the agent's web-research tool + MCP access (default fully_open).
		const agentToolAccess = resolveAgentToolAccess(globalAgentCapabilities);
		const agentWebResearchAllowed = agentToolAccess.webResearch;
		const agentMcpAccess = agentToolAccess.mcp;
		let service = nkleinTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
		if (!service) {
			service = createInMemoryNKleinTaskSessionService({
				watcherRegistry: nkleinWatcherRegistry,
				swarmGuardrails: runtimeConfig.swarmGuardrails,
				knowsTodayEnabled: runtimeConfig.knowsTodayEnabled,
				sandboxMcpServersEnabled: runtimeConfig.sandboxMcpServersEnabled,
				retrievalEgressEnabled: runtimeConfig.retrievalEgressEnabled,
				modelStatsTrackingLevel: runtimeConfig.modelStatsTrackingLevel,
				retrievalSearchBackendUrl: runtimeConfig.retrievalSearchBackendUrl,
				agentWebResearchAllowed,
				agentMcpAccess,
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
			// §5.0.5 W2.2 (startup crash-recovery): this block creates the service exactly once per workspace. A crash
			// (which skips the shutdown-coordinator's parking) leaves cards in the in_progress lane with NO live session
			// after restart — a "lying board". The fresh service has an empty summary set, so any in_progress card is
			// orphaned; park those into Review (mirroring the clean-shutdown behavior) so the board is honest + the work
			// resumable (the #21 salvage rebinds any that kept a result branch). Best-effort; never blocks tracking.
			try {
				const liveTaskIds = new Set(
					trackedService
						.listSummaries()
						.filter(
							(summary) =>
								summary.state === "running" ||
								summary.state === "queued" ||
								summary.state === "awaiting_review",
						)
						.map((summary) => summary.taskId),
				);
				await mutateWorkspaceState(scope.workspacePath, (latestState) => {
					const reconciled = reconcileOrphanedInProgressCards({
						board: latestState.board,
						liveSessionTaskIds: liveTaskIds,
					});
					if (reconciled.parkedTaskIds.length > 0) {
						deps.warn(
							`Startup crash-recovery: parked ${reconciled.parkedTaskIds.length} orphaned in-progress card(s) into Review (sessions lost on restart): ${reconciled.parkedTaskIds.join(", ")}.`,
						);
					}
					return { board: reconciled.board, save: reconciled.parkedTaskIds.length > 0, value: null };
				});
			} catch (error) {
				deps.warn(
					`Startup orphan reconcile failed for ${scope.workspacePath}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			deps.runtimeStateHub.trackNKleinTaskSessionService(scope.workspaceId, scope.workspacePath, service);
			// C3 (§5.AF): remember the scope so the durable controller's `startCard` port can re-enter the start path from a
			// timer/summary callback, and BOOT-RESUME any durable run this workspace had in flight when the process died.
			// Gated on the flag so the default path adds NO residual entry to the map (review finding #2).
			if (durableSchedulerEnabled) {
				scopeByWorkspaceId.set(scope.workspaceId, scope);
				// resumeOnly: at service creation the board is only the decompose seed — only RESUME a run that a prior
				// process left in flight (a persisted ledger); the FRESH run is built at decompose-apply (full DAG known).
				await ensureDurableRunForScope(scope, { resumeOnly: true });
			}
			const unsubscribeQueueDrain = service.onSummary((summary) => {
				recordNKleinKnowledgeToolUsage(scope, summary);
				recordNKleinModelPerformance(scope, summary);
				if (isReviewableNKleinSummary(summary)) {
					finalizeHeadlessAutoReviewTask(scope, trackedService, summary.taskId);
				}
				if (summary.state !== "queued" && summary.state !== "running") {
					drainQueuedTaskStarts(scope, { force: true });
				}
				if (summary.state === "interrupted" || summary.state === "failed") {
					// A dying card fires no completion — retry the waiting cards it can no longer unblock (run16),
					// and give the dead card ITSELF one fresh attempt when it left no reviewable work (#24).
					retryWaitingCardsAfterTerminal(scope, trackedService, summary.taskId);
				}
				// C3: route the state change into the workspace's durable run (report completion → tick → cascade, or
				// heartbeat a live lease). No-op when the flag is off. Thread the failure reason (§5.AF #7): a failed/
				// interrupted session stamps `warningMessage = errorMessage` (task-session-service ~L1194), and the reaction
				// mapper only consults errorText for failed/interrupted (a running heartbeat / awaiting_review success ignore
				// it), so a TRANSIENT network blip (body/headers timeout, connection reset, 5xx) now classifies as
				// `transient_retry` — the job retries instead of parking — via `isTransientNetworkError`. A non-network
				// failure (no matching pattern, or a null message) stays a permanent fail, unchanged.
				void durableRunWiring?.observeSummary(
					scope.workspaceId,
					summary.taskId,
					summary.state,
					summary.warningMessage ?? null,
				);
			});
			queuedStartDrainUnsubscribeByWorkspaceId.set(scope.workspaceId, unsubscribeQueueDrain);
			reconcileCapturedHeadlessAutoReviewTasks(scope, trackedService);
			// #29: the board-liveness watchdog — self-healing runtime stall detection.
			boardLivenessWatchdogByWorkspaceId.set(
				scope.workspaceId,
				setInterval(() => {
					void (async () => {
						try {
							const anySessionAlive = trackedService.listSummaries().some(
								(summary) =>
									// §5.AW: a speculative mirror is auxiliary by definition — it must never
									// mask a frozen board (real cards waiting while only a ::spec runs).
									!summary.taskId.endsWith("::spec") &&
									(summary.state === "running" ||
										summary.state === "queued" ||
										summary.state === "paused" ||
										summary.state === "awaiting_review"),
							);
							if (anySessionAlive) {
								return;
							}
							if ((await readSwarmStopSignal(scope.workspacePath)) !== null) {
								return; // swarm stopped by the operator — idle is intentional, not a stall
							}
							const state = await retryWorkspaceStateLock(() => loadWorkspaceState(scope.workspacePath));
							// §5.BD rescue: an interrupted worker card still IN PROGRESS with a result branch is the
							// salvage the capture-path rebounds sometimes miss (docker-409 stop-path capture errors,
							// runs 36/38) — rebind it into review so the machinery judges the work. Scope this to the
							// IN_PROGRESS lane ONLY: a card already in review has been (or is being) judged, and a
							// HELD card there has an interrupted session by design (#33 stops held sessions to free
							// the slot) — re-rescuing it would loop hold → stop → rebind → re-review forever.
							const inProgressTaskIds = new Set<string>();
							for (const column of state.board.columns) {
								if (column.id !== "in_progress") {
									continue;
								}
								for (const card of column.cards) {
									inProgressTaskIds.add(card.id);
								}
							}
							for (const summary of trackedService.listSummaries()) {
								if (summary.state !== "interrupted" || !inProgressTaskIds.has(summary.taskId)) {
									continue;
								}
								const rescued = await trackedService
									.rescueInterruptedTaskWithPriorWork(summary.taskId)
									.catch(() => false);
								if (rescued) {
									deps.warn(
										`Board-liveness watchdog: rebound interrupted card ${summary.taskId} (prior result branch exists) into review.`,
									);
								}
							}
							const startable = listStartableUnstartedTaskIds(state.board, new Set<string>());
							// BOTH deferral kinds are actionable: overlap-deferred cards AND a pending
							// concurrency-deferral retry (run36: only the overlap set was checked).
							const deferredCount =
								(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.size ?? 0) +
								(deferredRetryTimerByWorkspaceId.has(scope.workspaceId) ? 1 : 0);
							if (startable.length === 0 && deferredCount === 0) {
								return; // legitimately idle (everything terminal or held for the operator)
							}
							deps.warn(
								`Board-liveness watchdog: no session alive but ${startable.length} startable + ${deferredCount} deferred card(s) exist for ${scope.workspacePath} — sweeping (frozen-board self-heal).`,
							);
							recordSelfObservation({
								signal: "custom",
								severity: "warning",
								message: `Board-liveness watchdog fired: frozen board self-heal (startable=${startable.length}, deferred=${deferredCount}).`,
								workspacePath: scope.workspacePath,
								metadata: {
									category: "board_liveness_watchdog",
									startable: startable.length,
									deferred: deferredCount,
								},
							});
							retryWaitingCardsAfterTerminal(scope, trackedService);
						} catch (error) {
							// The watchdog must never crash the runtime — but its failures must be VISIBLE (#35:
							// an empty catch here silently disabled the frozen-board rescue). First error per
							// workspace is recorded; later ticks retry regardless.
							if (!watchdogErrorReportedWorkspaceIds.has(scope.workspaceId)) {
								watchdogErrorReportedWorkspaceIds.add(scope.workspaceId);
								recordSelfObservation({
									signal: "runtime_error",
									severity: "warning",
									message: `Board-liveness watchdog tick failed (rescue skipped this tick): ${
										error instanceof Error ? error.message : String(error)
									}`,
									workspacePath: scope.workspacePath,
									metadata: { category: "board_liveness_watchdog_error" },
								});
							}
						}
					})();
				}, BOARD_LIVENESS_TICK_MS),
			);
			speculativeConfigByWorkspaceId.set(scope.workspaceId, {
				enabled: runtimeConfig.speculativeBestOfNEnabled,
				maxConcurrentSpecs: runtimeConfig.speculativeMaxConcurrentSpecs,
				maxSpecsPerRun: runtimeConfig.speculativeMaxSpecsPerRun,
			});
			// §5.AW: the opportunistic mirror tick (see the state maps above for the scheduling rules).
			speculativeMirrorTickByWorkspaceId.set(
				scope.workspaceId,
				setInterval(() => {
					void (async () => {
						try {
							const cfg = speculativeConfigByWorkspaceId.get(scope.workspaceId);
							if (!cfg?.enabled) {
								return;
							}
							const sessions = trackedService.listModelEndpointSessions();
							const busyStates = new Set(["running", "queued"]);
							const runningSpecSessions = sessions.filter(
								(session) => session.taskId.endsWith("::spec") && busyStates.has(session.state),
							);
							// PREEMPTION (adversarial finding): "real work outranks speculation" must also hold for
							// specs ALREADY running — a mirror occupying a per-model slot for its full bound would
							// starve queued/deferred real cards. Whenever real work is waiting, cancel every live
							// spec (the tick bounds preemption latency to one tick).
							const realWorkWaiting =
								taskStartQueue.size(scope.workspaceId) > 0 ||
								(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.size ?? 0) > 0;
							if (realWorkWaiting && runningSpecSessions.length > 0) {
								for (const spec of runningSpecSessions) {
									const primaryTaskId = spec.taskId.slice(0, -"::spec".length);
									deps.warn(
										`Preempting speculative mirror ${spec.taskId}: real card(s) are waiting for capacity.`,
									);
									void trackedService.cancelSpeculativeMirror(primaryTaskId).catch(() => undefined);
								}
								return;
							}
							const runningSpecCount =
								runningSpecSessions.length +
								(speculativeSpecsInFlightByWorkspaceId.get(scope.workspaceId) ?? 0);
							const runningWorkerSessions = sessions.filter(
								(session) =>
									session.state === "running" &&
									!session.taskId.includes("::") &&
									!isHomeAgentSessionId(session.taskId),
							);
							if (runningWorkerSessions.length === 0) {
								return; // cheap early exit before any endpoint probe
							}
							const baseUrl =
								runningWorkerSessions.find((session) => session.endpoint)?.endpoint ??
								"http://127.0.0.1:1234/v1";
							// Descriptor-derived facts (idle set, lineage keys) are only valid for sessions on the SAME
							// endpoint they were fetched from — drop workers on other endpoints this tick.
							const endpointConsistentWorkers = runningWorkerSessions.filter(
								(session) => (session.endpoint ?? baseUrl) === baseUrl,
							);
							// Only cards that can actually REACH the A/B arbitration seam (headless auto-review commit
							// flow) are worth mirroring — a plan-mode or manual-review card would burn the spec budget
							// on a candidate no reviewer will ever compare.
							const boardStateForTick = await loadWorkspaceState(scope.workspacePath);
							const cardById = new Map(
								boardStateForTick.board.columns.flatMap((column) =>
									column.cards.map((card) => [card.id, card]),
								),
							);
							const arbitrationEligibleWorkers = endpointConsistentWorkers.filter((session) => {
								const card = cardById.get(session.taskId);
								return (
									card !== undefined &&
									card.startInPlanMode !== true &&
									card.autoReviewEnabled === true &&
									(card.autoReviewMode ?? "commit") === "commit"
								);
							});
							const descriptors = await fetchLoadedModelDescriptors(baseUrl).catch(
								() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>,
							);
							if (descriptors.length === 0) {
								return;
							}
							// Sessions carry the SERVED alias; lineage needs the REAL model key. real→served is built from
							// the IDLE instances below (an idle model key must resolve to its IDLE served instance — a
							// both-ways map could route the mirror onto a busy duplicate instance).
							const servedIdByRealKey = new Map<string, string>();
							const toRealKey = (servedOrReal: string): string =>
								descriptors.find(
									(descriptor) =>
										descriptor.runtimeId === servedOrReal || descriptor.modelKey === servedOrReal,
								)?.modelKey ?? servedOrReal;
							const busyModelIds = new Set(
								sessions.filter((session) => busyStates.has(session.state)).map((session) => session.modelId),
							);
							const idleDescriptors = descriptors.filter(
								(descriptor) =>
									!descriptor.isEmbedding &&
									!busyModelIds.has(descriptor.runtimeId) &&
									!busyModelIds.has(descriptor.modelKey),
							);
							for (const descriptor of idleDescriptors) {
								if (!servedIdByRealKey.has(descriptor.modelKey)) {
									servedIdByRealKey.set(descriptor.modelKey, descriptor.runtimeId);
								}
							}
							const idleModels = idleDescriptors.map((descriptor) => ({ modelId: descriptor.modelKey }));
							const mirroredTaskIds =
								speculativeMirroredTaskIdsByWorkspaceId.get(scope.workspaceId) ?? new Set<string>();
							speculativeMirroredTaskIdsByWorkspaceId.set(scope.workspaceId, mirroredTaskIds);
							const decision = decideSpeculativeMirror({
								enabled: cfg.enabled,
								maxConcurrentSpecs: cfg.maxConcurrentSpecs,
								maxSpecsPerRun: cfg.maxSpecsPerRun,
								runningSpecCount,
								specsStartedThisRun: speculativeSpecsStartedByWorkspaceId.get(scope.workspaceId) ?? 0,
								queuedRealStartCount: taskStartQueue.size(scope.workspaceId),
								deferredRealCardCount: deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.size ?? 0,
								runningWorkers: arbitrationEligibleWorkers.map((session) => ({
									taskId: session.taskId,
									modelId: toRealKey(session.modelId),
									// Router difficulty is not persisted on summaries yet — null sorts last, so the
									// longest-running card wins the tie-break (a decent hardness proxy on a rail).
									difficulty: null,
									startedAt: session.startedAt,
								})),
								idleModels,
								alreadyMirroredTaskIds: mirroredTaskIds,
							});
							if (decision.action !== "mirror") {
								return;
							}
							const card = cardById.get(decision.taskId);
							if (!card) {
								return;
							}
							const mirrorSession = arbitrationEligibleWorkers.find(
								(session) => session.taskId === decision.taskId,
							);
							const servedMirrorId = servedIdByRealKey.get(decision.mirrorModelId) ?? decision.mirrorModelId;
							mirroredTaskIds.add(decision.taskId);
							speculativeSpecsStartedByWorkspaceId.set(
								scope.workspaceId,
								(speculativeSpecsStartedByWorkspaceId.get(scope.workspaceId) ?? 0) + 1,
							);
							const scopeNote =
								Array.isArray(card.filesLikelyTouched) && card.filesLikelyTouched.length > 0
									? `\n\nIMPORTANT — this card's declared file scope (writes OUTSIDE these paths are blocked): ${card.filesLikelyTouched.join(", ")}. Work within it.`
									: "";
							recordSelfObservation({
								signal: "custom",
								severity: "info",
								message: `Speculative mirror started: ${decision.reason}`,
								taskId: decision.taskId,
								workspacePath: scope.workspacePath,
								metadata: {
									category: "speculative_mirror_started",
									mirrorModelId: servedMirrorId,
									workerModelId: decision.workerModelId,
								},
							});
							speculativeSpecsInFlightByWorkspaceId.set(
								scope.workspaceId,
								(speculativeSpecsInFlightByWorkspaceId.get(scope.workspaceId) ?? 0) + 1,
							);
							void trackedService
								.runSpeculativeMirrorSession({
									taskId: decision.taskId,
									projectRepoPath: scope.workspacePath,
									baseRef: card.baseRef ?? "HEAD",
									prompt: `${card.prompt}${scopeNote}`,
									mirror: { providerId: mirrorSession?.providerId ?? "lmstudio", modelId: servedMirrorId },
								})
								.catch(() => undefined)
								.finally(() => {
									speculativeSpecsInFlightByWorkspaceId.set(
										scope.workspaceId,
										Math.max(0, (speculativeSpecsInFlightByWorkspaceId.get(scope.workspaceId) ?? 1) - 1),
									);
								});
						} catch {
							// The mirror tick is strictly opportunistic — it must never crash the runtime.
						}
					})();
				}, SPECULATIVE_MIRROR_TICK_MS),
			);
			// §5.AW: flag-gated opportunistic idle-work sweep. When the swarm is genuinely idle (no running worker,
			// no real work waiting), the ranker picks the highest-value available task — today only `review` (a review-
			// lane card whose event-driven review was missed). Idempotent per workspace so it never re-reviews a card.
			opportunisticIdleWorkTickByWorkspaceId.set(
				scope.workspaceId,
				setInterval(() => {
					void (async () => {
						try {
							if (!isTruthyEnv(process.env.NKLEIN_OPPORTUNISTIC_IDLE_WORK)) {
								return;
							}
							const sessions = trackedService.listModelEndpointSessions();
							const runningWorkerSessions = sessions.filter(
								(session) =>
									session.state === "running" &&
									!session.taskId.includes("::") &&
									!isHomeAgentSessionId(session.taskId),
							);
							const realWorkWaiting =
								taskStartQueue.size(scope.workspaceId) > 0 ||
								(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.size ?? 0) > 0;
							const hasRealQueuedWork = realWorkWaiting || runningWorkerSessions.length > 0;
							const boardState = await loadWorkspaceState(scope.workspacePath);
							const dispatched = idleReviewDispatchedByWorkspaceId.get(scope.workspaceId) ?? new Set<string>();
							const reviewCandidateTaskIds = findReviewCandidateTaskIds(boardState.board, dispatched);
							const decision = decideOpportunisticIdleWork({ hasRealQueuedWork, reviewCandidateTaskIds });
							if (!decision.reviewTaskId) {
								return;
							}
							// Mark dispatched BEFORE the async review so a subsequent tick can never double-dispatch.
							dispatched.add(decision.reviewTaskId);
							idleReviewDispatchedByWorkspaceId.set(scope.workspaceId, dispatched);
							deps.warn(
								`Opportunistic idle review: swarm idle, dispatching a review for ${decision.reviewTaskId}.`,
							);
							void runSecondOpinionReviewForTask({
								workspacePath: scope.workspacePath,
								taskId: decision.reviewTaskId,
								service: trackedService,
								warn: deps.warn,
							}).catch((error) => {
								const message = error instanceof Error ? error.message : String(error);
								deps.warn(`Opportunistic idle review for ${decision.reviewTaskId} errored: ${message}`);
							});
						} catch {
							// Opportunistic — must never crash the runtime.
						}
					})();
				}, OPPORTUNISTIC_IDLE_WORK_TICK_MS),
			);
		} else {
			await service.updateAgentSandboxPoolConfig(sandboxPoolConfig);
			// Re-apply the sandbox Docker --network policy on a live capability-tier change. Without this, a cached
			// service kept its original (looser) egress after the operator tightened isolation — a fail-open
			// Docker-isolation drift (prime directive #2). Every other config field below is already re-applied here.
			await service.setSandboxNetworkPolicy(sandboxNetworkPolicy);
			service.setSwarmGuardrails(runtimeConfig.swarmGuardrails);
			service.setKnowsTodayEnabled(runtimeConfig.knowsTodayEnabled);
			service.setSandboxMcpServersEnabled(runtimeConfig.sandboxMcpServersEnabled);
			service.setRetrievalConfig(runtimeConfig.retrievalEgressEnabled, runtimeConfig.retrievalSearchBackendUrl);
			// §5.L: re-apply the per-role web-research capability gate on a live ruleset change (same drift class as the
			// --network re-apply above — a cached service must not keep looser tool access after the operator tightens it).
			service.setAgentWebResearchAllowed(agentWebResearchAllowed);
			service.setAgentMcpAccess(agentMcpAccess);
			service.setModelStatsTrackingLevel(runtimeConfig.modelStatsTrackingLevel);
			speculativeConfigByWorkspaceId.set(scope.workspaceId, {
				enabled: runtimeConfig.speculativeBestOfNEnabled,
				maxConcurrentSpecs: runtimeConfig.speculativeMaxConcurrentSpecs,
				maxSpecsPerRun: runtimeConfig.speculativeMaxSpecsPerRun,
			});
		}
		return service;
	};
	const disposeNKleinTaskSessionServiceAsync = async (workspaceId: string): Promise<void> => {
		const service = nkleinTaskSessionServiceByWorkspaceId.get(workspaceId);
		if (!service) {
			return;
		}
		nkleinTaskSessionServiceByWorkspaceId.delete(workspaceId);
		// C3 (§5.AF): drop the workspace's durable run + scope entry so a disposed workspace leaves no ghost run the tick
		// timer keeps ticking (review finding #2). No-op when the flag is off.
		durableRunWiring?.dispose(workspaceId);
		scopeByWorkspaceId.delete(workspaceId);
		queuedStartDrainUnsubscribeByWorkspaceId.get(workspaceId)?.();
		queuedStartDrainUnsubscribeByWorkspaceId.delete(workspaceId);
		const drainTimer = queuedStartDrainTimersByWorkspaceId.get(workspaceId);
		if (drainTimer) {
			clearTimeout(drainTimer.timer);
			queuedStartDrainTimersByWorkspaceId.delete(workspaceId);
		}
		const livenessWatchdog = boardLivenessWatchdogByWorkspaceId.get(workspaceId);
		if (livenessWatchdog) {
			clearInterval(livenessWatchdog);
			boardLivenessWatchdogByWorkspaceId.delete(workspaceId);
		}
		const mirrorTick = speculativeMirrorTickByWorkspaceId.get(workspaceId);
		if (mirrorTick) {
			clearInterval(mirrorTick);
			speculativeMirrorTickByWorkspaceId.delete(workspaceId);
		}
		const idleWorkTick = opportunisticIdleWorkTickByWorkspaceId.get(workspaceId);
		if (idleWorkTick) {
			clearInterval(idleWorkTick);
			opportunisticIdleWorkTickByWorkspaceId.delete(workspaceId);
		}
		idleReviewDispatchedByWorkspaceId.delete(workspaceId);
		speculativeConfigByWorkspaceId.delete(workspaceId);
		speculativeSpecsInFlightByWorkspaceId.delete(workspaceId);
		const deferredTimer = deferredRetryTimerByWorkspaceId.get(workspaceId);
		if (deferredTimer) {
			clearTimeout(deferredTimer);
			deferredRetryTimerByWorkspaceId.delete(workspaceId);
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
				// WATCH MODE (user directive 2026-07-02: "user shall not be able to disturb ongoing sweeps/tests"):
				// when the spawning harness sets NKLEIN_WATCH_MODE_MUTATION_TOKEN, every tRPC MUTATION (per the
				// tRPC HTTP spec, mutations are always POST; queries/subscriptions are GET) must carry the token —
				// the harness attaches it to its own orchestration calls, while a browser on the live-board link
				// gets a read-only view: watching is free, mutating without the token is rejected loudly. The
				// motivating incident: an operator accidentally changed a model role mid-run from the served UI.
				const watchModeToken = process.env.NKLEIN_WATCH_MODE_MUTATION_TOKEN?.trim() || null;
				if (watchModeToken && req.method === "POST") {
					const presented = req.headers["x-nklein-mutation-token"];
					if (presented !== watchModeToken) {
						res.writeHead(403, {
							"Content-Type": "application/json; charset=utf-8",
							"Cache-Control": "no-store",
						});
						res.end(
							JSON.stringify({
								error: {
									message:
										"Read-only WATCH MODE: this board is being driven by a test harness — mutations from the browser are disabled so ongoing sweeps aren't disturbed.",
									code: -32603,
									data: { code: "FORBIDDEN", httpStatus: 403 },
								},
							}),
						);
						return;
					}
				}
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
			if (durableTickTimer) {
				clearInterval(durableTickTimer);
			}
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
