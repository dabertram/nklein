import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { setChatAdapterRuntimeFlags } from "../chat/chat-local-llm-adapter";
import {
	createAgentSandboxChatWorkspaceProvider,
	createSandboxWorkspaceReadTools,
	createSandboxWorkspaceWriteTools,
	resolveSandboxWritablePathMounts,
	type SandboxWritablePathMount,
} from "../chat/chat-sandbox-workspace-tools";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../config/runtime-config";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";
import { buildTransitionEvent } from "../core/agent-attempt-ledger";
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
	RuntimeCommandRunResponse,
	RuntimeRunUpdateResponse,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { readPausedTasks } from "../core/card-pause";
import { resolveSessionConcurrencyCaps } from "../core/concurrency-config";
import { decideDeliveryAction, shouldRedriveApprovedButAcceptanceFailed } from "../core/delivery-decision";
import {
	deriveDeliveryGateEvidence,
	regressionDeltaFromAcceptanceRuns,
	shouldHoldEmptyPatchResult,
} from "../core/delivery-evidence";
import { isTruthyEnv } from "../core/env-flag";
import { EVAL_PROMPT_CORPUS } from "../core/eval-prompt-corpus";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { loadLlmfitCatalogSupplement } from "../core/llmfit-catalog-supplement";
import { defaultLlmfitCatalogCachePath } from "../core/llmfit-catalog-update";
import { createDefaultLmsRunner, fetchLmsPsModelsCached, type LmsPsModel } from "../core/lms-ps-json";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { fetchLoadedModelIdsCached } from "../core/lmstudio-loaded-models";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import { registerModelCatalogLlmfitSupplement, registerModelCatalogOverlay } from "../core/model-capability-catalog";
import { defaultModelCatalogOverlayPath, loadModelCatalogOverlay } from "../core/model-catalog-overlay";
import { findActiveSameTaskModelTurn } from "../core/model-turn-admission";
import {
	decideOpportunisticIdleWork,
	findReviewCandidateTaskIds,
	findStalledReviewTaskIds,
	findThinEvalCells,
} from "../core/opportunistic-idle-work";
import { resolveRuntimeSwarmGuardrailsForModelRoles } from "../core/parallel-swarm-guardrails";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeTls,
	isKanbanRemoteHost,
} from "../core/runtime-endpoint";
import { isBusySessionState, isTerminalFailureSessionState } from "../core/session-state-predicates";
import { resolveSpeculativeDeliveryTarget } from "../core/speculative-delivery-target";
import { decideSpeculativeMirror } from "../core/speculative-mirror";
import { reconcileOrphanedInProgressCards } from "../core/startup-orphan-reconcile";
import { readSwarmStopSignal } from "../core/swarm-guardrails";
import {
	isDerivedTaskSessionId,
	isSpeculativeMirrorTaskId,
	primaryTaskIdOfSpeculativeMirror,
} from "../core/synthetic-task-id";
import {
	completeTaskAndGetReadyLinkedTaskIds,
	findBoardCardWithColumn,
	getTaskColumnId,
	moveTaskToColumn,
	STARTED_CARD_ENTRY_LANE,
} from "../core/task-board-mutations";
import { listStartableUnstartedTaskIds } from "../core/task-board-ready-sweep";
import { findActiveTaskLikelyTouchedFileOverlap, getSharedLikelyTouchedPaths } from "../core/task-file-overlap";
import { isReviewableNKleinSummary } from "../core/task-session-guards";
import { planTerminalRedriveEscalation } from "../core/terminal-redrive-escalation";
import { evalDifficultyToFitnessTier, type ModelEvalChatChoice, runModelEval } from "../nklein-agent/model-eval-runner";
import { AgentSandboxManager, resolveAgentSandboxImageName } from "../nklein-agent/nklein-agent-sandbox";
import { configureNKleinAiSdkWarnings } from "../nklein-agent/nklein-ai-sdk-warnings";
import type { NKleinDecompositionAppliedEvent } from "../nklein-agent/nklein-decomposition-tool";
import {
	type NKleinEndpointSessionSnapshot,
	scheduleNKleinEndpointStart,
} from "../nklein-agent/nklein-endpoint-scheduler";
import { hashWorkspacePathForLedger } from "../nklein-agent/nklein-ledger-attempt";
import { buildLmStudioMachineByModelId } from "../nklein-agent/nklein-lmstudio-host-map";
import { handleNKleinMcpOauthCallback } from "../nklein-agent/nklein-mcp-runtime-service";
import { buildNKleinModelRegistryKey, getDefaultNKleinModelRegistry } from "../nklein-agent/nklein-model-registry";
import {
	createInMemoryNKleinTaskSessionService,
	type NKleinModelTurnAdmissionGate,
	type NKleinModelTurnAdmissionRequest,
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
import { appendAgentLedgerEvent, readAgentLedger } from "../state/agent-attempt-ledger-store";
import { appendCardMailboxNote } from "../state/card-mailbox-store";
import { recordMergeHistory } from "../state/merge-history-store";
import {
	defaultRuntimeIdModelKeyMapPath,
	initSharedRuntimeIdModelKeyMap,
} from "../state/runtime-id-model-key-map-store";
import { loadWorkspaceContextById, loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { readFitnessTable, recordTaskFitnessOutcome } from "../telemetry/fitness-table-store";
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
import { acceptancePresentAndFailed } from "./acceptance-waiver-decision";
import {
	buildAgentSandboxPoolConfig,
	buildChatAgentSandboxPoolConfig,
	createCheckingAgentSandboxStatus,
} from "./agent-sandbox-runtime-config";
import { getWebUiDir, normalizeRequestPath, readAsset } from "./assets";
import { decideAutoReviewCardAction, selectHeadlessAutoReviewReconcileCandidates } from "./auto-review-card-decision";
import { createDurableRunWiring, type DurableRunWiring } from "./durable-run-wiring";
import { handleHttpRequest, handleSocketUpgrade } from "./middleware";
import { createPlanIntegrationGateRunner } from "./nklein-plan-integration-gate-runner";
import {
	createRuntimeTerminalTelemetryRecorders,
	createSessionTransitionRecorder,
} from "./nklein-runtime-terminal-telemetry";
import { resolveReviewSandboxResult } from "./review-sandbox-result";
import { getRemoteIp, readRequestBody } from "./runtime-server-http";
import type { RuntimeStateHub } from "./runtime-state-hub";
import { runSecondOpinionReviewForTask } from "./second-opinion-review-runner";
import { shouldRunTerminalRetrySweep } from "./terminal-retry-sweep-policy";
import { readWorkspaceIdFromRequest } from "./workspace-id-from-request";
import type { WorkspaceRegistry } from "./workspace-registry";
import { retryWorkspaceStateLock } from "./workspace-state-lock-retry";

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

// C3 (§5.AF): how often the durable-run reclaim/dispatch timer fires. Long enough not to busy-loop, short enough to
// re-dispatch a reclaimed orphan (30s backoff) promptly. Only armed when NKLEIN_DURABLE_SCHEDULER is set.
const DURABLE_RUN_TICK_INTERVAL_MS = 15_000;

export async function createRuntimeServer(deps: CreateRuntimeServerDependencies): Promise<RuntimeServer> {
	// Silence the external `ai` package's per-call "system messages in the prompt" warning (we pass them by
	// design) and log the rationale once, so it stops flooding the runtime log and burying the useful lines.
	configureNKleinAiSdkWarnings(deps.warn);
	// §5.Y #8: compute remote-mode confinement roots once at startup.
	const isRemoteMode = isKanbanRemoteHost();
	const globalConfig = await loadGlobalRuntimeConfig();
	// §5.BB: seed the chat adapter's runtime flags from the persisted settings (env overrides still compose at read
	// time inside the adapter). Re-applied on every config save via the setActiveRuntimeConfig wrapper below.
	setChatAdapterRuntimeFlags({
		adaptiveTruncationEnabled: globalConfig.chatAdaptiveTruncationEnabled,
		reasoningBudgetEnabled: globalConfig.reasoningBudgetEnabled,
	});
	// §5.AL / decision #1 (2026-07-07): load the user-editable model-catalog overlay so `lookupModelCapability` is
	// data-driven — a user can add or override a model's verdict without a rebuild. Best-effort: a missing file is the
	// normal case; malformed entries are skipped with a logged reason and never block startup.
	const catalogOverlay = await loadModelCatalogOverlay(defaultModelCatalogOverlayPath(homedir()));
	registerModelCatalogOverlay(catalogOverlay.entries);
	for (const overlayError of catalogOverlay.errors) {
		deps.warn(overlayError);
	}
	const llmfitSupplement = await loadLlmfitCatalogSupplement(defaultLlmfitCatalogCachePath(homedir()));
	registerModelCatalogLlmfitSupplement(llmfitSupplement.entries);
	for (const supplementError of llmfitSupplement.errors) {
		deps.warn(supplementError);
	}
	// §5.BG (David 2026-07-07): load the persisted runtimeId→stable-modelKey map so a COLD model still resolves to its
	// stable key (learned from live descriptors on the routing path). Best-effort — a missing/corrupt file re-learns.
	await initSharedRuntimeIdModelKeyMap(defaultRuntimeIdModelKeyMapPath(homedir())).catch(() => {});
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
	const chatSandboxManagerByWorkspaceKey = new Map<string, AgentSandboxManager>();
	const chatSandboxWorkspaceKeyBase = (workspacePath: string): string => {
		const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
		const activeWorkspacePath = deps.workspaceRegistry.getActiveWorkspacePath();
		if (activeWorkspaceId && activeWorkspacePath === workspacePath) {
			return `workspace:${activeWorkspaceId}`;
		}
		return `path:${hashWorkspacePathForLedger(workspacePath)}`;
	};
	const chatSandboxWorkspaceKey = (
		workspacePath: string,
		writableMounts: readonly SandboxWritablePathMount[] = [],
	): string => {
		const base = chatSandboxWorkspaceKeyBase(workspacePath);
		if (writableMounts.length === 0) {
			return base;
		}
		const signature = writableMounts
			.map((mount) => `${mount.relativePath}\t${mount.hostPath}\t${mount.containerPath}`)
			.sort()
			.join("\n");
		const mountHash = createHash("sha256").update(signature).digest("hex").slice(0, 16);
		return `${base}:w=${mountHash}`;
	};
	const getChatSandboxManager = async (
		workspacePath: string,
		writableMounts: readonly SandboxWritablePathMount[] = [],
	): Promise<AgentSandboxManager> => {
		const key = chatSandboxWorkspaceKey(workspacePath, writableMounts);
		const runtimeConfig = await loadRuntimeConfig(workspacePath);
		const poolConfig = buildChatAgentSandboxPoolConfig(runtimeConfig);
		let manager = chatSandboxManagerByWorkspaceKey.get(key);
		if (!manager) {
			manager = new AgentSandboxManager({
				poolConfig,
				// Chat read tools need no network; keep the enforcement sandbox stricter than general task runs.
				networkPolicy: "none",
				basicMemoryEnabled: runtimeConfig.basicMemoryEnabled,
				writableMounts,
			});
			chatSandboxManagerByWorkspaceKey.set(key, manager);
			return manager;
		}
		await manager.updatePoolConfig(poolConfig);
		return manager;
	};
	const stopChatSandboxManagersByPrefix = async (prefix: string): Promise<void> => {
		const entries = [...chatSandboxManagerByWorkspaceKey.entries()].filter(
			([key]) => key === prefix || key.startsWith(`${prefix}:`),
		);
		for (const [key] of entries) {
			chatSandboxManagerByWorkspaceKey.delete(key);
		}
		await Promise.all(entries.map(([, manager]) => manager.stopNow().catch(() => null)));
	};
	const stopAllChatSandboxManagers = async (): Promise<void> => {
		const managers = [...chatSandboxManagerByWorkspaceKey.values()];
		chatSandboxManagerByWorkspaceKey.clear();
		await Promise.all(managers.map(async (manager) => manager.stopNow().catch(() => null)));
	};
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
	// if actionable work exists without its own live session (startable-unstarted cards or a non-empty deferred set),
	// the board has stranded work — self-heal by sweeping, and say so loudly. A live card excludes only itself;
	// legitimately-idle boards (everything terminal or held for the operator) never trip it.
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
	// (laptop CPU/GPU co-model ≈4× measured). Revisit with §5.AB machine-aware pools.
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
	/** §5.AB idle re-eval rail: eval cellKeys with a dispatch IN FLIGHT (cleared on completion so thin cells top up). */
	const idleReEvalDispatchedByWorkspaceId = new Map<string, Set<string>>();
	const OPPORTUNISTIC_IDLE_WORK_TICK_MS = 60_000;
	const DEFERRED_RETRY_TIMER_MS = 7_000;
	const queuedStartDrainTimersByWorkspaceId = new Map<
		string,
		{
			dueAt: number;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const MODEL_TURN_ADMISSION_POLL_MS = 3_000;
	const MODEL_TURN_ADMISSION_WARN_MS = 30_000;
	const MODEL_TURN_LMS_PS_TIMEOUT_MS = 15_000;
	const activeModelTurnsByWorkspaceId = new Map<string, NKleinEndpointSessionSnapshot[]>();
	const modelTurnAdmissionTailByWorkspaceId = new Map<string, Promise<void>>();
	let lastNonEmptyModelTurnPsModels: readonly LmsPsModel[] = [];
	const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
	const emptyModelRegistrySnapshot = () => ({
		schemaVersion: 1 as const,
		updatedAt: 0,
		models: {},
	});
	const runSerializedModelTurnAdmission = async <T>(workspaceId: string, run: () => Promise<T>): Promise<T> => {
		const previous = modelTurnAdmissionTailByWorkspaceId.get(workspaceId) ?? Promise.resolve();
		let releaseNext: () => void = () => {};
		const next = new Promise<void>((resolve) => {
			releaseNext = resolve;
		});
		const tail = previous.catch(() => undefined).then(() => next);
		modelTurnAdmissionTailByWorkspaceId.set(workspaceId, tail);
		await previous.catch(() => undefined);
		try {
			return await run();
		} finally {
			releaseNext();
			if (modelTurnAdmissionTailByWorkspaceId.get(workspaceId) === tail) {
				modelTurnAdmissionTailByWorkspaceId.delete(workspaceId);
			}
		}
	};
	const resolveLegacyPerMachineCap = (): number | null => {
		if (process.env.VITEST || process.env.NODE_ENV === "test") {
			return null;
		}
		const raw = Number(process.env.NKLEIN_PER_MACHINE_MAX_CONCURRENCY);
		return Number.isInteger(raw) && raw > 0 ? raw : null;
	};
	const collectModelTurnSchedulingSessions = (
		workspaceId: string,
		request: NKleinModelTurnAdmissionRequest,
		psModels: readonly LmsPsModel[],
	): NKleinEndpointSessionSnapshot[] => {
		const byTaskId = new Map<string, NKleinEndpointSessionSnapshot>();
		for (const [turnWorkspaceId, sessions] of activeModelTurnsByWorkspaceId) {
			for (const session of sessions) {
				byTaskId.set(turnWorkspaceId === workspaceId ? session.taskId : `${turnWorkspaceId}:${session.taskId}`, {
					...session,
					taskId: turnWorkspaceId === workspaceId ? session.taskId : `${turnWorkspaceId}:${session.taskId}`,
				});
			}
		}
		const trackedModelIds = new Set([...byTaskId.values()].map((session) => session.modelId));
		for (const model of psModels) {
			const status = model.status?.trim().toLowerCase() ?? "";
			const isBusy = model.queued > 0 || (status.length > 0 && status !== "idle");
			if (!isBusy || trackedModelIds.has(model.identifier)) {
				continue;
			}
			const taskId = `external-lms:${model.machineId}:${model.identifier}`;
			byTaskId.set(taskId, {
				taskId,
				state: "running",
				startedAt: null,
				providerId: request.providerId,
				modelId: model.identifier,
				hostId: model.machineId,
				endpoint: model.identifier === request.modelId ? request.endpoint : null,
			});
		}
		return [...byTaskId.values()].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0));
	};
	const findExternalLmsHostBlock = (
		request: NKleinModelTurnAdmissionRequest,
		psModels: readonly LmsPsModel[],
		hostId: string | null,
		runningSessions: readonly NKleinEndpointSessionSnapshot[],
		machineByModelId: ReadonlyMap<string, string>,
	): string | null => {
		if (!hostId) {
			return null;
		}
		const runningOnHost = runningSessions.some(
			(session) =>
				session.taskId !== request.taskId &&
				!session.taskId.startsWith("external-lms:") &&
				(session.hostId?.trim() || machineByModelId.get(session.modelId)?.trim() || null) === hostId,
		);
		const hostModels = psModels.filter((model) => model.machineId === hostId);
		const queued = hostModels.find((model) => model.queued > 0);
		if (queued) {
			return `LM Studio host "${hostId}" already has ${queued.queued} queued request(s) on ${queued.identifier}.`;
		}
		const busy = hostModels.find((model) => {
			const status = model.status?.trim().toLowerCase() ?? "";
			return status.length > 0 && status !== "idle";
		});
		if (busy && !runningOnHost) {
			return `LM Studio host "${hostId}" is busy outside !Klein on ${busy.identifier} (status ${busy.status ?? "unknown"}).`;
		}
		return null;
	};
	const evaluateModelTurnAdmission = async (
		scope: RuntimeTrpcWorkspaceScope,
		request: NKleinModelTurnAdmissionRequest,
	): Promise<
		| { ok: true; reservation: NKleinEndpointSessionSnapshot }
		| { ok: false; reason: string; retryAfterMs: number | null }
	> => {
		const runtimeConfig = await loadRuntimeConfig(scope.workspacePath);
		// Shared snapshot at poll granularity: N waiting cards previously EACH fetched uncached every ~3s —
		// the LM Studio catalog-hammering storm (David 2026-07-10). One fetch per poll window serves all waiters.
		const freshPsModels = await fetchLmsPsModelsCached(
			createDefaultLmsRunner(MODEL_TURN_LMS_PS_TIMEOUT_MS),
			MODEL_TURN_ADMISSION_POLL_MS,
		);
		if (freshPsModels.length > 0) {
			lastNonEmptyModelTurnPsModels = freshPsModels;
		}
		const psModelsForHostMap = freshPsModels.length > 0 ? freshPsModels : lastNonEmptyModelTurnPsModels;
		const machineByModelId = buildLmStudioMachineByModelId(psModelsForHostMap, {
			providerIds: [request.providerId],
			endpoints: [request.endpoint],
		});
		const hostId = machineByModelId.get(request.modelId)?.trim() || null;
		const registryModelKey = buildNKleinModelRegistryKey({
			providerId: request.providerId,
			modelId: request.modelId,
			endpoint: request.endpoint,
		});
		const concurrencyCaps = resolveSessionConcurrencyCaps({
			providerId: request.providerId,
			modelId: registryModelKey,
			endpoint: request.endpoint,
			hostId,
			global: runtimeConfig.concurrencyDefaults,
			override: runtimeConfig.concurrencyOverride,
			hostFallback: resolveLegacyPerMachineCap(),
		});
		const modelRegistrySnapshot = await Promise.resolve(getDefaultNKleinModelRegistry().getSnapshot()).catch(() =>
			emptyModelRegistrySnapshot(),
		);
		const runningSessions = collectModelTurnSchedulingSessions(scope.workspaceId, request, freshPsModels);
		const sameTaskTurn = findActiveSameTaskModelTurn(request.taskId, runningSessions);
		if (sameTaskTurn) {
			return {
				ok: false,
				reason: `Task "${request.taskId}" already has an active model turn; waiting before starting another turn for the same session.`,
				retryAfterMs: null,
			};
		}
		const endpointDecision = scheduleNKleinEndpointStart({
			taskId: request.taskId,
			providerId: request.providerId,
			modelId: request.modelId,
			endpoint: request.endpoint,
			hostId,
			runningSessions,
			modelRegistry: modelRegistrySnapshot,
			now: Date.now(),
			providerConcurrencyCap: concurrencyCaps.providerCap,
			modelConcurrencyCap: concurrencyCaps.modelCap,
			endpointConcurrencyCap: concurrencyCaps.endpointCap,
			hostConcurrencyCap: concurrencyCaps.hostCap,
			machineByModelId,
		});
		if (!endpointDecision.ok) {
			return {
				ok: false,
				reason: endpointDecision.reason,
				retryAfterMs: endpointDecision.estimatedWaitMs,
			};
		}
		const externalBlock = findExternalLmsHostBlock(request, freshPsModels, hostId, runningSessions, machineByModelId);
		if (externalBlock) {
			return { ok: false, reason: externalBlock, retryAfterMs: null };
		}
		const reservation: NKleinEndpointSessionSnapshot = {
			taskId: request.taskId,
			state: "running",
			startedAt: Date.now(),
			providerId: request.providerId,
			modelId: request.modelId,
			endpoint: request.endpoint,
			hostId,
		};
		const activeTurns = activeModelTurnsByWorkspaceId.get(scope.workspaceId) ?? [];
		activeModelTurnsByWorkspaceId.set(scope.workspaceId, [...activeTurns, reservation]);
		return { ok: true, reservation };
	};
	const waitForModelTurnAdmission = async (
		scope: RuntimeTrpcWorkspaceScope,
		request: NKleinModelTurnAdmissionRequest,
	): Promise<NKleinEndpointSessionSnapshot> => {
		let nextWarnAt = Date.now() + MODEL_TURN_ADMISSION_WARN_MS;
		for (;;) {
			const decision = await runSerializedModelTurnAdmission(scope.workspaceId, () =>
				evaluateModelTurnAdmission(scope, request),
			);
			if (decision.ok) {
				return decision.reservation;
			}
			const nowMs = Date.now();
			const retryAfterMs =
				typeof decision.retryAfterMs === "number" && Number.isFinite(decision.retryAfterMs)
					? decision.retryAfterMs
					: MODEL_TURN_ADMISSION_POLL_MS;
			if (nowMs >= nextWarnAt) {
				deps.warn(`Model turn for ${request.taskId} is waiting for capacity: ${decision.reason}`);
				await Promise.resolve(request.onWaiting?.({ reason: decision.reason, retryAfterMs })).catch(
					() => undefined,
				);
				nextWarnAt = nowMs + MODEL_TURN_ADMISSION_WARN_MS;
			}
			await sleep(Math.min(Math.max(MODEL_TURN_ADMISSION_POLL_MS, retryAfterMs), 30_000));
		}
	};
	const releaseModelTurnAdmission = (workspaceId: string, reservation: NKleinEndpointSessionSnapshot): void => {
		const activeTurns = activeModelTurnsByWorkspaceId.get(workspaceId) ?? [];
		const nextTurns = activeTurns.filter((turn) => turn !== reservation);
		if (nextTurns.length > 0) {
			activeModelTurnsByWorkspaceId.set(workspaceId, nextTurns);
		} else {
			activeModelTurnsByWorkspaceId.delete(workspaceId);
		}
	};
	const createModelTurnAdmissionGate =
		(scope: RuntimeTrpcWorkspaceScope): NKleinModelTurnAdmissionGate =>
		async (request, run) => {
			const reservation = await waitForModelTurnAdmission(scope, request);
			try {
				return await run();
			} finally {
				releaseModelTurnAdmission(scope.workspaceId, reservation);
				drainQueuedTaskStarts(scope, { force: true });
			}
		};
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
				// backlog/planning = a waiting card; `ready` = a dep-free card parked after an earlier defer (todo 11116).
				// Any other lane means it is no longer waiting (started elsewhere, completed, trashed).
				if (sourceColumnId !== "backlog" && sourceColumnId !== "planning" && sourceColumnId !== "ready") {
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
				// Double-dispatch guard (live-found 2026-07-10, simulated project-19 run): a STARTED card sits in the
				// Planning entry lane, so the column check above does not stop repeat auto-starts — each retry then
				// re-queued the card behind the busy endpoint and the queue ran it AGAIN after the first session
				// finished (two full worker sessions, second produced an empty duplicate patch → not_reviewable).
				// An already-active session for the card means there is nothing to start.
				const activeSessionForTask = liveNKleinSessions.find(
					(summary) =>
						summary.taskId === taskId &&
						(summary.state === "running" ||
							summary.state === "queued" ||
							summary.state === "paused" ||
							summary.state === "awaiting_review"),
				);
				if (activeSessionForTask) {
					deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.delete(taskId);
					continue;
				}
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
					await parkCardInReadyLane(scope, task.id); // queued-but-unblocked (waiting on a file lock) ⇒ Ready.
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
						await parkCardInReadyLane(scope, task.id); // dep-free but no slot ⇒ show in Ready.
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
									// timerFired: the trailing sweep must not be re-swallowed by the debounce (#26).
									retryWaitingCardsAfterTerminal(scope, timerService, undefined, { timerFired: true });
								}
							}, DEFERRED_RETRY_TIMER_MS),
						);
						continue;
					}
					deps.warn(
						`Could not auto-start linked task ${task.id} for ${scope.workspacePath} (${started.errorCode ?? "unknown_code"}): ${started.error ?? "unknown error"}`,
					);
					recordSelfObservation({
						signal: "runtime_error",
						severity: "warning",
						message: `Auto-start failed before a session was created for ${task.id}: ${started.error ?? "unknown error"}`,
						taskId: task.id,
						workspacePath: scope.workspacePath,
						metadata: {
							category: "auto_start_failed",
							errorCode: started.errorCode ?? "unknown_code",
						},
					});
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
					await parkCardInReadyLane(scope, task.id); // dep-free but endpoint busy ⇒ show in Ready.
					continue;
				}
				const pinnedModelRecommendation = started.selectionReason?.match(/Pinned-model recommendation:.*$/u)?.[0];
				if (pinnedModelRecommendation) {
					deps.warn(`Auto-start of ${task.id}: ${pinnedModelRecommendation}`);
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
				recordSelfObservation({
					signal: "runtime_error",
					severity: "warning",
					message: `Auto-start threw before a session was created for ${taskId}: ${message}`,
					taskId,
					workspacePath: scope.workspacePath,
					metadata: { category: "auto_start_exception" },
				});
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
		options?: { timerFired?: boolean },
	): void => {
		const now = Date.now();
		const last = lastTerminalRetrySweepAtByWorkspaceId.get(scope.workspaceId) ?? 0;
		// The debounce guards against sweep storms — but a pending one-shot dead-card rescue (#24) must not be
		// swallowed by a neighboring terminal's window (losing it would strand the card permanently).
		const redrivePending =
			terminalTaskId !== undefined &&
			!terminalRedriveAttemptedTaskKeys.has(`${scope.workspaceId}:${terminalTaskId}`);
		if (
			!shouldRunTerminalRetrySweep({
				now,
				lastSweepAt: last,
				debounceMs: TERMINAL_RETRY_SWEEP_DEBOUNCE_MS,
				redrivePending,
				timerFired: options?.timerFired === true,
			})
		) {
			// A swallowed sweep must not strand deferred work: with a non-empty deferred set and no trailing
			// timer armed, this debounce window could be the LAST event before the board freezes (live-found
			// 2026-07-10, simulated project-02 run). Arm the one-shot timer to sweep after the window closes.
			const deferredPending = (deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.size ?? 0) > 0;
			if (deferredPending && !deferredRetryTimerByWorkspaceId.has(scope.workspaceId)) {
				deferredRetryTimerByWorkspaceId.set(
					scope.workspaceId,
					setTimeout(() => {
						deferredRetryTimerByWorkspaceId.delete(scope.workspaceId);
						const timerService = nkleinTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
						if (timerService) {
							retryWaitingCardsAfterTerminal(scope, timerService, undefined, { timerFired: true });
						}
					}, DEFERRED_RETRY_TIMER_MS),
				);
			}
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
								summary.state === "paused" ||
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
							// §5.AG Layer-1 automatic escalation at the one-shot redrive: if the §5.AF ledger shows this
							// card HARD-STUCK on its current model, switch the fresh attempt to the best UNTRIED loaded
							// model (never loads anything — /api/v0/models only). Best-effort: any failure here falls back
							// to the plain same-model redrive, which is the pre-existing behavior.
							let redriveNote = "";
							try {
								const events = await readAgentLedger({
									workspacePathHash: hashWorkspacePathForLedger(scope.workspacePath),
								});
								const deadSummary = service.getSummary(terminalTaskId);
								const escalationBaseUrl = deadSummary?.endpoint ?? DEFAULT_LOCAL_MODEL_BASE_URL;
								const loadedIds = await fetchLoadedModelIdsCached(escalationBaseUrl).catch(() => []);
								const action = planTerminalRedriveEscalation({
									events,
									taskId: terminalTaskId,
									availableModelIds: loadedIds,
								});
								if (action.kind === "retry_other_model") {
									await mutateWorkspaceState(scope.workspacePath, (latestState) => ({
										board: {
											...latestState.board,
											columns: latestState.board.columns.map((column) => ({
												...column,
												cards: column.cards.map((card) =>
													card.id === terminalTaskId
														? {
																...card,
																nkleinSettings: {
																	...(card.nkleinSettings ?? {}),
																	modelId: action.modelId,
																},
																updatedAt: Date.now(),
															}
														: card,
												),
											})),
										},
										value: null,
									}));
									redriveNote = ` (Layer-1 escalation: hard-stuck on its model — switched to untried loaded model ${action.modelId})`;
								}
								if (action.kind !== "continue") {
									void appendAgentLedgerEvent(
										buildTransitionEvent({
											workflowId: terminalTaskId,
											taskId: terminalTaskId,
											workspacePathHash: hashWorkspacePathForLedger(scope.workspacePath),
											from: "hard_stuck",
											to: "redrive",
											reason: "terminal_redrive",
											controllerDecision:
												action.kind === "retry_other_model"
													? `layer1_model_switch:${action.modelId}`
													: "escalate_to_user",
										}),
									).catch(() => {});
								}
							} catch {
								// fall through to the plain redrive.
							}
							deps.warn(
								`Dead card ${terminalTaskId} left no captured work — attempting ONE fresh restart before leaving it for the operator.${redriveNote}`,
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
	// §5.B Ready lane (todo 11116 increment 2): a dep-free card whose auto-start was DEFERRED (slot busy, endpoint
	// busy, or file-overlap serialized) is "queued but unblocked" — park it in `ready` so that state is visible as
	// its own column. Placement ties to the authoritative DEFER decision (not a reconcile), so there is no race with
	// the start flow: a card that actually STARTS is moved to the planning entry-lane and promoted to in_progress
	// instead, never here. Idempotent; best-effort (never blocks the sweep).
	const parkCardInReadyLane = async (scope: RuntimeTrpcWorkspaceScope, taskId: string): Promise<void> => {
		await mutateWorkspaceState(scope.workspacePath, (latestState) => {
			const record = findBoardCardWithColumn(latestState.board, taskId);
			// Only park a card that is still pre-implementation (backlog/planning) — never pull one back from a later lane.
			if (!record || (record.columnId !== "backlog" && record.columnId !== "planning")) {
				return { board: latestState.board, save: false, value: null };
			}
			const movement = moveTaskToColumn(latestState.board, taskId, "ready");
			return { board: movement.board, save: movement.moved, value: null };
		}).catch((error) => {
			deps.warn(`Ready-lane park failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
		});
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
	const {
		recordModelPerformance: recordNKleinModelPerformance,
		recordKnowledgeToolUsage: recordNKleinKnowledgeToolUsage,
	} = createRuntimeTerminalTelemetryRecorders({ warn: deps.warn });
	// §5.AF: task-session state transitions → ledger `transition` events (the controller-visible state stream).
	const recordNKleinSessionTransition = createSessionTransitionRecorder((event) => appendAgentLedgerEvent(event));
	const planIntegrationGateRunner = createPlanIntegrationGateRunner({ warn: deps.warn });
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
				// Retry only the individual workspace-state reads/writes below. Retrying this WHOLE callback after a
				// transient lock conflict replays non-idempotent reviewer, acceptance, and merge effects. Under a busy
				// board that produced approve → merge → completion-lock-conflict → second review; the resumed review
				// could return no_verdict and strand already-merged work in Review.
				await (async () => {
					let shouldAutoComplete = false;
					await retryWorkspaceStateLock(() =>
						mutateWorkspaceState(scope.workspacePath, (latestState) => {
							const record = latestState.board.columns
								.flatMap((column) => column.cards.map((card) => ({ columnId: column.id, card })))
								.find((candidate) => candidate.card.id === taskId);
							const action = decideAutoReviewCardAction(record);
							shouldAutoComplete = action.shouldAutoComplete;
							if (!action.moveToReview) {
								return { board: latestState.board, save: false, value: null };
							}
							const movement = moveTaskToColumn(latestState.board, taskId, "review");
							return {
								board: movement.board,
								save: movement.moved,
								value: null,
							};
						}),
					);
					if (!shouldAutoComplete) {
						return;
					}
					const loadedReviewState = await retryWorkspaceStateLock(() => loadWorkspaceState(scope.workspacePath));
					// The session's round-2 capture and the review finalizer are triggered by the same summary edge. A late
					// live-state write can transiently project the card back into In Progress after the authoritative move
					// above. This callback already proved the card is auto-reviewable; normalize its immutable review snapshot
					// so the runner cannot reject the handoff as `not_reviewable`. Persisted delivery still uses locked mutations.
					const reviewState = {
						...loadedReviewState,
						board: moveTaskToColumn(loadedReviewState.board, taskId, "review").board,
					};
					const sandboxResult = await resolveReviewSandboxResult(
						{ repoPath: scope.workspacePath, taskId },
						{ getSummary: (id) => service.getSummary(id), resolveResultCommit: resolveTaskResultBranchCommit },
					);
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
						// Use the normalized authoritative snapshot above; re-reading during the handoff/capture race can see the
						// transient In Progress bounce lane and reject the legitimate round-2 review as `not_reviewable`.
						loadWorkspaceState: async () => reviewState,
						warn: deps.warn,
						onRedecomposeCardSpawned: (redecomposeTaskId) =>
							autoStartTaskIds(scope, [redecomposeTaskId], { bypassDurableGuard: true }),
					}).catch((error) => {
						const message = error instanceof Error ? error.message : String(error);
						deps.warn(`Second-opinion review errored for ${taskId}; proceeding to delivery: ${message}`);
						return { type: "skipped" as const, reason: "card_not_found" as const };
					});
					const reviewReason = "reason" in reviewOutcome ? ` (${reviewOutcome.reason})` : "";
					deps.warn(`Second-opinion review outcome for ${taskId}: ${reviewOutcome.type}${reviewReason}`);
					// The reviewer's turns just freed the endpoint. A DELIVERED review drains via the completion path
					// below, but a bounced/parked/skipped one does NOT complete the card — so a sibling card queued
					// behind the busy review endpoint would wait out its full exponential backoff (fleet
					// under-utilization mechanism #2, todo 11007). Force-drain now so the freed slot is reused at once.
					drainQueuedTaskStarts(scope, { force: true });
					// §5.AW arbitration: when the reviewer compared candidates A/B and preferred the SPECULATIVE
					// one, every delivery step below (acceptance evidence, protected-path scan, the merge itself)
					// must target the ::spec result branch while all board bookkeeping stays on the card id. The
					// in-process reviewOutcome.preferred is authoritative; the persisted review.preferredCandidate
					// is the DURABLE fallback so a restart between the verdict and this delivery still ships the
					// winner (the persistence is written by the review orchestrator's onDeliver).
					const persistedPreferred = reviewState.board.columns
						.flatMap((column) => column.cards)
						.find((c) => c.id === taskId)?.review?.preferredCandidate;
					const initialDeliveryTarget = resolveSpeculativeDeliveryTarget({
						reviewDelivered: reviewOutcome.type === "delivered",
						reviewPreferred: reviewOutcome.type === "delivered" ? reviewOutcome.preferred : null,
						persistedPreferred,
						taskId,
					});
					let preferredSpeculative = initialDeliveryTarget.preferredSpeculative;
					let deliveredBranchTaskId = initialDeliveryTarget.deliveredBranchTaskId;
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
						reviewOutcome.type === "escalated" ||
						reviewOutcome.type === "blocked"
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
					// Hoisted so the delivery gate below can derive a MEASURED command-level regression delta from the
					// same base-tree sample (null = never sampled ⇒ the delta honestly stays unknown).
					let acceptanceBaseline: Awaited<ReturnType<typeof service.verifyTaskAcceptanceInSandbox>> | null = null;
					if (deliveryCard && acceptancePresentAndFailed(acceptance)) {
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
						acceptanceBaseline = baseline;
						if (acceptancePresentAndFailed(baseline)) {
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
							await retryWorkspaceStateLock(() =>
								mutateWorkspaceState(scope.workspacePath, (latestState) => {
									const movement = moveTaskToColumn(latestState.board, taskId, "in_progress");
									return { board: movement.board, save: movement.moved, value: null };
								}),
							);
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
						// only at the most-open tier). Any non-merge action (manual / commit) leaves the card
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
								// §5.L measured regression delta (command granularity, from runs already collected):
								// delivered-green ⇒ 0; failed-but-pre-existing (the #39 waiver) ⇒ 0; failed-vs-green-base
								// ⇒ -1; unmeasured ⇒ null. Un-deadens the more_open tier (null could never auto-merge).
								regressionDelta: regressionDeltaFromAcceptanceRuns(acceptance, acceptanceBaseline),
								hasProtectedPathChanges: changedFiles.some(isTrustedAutoMergeProtectedPath),
							},
						);
						// §5.AF gate event: the delivery-gate verdict + its evidence, appended as a `transition` record so
						// the ledger projections (escalation report, learning) see WHY a card merged/held/bounced —
						// structured, never only a warn-log line. Best-effort (observational).
						void appendAgentLedgerEvent(
							buildTransitionEvent({
								workflowId: taskId,
								taskId,
								workspacePathHash: hashWorkspacePathForLedger(scope.workspacePath),
								from: "review",
								to: `delivery_${deliveryDecision.action}`,
								reason: deliveryDecision.reason || null,
								controllerDecision: `gates:review=${evidence.reviewApproved ? "pass" : "fail"},tests=${evidence.testsPassed ? "pass" : "fail"},protected=${changedFiles.some(isTrustedAutoMergeProtectedPath) ? "touched" : "clear"}`,
							}),
						).catch(() => {});
						if (deliveryDecision.action !== "merge") {
							// #28: the reviewer APPROVED but the fresh acceptance failed ⇒ the worker never learns why the
							// card is stuck. Re-drive ONCE with the acceptance failure (mirrors the W4.2a empty-patch
							// re-drive); a repeat failure leaves the hold for the operator as before.
							const acceptanceRedrives = acceptanceFailureRedriveAttemptsByTaskKey.get(inFlightKey) ?? 0;
							if (
								acceptance &&
								shouldRedriveApprovedButAcceptanceFailed({
									reviewApproved: evidence.reviewApproved,
									testsPassed: evidence.testsPassed,
									priorRedriveAttempts: acceptanceRedrives,
								})
							) {
								acceptanceFailureRedriveAttemptsByTaskKey.set(inFlightKey, acceptanceRedrives + 1);
								deps.warn(
									`Approved-but-acceptance-failed card ${taskId}: re-driving the worker once with the failing acceptance output.`,
								);
								await retryWorkspaceStateLock(() =>
									mutateWorkspaceState(scope.workspacePath, (latestState) => {
										const movement = moveTaskToColumn(latestState.board, taskId, "in_progress");
										return { board: movement.board, save: movement.moved, value: null };
									}),
								);
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
					await retryWorkspaceStateLock(() =>
						mutateWorkspaceState(scope.workspacePath, (latestState) => {
							const completed = completeTaskAndGetReadyLinkedTaskIds(latestState.board, taskId);
							readyTaskIds = completed.readyTaskIds;
							completedBoard = completed.board;
							return {
								board: completed.board,
								save: completed.moved,
								value: null,
							};
						}),
					);
					// §5.0.5 plan-level integration gate: if this delivery completed a decomposition's LAST card, run
					// the plan's project-level acceptance on the fully-merged tree (fire-and-forget + per-slug debounced
					// inside — must not delay releasing dependents below).
					if (completedBoard) {
						planIntegrationGateRunner.runForCompletion(scope, service, taskId, completedBoard);
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
					const sweepState = await retryWorkspaceStateLock(() => loadWorkspaceState(scope.workspacePath)).catch(
						() => null,
					);
					const activeSessionTaskIds = new Set(
						service
							.listSummaries()
							.filter(
								(summary) =>
									summary.state === "running" ||
									summary.state === "queued" ||
									summary.state === "paused" ||
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
				})();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Could not finalize auto-review task ${taskId} for ${scope.workspacePath}: ${message}`);
			} finally {
				autoReviewFinalizationInFlightTaskIds.delete(inFlightKey);
				if (autoReviewFinalizationRerunRequestedKeys.delete(inFlightKey)) {
					// Duplicate awaiting-review summaries can queue a rerun while round 1 is still settling. Re-run the
					// queued finalize UNLESS the worker is ACTIVELY re-driving (running/queued/paused): on a BOUNCE the
					// card is back In Progress with the worker being fixed up, and a FUTURE awaiting_review edge will
					// finalize the FRESH artifact — replaying now would race ahead and review the stale one (the case
					// this gate was added for). But a card that has gone QUIESCENT has no future edge of its own: gating
					// on `isReviewableNKleinSummary` (state === awaiting_review) dropped the rerun whenever the
					// zero-latency empty-patch re-drive settled past awaiting_review before this `finally` ran, STRANDING
					// the no-op worker In Progress instead of reaching the fail-closed Review hold (§5.BF 2026-07-11 —
					// caught by the deterministic swarm harness). awaiting_review (the queued case) and terminal/idle
					// states all re-run; only a live re-drive is deferred to its own edge.
					const latestSummary = service.getSummary(taskId);
					const workerActivelyRedriving =
						latestSummary?.state === "running" ||
						latestSummary?.state === "queued" ||
						latestSummary?.state === "paused";
					if (!workerActivelyRedriving) {
						finalizeHeadlessAutoReviewTask(scope, service, taskId);
					}
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
			const candidates = selectHeadlessAutoReviewReconcileCandidates(state.board);
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
			if (queued.exhausted) {
				// Endpoint-busy re-queue exhausted (todo 11007): DON'T re-arm a drain — the entry is already dropped.
				// The card stops reading as queued-forever; the board-liveness watchdog picks it up as a
				// startable-unstarted card (or leaves it for the operator if the endpoint is genuinely dead).
				deps.warn(
					`Task ${input.request.taskId} exhausted its endpoint-busy retry budget (${queued.attempts} attempts) for ${input.workspaceScope.workspacePath}; dropped from the start queue for the liveness watchdog to re-evaluate.`,
				);
				return queued;
			}
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
		const effectiveSwarmGuardrails = resolveRuntimeSwarmGuardrailsForModelRoles({
			configuredGuardrails: runtimeConfig.swarmGuardrails,
			effectiveModelRoles: runtimeConfig.effectiveModelRoles,
		});
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
				swarmGuardrails: effectiveSwarmGuardrails,
				knowsTodayEnabled: runtimeConfig.knowsTodayEnabled,
				sandboxMcpServersEnabled: runtimeConfig.sandboxMcpServersEnabled,
				basicMemoryEnabled: runtimeConfig.basicMemoryEnabled,
				retrievalEgressEnabled: runtimeConfig.retrievalEgressEnabled,
				modelStatsTrackingLevel: runtimeConfig.modelStatsTrackingLevel,
				retrievalSearchBackendUrl: runtimeConfig.retrievalSearchBackendUrl,
				agentWebResearchAllowed,
				agentMcpAccess,
				modelTurnAdmissionGate: createModelTurnAdmissionGate(scope),
				agentSandboxManager: new AgentSandboxManager({
					poolConfig: sandboxPoolConfig,
					networkPolicy: sandboxNetworkPolicy,
					// §5.L egress proxy (§6 I3): persisted flag + host allowlist (env still overrides the flag).
					sandboxEgressProxyEnabled: runtimeConfig.sandboxEgressProxyEnabled,
					sandboxEgressAllowlist: runtimeConfig.sandboxEgressAllowlist,
					basicMemoryEnabled: runtimeConfig.basicMemoryEnabled,
					// Surface a stalled slot acquisition (the review-hang class) instead of a silent freeze.
					warn: (message) => deps.warn(message),
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
				onTurnLoopEscalation: async (event) => {
					// §12 turn-loop ladder, escalate-model rung — route through the EXISTING §5.AG machinery:
					// (1) the boundary question goes to the card MAILBOX (consumed as opening guidance on the next
					// start), (2) the card's model override switches to the lineage-diverse pick (the same effect the
					// terminal-redrive Layer-1 escalation applies), (3) a ledger transition records the decision,
					// (4) the looping session is STOPPED — the standard terminal sweep then redrives the card (or the
					// prior-work rebound routes captured work through review). No new recovery machinery.
					// NOTE: no workspacePath filter here — the event's workspacePath is the AGENT-perceived cwd (the
					// sandbox workdir under isolation, never the host path), and this service instance is already
					// scoped to exactly one workspace, so filtering on it would silently drop every escalation.
					try {
						await appendCardMailboxNote({
							taskId: event.taskId,
							text:
								`The previous model looped on a boundary it could not resolve: "${event.boundary}". ` +
								"Settle this question FIRST from the task's spec/acceptance criteria (they are authoritative), then proceed — do not re-raise it.",
							source: "chat",
						});
						await mutateWorkspaceState(scope.workspacePath, (latestState) => ({
							board: {
								...latestState.board,
								columns: latestState.board.columns.map((column) => ({
									...column,
									cards: column.cards.map((card) =>
										card.id === event.taskId
											? {
													...card,
													nkleinSettings: {
														...(card.nkleinSettings ?? {}),
														modelId: event.model.modelId,
													},
													updatedAt: Date.now(),
												}
											: card,
									),
								})),
							},
							value: null,
						}));
						void appendAgentLedgerEvent(
							buildTransitionEvent({
								workflowId: event.taskId,
								taskId: event.taskId,
								workspacePathHash: hashWorkspacePathForLedger(scope.workspacePath),
								from: "hard_stuck",
								to: "redrive",
								reason: "turn_loop",
								controllerDecision: `layer1_model_switch:${event.model.modelId}`,
							}),
						).catch(() => {});
						deps.warn(
							`Turn-loop escalation: ${event.taskId} looped on "${event.boundary}" — switched its model to ${event.model.modelId} and stopping the session for a redrive.`,
						);
						const escalationService = nkleinTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
						await escalationService?.stopTaskSession(event.taskId);
					} catch (error) {
						deps.warn(
							`Turn-loop escalation failed for ${event.taskId}: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
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
								summary.state === "paused" ||
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
				recordNKleinSessionTransition(scope, summary);
				if (isReviewableNKleinSummary(summary)) {
					finalizeHeadlessAutoReviewTask(scope, trackedService, summary.taskId);
				}
				if (summary.state !== "queued" && summary.state !== "running") {
					drainQueuedTaskStarts(scope, { force: true });
				}
				if (isTerminalFailureSessionState(summary.state)) {
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
							if ((await readSwarmStopSignal(scope.workspacePath)) !== null) {
								return; // swarm stopped by the operator — idle is intentional, not a stall
							}
							const state = await retryWorkspaceStateLock(() => loadWorkspaceState(scope.workspacePath));
							// A live card excludes only ITSELF from rescue. The old board-wide `anySessionAlive` veto let a
							// stale paused/awaiting-review source, a derived session, or one unrelated running card mask a
							// dependency-free Planning root forever. Board membership + the ready sweep provide the proper
							// correlation: absent/terminal/synthetic summaries cannot suppress real waiting cards.
							const activeSessionTaskIds = new Set(
								trackedService
									.listSummaries()
									.filter(
										(summary) =>
											summary.state === "running" ||
											summary.state === "queued" ||
											summary.state === "paused" ||
											summary.state === "awaiting_review",
									)
									.map((summary) => summary.taskId),
							);
							// Secondary reviewers run outside the task-session service, so their card is absent from
							// `activeSessionTaskIds`. Correlate the finalizer's own in-flight set as well; otherwise a
							// watchdog tick can launch a duplicate reviewer while the first one is still awaiting its
							// verdict (live-found in the watchable project-05 bounce run).
							const activelyHandledTaskIds = new Set(activeSessionTaskIds);
							const finalizationKeyPrefix = `${scope.workspaceId}:`;
							for (const finalizationKey of autoReviewFinalizationInFlightTaskIds) {
								if (finalizationKey.startsWith(finalizationKeyPrefix)) {
									activelyHandledTaskIds.add(finalizationKey.slice(finalizationKeyPrefix.length));
								}
							}
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
							const startable = listStartableUnstartedTaskIds(state.board, activeSessionTaskIds);
							// BOTH deferral kinds are actionable: overlap-deferred cards AND a pending
							// concurrency-deferral retry (run36: only the overlap set was checked).
							const deferredCount =
								(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.size ?? 0) +
								(deferredRetryTimerByWorkspaceId.has(scope.workspaceId) ? 1 : 0);
							if (startable.length === 0 && deferredCount === 0) {
								// STALLED-REVIEW rescue: a verdict-less review card with no live session on an
								// otherwise-idle board is a frozen pipeline (a dropped review finalize — e.g. the
								// endpoint was busy with a SIBLING project when the card reached review; nothing
								// retries it, and its dependents block the whole board — live-found 2026-07-10).
								// Dispatch ONE per tick (serialized like the idle-review path, shared dedup set).
								const rescueDispatched =
									idleReviewDispatchedByWorkspaceId.get(scope.workspaceId) ?? new Set<string>();
								const stalledReviewTaskIds = findStalledReviewTaskIds(
									state.board,
									activelyHandledTaskIds,
									rescueDispatched,
								);
								const stalledReviewTaskId = stalledReviewTaskIds[0];
								if (stalledReviewTaskId === undefined) {
									return; // legitimately idle (everything terminal or held for the operator)
								}
								rescueDispatched.add(stalledReviewTaskId);
								idleReviewDispatchedByWorkspaceId.set(scope.workspaceId, rescueDispatched);
								// The rescue must stay SELF-healing: a dispatched review can itself wedge silently under
								// cross-project endpoint contention (live-seen 2026-07-10 — no outcome, no capacity
								// warning). Expire the dedup entry after the review budget so a still-verdict-less card
								// gets another attempt instead of a permanent one-shot.
								const rescueRetryTimer = setTimeout(
									() => {
										idleReviewDispatchedByWorkspaceId.get(scope.workspaceId)?.delete(stalledReviewTaskId);
									},
									12 * 60 * 1000,
								);
								rescueRetryTimer.unref?.();
								deps.warn(
									`Board-liveness watchdog: ${stalledReviewTaskIds.length} verdict-less review card(s) with no live session for ${scope.workspacePath} — dispatching the stalled review for ${stalledReviewTaskId}.`,
								);
								recordSelfObservation({
									signal: "custom",
									severity: "warning",
									message: `Board-liveness watchdog fired: stalled-review rescue (${stalledReviewTaskIds.length} verdict-less review card(s)).`,
									workspacePath: scope.workspacePath,
									metadata: {
										category: "board_liveness_watchdog",
										stalledReviews: stalledReviewTaskIds.length,
										taskId: stalledReviewTaskId,
									},
								});
								void runSecondOpinionReviewForTask({
									workspacePath: scope.workspacePath,
									taskId: stalledReviewTaskId,
									service: trackedService,
									warn: deps.warn,
									onRedecomposeCardSpawned: (redecomposeTaskId) =>
										autoStartTaskIds(scope, [redecomposeTaskId], { bypassDurableGuard: true }),
								})
									.catch((error) => {
										const message = error instanceof Error ? error.message : String(error);
										deps.warn(`Stalled-review rescue for ${stalledReviewTaskId} errored: ${message}`);
									})
									.finally(() => {
										// The review freed the endpoint (and may have completed the card) — retry waiters.
										drainQueuedTaskStarts(scope, { force: true });
										retryWaitingCardsAfterTerminal(scope, trackedService);
									});
								return;
							}
							deps.warn(
								`Board-liveness watchdog: ${startable.length} startable + ${deferredCount} deferred card(s) lack an active task session for ${scope.workspacePath} — sweeping (frozen-board self-heal).`,
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
							const runningSpecSessions = sessions.filter(
								(session) => isSpeculativeMirrorTaskId(session.taskId) && isBusySessionState(session.state),
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
									const primaryTaskId = primaryTaskIdOfSpeculativeMirror(spec.taskId);
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
									!isDerivedTaskSessionId(session.taskId) &&
									!isHomeAgentSessionId(session.taskId),
							);
							if (runningWorkerSessions.length === 0) {
								return; // cheap early exit before any endpoint probe
							}
							const baseUrl =
								runningWorkerSessions.find((session) => session.endpoint)?.endpoint ??
								DEFAULT_LOCAL_MODEL_BASE_URL;
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
								sessions
									.filter((session) => isBusySessionState(session.state))
									.map((session) => session.modelId),
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
									!isDerivedTaskSessionId(session.taskId) &&
									!isHomeAgentSessionId(session.taskId),
							);
							const realWorkWaiting =
								taskStartQueue.size(scope.workspaceId) > 0 ||
								(deferredOverlapTaskIdsByWorkspaceId.get(scope.workspaceId)?.size ?? 0) > 0;
							const hasRealQueuedWork = realWorkWaiting || runningWorkerSessions.length > 0;
							const boardState = await loadWorkspaceState(scope.workspacePath);
							const dispatched = idleReviewDispatchedByWorkspaceId.get(scope.workspaceId) ?? new Set<string>();
							const reviewCandidateTaskIds = findReviewCandidateTaskIds(boardState.board, dispatched);
							// §5.AB re-eval budget: thin eval cells of the LOADED models (never loads anything). Fed only
							// when nothing higher-value is available — the ranker keeps re_eval just above context_prep.
							const evalEndpoint = DEFAULT_LOCAL_MODEL_BASE_URL;
							const loadedModelIds =
								reviewCandidateTaskIds.length > 0
									? []
									: await fetchLoadedModelIdsCached(evalEndpoint).catch(() => [] as string[]);
							const reEvalDispatched =
								idleReEvalDispatchedByWorkspaceId.get(scope.workspaceId) ?? new Set<string>();
							const reEvalCandidates = findThinEvalCells({
								fitnessRows: await readFitnessTable()
									.then((table) => Object.values(table.rows))
									.catch(() => []),
								loadedModelIds,
								corpusPrompts: EVAL_PROMPT_CORPUS.filter((prompt) => prompt.family !== "implement"),
								alreadyDispatched: reEvalDispatched,
							});
							const decision = decideOpportunisticIdleWork({
								hasRealQueuedWork,
								reviewCandidateTaskIds,
								reEvalCandidates,
							});
							if (decision.reviewTaskId) {
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
									onRedecomposeCardSpawned: (redecomposeTaskId) =>
										autoStartTaskIds(scope, [redecomposeTaskId], { bypassDurableGuard: true }),
								})
									.catch((error) => {
										const message = error instanceof Error ? error.message : String(error);
										deps.warn(`Opportunistic idle review for ${decision.reviewTaskId} errored: ${message}`);
									})
									.finally(() => {
										// The opportunistic review freed the endpoint — reuse the slot immediately (todo 11007).
										drainQueuedTaskStarts(scope, { force: true });
									});
								return;
							}
							const reEval = decision.reEvalCandidate;
							if (!reEval) {
								return;
							}
							// One thin cell per tick: run its corpus prompts ONCE on the loaded model + persist, so the
							// §5.AB stability judge accumulates the runs it is owed without ever competing with real work.
							reEvalDispatched.add(reEval.cellKey);
							idleReEvalDispatchedByWorkspaceId.set(scope.workspaceId, reEvalDispatched);
							deps.warn(
								`Opportunistic idle re-eval: swarm idle, running eval cell ${reEval.cellKey} (${reEval.promptIds.length} prompt(s), runsOwed=${reEval.runsOwed}).`,
							);
							const chatBase = evalEndpoint.replace(/\/+$/, "");
							const chatUrl = `${chatBase.endsWith("/v1") ? chatBase : `${chatBase}/v1`}/chat/completions`;
							void (async () => {
								try {
									const result = await runModelEval(
										{ modelId: reEval.modelId, repeats: 1, promptIds: reEval.promptIds },
										{
											chat: async (messages, extra) => {
												try {
													const res = await fetch(chatUrl, {
														method: "POST",
														headers: { "content-type": "application/json" },
														body: JSON.stringify({
															model: reEval.modelId,
															messages,
															temperature: 0,
															max_tokens: 2500,
															...extra,
														}),
													});
													const json = (await res.json()) as {
														choices?: ModelEvalChatChoice[];
														error?: unknown;
													};
													return json.error ? null : (json.choices?.[0] ?? null);
												} catch {
													return null;
												}
											},
										},
									);
									for (const cell of result.cells) {
										if (cell.score === null) {
											continue;
										}
										await recordTaskFitnessOutcome(
											{
												modelKey: reEval.modelId,
												role: cell.role,
												difficultyTier: evalDifficultyToFitnessTier(cell.difficulty),
											},
											{
												success: cell.score >= 0.6,
												wallTimeMs: cell.latencyMs,
												failureMode: cell.score >= 0.6 ? undefined : "eval_below_bar",
											},
											{ now: Date.now() },
										).catch(() => undefined);
									}
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									deps.warn(`Opportunistic idle re-eval for ${reEval.cellKey} errored: ${message}`);
								} finally {
									// The cell may still be thin (needs ≥4 samples) — allow the NEXT tick to top it up.
									idleReEvalDispatchedByWorkspaceId.get(scope.workspaceId)?.delete(reEval.cellKey);
								}
							})();
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
			// §5.L egress proxy (§6 I3): re-apply the persisted proxy flag + host allowlist on a live config change (same
			// drift-guard discipline as the --network re-apply above — a cached manager must re-probe, never keep a stale
			// verdict/allowlist). The NKLEIN_SANDBOX_EGRESS_PROXY env still overrides the flag.
			service.setSandboxEgressConfig(
				runtimeConfig.sandboxEgressProxyEnabled,
				runtimeConfig.sandboxEgressAllowlist ?? "",
			);
			service.setSwarmGuardrails(effectiveSwarmGuardrails);
			service.setKnowsTodayEnabled(runtimeConfig.knowsTodayEnabled);
			service.setSandboxMcpServersEnabled(runtimeConfig.sandboxMcpServersEnabled);
			// §5.BB: re-apply the basic-memory switch (service bit + the sandbox manager's writable-store plan gate).
			service.setBasicMemoryEnabled(runtimeConfig.basicMemoryEnabled);
			service.setRetrievalConfig(runtimeConfig.retrievalEgressEnabled, runtimeConfig.retrievalSearchBackendUrl);
			// §5.L: re-apply the per-role web-research capability gate on a live ruleset change (same drift class as the
			// --network re-apply above — a cached service must not keep looser tool access after the operator tightens it).
			service.setAgentWebResearchAllowed(agentWebResearchAllowed);
			service.setAgentMcpAccess(agentMcpAccess);
			service.setModelStatsTrackingLevel(runtimeConfig.modelStatsTrackingLevel);
			service.setModelTurnAdmissionGate(createModelTurnAdmissionGate(scope));
			speculativeConfigByWorkspaceId.set(scope.workspaceId, {
				enabled: runtimeConfig.speculativeBestOfNEnabled,
				maxConcurrentSpecs: runtimeConfig.speculativeMaxConcurrentSpecs,
				maxSpecsPerRun: runtimeConfig.speculativeMaxSpecsPerRun,
			});
		}
		return service;
	};
	const disposeNKleinTaskSessionServiceAsync = async (workspaceId: string): Promise<void> => {
		await stopChatSandboxManagersByPrefix(`workspace:${workspaceId}`);
		const service = nkleinTaskSessionServiceByWorkspaceId.get(workspaceId);
		if (!service) {
			return;
		}
		nkleinTaskSessionServiceByWorkspaceId.delete(workspaceId);
		// C3 (§5.AF): drop the workspace's durable run + scope entry so a disposed workspace leaves no ghost run the tick
		// timer keeps ticking (review finding #2). No-op when the flag is off.
		durableRunWiring?.dispose(workspaceId);
		scopeByWorkspaceId.delete(workspaceId);
		activeModelTurnsByWorkspaceId.delete(workspaceId);
		modelTurnAdmissionTailByWorkspaceId.delete(workspaceId);
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
		await stopAllChatSandboxManagers();
		deps.workspaceRegistry.clearActiveWorkspace();
	};

	runtimeApi = createRuntimeApi({
		getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
		getActiveWorkspacePath: deps.workspaceRegistry.getActiveWorkspacePath,
		getActiveRuntimeConfig: deps.workspaceRegistry.getActiveRuntimeConfig,
		loadScopedRuntimeConfig: deps.workspaceRegistry.loadScopedRuntimeConfig,
		setActiveRuntimeConfig: (config) => {
			deps.workspaceRegistry.setActiveRuntimeConfig(config);
			// §5.BB: the chat adapter sits below the config plumbing (per-turn client factories), so re-apply its two
			// settings-backed gates here — the ONE seam every config save flows through.
			setChatAdapterRuntimeFlags({
				adaptiveTruncationEnabled: config.chatAdaptiveTruncationEnabled,
				reasoningBudgetEnabled: config.reasoningBudgetEnabled,
			});
		},
		getScopedTerminalManager,
		getScopedNKleinTaskSessionService,
		getLoadedScopedNKleinTaskSessionService: (workspaceScope) =>
			nkleinTaskSessionServiceByWorkspaceId.get(workspaceScope.workspaceId) ?? null,
		getSandboxWorkspaceReadTools: async (session, workspacePath) => {
			if (agentSandboxStatus.state !== "ready") {
				return null;
			}
			try {
				const manager = await getChatSandboxManager(workspacePath);
				return createSandboxWorkspaceReadTools({
					session,
					workspacePath,
					provider: createAgentSandboxChatWorkspaceProvider(manager),
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Chat sandbox read tools unavailable: ${message}`);
				return null;
			}
		},
		getSandboxWorkspaceWriteTools: async (session, workspacePath) => {
			if (agentSandboxStatus.state !== "ready") {
				return null;
			}
			const writableMounts = resolveSandboxWritablePathMounts(workspacePath, session.sandboxWritablePaths);
			if (writableMounts.length === 0) {
				return null;
			}
			try {
				const manager = await getChatSandboxManager(workspacePath, writableMounts);
				return createSandboxWorkspaceWriteTools({
					session,
					workspacePath,
					provider: createAgentSandboxChatWorkspaceProvider(manager),
					writableMounts,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Chat sandbox write tools unavailable: ${message}`);
				return null;
			}
		},
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
			activeModelTurnsByWorkspaceId.clear();
			modelTurnAdmissionTailByWorkspaceId.clear();
			lastNonEmptyModelTurnPsModels = [];
			await stopAllChatSandboxManagers();
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
