import { readdirSync } from "node:fs";
import { restrictToolPoliciesForPlanning } from "../core/decompose-tool-policy";
import {
	applyModelStatsTrackingLevel,
	DEFAULT_MODEL_STATS_TRACKING_LEVEL,
	type ModelStatsTrackingLevel,
} from "../core/model-stats-tracking-level";
import { isTerminalFailureSessionState } from "../core/session-state-predicates";

import { readAgentResultText, readSdkSessionEvent } from "./nklein-sdk-event-readers";

// Task-oriented facade for native NKlein sessions.
// runtime-api.ts uses this service to start sessions, send messages, load
// history, and subscribe to summaries and chat events without knowing SDK
// host, repository, or event-adapter details.

import {
	DEFAULT_BASIC_MEMORY_ENABLED,
	DEFAULT_KNOWS_TODAY_ENABLED,
	DEFAULT_SANDBOX_MCP_SERVERS_ENABLED,
} from "../config/runtime-config-defaults";
import {
	DEFAULT_RETRIEVAL_EGRESS_ENABLED,
	DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL,
} from "../config/runtime-config-retrieval-resolver";
import { buildAttemptRetryNoteFromLedger } from "../core/agent-ledger-projections";
import type { McpAccess, SandboxNetworkPolicy } from "../core/agent-rulesets";
import type {
	RuntimeNKleinTeamProgressEvent,
	RuntimeSwarmGuardrails,
	RuntimeTaskAcceptanceResult,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS, normalizeRuntimeSwarmGuardrails } from "../core/api-contract";
import { derivePromptSessionKind, type PromptWarmthLedgerEntry } from "../core/cache-warmth";
import { isEnabledByDefaultEnv, isTruthyEnv } from "../core/env-flag";
import type { FocusChain } from "../core/focus-chain";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { applyThinkingDisable } from "../core/model-thinking-control";
import type { PromptFragment } from "../core/prompt-fragment-assembly";
import { didCreditLimitJustTrigger, shouldCaptureReviewCheckpoint } from "../core/task-session-guards";
import { decideTemporalContextInjection } from "../core/temporal-context-injection";
import { resolveHomeAgentAppendSystemPrompt } from "../prompts/append-system-prompt";
import { appendAgentLedgerEvent, readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { resolveStableRoutingModelId } from "../state/runtime-id-model-key-map-store";
import { recordTaskRunSummary, type TaskRunTerminalState } from "../state/task-run-summary-store";
import { recordSelfObservation, type SelfObservationEventInput } from "../telemetry/self-observation-sink";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { captureTaskTurnCheckpoint, deleteTaskTurnCheckpointRef } from "../workspace/turn-checkpoints";
import type { AutonomyBudgetWatchdogCallbacks } from "./autonomy-budget-watchdog";
import { AutonomyBudgetWatchdog } from "./autonomy-budget-watchdog";
import type { DecompositionStallNudgerCallbacks } from "./decomposition-stall-nudger";
import { DecompositionStallNudger, isChatOnlyDecompositionActivity } from "./decomposition-stall-nudger";
import { createAcceptanceVerifier } from "./nklein-acceptance-verifier";
import { createAdaptiveBudgetController } from "./nklein-adaptive-budget-controller";
import {
	type AgentSandboxManager,
	type AgentSandboxPoolConfig,
	type AgentSandboxShellTarget,
	createAgentSandboxToolExecutors,
	resolveNKleinAgentPerceivedCwd,
} from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import { createContextBudgetController } from "./nklein-context-budget-controller";
import { buildContextBudgetBreakdown, estimateKanbanToolSchemaTokens } from "./nklein-context-budget-tokens";
import { createContextOverflowController } from "./nklein-context-overflow-controller";
import type { NKleinDecompositionAppliedHandler } from "./nklein-decomposition-tool";
import { applyNKleinSessionEvent } from "./nklein-event-adapter";
import { computeNKleinFailureBackoff } from "./nklein-failure-backoff";
import { createFocusChainStore } from "./nklein-focus-chain-store";
import { extractFocusChainTouchDeltaFromSdkEvent } from "./nklein-focus-chain-touch-delta";
import { buildKanbanEfficiencyRules } from "./nklein-kanban-efficiency-rules";
import {
	type NKleinTaskLaunchConfigOverrides,
	type NKleinTaskRestartLaunchConfig,
	normalizeLaunchConfig,
} from "./nklein-launch-config";
import { buildTerminalAttemptEvent } from "./nklein-ledger-attempt";
import { extractTerminalToolCalls } from "./nklein-ledger-tool-calls";
import { assertLocalProviderAllowed } from "./nklein-local-only-policy";
import {
	createMergeResolutionRunner,
	type NKleinMergeResolutionSessionOutcome,
} from "./nklein-merge-resolution-runner";
import {
	createInMemoryNKleinMessageRepository,
	createTaskEntryFromPersistedSession,
	type NKleinMessageRepository,
} from "./nklein-message-repository";
import { buildSharedLocalEndpointId } from "./nklein-model-registry";
import { createModelResidencyWatcher } from "./nklein-model-residency-watcher";
import { createParkController } from "./nklein-park-controller";
import { NKleinPauseController } from "./nklein-pause-controller";
import { createPlanCritiqueRunner } from "./nklein-plan-critique-runner";
import type { NKleinPlanCritiqueResult } from "./nklein-plan-critique-tool";
import type { NKleinCardPromotedHandler } from "./nklein-promotion-tool";
import { type AssembleSessionSystemPromptInput, createPromptWarmthLedger } from "./nklein-prompt-warmth-ledger";
import { createRetrievalToolsBuilder } from "./nklein-retrieval-tools-builder";
import type { NKleinReviewResult } from "./nklein-review-tool";
import { pickDiverseReviewerModel } from "./nklein-reviewer-model-selection";
import { createRuntimeObservationRecorder } from "./nklein-runtime-observation-recorder";
import type {
	RuntimeTaskSessionStartResult,
	StartRuntimeTaskSessionFromLaunchConfigInput,
} from "./nklein-runtime-session-input";
import { createNKleinRuntimeSetup } from "./nklein-runtime-setup";
import { createRuntimeSetupLeaseCache } from "./nklein-runtime-setup-lease-cache";
import { createSandboxReviewFinalizer } from "./nklein-sandbox-review-finalizer";
import { createSecondOpinionReviewRunner } from "./nklein-second-opinion-review-runner";
import { createSecondarySessionHarness } from "./nklein-secondary-session-harness";
import {
	createInMemoryNKleinSessionRuntime,
	type NKleinPersistedTaskSessionSnapshot,
	type NKleinSessionRuntime,
	readKanbanLaunchConfigFromSessionRecord,
} from "./nklein-session-runtime";
import { buildSessionSkillFragments } from "./nklein-session-skill-fragments";
import {
	clearActiveTurnState,
	cloneSummary,
	createAssistantMessage,
	createDefaultSummary,
	createMessage,
	createMessageWithMeta,
	createSessionId,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	setOrCreateAssistantMessage,
	updateSummary,
} from "./nklein-session-state";
import { createSpeculativeMirrorRunner } from "./nklein-speculative-mirror-runner";
import { TaskContextBudgetInputs } from "./nklein-task-context-budget-inputs";
import { TaskFailureBackoffTracker } from "./nklein-task-failure-backoff-tracker";
import { createTaskFailureEmitter } from "./nklein-task-failure-emitter";
import { TaskModelEndpointStore, UNCONFIGURED_MODEL_ID } from "./nklein-task-model-endpoint-store";
import { TaskPendingTimeoutStore } from "./nklein-task-pending-timeout-store";
import { appendSystemPrompt, buildNKleinStartPromptParts } from "./nklein-task-prompt-builders";
import { isExplicitDecompositionPrompt } from "./nklein-task-prompt-parsing";
import { TaskProviderIdStore } from "./nklein-task-provider-id-store";
import { TaskRequestTimer } from "./nklein-task-request-timer";
import { TaskSandboxStateStore } from "./nklein-task-sandbox-state";
import { formatStartWarnings, resolveNKleinTaskRole, toErrorMessage } from "./nklein-task-session-helpers";
import { shouldDisableSwarmThinking } from "./nklein-task-start-guard";
import type { NKleinTaskTimeoutKind } from "./nklein-task-timeout-handles";
import { createTeamProgressEmitter } from "./nklein-team-progress-emitter";
import { createTimeoutController } from "./nklein-timeout-controller";
import { createNKleinWatcherRegistry, type NKleinWatcherRegistry } from "./nklein-watcher-registry";
import type { RepeatedToolCallGuardCallbacks } from "./repeated-tool-call-guard";
import { RepeatedToolCallGuard } from "./repeated-tool-call-guard";
import type { AgentTool } from "./sdk-agent-types";
import {
	listNKleinSdkWorkflowSlashCommands,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSlashCommand,
	resolveNKleinSdkSystemPromptParts,
} from "./sdk-runtime-boundary.js";
import type { TurnLoopEscalationEvent, TurnLoopGuardCallbacks } from "./turn-loop-guard";
import { TurnLoopGuard } from "./turn-loop-guard";

export type { KanbanContextPressurePolicy, KanbanContextSafetyBudgets } from "./nklein-context-budgets";
export { buildKanbanContextPressurePolicy, buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";
export type { NKleinTaskMessage } from "./nklein-session-state";
export { computeRepeatedToolCallCandidate, formatRepeatedToolCallParkMessage } from "./repeated-tool-call-guard";

/** Overall time budget for a second-opinion reviewer session (first turn + any nudges) before it is abandoned (todo §5.K). */
const DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
/** §5.AW: a speculative mirror is a full worker attempt — give it a worker-scale bound (arbitration usually cancels it sooner). */
/**
 * Opt-in stream-event tracing (`NKLEIN_DEBUG_STREAM_EVENTS=1`). Prints every SDK event reaching the service with a
 * wall-clock timestamp + the gap since the previous event for that task — so a "stream inactivity" stall can be read
 * from the data (is the model actively streaming events, or genuinely silent?) instead of inferred. Default off.
 */
const DEBUG_STREAM_EVENTS = isTruthyEnv(process.env.NKLEIN_DEBUG_STREAM_EVENTS);
const debugStreamEventLastAtByTaskId = new Map<string, number>();
/** Re-prompt budget when a reviewer turn ends without calling `submit_review` (small models often forget). */
const MAX_SECOND_OPINION_REVIEW_NUDGES = 2;
const UNCONFIGURED_PROVIDER_ID = "unconfigured";

import type {
	CreateInMemoryNKleinTaskSessionServiceOptions,
	NKleinModelTurnAdmissionGate,
	NKleinTaskSessionService,
	StartNKleinTaskSessionRequest,
} from "./nklein-task-session-service-types";

// Re-exported for API compatibility — the merge-resolution outcome types now live with their runner (§5.U seam 6/6).
export type {
	NKleinMergeResolutionResolvedFile,
	NKleinMergeResolutionSessionOutcome,
} from "./nklein-merge-resolution-runner";
export type {
	CreateInMemoryNKleinTaskSessionServiceOptions,
	NKleinModelTurnAdmissionGate,
	NKleinModelTurnAdmissionRequest,
	NKleinTaskSessionService,
	StartNKleinTaskSessionRequest,
} from "./nklein-task-session-service-types";

function appendVisibleSystemPromptMessage(entry: NKleinTaskSessionEntry, taskId: string, content: string | null): void {
	const trimmed = content?.trim();
	if (!trimmed || entry.messages.some((message) => message.meta?.messageKind === "system_prompt")) {
		return;
	}
	entry.messages.push(
		createMessageWithMeta(taskId, "system", trimmed, {
			hookEventName: null,
			messageKind: "system_prompt",
			displayRole: "System prompt",
		}),
	);
}

export class InMemoryNKleinTaskSessionService implements NKleinTaskSessionService {
	private readonly pendingTurnCancelTaskIds = new Set<string>();
	private readonly providerIdStore = new TaskProviderIdStore();
	private readonly modelEndpoint = new TaskModelEndpointStore();
	private modelTurnAdmissionGate: NKleinModelTurnAdmissionGate | null = null;
	/** Owns per-task context-window resolution + the pre-send context-budget guard (deps are lazy → field-init safe). */
	private readonly contextBudgetController = createContextBudgetController({
		getModelIdForTask: (taskId) => this.launchConfigByTaskId.get(taskId)?.modelId ?? null,
		getQualityBudget: (modelId) => this.adaptiveBudgetController.getQualityBudget(modelId),
		recordObservation: (event) => this.recordObservationWithModel(event),
	});
	private readonly contextBudgetInputs = new TaskContextBudgetInputs();
	private readonly launchConfigByTaskId = new Map<string, NKleinTaskRestartLaunchConfig>();
	/** §5.AN opt-in residency heartbeats, one per running task (auto-cleaned on session end). */
	private readonly modelResidencyWatcher = createModelResidencyWatcher({
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId),
		getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId),
		clearTaskTimeouts: (taskId) => this.clearTaskTimeouts(taskId),
		abortTaskSession: (taskId) => this.sessionRuntime.abortTaskSession(taskId),
		recordObservation: (event) => this.recordObservationWithModel(event),
		emitTaskFailure: (taskId, entry, context, error) => this.taskFailureEmitter.emit(taskId, entry, context, error),
	});
	private readonly sandboxReviewFinalizer = createSandboxReviewFinalizer({
		getSandboxState: () => this.sandboxState,
		getAgentSandboxManager: () => this.agentSandboxManager,
		getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId),
		emitSummary: (summary) => this.emitSummary(summary),
		emitMessage: (taskId, message) => this.emitMessage(taskId, message),
		isExplicitDecomposition: (taskId) => this.explicitDecompositionTaskIds.has(taskId),
		getDiagnosticStoreRoot: () => this.diagnosticStoreRoot,
		releaseSandboxMcpResources: (taskId) => this.sessionRuntime.releaseTaskMcpTools(taskId),
	});
	/** §5.U auxiliary secondary-session runner: acceptance verification against the delivered tree in a sandbox. */
	private readonly acceptanceVerifier = createAcceptanceVerifier({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getPauseController: () => this.pauseController,
	});
	/** §5.U shared skeleton for the auxiliary secondary sessions (reviewer/plan-critic/merge/mirror): bounded sandbox
	 * session against the delivered tree, always torn down. Runners supply only their `drive` closure. */
	private readonly secondarySessionHarness = createSecondarySessionHarness({
		getAgentSandboxManager: () => this.agentSandboxManager,
		setSandbox: (taskId, repoPath, baseRef) => this.sandboxState.setSandbox(taskId, repoPath, baseRef),
		clearTaskSessions: (taskId) => this.sessionRuntime.clearTaskSessions(taskId),
		forgetSyntheticState: (taskId) => this.forgetSyntheticSessionState(taskId),
	});
	/** §5.U auxiliary secondary-session runner: the §5.AW speculative best-of-N mirror (owns its own cancel flags). */
	private readonly speculativeMirrorRunner = createSpeculativeMirrorRunner({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId),
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId),
		getPauseController: () => this.pauseController,
		setSandbox: (taskId, repoPath, baseRef) => this.sandboxState.setSandbox(taskId, repoPath, baseRef),
		setResultBranch: (taskId, branch) => this.sandboxState.setResultBranch(taskId, branch),
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		cancelTaskTurn: (taskId) => this.cancelTaskTurn(taskId),
		clearTaskSessions: (taskId) => this.sessionRuntime.clearTaskSessions(taskId),
		forgetSyntheticState: (taskId) => this.forgetSyntheticSessionState(taskId),
	});
	/** §5.U auxiliary secondary-session runner: the §5.AK sandbox merge-conflict resolution session. */
	private readonly mergeResolutionRunner = createMergeResolutionRunner({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId),
		pickEscalationModel: (taskId) => this.pickDiverseEscalationModel(taskId),
		getPauseController: () => this.pauseController,
		setSandbox: (taskId, repoPath, baseRef) => this.sandboxState.setSandbox(taskId, repoPath, baseRef),
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		sendTaskSessionInput: (taskId, prompt) => this.sendAuxiliaryTaskSessionInput(taskId, prompt),
		clearTaskSessions: (taskId) => this.sessionRuntime.clearTaskSessions(taskId),
		forgetSyntheticState: (taskId) => this.forgetSyntheticSessionState(taskId),
	});
	/** §5.U auxiliary secondary-session runner: the §5.AB second-opinion reviewer session (owns its single-flight guard). */
	private readonly secondOpinionReviewRunner = createSecondOpinionReviewRunner({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId) ?? null,
		getShellKeyByModelId: () => this.promptWarmthLedger.shellKeyByModelId,
		getPauseController: () => this.pauseController,
		getHarness: () => this.secondarySessionHarness,
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		sendTaskSessionInput: (taskId, prompt) => this.sendAuxiliaryTaskSessionInput(taskId, prompt),
		defaultTimeoutMs: DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS,
		maxNudges: MAX_SECOND_OPINION_REVIEW_NUDGES,
	});
	/** §5.U auxiliary secondary-session runner: the W4.3 plan-critique session (owns its per-run critique budget). */
	private readonly planCritiqueRunner = createPlanCritiqueRunner({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId) ?? null,
		getShellKeyByModelId: () => this.promptWarmthLedger.shellKeyByModelId,
		getPauseController: () => this.pauseController,
		getHarness: () => this.secondarySessionHarness,
		pickEscalationModel: (taskId) => this.pickDiverseEscalationModel(taskId),
		getBaseRef: (taskId) => this.sandboxState.getBaseRef(taskId) ?? null,
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		sendTaskSessionInput: (taskId, prompt) => this.sendAuxiliaryTaskSessionInput(taskId, prompt),
		defaultTimeoutMs: DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS,
		maxNudges: MAX_SECOND_OPINION_REVIEW_NUDGES,
		runBudget: 2,
	});
	/** W2.3a/W1.1b: learned quality-effective budgets (read by the ContextBudgetController) + the stall-signature
	 * adaptive retry (re-sends the card on a raised per-turn budget). Owns its three state maps/flags. */
	private readonly adaptiveBudgetController = createAdaptiveBudgetController({
		hasResultBranch: (taskId) => Boolean(this.sandboxState.getResultBranch(taskId)),
		resolveKnownContextWindow: (taskId) =>
			this.contextBudgetController.resolveKnownContextWindowForTask(taskId, null),
		resendTaskInput: (taskId, text, mode, images, launchConfigOverrides) =>
			this.sendTaskSessionInput(taskId, text, mode, images, launchConfigOverrides),
	});
	/** §5.U: the context-overflow recovery pair (reactive retry-after + proactive compact-before). Session-lifecycle
	 * accessors are supplied lazily so field-init order is irrelevant. */
	private readonly contextOverflowController = createContextOverflowController({
		recordObservationWithModel: (event) => this.recordObservationWithModel(event),
		readPersistedTaskSession: (taskId) => this.sessionRuntime.readPersistedTaskSession(taskId),
		resolvePersistedLaunchConfig: (input) => this.resolvePersistedLaunchConfig(input),
		stopTaskSession: (taskId) => this.sessionRuntime.stopTaskSession(taskId),
		canRestartTaskSession: (taskId) => this.sessionRuntime.canRestartTaskSession(taskId),
		waitUntilTaskResumed: (taskId) => this.waitUntilTaskResumed(taskId),
		markStarted: (taskId) => this.requestTimer.markStarted(taskId),
		restartTaskSession: (input) =>
			this.restartTaskSessionFromResolvedConfig({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: input.initialMessages,
				launchConfig: this.resolveRestartLaunchConfig({
					taskId: input.taskId,
					launchConfigOverrides: input.launchConfigOverrides,
				}),
				fallbackCwd: input.cwd,
			}),
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		prepareMessagesForKnownContextWindow: (input) =>
			this.contextBudgetController.prepareMessagesForKnownContextWindow(input),
		emitSummary: (summary) => this.emitSummary(summary),
	});
	private readonly requestTimer = new TaskRequestTimer(now);
	private readonly failureBackoff = new TaskFailureBackoffTracker();
	/** Classifies + emits a failed SDK start/send (backoff, park-or-review, observation + message + summary). */
	private readonly taskFailureEmitter = createTaskFailureEmitter({
		clearRunTimeouts: (taskId) => {
			this.clearTaskTimeout(taskId, "stream");
			this.clearTaskTimeout(taskId, "tool");
			this.clearTaskTimeout(taskId, "conversation");
		},
		clearActiveToolFlag: (taskId) => {
			this.activeToolTaskIds.delete(taskId);
		},
		resolveProviderId: (taskId) => this.resolveProviderIdForTask(taskId),
		getModelId: (taskId) => this.modelEndpoint.getModelId(taskId),
		getEndpoint: (taskId) => this.modelEndpoint.getEndpoint(taskId),
		getPreviousFailure: (taskId) => this.failureBackoff.getPrevious(taskId),
		recordFailure: (taskId, state) => this.failureBackoff.record(taskId, state),
		emitMessage: (taskId, message) => this.emitMessage(taskId, message),
		emitSummary: (summary) => this.emitSummary(summary),
	});
	/** Builds the §5.AC retrieval tools per task (reads retrieval config LIVE so a mid-session config-off fails closed). */
	private readonly retrievalToolsBuilder = createRetrievalToolsBuilder({
		getRetrievalConfig: () => ({
			egressEnabled: this.retrievalEgressEnabled,
			agentWebResearchAllowed: this.agentWebResearchAllowed,
			searchBackendUrl: this.retrievalSearchBackendUrl,
		}),
		resolveProviderId: (taskId) => this.resolveProviderIdForTask(taskId),
		getModelId: (taskId) => this.modelEndpoint.getModelId(taskId),
		getEndpoint: (taskId) => this.modelEndpoint.getEndpoint(taskId),
	});
	/** Last terminal state already persisted to the durable run-summary store, to dedupe repeated emits. */
	private readonly lastRecordedRunStateByTaskId = new Map<string, TaskRunTerminalState>();
	/** Structured timeout reason for the next terminal run summary, set when a task is aborted on timeout. */
	private readonly pendingTimeout = new TaskPendingTimeoutStore();
	private readonly autonomyBudgetWatchdog: AutonomyBudgetWatchdog;
	private readonly explicitDecompositionTaskIds = new Set<string>();
	private readonly decompositionStallNudger: DecompositionStallNudger;
	private readonly repeatedToolCallGuard: RepeatedToolCallGuard;
	private readonly turnLoopGuard: TurnLoopGuard;
	private readonly activeToolTaskIds = new Set<string>();
	private readonly sandboxState = new TaskSandboxStateStore();
	private readonly sessionRuntime: NKleinSessionRuntime;
	private readonly messageRepository: NKleinMessageRepository;
	private readonly watcherRegistry: NKleinWatcherRegistry;
	private readonly agentSandboxManager: AgentSandboxManager | null;
	private readonly pauseController: NKleinPauseController;
	private readonly onDecompositionApplied: NKleinDecompositionAppliedHandler | undefined;
	private readonly onCardPromoted: NKleinCardPromotedHandler | undefined;
	private readonly onFocusChainUpdated: ((taskId: string, chain: FocusChain) => void | Promise<void>) | undefined;
	private swarmGuardrails: RuntimeSwarmGuardrails;
	/** §5.AC "knows today" runtime-config switch (off by default); live-updated with config, OR-ed with the env override. */
	private knowsTodayEnabled: boolean;
	/** §5.AR curated sandbox-MCP switch (on by default); live-updated with config, OR-ed with the env override. */
	private sandboxMcpServersEnabled: boolean;
	/** §5.AR/§5.BB basic-memory switch (off by default); live-updated with config, OR-ed with the env override. */
	private basicMemoryEnabled: boolean;
	/** §5.AC retrieval egress switch (OFF by default, fail closed); live-updated with config. */
	private retrievalEgressEnabled: boolean;
	private modelStatsTrackingLevel: ModelStatsTrackingLevel;
	/** §5.AC search backend base URL (null ⇒ `web_search` never attaches); live-updated with config. */
	private retrievalSearchBackendUrl: string | null;
	/** §5.L per-role capability gate on web-research (default true = fully_open); live-updated with config. */
	private agentWebResearchAllowed: boolean;
	/** §5.L per-role capability gate on MCP access (default "on" = fully_open); live-updated with config. */
	private agentMcpAccess: McpAccess;
	/** Temp root for diagnostic stores in tests; undefined in production (→ the real `~/.nklein` home). */
	private readonly diagnosticStoreRoot: string | undefined;
	/** Latest focus chain each task emitted (todo §5.N), captured into the terminal run summary. */
	private readonly focusChainStore = createFocusChainStore({
		now,
		onUpdated: (taskId, chain) => this.onFocusChainUpdated?.(taskId, chain),
	});
	private readonly runtimeSetupLeaseCache = createRuntimeSetupLeaseCache({
		acquire: (workspacePath) => this.watcherRegistry.acquire(workspacePath),
	});
	private readonly teamProgressEmitter = createTeamProgressEmitter();
	private readonly parkController = createParkController({
		getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId),
		listSummaries: () => this.messageRepository.listSummaries(),
		emitSummary: (summary) => this.emitSummary(summary),
		emitMessage: (taskId, message) => this.emitMessage(taskId, message),
		clearTaskTimeouts: (taskId) => this.clearTaskTimeouts(taskId),
		checkAutonomyBudget: (taskId, checkpoint, entry) => this.autonomyBudgetWatchdog.check(taskId, checkpoint, entry),
		resetAutonomyBudget: (taskId) => this.autonomyBudgetWatchdog.resetTask(taskId),
		resetRepeatedToolCallGuard: (taskId) => this.repeatedToolCallGuard.resetTask(taskId),
		markTaskParked: (taskId) => this.pauseController.markTaskParked(taskId),
		abortTaskSession: (taskId) => this.sessionRuntime.abortTaskSession(taskId),
		recordObservation: (event) => this.recordObservationWithModel(event),
	});
	private readonly timeoutController = createTimeoutController({
		isToolActive: (taskId) => this.activeToolTaskIds.has(taskId),
		getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId),
		clearTaskRunTeardown: (taskId) => this.clearTaskTimeouts(taskId),
		abortTaskSession: (taskId) => this.sessionRuntime.abortTaskSession(taskId),
		recordTimeout: (taskId, reason, source) => this.pendingTimeout.record(taskId, reason, source),
		canRestartTaskSession: (taskId) => this.sessionRuntime.canRestartTaskSession(taskId),
		recordObservation: (event) => this.recordObservationWithModel(event),
		emitTaskFailure: (taskId, entry, context, error) => this.taskFailureEmitter.emit(taskId, entry, context, error),
	});
	/** §5.U: routes SDK session events + launch metadata into the model registry / self-observation sink. */
	private readonly runtimeObservationRecorder = createRuntimeObservationRecorder({
		resolveTaskModelIdentity: (taskId) => this.resolveTaskModelIdentity(taskId),
		getEndpoint: (taskId) => this.modelEndpoint.getEndpoint(taskId),
		resolveKnownContextWindow: (taskId) =>
			this.contextBudgetController.resolveKnownContextWindowForTask(taskId, null),
		elapsedMs: (taskId, at) => this.requestTimer.elapsedMs(taskId, at),
		forgetTimer: (taskId) => this.requestTimer.forget(taskId),
		recordObservationWithModel: (event) => this.recordObservationWithModel(event),
		isNKleinProviderForTask: (taskId) => this.isNKleinProviderForTask(taskId),
	});

	constructor(options: CreateInMemoryNKleinTaskSessionServiceOptions) {
		if (!options.agentSandboxManager && options.allowUnisolatedTestRuntime !== true) {
			throw new Error(
				"NKlein task sessions require an AgentSandboxManager. Unit tests that stub the SDK runtime must pass allowUnisolatedTestRuntime: true.",
			);
		}
		const createSessionRuntime = options.createSessionRuntime ?? createInMemoryNKleinSessionRuntime;
		const createMessageRepository = options.createMessageRepository ?? createInMemoryNKleinMessageRepository;
		this.watcherRegistry =
			options.watcherRegistry ??
			createNKleinWatcherRegistry({
				createRuntimeSetup: options.createRuntimeSetup ?? createNKleinRuntimeSetup,
			});
		this.sessionRuntime = createSessionRuntime({
			onTaskEvent: (taskId: string, event: unknown) => {
				this.handleTaskEvent(taskId, event);
			},
		});
		this.messageRepository = createMessageRepository();
		this.agentSandboxManager = options.agentSandboxManager ?? null;
		this.pauseController = options.pauseController ?? new NKleinPauseController();
		this.onDecompositionApplied = options.onDecompositionApplied;
		this.onCardPromoted = options.onCardPromoted;
		this.onFocusChainUpdated = options.onFocusChainUpdated;
		this.swarmGuardrails = options.swarmGuardrails ?? DEFAULT_RUNTIME_SWARM_GUARDRAILS;
		this.knowsTodayEnabled = options.knowsTodayEnabled ?? DEFAULT_KNOWS_TODAY_ENABLED;
		this.sandboxMcpServersEnabled = options.sandboxMcpServersEnabled ?? DEFAULT_SANDBOX_MCP_SERVERS_ENABLED;
		this.basicMemoryEnabled = options.basicMemoryEnabled ?? DEFAULT_BASIC_MEMORY_ENABLED;
		this.retrievalEgressEnabled = options.retrievalEgressEnabled ?? DEFAULT_RETRIEVAL_EGRESS_ENABLED;
		this.modelStatsTrackingLevel = options.modelStatsTrackingLevel ?? DEFAULT_MODEL_STATS_TRACKING_LEVEL;
		this.retrievalSearchBackendUrl = options.retrievalSearchBackendUrl ?? DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL;
		this.agentWebResearchAllowed = options.agentWebResearchAllowed ?? true;
		this.agentMcpAccess = options.agentMcpAccess ?? "on";
		this.modelTurnAdmissionGate = options.modelTurnAdmissionGate ?? null;
		this.diagnosticStoreRoot = options.diagnosticStoreRoot;
		this.decompositionStallNudger = new DecompositionStallNudger(this.buildNudgerCallbacks());
		this.repeatedToolCallGuard = new RepeatedToolCallGuard(this.buildGuardCallbacks());
		this.autonomyBudgetWatchdog = new AutonomyBudgetWatchdog(this.buildWatchdogCallbacks());
		this.turnLoopGuard = new TurnLoopGuard(this.buildTurnLoopGuardCallbacks(options.onTurnLoopEscalation));
	}

	private buildTurnLoopGuardCallbacks(
		onTurnLoopEscalation: ((event: TurnLoopEscalationEvent) => void | Promise<void>) | undefined,
	): TurnLoopGuardCallbacks {
		return {
			getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId) ?? null,
			cancelTaskTurn: (taskId) => this.cancelTaskTurn(taskId),
			sendTaskSessionInput: (taskId, text) => this.sendTaskSessionInput(taskId, text),
			pickEscalationModel: (taskId) => this.pickDiverseEscalationModel(taskId),
			parkTaskForAutonomyBudget: (input) => this.parkController.parkTaskForAutonomyBudget(input),
			recordObservation: ({ taskId, message, metadata }) => {
				this.recordObservationWithModel({
					signal: "custom",
					severity: "warning",
					message,
					taskId,
					workspacePath: this.messageRepository.getTaskEntry(taskId)?.summary.workspacePath ?? null,
					metadata,
				});
			},
			...(onTurnLoopEscalation ? { onEscalateModel: onTurnLoopEscalation } : {}),
		};
	}

	private buildGuardCallbacks(): RepeatedToolCallGuardCallbacks {
		return {
			getMaxRepeatedToolCallsPerTask: () => this.swarmGuardrails.maxRepeatedToolCallsPerTask,
			getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId) ?? null,
			parkTaskForAutonomyBudget: (input) => this.parkController.parkTaskForAutonomyBudget(input),
		};
	}

	private buildWatchdogCallbacks(): AutonomyBudgetWatchdogCallbacks {
		return {
			getSwarmGuardrails: () => this.swarmGuardrails,
			isTaskPaused: (taskId) => this.pauseController.isPaused(taskId),
			parkTaskForPause: (input) => this.parkController.parkTaskForPause(input),
			parkTaskForAutonomyBudget: (input) => this.parkController.parkTaskForAutonomyBudget(input),
		};
	}

	private buildNudgerCallbacks(): DecompositionStallNudgerCallbacks {
		return {
			isExplicitDecompositionTask: (taskId) => this.explicitDecompositionTaskIds.has(taskId),
			getTaskSummary: (taskId) => this.messageRepository.getTaskEntry(taskId)?.summary ?? null,
			resolveProviderId: (taskId) => this.resolveProviderIdForTask(taskId),
			resolveModelId: (taskId) => this.modelEndpoint.getModelId(taskId),
			resolveWorkspacePath: (taskId) => this.messageRepository.getTaskEntry(taskId)?.summary.workspacePath ?? null,
			recordObservation: ({ taskId, workspacePath, providerId, modelId, message, metadata }) => {
				recordSelfObservation({
					signal: "budget_wall",
					severity: "warning",
					message,
					taskId,
					workspacePath,
					providerId,
					modelId,
					metadata,
				});
			},
			cancelTaskTurn: (taskId) => this.cancelTaskTurn(taskId),
			sendTaskSessionInput: (taskId, text, mode) => this.sendTaskSessionInput(taskId, text, mode),
		};
	}

	private async prepareSandboxWorkspace(
		request: StartNKleinTaskSessionRequest,
		options?: { onQueued?: () => void },
	): Promise<{
		manager: AgentSandboxManager;
		workdir: string;
	} | null> {
		if (!this.agentSandboxManager) {
			return null;
		}
		const projectRepoPath = request.workspaceRoot?.trim() || request.cwd;
		await this.agentSandboxManager.assertAvailable();
		const resumeResultCommit = request.resumeFromTrash
			? await resolveTaskResultBranchCommit({
					repoPath: projectRepoPath,
					taskId: request.taskId,
				})
			: null;
		const baseRef = resumeResultCommit ?? request.baseRef ?? null;
		const workspace = await this.agentSandboxManager.prepareWorkspace({
			taskId: request.taskId,
			projectRepoPath,
			baseRef,
			onQueued: options?.onQueued,
		});
		this.sandboxState.setSandbox(request.taskId, projectRepoPath, baseRef?.trim() || "HEAD");
		return {
			manager: this.agentSandboxManager,
			workdir: workspace.workdir,
		};
	}

	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		return this.messageRepository.onSummary(listener);
	}

	onMessage(listener: (taskId: string, message: NKleinTaskMessage) => void): () => void {
		return this.messageRepository.onMessage(listener);
	}

	onTeamProgress(listener: (taskId: string, event: RuntimeNKleinTeamProgressEvent) => void): () => void {
		return this.teamProgressEmitter.subscribe(listener);
	}

	private resolveProviderIdForTask(taskId: string): string {
		const cached = this.providerIdStore.get(taskId);
		if (cached) {
			return cached;
		}
		// Fall back to the runtime's last-start-request for tasks rebound from persistence.
		const fromRuntime = this.sessionRuntime.getTaskProviderId(taskId);
		if (fromRuntime) {
			this.providerIdStore.set(taskId, fromRuntime);
			return fromRuntime;
		}
		return UNCONFIGURED_PROVIDER_ID;
	}

	/**
	 * The {providerId, modelId} a task is running under — the identity stamped on the model
	 * observations / telemetry rows the service records. Consolidates the repeated inline pair so
	 * the call sites spread `...this.resolveTaskModelIdentity(taskId)` instead of duplicating both
	 * lookups (provider via the re-derivable cache, model via the model-endpoint store).
	 */
	private resolveTaskModelIdentity(taskId: string): { providerId: string; modelId: string } {
		return {
			providerId: this.resolveProviderIdForTask(taskId),
			// NOTE (§5.BG): telemetry must stay keyed by the RUNTIME id here for now — the READ side (routing candidates,
			// runtime-verdict, ledger evidence) all key off the runtime id (`candidate.entry.key` is built from
			// `descriptor.runtimeId`, and the verdict matches events against `entry.modelId`). Stamping the stable key on
			// the WRITE alone silently misaligns writes vs reads (breaks the stall penalty). The stable-key migration must
			// switch the candidate/registry KEY SOURCE (`d.runtimeId` → `d.modelKey`) and all reads TOGETHER — see §5.BG.
			modelId: this.modelEndpoint.getModelId(taskId),
		};
	}

	/**
	 * Record a self-observation with this task's model identity ({providerId, modelId}) stamped on it — wraps the
	 * recordSelfObservation + `...resolveTaskModelIdentity` pair the service repeats at every model-attributed
	 * observation site, so the identity attachment lives in one place.
	 */
	private recordObservationWithModel(event: SelfObservationEventInput & { taskId: string }): void {
		recordSelfObservation({ ...event, ...this.resolveTaskModelIdentity(event.taskId) });
	}

	private cacheLaunchConfig(
		taskId: string,
		launchConfig: NKleinTaskRestartLaunchConfig,
	): NKleinTaskRestartLaunchConfig {
		// §5.U: the subtle present-vs-absent field normalization is the pure `normalizeLaunchConfig` (unit-tested); this
		// method keeps only the store writes below.
		const normalized = normalizeLaunchConfig(launchConfig);
		this.launchConfigByTaskId.set(taskId, normalized);
		this.providerIdStore.set(taskId, normalized.providerId);
		this.modelEndpoint.set(taskId, normalized.modelId, normalized.baseUrl ?? null);
		if (Object.hasOwn(normalized, "contextWindow")) {
			this.contextBudgetController.resolveContextWindowForTask(taskId, normalized.contextWindow);
		}
		return normalized;
	}

	private resolvePersistedLaunchConfig(input: {
		taskId: string;
		persistedSnapshot?: NKleinPersistedTaskSessionSnapshot | null;
	}): NKleinTaskRestartLaunchConfig | null {
		const cached = this.launchConfigByTaskId.get(input.taskId);
		if (cached) {
			return cached;
		}
		const persisted = input.persistedSnapshot
			? readKanbanLaunchConfigFromSessionRecord(input.persistedSnapshot.record)
			: null;
		if (!persisted) {
			return null;
		}
		return this.cacheLaunchConfig(input.taskId, persisted);
	}

	private resolveRestartLaunchConfig(input: {
		taskId: string;
		persistedSnapshot?: NKleinPersistedTaskSessionSnapshot | null;
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides;
	}): NKleinTaskRestartLaunchConfig | null {
		const persisted = this.resolvePersistedLaunchConfig({
			taskId: input.taskId,
			persistedSnapshot: input.persistedSnapshot,
		});
		if (!input.launchConfigOverrides) {
			return persisted;
		}
		return normalizeLaunchConfig({
			...(persisted ?? {}),
			...input.launchConfigOverrides,
		});
	}

	private async restartTaskSessionFromResolvedConfig(input: {
		taskId: string;
		prompt: string;
		mode?: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		initialMessages?: NKleinSdkPersistedMessage[];
		launchConfig: NKleinTaskRestartLaunchConfig | null;
		persistedSnapshot?: NKleinPersistedTaskSessionSnapshot | null;
		fallbackCwd?: string | null;
	}): Promise<RuntimeTaskSessionStartResult> {
		const sandboxRepoPath = this.sandboxState.getRepoPath(input.taskId)?.trim() || null;
		if (sandboxRepoPath) {
			if (!input.launchConfig) {
				throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
			}
			return await this.startRuntimeTaskSessionFromLaunchConfig({
				taskId: input.taskId,
				cwd: sandboxRepoPath,
				workspaceRoot: sandboxRepoPath,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: input.initialMessages,
				launchConfig: {
					...input.launchConfig,
					workspaceRoot: input.launchConfig.workspaceRoot ?? sandboxRepoPath,
				},
			});
		}

		if (this.sessionRuntime.canRestartTaskSession(input.taskId)) {
			await this.waitUntilTaskResumed(input.taskId);
			this.requestTimer.markStarted(input.taskId);
			const restartedSession = await this.sessionRuntime.restartTaskSession({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: input.initialMessages,
				launchConfigOverrides: input.launchConfig ?? undefined,
				onTeamEvent: (event, teamName) => {
					this.teamProgressEmitter.emit(input.taskId, event, teamName);
				},
			});
			if (input.launchConfig) {
				this.cacheLaunchConfig(input.taskId, input.launchConfig);
			}
			return {
				result: restartedSession.result,
				warnings: restartedSession.warnings,
			};
		}

		const cwd = input.persistedSnapshot?.record.cwd ?? input.fallbackCwd ?? null;
		if (input.launchConfig && cwd) {
			return await this.startRuntimeTaskSessionFromLaunchConfig({
				taskId: input.taskId,
				cwd,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: input.initialMessages,
				launchConfig: input.launchConfig,
			});
		}
		throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
	}

	/**
	 * §5.AQ prompt-warmth ledger: owns the per-model prompt-state maps (full-bytes for reuse telemetry + shell-key
	 * for warmth-aware routing) and assembles the session system prompt around the pure `buildSessionSystemPrompt`.
	 */
	private readonly promptWarmthLedger = createPromptWarmthLedger();

	/**
	 * §5.AC steps 3+4 — the egress-gated retrieval extra tools for one session (`web_search` + `browse_url`), or `[]`
	 * when none may attach. Fail closed, and note the SPLIT GATE:
	 *
	 * - Gate 0 (both tools): synthetic sessions (`::review` / `::plan-critique` / `::acceptance`) NEVER get egress —
	 *   reviewers/critics/acceptance judge local work only. And the egress switch must be literally `true` (default OFF).
	 * - `browse_url` needs ONLY the egress gate: browsing a URL is egress but is INDEPENDENT of the search backend, so a
	 *   configured egress with NO backend URL still gets browse_url (the agent can read URLs it already has).
	 * - `web_search` ADDITIONALLY needs a non-blank backend URL (the SearXNG endpoint). So: egress-on ⇒ browse_url;
	 *   egress-on + backend ⇒ web_search too.
	 *
	 * Both tools run HOST-side in the trusted runtime (the sandbox stays network-isolated; results enter as tool
	 * results). The SearXNG client is constructed per search from the LIVE service fields (cheap factory), so a
	 * config-off mid-session makes the very next call fail closed (`blocked_by_egress`) instead of honoring values
	 * captured at session start. `browse_url` enforces the SSRF guard UNCONDITIONALLY (see nklein-browse-tool.ts): a
	 * sandboxed agent must never reach the operator's LAN/loopback, whatever the host mode — the egress switch is the
	 * on-switch, SSRF-always is the safety floor.
	 */
	/** Sandbox-proxied extra tools ⊕ the §5.AC retrieval tools, or undefined when there is nothing to attach. */
	private static combineExtraTools(
		sandboxExtraTools: AgentTool[] | undefined,
		retrievalExtraTools: AgentTool[],
	): AgentTool[] | undefined {
		if (!sandboxExtraTools && retrievalExtraTools.length === 0) {
			return undefined;
		}
		return [...(sandboxExtraTools ?? []), ...retrievalExtraTools];
	}

	/**
	 * §5.U/§5.AQ — the SINGLE builder for a session's system-prompt assembly input, shared by both start paths
	 * (`startTaskSession` + `startRuntimeTaskSessionFromLaunchConfig`) so they can never drift a §5.AQ prefix byte
	 * apart. The genuinely per-path pieces stay explicit args: `efficiencyRules` (the restart path bakes the lean/full
	 * level, the primary path doesn't), and `planningPrompt` + `skillFragments` (primary-only — the restart path passes
	 * neither, which the pure `buildSessionSystemPrompt` treats byte-identically to the null/[] this defaults them to;
	 * pinned by nklein-session-system-prompt.test.ts). The volatility-ordered fragment assembly itself lives in that
	 * pure, unit-tested function; this only resolves the shared inputs (session kind, home-agent append, temporal block).
	 */
	private buildSessionSystemPromptInput(args: {
		taskId: string;
		prompt: string;
		modelId: string | null | undefined;
		workspacePath: string | null;
		basePrompt: string;
		baseIsStaticShell: boolean;
		sessionEnv: string | null;
		efficiencyRules: string;
		planningPrompt?: string | null;
		attemptRetryNote?: string | null;
		skillFragments?: readonly PromptFragment[];
	}): AssembleSessionSystemPromptInput {
		return {
			taskId: args.taskId,
			modelId: args.modelId,
			sessionKind: derivePromptSessionKind(args.taskId, {
				isExplicitDecomposition: this.explicitDecompositionTaskIds.has(args.taskId),
			}),
			workspacePath: args.workspacePath,
			basePrompt: args.basePrompt,
			baseIsStaticShell: args.baseIsStaticShell,
			homeAgentAppend: resolveHomeAgentAppendSystemPrompt(args.taskId),
			sessionEnv: args.sessionEnv,
			planningPrompt: args.planningPrompt ?? null,
			attemptRetryNote: args.attemptRetryNote ?? null,
			efficiencyRules: args.efficiencyRules,
			temporalBlock: decideTemporalContextInjection({
				enabled: this.knowsTodayEnabled || isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY),
				text: args.prompt,
				now: new Date(),
			}).block,
			skillFragments: args.skillFragments ?? [],
		};
	}

	private async buildAttemptRetryNote(taskId: string): Promise<string | null> {
		if (this.diagnosticStoreRoot) {
			try {
				if (!readdirSync(this.diagnosticStoreRoot).some((file) => file.endsWith(".jsonl"))) {
					return null;
				}
			} catch {
				return null;
			}
		}
		const events = await readAllAgentLedger({ rootDir: this.diagnosticStoreRoot }).catch(() => []);
		const note = buildAttemptRetryNoteFromLedger(events, { workflowId: taskId }).trim();
		return note.length > 0 ? note : null;
	}

	private async withModelTurnAdmission<T>(
		input: {
			taskId: string;
			providerId: string | null | undefined;
			modelId: string | null | undefined;
			endpoint: string | null | undefined;
		},
		run: () => Promise<T>,
	): Promise<T> {
		const gate = this.modelTurnAdmissionGate;
		if (!gate) {
			return await run();
		}
		const providerId = input.providerId?.trim() || "";
		const modelId = input.modelId?.trim() || "";
		if (!providerId || !modelId || providerId === UNCONFIGURED_PROVIDER_ID || modelId === UNCONFIGURED_MODEL_ID) {
			return await run();
		}
		return await gate(
			{
				taskId: input.taskId,
				providerId,
				modelId,
				endpoint: input.endpoint?.trim() || null,
				onWaiting: ({ reason }) => {
					this.recordModelTurnAdmissionWait(input.taskId, reason);
				},
			},
			run,
		);
	}

	private recordModelTurnAdmissionWait(taskId: string, reason: string): void {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (entry?.summary.state !== "running") {
			return;
		}
		const activityText = `Waiting for model capacity — ${reason}`;
		this.emitSummary(
			updateSummary(entry, {
				lastHookAt: now(),
				lastHeartbeatAt: now(),
				heartbeatStatus: "healthy",
				latestHookActivity: {
					activityText,
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "model_turn_admission_wait",
					notificationType: null,
					source: "nklein",
				},
			}),
		);
	}

	private async withModelTurnAdmissionForTask<T>(
		taskId: string,
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides,
		run?: () => Promise<T>,
	): Promise<T> {
		const launchConfig = this.resolveRestartLaunchConfig({ taskId, launchConfigOverrides });
		return await this.withModelTurnAdmission(
			{
				taskId,
				providerId: launchConfig?.providerId,
				modelId: launchConfig?.modelId,
				endpoint: launchConfig?.baseUrl ?? null,
			},
			run ?? (async () => undefined as T),
		);
	}

	private async sendAuxiliaryTaskSessionInput(taskId: string, prompt: string): Promise<unknown> {
		return await this.withModelTurnAdmissionForTask(taskId, undefined, () =>
			this.sessionRuntime.sendTaskSessionInput(taskId, prompt),
		);
	}

	private async startAuxiliaryRuntimeTaskSessionFromLaunchConfig(
		input: StartRuntimeTaskSessionFromLaunchConfigInput,
	): Promise<RuntimeTaskSessionStartResult> {
		return await this.withModelTurnAdmission(
			{
				taskId: input.taskId,
				providerId: input.launchConfig.providerId,
				modelId: input.launchConfig.modelId,
				endpoint: input.launchConfig.baseUrl ?? null,
			},
			() => this.startRuntimeTaskSessionFromLaunchConfig(input),
		);
	}

	private async startRuntimeTaskSessionFromLaunchConfig(
		input: StartRuntimeTaskSessionFromLaunchConfigInput,
	): Promise<RuntimeTaskSessionStartResult> {
		const launchConfig = this.cacheLaunchConfig(input.taskId, input.launchConfig);
		assertLocalProviderAllowed({
			providerId: launchConfig.providerId,
			baseUrl: launchConfig.baseUrl,
		});
		// Host-side runtime setup (rules / tool policy / system prompt) is keyed on the workspace path, so it
		// must use the HOST workspace root — never the agent-perceived `cwd`, which under isolation is the
		// sandbox workdir (`/workspaces/<taskId>`) and does not exist on the host. Feeding the sandbox path
		// here made a restarted isolated task silently load no rules/setup. The host root comes from the
		// persisted launch config (mirrors the main start path, which passes the host `request.cwd`). See the
		// StartNKleinTaskSessionRequest.cwd docs + todo §5.U.
		const hostWorkspaceRoot = input.workspaceRoot?.trim() || launchConfig.workspaceRoot?.trim() || input.cwd;
		// Re-prep the Docker sandbox on a restart-rebuild (invariant #2). The callers reach this path with no
		// live session and no sandbox (e.g. resuming an isolated task after a runtime process restart). Without
		// this, the rebuilt session ran with HOST file tools on a non-existent sandbox `cwd`. prepareSandbox
		// Workspace checks out the task's result branch so accumulated work is present, and records the host
		// repo path so host-side consumers (the send-path `ensureRuntimeSetup`) resolve the host root. Skipped
		// only when the caller already supplied sandbox executors (it then owns the sandbox + cwd).
		const sandboxWorkspace =
			input.toolExecutors || input.extraTools
				? null
				: await this.prepareSandboxWorkspace({
						taskId: input.taskId,
						cwd: hostWorkspaceRoot,
						workspaceRoot: hostWorkspaceRoot,
						prompt: input.prompt,
						resumeFromTrash: true,
					});
		const agentPerceivedCwd = sandboxWorkspace?.workdir ?? input.cwd;
		const runtimeSetup = await this.runtimeSetupLeaseCache.ensure(hostWorkspaceRoot);
		const requestContextWindow = this.contextBudgetController.resolveKnownContextWindowForTask(
			input.taskId,
			launchConfig.contextWindow,
		);
		const customSystemPrompt = input.systemPrompt?.trim() || null;
		const sdkPromptParts = customSystemPrompt
			? null
			: await resolveNKleinSdkSystemPromptParts({
					// Sandbox-aware working directory for the `<session>` trailer; never the host mount (AGENTS.md).
					cwd: resolveNKleinAgentPerceivedCwd(input.taskId, agentPerceivedCwd),
					providerId: launchConfig.providerId,
					rules: runtimeSetup.loadRules(),
				});
		// §5.U/§5.AQ: both start paths build their assembly input through the shared `buildSessionSystemPromptInput`
		// (the byte-stable, volatility-ordered fragment assembly lives in the pure `buildSessionSystemPrompt`). This
		// restart seam also builds the SYNTHETIC sessions (`::review`/`::plan-critique`/`::merge` — kind derived from
		// the task-id suffix) and bakes the lean/full efficiency-rules level; it carries no planning/skill fragments.
		const attemptRetryNote = await this.buildAttemptRetryNote(input.taskId);
		const systemPrompt = this.promptWarmthLedger.assembleAndRecord(
			this.buildSessionSystemPromptInput({
				taskId: input.taskId,
				prompt: input.prompt,
				modelId: launchConfig.modelId,
				workspacePath: hostWorkspaceRoot,
				basePrompt: customSystemPrompt ?? sdkPromptParts?.staticText ?? "",
				baseIsStaticShell: !customSystemPrompt,
				sessionEnv: sdkPromptParts?.sessionEnvText ?? null,
				attemptRetryNote,
				efficiencyRules: buildKanbanEfficiencyRules({
					contextScope: input.contextScope ?? "smart",
					contextWindow: requestContextWindow,
					timeoutMode: input.timeoutMode ?? "normal",
					maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					// W2.4a: small (quality-effective) windows get the LEAN rules. FLAG-GATED OFF after live A/B evidence
					// (run9 2026-07-02): the first lean run showed a small coder model ping-ponging read_files/get_file_size for 14min
					// with zero writes — the dropped "never re-read covered ranges" lines plausibly serve as anti-loop rails
					// for small models. Enable with NKLEIN_LEAN_SYSPROMPT=1 to measure; default full until the scoreboard
					// proves lean safe (research: measure-first).
					level:
						isTruthyEnv(process.env.NKLEIN_LEAN_SYSPROMPT) &&
						requestContextWindow &&
						requestContextWindow <= 40_000
							? "lean"
							: "full",
				}),
			}),
		);

		await this.waitUntilTaskResumed(input.taskId);
		this.requestTimer.markStarted(input.taskId);
		this.adaptiveBudgetController.refreshLearnedQualityBudgets();
		// Sandbox-proxied tool executors / extra tools for the rebuilt session (or the caller's, if supplied).
		const sandboxToolExecutors =
			input.toolExecutors ??
			(sandboxWorkspace
				? createAgentSandboxToolExecutors(sandboxWorkspace.manager, input.taskId, {
						pauseController: this.pauseController,
					})
				: undefined);
		const sandboxExtraTools =
			input.extraTools ??
			(sandboxWorkspace
				? createAgentSandboxExtraTools(sandboxWorkspace.manager, input.taskId, {
						sessionId: createSessionId(input.taskId),
						contextWindow: requestContextWindow,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					})
				: undefined);
		// §5.AC step 3: append the egress-gated web_search tool AFTER the sandbox tools (never mutate what
		// createAgentSandboxExtraTools returns). retrievalToolsBuilder.build fails closed (default-off config, blank
		// backend) and returns [] for synthetic `::` sessions, so reviewers/critics rebuilt here get no egress.
		const combinedExtraTools = InMemoryNKleinTaskSessionService.combineExtraTools(
			sandboxExtraTools,
			this.retrievalToolsBuilder.build(input.taskId),
		);
		const startResult = await this.sessionRuntime
			.startTaskSession({
				taskId: input.taskId,
				cwd: agentPerceivedCwd,
				workspaceRoot: input.workspaceRoot ?? launchConfig.workspaceRoot,
				// W1.3 (audit 2026-07-02): disable thinking on LOW-difficulty cards for switchable models — removes the
				// 500–965-token reasoning tax + its truncation risk at no correctness cost; hard cards keep reasoning.
				prompt: shouldDisableSwarmThinking({
					modelId: launchConfig.modelId,
					prompt: input.prompt,
					taskTitle: null,
				})
					? applyThinkingDisable(input.prompt, launchConfig.modelId ?? "")
					: input.prompt,
				initialMessages: input.initialMessages,
				maxTokensPerTurn: input.maxTokensPerTurn ?? input.launchConfig.maxTokensPerTurn ?? null,
				images: input.images,
				providerId: launchConfig.providerId,
				modelId: launchConfig.modelId,
				mode: input.mode,
				apiKey: launchConfig.apiKey,
				baseUrl: launchConfig.baseUrl,
				reasoningEffort: launchConfig.reasoningEffort,
				contextWindow: requestContextWindow,
				maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines,
				codeEmbeddingProvider: input.codeEmbeddingProvider,
				apiTimeoutMs: launchConfig.apiTimeoutMs,
				turnTimeoutMs: launchConfig.turnTimeoutMs,
				systemPrompt,
				...(sandboxToolExecutors ? { toolExecutors: sandboxToolExecutors } : {}),
				...(combinedExtraTools ? { extraTools: combinedExtraTools } : {}),
				// §5.AR: offer the curated sandbox-hosted MCP servers (fit-gated per model) when enabled — the runtime-config
				// `sandboxMcpServersEnabled` (ON by default; global/per-project opt-out) OR the `NKLEIN_SANDBOX_MCP` env override.
				...(this.isSandboxMcpEnabled() && sandboxWorkspace
					? {
							sandboxMcpExecTarget: sandboxWorkspace.manager.getSandboxExecTarget(input.taskId),
							basicMemoryExecEnv: sandboxWorkspace.manager.getBasicMemoryExecEnv?.(input.taskId),
							// §5.BB: the resolved basic-memory opt-in (setting OR env) rides along so the MCP bundle
							// offers/withholds the default-off basic-memory server consistently with the mounts.
							basicMemoryEnabled: this.isBasicMemoryEnabled(),
						}
					: {}),
				userInstructionService: runtimeSetup.userInstructionService,
				requestToolApproval: runtimeSetup.createToolApproval({
					taskId: input.taskId,
					contextWindow: requestContextWindow,
					maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					filesLikelyTouched: launchConfig.filesLikelyTouched ?? null,
				}),
				// A decompose/plan seed only PLANS (calls decompose_project) — strip execution + write tools so a weak
				// model can't rabbit-hole on run_commands/edits instead of decomposing (sweep run 7, §5.B).
				toolPolicies: this.explicitDecompositionTaskIds.has(input.taskId)
					? restrictToolPoliciesForPlanning(runtimeSetup.toolPolicies)
					: runtimeSetup.toolPolicies,
				onDecompositionApplied: this.onDecompositionApplied,
				requestPlanCritique: this.planCritiqueRunner.buildRequestHandler(input.taskId, hostWorkspaceRoot),
				onCardPromoted: isHomeAgentSessionId(input.taskId) ? undefined : this.onCardPromoted,
				onReviewSubmitted: input.onReviewSubmitted,
				onPlanCritiqueSubmitted: input.onPlanCritiqueSubmitted,
				onMergeResolutionSubmitted: input.onMergeResolutionSubmitted,
				onFocusChainUpdated: (chain) => this.focusChainStore.applyStep(input.taskId, chain),
				onTeamEvent: (event, teamName) => {
					this.teamProgressEmitter.emit(input.taskId, event, teamName);
				},
			})
			.catch(async (error: unknown): Promise<never> => {
				// On a failed restart-rebuild start, release the freshly-prepped sandbox so it isn't leaked.
				await sandboxWorkspace?.manager.disposeWorkspace(input.taskId).catch(() => null);
				throw error;
			});
		return {
			result: startResult.result,
			warnings: startResult.warnings,
		};
	}

	private isNKleinProviderForTask(taskId: string): boolean {
		return this.resolveProviderIdForTask(taskId) === "nklein";
	}

	private recordSessionRecoveryFailure(input: {
		taskId: string;
		operation: "reload_task_session" | "rebind_persisted_task_session";
		error: unknown;
	}): void {
		const errorMessage = toErrorMessage(input.error);
		this.recordObservationWithModel({
			signal: "runtime_error",
			severity: "warning",
			message: `NKlein session recovery failed during ${input.operation}: ${errorMessage}`,
			taskId: input.taskId,
			metadata: {
				operation: input.operation,
				recoveryAction: true,
			},
		});
	}

	private recordLostSessionRecoveryTransition(input: {
		taskId: string;
		transition: "rebound_for_review" | "marked_interrupted";
		workspacePath?: string | null;
	}): void {
		this.recordObservationWithModel({
			signal: "custom",
			severity: "info",
			message:
				input.transition === "rebound_for_review"
					? "Lost session rebound for review."
					: "Lost session marked interrupted.",
			taskId: input.taskId,
			workspacePath: input.workspacePath ?? null,
			metadata: {
				operation: "lost_session_recovery",
				transition: input.transition,
			},
		});
	}

	private clearTaskTimeout(taskId: string, kind: NKleinTaskTimeoutKind): void {
		this.timeoutController.clearKind(taskId, kind);
	}

	private clearTaskTimeouts(taskId: string): void {
		this.timeoutController.clearAll(taskId);
		this.activeToolTaskIds.delete(taskId);
		this.modelResidencyWatcher.stop(taskId);
	}

	private async dispatchResolvedTaskInput(input: {
		taskId: string;
		prompt: string;
		mode?: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		delivery?: "queue" | "steer";
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides;
		forceRestart?: boolean;
	}): Promise<{
		result: unknown;
		warnings?: string[];
	}> {
		if (
			!input.forceRestart &&
			this.sessionRuntime.getTaskSessionId(input.taskId) &&
			!this.sessionRuntime.requiresTaskSessionRestart(input.taskId, input.mode, input.launchConfigOverrides)
		) {
			await this.waitUntilTaskResumed(input.taskId);
			this.requestTimer.markStarted(input.taskId);
			return {
				result: await this.sessionRuntime.sendTaskSessionInput(
					input.taskId,
					input.prompt,
					input.mode,
					input.images,
					input.delivery,
					input.launchConfigOverrides,
				),
			};
		}

		if (this.sessionRuntime.getTaskSessionId(input.taskId)) {
			const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId);
			const restartLaunchConfig = this.resolveRestartLaunchConfig({
				taskId: input.taskId,
				persistedSnapshot,
				launchConfigOverrides: input.launchConfigOverrides,
			});
			const contextWindow = this.contextBudgetController.resolveKnownContextWindowForTask(
				input.taskId,
				restartLaunchConfig?.contextWindow,
			);
			const initialMessages = this.contextBudgetController.prepareMessagesForKnownContextWindow({
				taskId: input.taskId,
				messages: persistedSnapshot?.messages,
				prompt: input.prompt,
				images: input.images,
				contextWindow,
			});
			await this.sessionRuntime.stopTaskSession(input.taskId);
			return await this.restartTaskSessionFromResolvedConfig({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages,
				launchConfig: restartLaunchConfig,
				persistedSnapshot,
			});
		}

		if (isHomeAgentSessionId(input.taskId) && !this.sessionRuntime.canRestartTaskSession(input.taskId)) {
			throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
		}

		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId);
		const restartLaunchConfig = this.resolveRestartLaunchConfig({
			taskId: input.taskId,
			persistedSnapshot,
			launchConfigOverrides: input.launchConfigOverrides,
		});
		const contextWindow = this.contextBudgetController.resolveKnownContextWindowForTask(
			input.taskId,
			restartLaunchConfig?.contextWindow,
		);
		const initialMessages = this.contextBudgetController.prepareMessagesForKnownContextWindow({
			taskId: input.taskId,
			messages: persistedSnapshot?.messages,
			prompt: input.prompt,
			images: input.images,
			contextWindow,
		});
		return await this.restartTaskSessionFromResolvedConfig({
			taskId: input.taskId,
			prompt: input.prompt,
			mode: input.mode,
			images: input.images,
			initialMessages,
			launchConfig: restartLaunchConfig,
			persistedSnapshot,
		});
	}

	async startTaskSession(request: StartNKleinTaskSessionRequest): Promise<RuntimeTaskSessionSummary> {
		const existing = this.messageRepository.getTaskEntry(request.taskId);
		if (
			!request.resumeFromTrash &&
			!request.resumeFromPersistence &&
			existing &&
			(existing.summary.state === "queued" ||
				existing.summary.state === "running" ||
				existing.summary.state === "awaiting_review")
		) {
			return cloneSummary(existing.summary);
		}
		const providerId = request.providerId?.trim().toLowerCase() || UNCONFIGURED_PROVIDER_ID;
		this.providerIdStore.set(request.taskId, providerId);
		this.autonomyBudgetWatchdog.resetTask(request.taskId);
		this.repeatedToolCallGuard.resetTask(request.taskId);
		this.turnLoopGuard.resetTask(request.taskId);
		this.decompositionStallNudger.resetTask(request.taskId);
		if (request.startInPlanMode && isExplicitDecompositionPrompt(request.prompt)) {
			this.explicitDecompositionTaskIds.add(request.taskId);
		} else {
			this.explicitDecompositionTaskIds.delete(request.taskId);
		}
		const requestContextWindow = this.contextBudgetController.resolveKnownContextWindowForTask(
			request.taskId,
			request.contextWindow ?? null,
		);
		const modelId = request.modelId?.trim() || UNCONFIGURED_MODEL_ID;
		const endpoint = request.baseUrl?.trim() || null;
		const sharedEndpointId = buildSharedLocalEndpointId({ providerId, modelId, endpoint });
		this.modelEndpoint.set(request.taskId, modelId, endpoint, request.stableModelKey);
		this.runtimeObservationRecorder.recordLaunchContextWindow({
			providerId,
			modelId,
			endpoint,
			contextWindow: request.contextWindow ?? null,
		});
		this.cacheLaunchConfig(request.taskId, {
			providerId,
			modelId,
			workspaceRoot: request.workspaceRoot,
			filesLikelyTouched: request.filesLikelyTouched ?? null,
			apiKey: request.apiKey,
			baseUrl: request.baseUrl,
			reasoningEffort: request.reasoningEffort,
			contextWindow: requestContextWindow,
			maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
			apiTimeoutMs: request.requestTimeoutMs,
			turnTimeoutMs: request.turnTimeoutMs,
		});
		const resolvedMode: RuntimeTaskSessionMode = request.startInPlanMode ? "act" : (request.mode ?? "act");
		// A work card (not plan-mode, not a home/chat session) gets the Planning/Refinement preamble + the
		// begin_implementation promotion tool (todo §5.B); home/chat and decompose/plan cards do not.
		const isRefinableWorkCard = !request.startInPlanMode && !isHomeAgentSessionId(request.taskId);
		const startPromptParts = buildNKleinStartPromptParts(
			request.prompt,
			request.startInPlanMode,
			isRefinableWorkCard,
		);
		const normalizedPrompt = startPromptParts.userPrompt.trim();
		const hasRequestImages = Boolean(request.images && request.images.length > 0);
		const initialState = request.resumeFromTrash
			? "awaiting_review"
			: normalizedPrompt.length > 0 || hasRequestImages
				? "running"
				: "idle";
		const initialReviewReason = request.resumeFromTrash ? "attention" : null;
		const shouldHydratePersistedHistory = request.resumeFromTrash || request.resumeFromPersistence;
		const persistedResumeSnapshot = shouldHydratePersistedHistory
			? await this.sessionRuntime.readPersistedTaskSession(request.taskId).catch(() => null)
			: null;
		const entry = persistedResumeSnapshot
			? createTaskEntryFromPersistedSession(request.taskId, persistedResumeSnapshot.messages, {
					state: initialState,
					mode: resolvedMode,
					workspacePath: request.cwd,
					providerId,
					modelId,
					endpoint,
					sharedEndpointId,
					startedAt: now(),
					lastOutputAt: now(),
					reviewReason: initialReviewReason,
				})
			: ({
					summary: {
						...createDefaultSummary(request.taskId),
						state: initialState,
						mode: resolvedMode,
						workspacePath: request.cwd,
						providerId,
						modelId,
						endpoint,
						sharedEndpointId,
						startedAt: now(),
						lastOutputAt: now(),
						reviewReason: initialReviewReason,
					},
					messages: [],
					activeAssistantMessageId: null,
					activeReasoningMessageId: null,
					toolMessageIdByToolCallId: new Map<string, string>(),
					toolInputByToolCallId: new Map<string, unknown>(),
				} satisfies NKleinTaskSessionEntry);
		this.messageRepository.setTaskEntry(request.taskId, entry);
		this.pendingTurnCancelTaskIds.delete(request.taskId);
		this.clearTaskTimeouts(request.taskId);
		this.timeoutController.setSettings(request.taskId, {
			streamTimeoutMs: request.streamTimeoutMs ?? null,
			toolTimeoutMs: request.toolTimeoutMs ?? null,
			conversationTimeoutMs: request.conversationTimeoutMs ?? null,
			streamTimeoutSource: request.streamTimeoutSource ?? null,
			toolTimeoutSource: request.toolTimeoutSource ?? null,
			conversationTimeoutSource: request.conversationTimeoutSource ?? null,
		});
		let sandboxWorkspace: { manager: AgentSandboxManager; workdir: string } | null;
		let queuedForSandboxCapacity = false;
		try {
			sandboxWorkspace = await this.prepareSandboxWorkspace(request, {
				onQueued: () => {
					queuedForSandboxCapacity = true;
					this.emitSummary(
						updateSummary(entry, {
							state: "queued",
							workspacePath: request.cwd,
							lastOutputAt: now(),
							lastHookAt: now(),
							lastTokenAt: null,
							lastHeartbeatAt: null,
							heartbeatStatus: "healthy",
							warningMessage: null,
							latestHookActivity: {
								activityText: "Queued — waiting for sandbox capacity",
								toolName: null,
								toolInputSummary: null,
								finalMessage: null,
								hookEventName: "sandbox_queue",
								notificationType: null,
								source: "nklein",
							},
						}),
					);
				},
			});
		} catch (error) {
			if (queuedForSandboxCapacity) {
				this.taskFailureEmitter.emit(request.taskId, entry, "start", error);
			}
			throw error;
		}
		// The agent-perceived working directory: the in-container sandbox workdir when isolation is active,
		// else the host path. This is what the session runtime receives as `cwd` (host control-plane reads
		// keep using `request.workspaceRoot ?? request.cwd`); see the StartNKleinSessionRuntimeRequest docs.
		const agentPerceivedCwd = sandboxWorkspace?.workdir ?? request.cwd;
		entry.summary = {
			...entry.summary,
			state: initialState,
			workspacePath: agentPerceivedCwd,
			reviewReason: initialReviewReason,
			role: resolveNKleinTaskRole(request.taskId, this.explicitDecompositionTaskIds.has(request.taskId)),
			warningMessage: queuedForSandboxCapacity ? null : entry.summary.warningMessage,
			latestHookActivity: queuedForSandboxCapacity ? null : entry.summary.latestHookActivity,
			updatedAt: now(),
		};

		if (!request.resumeFromTrash && (normalizedPrompt.length > 0 || hasRequestImages)) {
			const messageCountBeforeSystemPrompt = entry.messages.length;
			appendVisibleSystemPromptMessage(entry, request.taskId, startPromptParts.systemPrompt);
			for (const systemMessage of entry.messages.slice(messageCountBeforeSystemPrompt)) {
				this.emitMessage(request.taskId, systemMessage);
			}
			const message = createMessage(request.taskId, "user", normalizedPrompt, request.images);
			entry.messages.push(message);
			this.emitMessage(request.taskId, message);
			const runningSummary = updateSummary(entry, {
				state: "running",
				reviewReason: null,
				lastOutputAt: now(),
				lastHookAt: now(),
				lastTokenAt: null,
				lastHeartbeatAt: now(),
				heartbeatStatus: "healthy",
				latestHookActivity: {
					activityText: "Agent active",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "turn_start",
					notificationType: null,
					source: "nklein-sdk",
				},
			});
			this.emitSummary(runningSummary);
		}
		this.emitSummary(entry.summary);

		void (async () => {
			const assistantCountBeforeStart = entry.messages.filter((message) => message.role === "assistant").length;
			try {
				const runtimeSetup = await this.runtimeSetupLeaseCache.ensure(request.cwd);
				const runtimePrompt = runtimeSetup.resolvePrompt(startPromptParts.userPrompt);
				const planningWorkflowPrompt = startPromptParts.systemWorkflowCommand
					? runtimeSetup.resolvePrompt(startPromptParts.systemWorkflowCommand)
					: null;
				const planningSystemPrompt = startPromptParts.systemPrompt
					? planningWorkflowPrompt
						? appendSystemPrompt(planningWorkflowPrompt, startPromptParts.systemPrompt)
						: startPromptParts.systemPrompt
					: null;
				const customSystemPrompt = request.systemPrompt?.trim() || null;
				const sdkPromptParts = customSystemPrompt
					? null
					: await resolveNKleinSdkSystemPromptParts({
							// The system prompt's `<session>` "Working Directory" must match the agent's actual (sandbox)
							// cwd, never the host mount — agents must never see host details (AGENTS.md). Same helper as
							// the agent-core `config.cwd`, so the two can't drift (the bug that leaked the host path here).
							cwd: resolveNKleinAgentPerceivedCwd(request.taskId, request.cwd),
							providerId,
							rules: runtimeSetup.loadRules(),
						});
				// W2.3b (§5.AQ): volatility-ordered fragment assembly. Since the §5.AQ(e) shell restructure the
				// head-pinned base is a byte-stable static shell (its cwd/date live in the session-env trailer), so
				// the assembly is base (static, head) → rules (config) → date (daily) → planning workflow (task) →
				// home-agent append (task) → session-env (task, LAST — the true task-volatile suffix).
				// §5.AE: resolve the session's active skills → their `wired` system-prompt fragments (today: a repo map
				// for a code/planning session). Fail-soft to [] — never blocks a start.
				const sessionSkillFragments = await buildSessionSkillFragments({
					role: resolveNKleinTaskRole(request.taskId, this.explicitDecompositionTaskIds.has(request.taskId)),
					taskText: request.prompt,
					workspacePath: request.workspaceRoot?.trim() || request.cwd,
					modelId,
					// Same gate the tool bundle uses to offer curated sandbox MCP servers — so the structural-retrieval
					// nudge is added exactly when (and only when) a structural code-graph server is offered to this model.
					sandboxMcpEnabled: this.isSandboxMcpEnabled(),
					// §5.AE honor the user's skill-dynamics level so the fragment resolution matches the affinity-tag one.
					...(request.skillDynamicsLevel ? { dynamicsLevel: request.skillDynamicsLevel } : {}),
				});
				const attemptRetryNote = await this.buildAttemptRetryNote(request.taskId);
				const systemPrompt = this.promptWarmthLedger.assembleAndRecord(
					this.buildSessionSystemPromptInput({
						taskId: request.taskId,
						prompt: request.prompt,
						modelId,
						workspacePath: request.workspaceRoot?.trim() || request.cwd,
						basePrompt: customSystemPrompt ?? sdkPromptParts?.staticText ?? "",
						baseIsStaticShell: !customSystemPrompt,
						sessionEnv: sdkPromptParts?.sessionEnvText ?? null,
						planningPrompt: planningSystemPrompt,
						attemptRetryNote,
						efficiencyRules: buildKanbanEfficiencyRules({
							contextScope: request.contextScope ?? "smart",
							contextWindow: requestContextWindow,
							timeoutMode: request.timeoutMode ?? "normal",
							maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
						}),
						skillFragments: sessionSkillFragments,
					}),
				);
				const toolSchemaTokens = estimateKanbanToolSchemaTokens(runtimeSetup.toolPolicies);
				this.contextBudgetInputs.record(request.taskId, systemPrompt, toolSchemaTokens);

				const initialMessages = this.contextBudgetController.prepareMessagesForKnownContextWindow({
					taskId: request.taskId,
					messages: persistedResumeSnapshot?.messages ?? request.initialMessages,
					prompt: runtimePrompt,
					images: request.images,
					contextWindow: requestContextWindow,
				});
				this.emitSummary(
					updateSummary(entry, {
						contextBudgetBreakdown: buildContextBudgetBreakdown({
							systemPrompt,
							toolSchemaTokens,
							messages: initialMessages,
							prompt: runtimePrompt,
							images: request.images,
							contextWindow: requestContextWindow,
						}),
					}),
				);
				if (entry.summary.state === "running") {
					this.timeoutController.scheduleStreamTimeout(request.taskId);
					this.timeoutController.scheduleConversationTimeout(request.taskId);
					this.modelResidencyWatcher.begin(request.taskId);
				}
				await this.waitUntilTaskResumed(request.taskId);
				this.requestTimer.markStarted(request.taskId);
				const startResult = await this.sessionRuntime.startTaskSession({
					taskId: request.taskId,
					cwd: agentPerceivedCwd,
					// Always hand the runtime a host workspace root so the trusted control-plane decomposition
					// tools resolve plan artifacts + board mutations to the host owning workspace, never to the
					// container workdir (agentPerceivedCwd points inside the sandbox volume when isolation is active).
					workspaceRoot: request.workspaceRoot ?? request.cwd,
					// W1.3 (audit 2026-07-02): disable thinking on LOW-difficulty cards for switchable models — removes
					// the 500–965-token reasoning tax + its truncation risk; hard cards keep their reasoning.
					prompt: shouldDisableSwarmThinking({
						modelId,
						prompt: runtimePrompt,
						taskTitle: request.taskTitle ?? null,
					})
						? applyThinkingDisable(runtimePrompt, modelId ?? "")
						: runtimePrompt,
					taskTitle: request.taskTitle,
					maxTokensPerTurn: request.maxTokensPerTurn ?? null,
					initialMessages,
					images: request.images,
					providerId,
					modelId,
					mode: resolvedMode,
					apiKey: request.apiKey,
					baseUrl: request.baseUrl,
					reasoningEffort: request.reasoningEffort,
					contextWindow: requestContextWindow,
					codeEmbeddingProvider: request.codeEmbeddingProvider,
					apiTimeoutMs: request.requestTimeoutMs,
					turnTimeoutMs: request.turnTimeoutMs,
					systemPrompt,
					userInstructionService: runtimeSetup.userInstructionService,
					requestToolApproval: runtimeSetup.createToolApproval({
						taskId: request.taskId,
						contextWindow: requestContextWindow,
						maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
						filesLikelyTouched: request.filesLikelyTouched ?? null,
					}),
					toolExecutors: sandboxWorkspace
						? createAgentSandboxToolExecutors(sandboxWorkspace.manager, request.taskId, {
								pauseController: this.pauseController,
							})
						: undefined,
					// §5.AC step 3: sandbox tools ⊕ the egress-gated web_search tool (config-gated, fail closed; [] for
					// synthetic `::` sessions). Concatenated here — createAgentSandboxExtraTools stays untouched.
					extraTools: InMemoryNKleinTaskSessionService.combineExtraTools(
						sandboxWorkspace
							? createAgentSandboxExtraTools(sandboxWorkspace.manager, request.taskId, {
									sessionId: createSessionId(request.taskId),
									contextWindow: requestContextWindow,
									maxFileLines: request.maxAgentWritableFileLines ?? null,
								})
							: undefined,
						this.retrievalToolsBuilder.build(request.taskId),
					),
					// §5.AR: a RESTARTED isolated task gets the curated sandbox MCP servers too (consistent with the main
					// start path) — gated by the config setting (on by default) OR the env override, and only when a sandbox
					// exists for the rebuilt task.
					...(this.isSandboxMcpEnabled() && sandboxWorkspace
						? {
								sandboxMcpExecTarget: sandboxWorkspace.manager.getSandboxExecTarget(request.taskId),
								basicMemoryExecEnv: sandboxWorkspace.manager.getBasicMemoryExecEnv?.(request.taskId),
								// §5.BB: same resolved basic-memory opt-in as the main start path.
								basicMemoryEnabled: this.isBasicMemoryEnabled(),
							}
						: {}),
					// Decompose/plan seed: read-only + decompose_project only (strip execution/write) — §5.B, sweep run 7.
					toolPolicies: this.explicitDecompositionTaskIds.has(request.taskId)
						? restrictToolPoliciesForPlanning(runtimeSetup.toolPolicies)
						: runtimeSetup.toolPolicies,
					onDecompositionApplied: this.onDecompositionApplied,
					requestPlanCritique: this.planCritiqueRunner.buildRequestHandler(request.taskId, request.cwd),
					onCardPromoted: isHomeAgentSessionId(request.taskId) ? undefined : this.onCardPromoted,
					onFocusChainUpdated: (chain) => this.focusChainStore.applyStep(request.taskId, chain),
					onTeamEvent: (event, teamName) => {
						this.teamProgressEmitter.emit(request.taskId, event, teamName);
					},
				});
				const warningMessage = formatStartWarnings(startResult.warnings);
				this.failureBackoff.forget(request.taskId);
				if (warningMessage) {
					this.emitSummary(
						updateSummary(entry, {
							warningMessage,
						}),
					);
				}

				const initialAgentText = readAgentResultText(startResult.result);
				if (initialAgentText) {
					const assistantCountAfterStart = entry.messages.filter((message) => message.role === "assistant").length;
					if (assistantCountAfterStart > assistantCountBeforeStart) {
						return;
					}
					const agentMessage =
						setOrCreateAssistantMessage(entry, request.taskId, initialAgentText) ??
						createAssistantMessage(entry, request.taskId, initialAgentText);
					this.emitMessage(request.taskId, agentMessage);
				}
			} catch (error) {
				this.clearTaskTimeouts(request.taskId);
				await sandboxWorkspace?.manager.disposeWorkspace(request.taskId).catch(() => null);
				this.taskFailureEmitter.emit(request.taskId, entry, "start", error);
			}
		})();

		return cloneSummary(entry.summary);
	}

	async stopTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		let entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			// Runtime restarts can clear in-memory task entries while the SDK still has a persisted
			// session for this task. Rebind first so stop() can target that recovered session id.
			const reboundSummary = await this.rebindPersistedTaskSession(taskId);
			if (!reboundSummary) {
				return null;
			}
			entry = this.messageRepository.getTaskEntry(taskId);
			if (!entry) {
				return reboundSummary;
			}
		}
		this.resetInterruptedTaskState(taskId);
		this.launchConfigByTaskId.delete(taskId);
		await this.sessionRuntime.stopTaskSession(taskId).catch(() => null);
		await this.agentSandboxManager?.disposeWorkspace(taskId).catch(() => null);
		this.forgetSandboxTask(taskId);
		if (entry.summary.state === "idle") {
			return cloneSummary(entry.summary);
		}
		const summary = updateSummary(entry, {
			state: "interrupted",
			reviewReason: "interrupted",
			exitCode: null,
			lastOutputAt: now(),
		});
		if (entry.summary.heartbeatStatus === "lost") {
			this.recordLostSessionRecoveryTransition({
				taskId,
				transition: "marked_interrupted",
				workspacePath: summary.workspacePath,
			});
		}
		this.emitSummary(summary);
		return summary;
	}

	async completeTaskSessionAfterDecomposition(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return null;
		}
		this.resetInterruptedTaskState(taskId);
		this.launchConfigByTaskId.delete(taskId);
		// HARD-abort, not graceful stop (runs 21/22 live finding): the architect's in-flight turn kept streaming
		// after the card completed — its hooks flipped the summary back to "running" for 18+ minutes, holding the
		// endpoint slot AND defeating the dead-stall detector (a phantom-alive session). The decomposition is
		// applied; whatever the turn was still generating is pure waste.
		this.clearTaskTimeout(taskId, "stream");
		this.clearTaskTimeout(taskId, "tool");
		this.clearTaskTimeout(taskId, "conversation");
		await this.sessionRuntime.abortTaskSession(taskId).catch(() => null);
		clearActiveTurnState(entry);
		await this.agentSandboxManager?.disposeWorkspace(taskId).catch(() => null);
		this.forgetSandboxTask(taskId);
		const message = "Decomposition applied; source task completed.";
		const summary = updateSummary(entry, {
			state: "idle",
			reviewReason: null,
			exitCode: 0,
			lastOutputAt: now(),
			lastHookAt: now(),
			lastHeartbeatAt: now(),
			heartbeatStatus: "healthy",
			latestHookActivity: {
				activityText: message,
				toolName: "decompose_project",
				toolInputSummary: null,
				finalMessage: message,
				hookEventName: "decomposition_applied",
				notificationType: null,
				source: "nklein",
			},
		});
		this.emitSummary(summary);
		return summary;
	}

	async abortTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return null;
		}
		this.resetInterruptedTaskState(taskId);
		await this.sessionRuntime.abortTaskSession(taskId).catch(() => null);
		await this.agentSandboxManager?.disposeWorkspace(taskId).catch(() => null);
		this.forgetSandboxTask(taskId);
		const summary = updateSummary(entry, {
			state: "interrupted",
			reviewReason: "interrupted",
			exitCode: null,
			lastOutputAt: now(),
		});
		this.emitSummary(summary);
		return summary;
	}

	async cancelTaskTurn(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return null;
		}
		if (entry.summary.state !== "running") {
			return null;
		}
		this.pendingTurnCancelTaskIds.add(taskId);
		this.clearTaskTimeout(taskId, "stream");
		this.clearTaskTimeout(taskId, "tool");
		this.decompositionStallNudger.clearDecompositionChatNudge(taskId);
		this.activeToolTaskIds.delete(taskId);
		await this.sessionRuntime.abortTaskSession(taskId).catch(() => null);
		clearActiveTurnState(entry);
		const summary = updateSummary(entry, {
			state: "idle",
			reviewReason: null,
			exitCode: null,
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: "Turn canceled",
				toolName: null,
				toolInputSummary: null,
				finalMessage: null,
				hookEventName: "turn_canceled",
				notificationType: null,
				source: "nklein-sdk",
			},
		});
		this.emitSummary(summary);
		return summary;
	}

	/**
	 * Run20 live finding: `finalizeSandboxReview` disposes the worker's sandbox workspace right after capturing
	 * the result branch (the branch holds the work; the slot frees) — but a review BOUNCE/ESCALATION re-drives
	 * the SAME live session, whose tools then operate on a DELETED cwd (every read ENOENT'd; the worker flailed
	 * "the repository is missing critical files" until the park rung gave up). The placement path is
	 * deterministic from the taskId, so re-preparing under the same id makes the session's existing sandbox
	 * executors valid again — checked out at the RESULT BRANCH first, so the accumulated work is present for the
	 * follow-up round. No-op when there is no sandbox manager, the task never had a sandbox, or its concrete Docker
	 * cwd is still present. A placement-map hit alone is not enough: a crashed/restarted container can leave stale
	 * manager state while `/workspaces/<task>` is gone.
	 */
	private async restoreDisposedSandboxWorkspaceForRedrive(taskId: string): Promise<boolean> {
		const manager = this.agentSandboxManager;
		const repoPath = this.sandboxState.getRepoPath(taskId);
		if (!manager || !repoPath) {
			return false;
		}
		try {
			const hasPlacement = manager.hasWorkspace(taskId);
			if (hasPlacement && (await manager.isWorkspacePrepared(taskId))) {
				return false;
			}
			await this.sessionRuntime.releaseTaskMcpTools(taskId).catch(() => undefined);
			if (hasPlacement) {
				await manager.disposeWorkspace(taskId).catch(() => null);
			}
			const resultCommit = await resolveTaskResultBranchCommit({ repoPath, taskId }).catch(() => null);
			await manager.prepareWorkspace({
				taskId,
				projectRepoPath: repoPath,
				baseRef: resultCommit ?? this.sandboxState.getBaseRef(taskId) ?? null,
				maxQueueWaitMs: 120_000,
			});
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Restored the disposed sandbox workspace for ${taskId} before a re-drive turn (checked out ${resultCommit ? "the result branch" : "the base ref"}).`,
				taskId,
				workspacePath: repoPath,
				metadata: { category: "sandbox_workspace_redrive_restore", fromResultBranch: Boolean(resultCommit) },
			});
			return true;
		} catch (error) {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `Could not restore the sandbox workspace for ${taskId} before a re-drive: ${error instanceof Error ? error.message : String(error)}`,
				taskId,
				workspacePath: repoPath,
				createdAt: Date.now(),
			});
			throw error;
		}
	}

	async sendTaskSessionInput(
		taskId: string,
		text: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides,
	): Promise<RuntimeTaskSessionSummary | null> {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return null;
		}
		if (
			entry.summary.state !== "running" &&
			entry.summary.state !== "paused" &&
			entry.summary.state !== "awaiting_review" &&
			entry.summary.state !== "idle" &&
			entry.summary.state !== "failed"
		) {
			return null;
		}
		this.pendingTurnCancelTaskIds.delete(taskId);
		const normalized = text.trim();
		const hasImages = Boolean(images && images.length > 0);
		const effectiveMode: RuntimeTaskSessionMode = mode ?? entry.summary.mode ?? "act";
		const queueDelivery = entry.summary.state === "running";
		if (normalized.length === 0 && !hasImages) {
			return null;
		}
		this.failureBackoff.forget(taskId);
		this.repeatedToolCallGuard.resetTask(taskId);
		if (!this.sessionRuntime.getTaskSessionId(taskId)) {
			if (isHomeAgentSessionId(taskId) && !this.sessionRuntime.canRestartTaskSession(taskId)) {
				return null;
			}
		}
		if (
			queueDelivery &&
			this.sessionRuntime.requiresTaskSessionRestart(taskId, effectiveMode, launchConfigOverrides)
		) {
			throw new Error(
				"Finish or cancel the active !Klein turn before changing its mode, provider, endpoint, reasoning, context, or timeout settings.",
			);
		}
		{
			const deliverResolvedInput = async (): Promise<{
				result: unknown;
				warnings?: string[];
				assistantCountBeforeSend: number;
			}> => {
				if (this.messageRepository.getTaskEntry(taskId) !== entry) {
					return { result: null, assistantCountBeforeSend: entry.messages.length };
				}
				const message = createMessage(taskId, "user", normalized, images);
				entry.messages.push(message);
				this.emitMessage(taskId, message);
				clearActiveTurnState(entry);
				const waitingSummary = updateSummary(entry, {
					state: "running",
					mode: effectiveMode,
					reviewReason: null,
					warningMessage: null,
					lastOutputAt: now(),
					lastHookAt: now(),
					lastTokenAt: null,
					lastHeartbeatAt: now(),
					heartbeatStatus: "healthy",
					latestHookActivity: {
						activityText: "Agent active",
						toolName: null,
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "turn_start",
						notificationType: null,
						source: "nklein-sdk",
					},
				});
				this.emitSummary(waitingSummary);
				this.timeoutController.scheduleStreamTimeout(taskId);
				this.timeoutController.scheduleConversationTimeout(taskId);
				const assistantCountBeforeSend = entry.messages.filter((message) => message.role === "assistant").length;
				const runtimeSetupWorkspacePath =
					this.sandboxState.getRepoPath(taskId) ?? entry.summary.workspacePath ?? "";
				const { result, warnings } = await this.runtimeSetupLeaseCache
					.ensure(runtimeSetupWorkspacePath)
					.then(async (runtimeSetup) => {
						// A bounced/escalated card's workspace may have been disposed at capture — restore it BEFORE
						// the turn so the session's sandbox tools work again (see the helper's run20 story).
						const restoredSandboxWorkspace = await this.restoreDisposedSandboxWorkspaceForRedrive(taskId);
						const resolvedPrompt = runtimeSetup.resolvePrompt(normalized);
						const resolvedContextWindow = this.contextBudgetController.resolveKnownContextWindowForTask(
							taskId,
							launchConfigOverrides?.contextWindow,
						);
						try {
							const persistedSnapshotForBudget = await this.sessionRuntime
								.readPersistedTaskSession(taskId)
								.catch(() => null);
							this.emitSummary(
								updateSummary(entry, {
									contextBudgetBreakdown: buildContextBudgetBreakdown({
										systemPrompt: this.contextBudgetInputs.getSystemPrompt(taskId),
										toolSchemaTokens: this.contextBudgetInputs.getToolSchemaTokens(taskId),
										messages: persistedSnapshotForBudget?.messages,
										prompt: resolvedPrompt,
										images,
										contextWindow: resolvedContextWindow,
									}),
								}),
							);
							if (!queueDelivery) {
								const proactiveCompaction = await this.contextOverflowController.compactBeforeOverflow({
									taskId,
									entry,
									prompt: resolvedPrompt,
									mode: effectiveMode,
									images,
									launchConfigOverrides,
									contextWindow: resolvedContextWindow,
								});
								if (proactiveCompaction) {
									return proactiveCompaction;
								}
							}
							return await this.dispatchResolvedTaskInput({
								taskId,
								prompt: resolvedPrompt,
								mode: effectiveMode,
								images,
								delivery: queueDelivery ? "queue" : undefined,
								launchConfigOverrides,
								forceRestart: restoredSandboxWorkspace,
							});
						} catch (error) {
							const recovered = await this.contextOverflowController.recoverAfterOverflow({
								taskId,
								prompt: resolvedPrompt,
								mode: effectiveMode,
								images,
								error,
							});
							if (recovered) {
								return recovered;
							}
							throw error;
						}
					});
				return { result, warnings, assistantCountBeforeSend };
			};
			const deliveryPromise = queueDelivery
				? deliverResolvedInput()
				: this.withModelTurnAdmissionForTask(taskId, launchConfigOverrides, deliverResolvedInput);
			void deliveryPromise
				.then(({ result, warnings, assistantCountBeforeSend }) => {
					// This fire-and-forget continuation captured `entry` before several awaits. A concurrent
					// clearTaskSession (/clear) can SWAP the map entry for a fresh cleared object in between, leaving
					// the captured `entry` orphaned. Re-fetch the live entry and bail if it was replaced (identity
					// check) or removed — else we push an assistant message onto the orphaned entry (lost from the
					// live one) and emit stale running state to listeners, resurrecting the just-cleared card.
					const live = this.messageRepository.getTaskEntry(taskId);
					if (!live || live !== entry) {
						return;
					}
					const warningMessage = formatStartWarnings(warnings);
					this.failureBackoff.forget(taskId);
					if (warningMessage) {
						this.emitSummary(
							updateSummary(live, {
								warningMessage,
							}),
						);
					}
					const agentText = readAgentResultText(result);
					if (agentText) {
						const assistantCountAfterSend = live.messages.filter(
							(message) => message.role === "assistant",
						).length;
						if (assistantCountAfterSend > assistantCountBeforeSend) {
							return;
						}
						const agentMessage =
							setOrCreateAssistantMessage(live, taskId, agentText) ??
							createAssistantMessage(live, taskId, agentText);
						this.emitMessage(taskId, agentMessage);
					}
				})
				.catch((error: unknown) => {
					// Same orphaned-entry guard: never emit a failure for a session cleared/replaced mid-flight.
					const live = this.messageRepository.getTaskEntry(taskId);
					if (!live || live !== entry) {
						return;
					}
					this.taskFailureEmitter.emit(taskId, live, "send", error);
				});
		}
		const summary = updateSummary(entry, {
			state: "running",
			mode: effectiveMode,
			reviewReason: null,
			lastOutputAt: now(),
		});
		this.emitSummary(summary);
		return summary;
	}

	async reloadTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		let entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			let reboundSummary: RuntimeTaskSessionSummary | null;
			try {
				reboundSummary = await this.rebindPersistedTaskSession(taskId);
			} catch (error) {
				this.recordSessionRecoveryFailure({
					taskId,
					operation: "rebind_persisted_task_session",
					error,
				});
				throw error;
			}
			if (!reboundSummary) {
				return null;
			}
			entry = this.messageRepository.getTaskEntry(taskId);
			if (!entry) {
				return reboundSummary;
			}
		}

		this.pendingTurnCancelTaskIds.delete(taskId);
		await this.sessionRuntime.stopTaskSession(taskId).catch(() => null);
		clearActiveTurnState(entry);

		const effectiveMode: RuntimeTaskSessionMode = entry.summary.mode ?? "act";
		if (!this.sessionRuntime.getTaskSessionId(taskId)) {
			if (isHomeAgentSessionId(taskId) && !this.sessionRuntime.canRestartTaskSession(taskId)) {
				return null;
			}
		}
		try {
			const { warnings } = await this.dispatchResolvedTaskInput({
				taskId,
				prompt: "",
				mode: effectiveMode,
			});
			const warningMessage = formatStartWarnings(warnings);
			const summary = updateSummary(entry, {
				state: "idle",
				mode: effectiveMode,
				reviewReason: null,
				warningMessage: warningMessage ?? null,
				lastOutputAt: now(),
			});
			this.emitSummary(summary);
			return cloneSummary(summary);
		} catch (error) {
			// Only `alreadyParked` is read here (it is independent of localModelUnavailable) — skip duplicate
			// recovery-failure recording when this exact error already parked the task.
			const alreadyParkedByThisError = computeNKleinFailureBackoff({
				context: "start",
				errorMessage: toErrorMessage(error),
				previousFailure: this.failureBackoff.getPrevious(taskId),
				localModelUnavailable: false,
			}).alreadyParked;
			if (!alreadyParkedByThisError) {
				this.recordSessionRecoveryFailure({
					taskId,
					operation: "reload_task_session",
					error,
				});
			}
			this.taskFailureEmitter.emit(taskId, entry, "start", error);
			return cloneSummary(entry.summary);
		}
	}

	/**
	 * The shared interrupted-task teardown: drop the per-task tracking state and reset the per-task
	 * guards. Used by the interrupt / decomposition-complete / trash paths (each then handles its own
	 * launch-config delete, session stop-vs-abort, and sandbox disposal). Order within is immaterial —
	 * every op targets an independent per-task map/guard with no read in between.
	 * (clearTaskSession deliberately does NOT use this — it has a different shape: provider-id forget,
	 * no pause-controller trio, no decomposition resets.)
	 */
	private resetInterruptedTaskState(taskId: string): void {
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.contextBudgetController.forget(taskId);
		this.modelEndpoint.forget(taskId);
		this.contextBudgetInputs.forget(taskId);
		this.requestTimer.forget(taskId);
		this.failureBackoff.forget(taskId);
		this.autonomyBudgetWatchdog.resetTask(taskId);
		this.repeatedToolCallGuard.resetTask(taskId);
		this.turnLoopGuard.resetTask(taskId);
		this.pauseController.abortTaskWaiters(taskId);
		this.pauseController.clearTaskParked(taskId);
		this.pauseController.setCardPaused(taskId, false);
		this.clearTaskTimeouts(taskId);
		this.decompositionStallNudger.resetTask(taskId);
		this.explicitDecompositionTaskIds.delete(taskId);
		this.timeoutController.deleteSettings(taskId);
	}

	async clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const existingEntry = this.messageRepository.getTaskEntry(taskId);
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.providerIdStore.forget(taskId);
		this.contextBudgetController.forget(taskId);
		this.modelEndpoint.forget(taskId);
		this.contextBudgetInputs.forget(taskId);
		this.launchConfigByTaskId.delete(taskId);
		this.requestTimer.forget(taskId);
		this.failureBackoff.forget(taskId);
		this.autonomyBudgetWatchdog.resetTask(taskId);
		this.repeatedToolCallGuard.resetTask(taskId);
		this.turnLoopGuard.resetTask(taskId);
		this.clearTaskTimeouts(taskId);
		this.timeoutController.deleteSettings(taskId);
		await this.sessionRuntime.clearTaskSessions(taskId).catch(() => undefined);
		await this.agentSandboxManager?.disposeWorkspace(taskId).catch(() => null);
		this.forgetSandboxTask(taskId);
		this.messageRepository.clearHydratedTaskMessages(taskId);
		if (!existingEntry) {
			return null;
		}

		const clearedEntry: NKleinTaskSessionEntry = {
			summary: {
				...createDefaultSummary(taskId),
				mode: existingEntry.summary.mode,
				workspacePath: existingEntry.summary.workspacePath,
			},
			messages: [],
			activeAssistantMessageId: null,
			activeReasoningMessageId: null,
			toolMessageIdByToolCallId: new Map<string, string>(),
			toolInputByToolCallId: new Map<string, unknown>(),
		};
		this.messageRepository.setTaskEntry(taskId, clearedEntry);
		this.emitSummary(clearedEntry.summary);
		return cloneSummary(clearedEntry.summary);
	}

	async rebindPersistedTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const existingEntry = this.messageRepository.getTaskEntry(taskId);
		if (existingEntry && existingEntry.summary.state !== "failed") {
			return cloneSummary(existingEntry.summary);
		}
		const snapshot = await this.sessionRuntime.readPersistedTaskSession(taskId);
		if (!snapshot) {
			return existingEntry ? cloneSummary(existingEntry.summary) : null;
		}
		this.resolvePersistedLaunchConfig({
			taskId,
			persistedSnapshot: snapshot,
		});
		const startedAt = Date.parse(snapshot.record.startedAt);
		const updatedAt = Date.parse(snapshot.record.updatedAt || snapshot.record.startedAt);
		const persistedCwd = typeof snapshot.record.cwd === "string" ? snapshot.record.cwd.trim() : "";
		const persistedWorkspaceRoot =
			typeof snapshot.record.workspaceRoot === "string" ? snapshot.record.workspaceRoot.trim() : "";
		const reboundState = existingEntry?.summary.state === "failed" ? "failed" : "awaiting_review";
		const reboundReviewReason = existingEntry?.summary.state === "failed" ? "error" : "attention";
		const entry = createTaskEntryFromPersistedSession(taskId, snapshot.messages, {
			agentId: "nklein",
			state: reboundState,
			mode: existingEntry?.summary.mode ?? null,
			reviewReason: reboundReviewReason,
			workspacePath: persistedCwd || persistedWorkspaceRoot || null,
			startedAt: Number.isFinite(startedAt) ? startedAt : null,
			lastOutputAt: Number.isFinite(updatedAt) ? updatedAt : null,
			warningMessage: existingEntry?.summary.warningMessage ?? null,
			latestHookActivity: existingEntry?.summary.latestHookActivity ?? null,
			latestTurnCheckpoint: existingEntry?.summary.latestTurnCheckpoint ?? null,
			previousTurnCheckpoint: existingEntry?.summary.previousTurnCheckpoint ?? null,
		});
		this.messageRepository.setTaskEntry(taskId, entry);
		this.recordLostSessionRecoveryTransition({
			taskId,
			transition: "rebound_for_review",
			workspacePath: entry.summary.workspacePath,
		});
		return cloneSummary(entry.summary);
	}

	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		return this.messageRepository.getSummary(taskId);
	}

	getTaskShellTarget(taskId: string): AgentSandboxShellTarget | null {
		return this.agentSandboxManager?.getTaskShellTarget(taskId) ?? null;
	}

	listSummaries(): RuntimeTaskSessionSummary[] {
		return this.messageRepository.listSummaries();
	}

	listModelEndpointSessions(): Array<{
		taskId: string;
		state: RuntimeTaskSessionSummary["state"];
		startedAt: number | null;
		providerId: string;
		modelId: string;
		endpoint: string | null;
	}> {
		return this.messageRepository.listSummaries().map((summary) => ({
			taskId: summary.taskId,
			state: summary.state,
			startedAt: summary.startedAt,
			providerId: this.providerIdStore.get(summary.taskId) ?? UNCONFIGURED_PROVIDER_ID,
			modelId: this.modelEndpoint.getModelId(summary.taskId),
			endpoint: this.modelEndpoint.getEndpoint(summary.taskId),
		}));
	}

	getPromptWarmthLedger(): ReadonlyMap<string, PromptWarmthLedgerEntry> {
		return this.promptWarmthLedger.shellKeyByModelId;
	}

	listMessages(taskId: string): NKleinTaskMessage[] {
		return this.messageRepository.listMessages(taskId);
	}

	setBoardPaused(paused: boolean): void {
		this.pauseController.setBoardPaused(paused);
		if (paused) {
			this.parkController.parkActiveTasksForOperatorPause();
		}
	}

	setCardPaused(taskId: string, paused: boolean): void {
		this.pauseController.setCardPaused(taskId, paused);
		if (paused) {
			this.parkController.parkActiveTasksForOperatorPause(taskId);
		}
	}

	setSwarmGuardrails(guardrails: RuntimeSwarmGuardrails): void {
		this.swarmGuardrails = normalizeRuntimeSwarmGuardrails(guardrails);
	}

	/** Live-update the §5.AC "knows today" switch when the runtime config changes (same seam as `setSwarmGuardrails`). */
	setKnowsTodayEnabled(enabled: boolean): void {
		this.knowsTodayEnabled = enabled;
	}

	setSandboxMcpServersEnabled(enabled: boolean): void {
		this.sandboxMcpServersEnabled = enabled;
	}

	/**
	 * §5.BB live-update the basic-memory switch when the runtime config changes (same seam as
	 * `setSandboxMcpServersEnabled`), forwarding to the sandbox manager so the per-project writable-store plan follows
	 * the setting for subsequently registered projects.
	 */
	setBasicMemoryEnabled(enabled: boolean): void {
		this.basicMemoryEnabled = enabled;
		this.agentSandboxManager?.setBasicMemoryEnabled(enabled);
	}

	/** §5.BB: whether basic-memory should be offered — the persisted setting OR the env override (either enables). */
	private isBasicMemoryEnabled(): boolean {
		return this.basicMemoryEnabled || isTruthyEnv(process.env.NKLEIN_BASIC_MEMORY);
	}

	setRetrievalConfig(egressEnabled: boolean, searchBackendUrl: string | null): void {
		this.retrievalEgressEnabled = egressEnabled;
		this.retrievalSearchBackendUrl = searchBackendUrl;
	}

	/** §5.L: live-update the per-role web-research capability gate when the runtime config (ruleset) changes. */
	setAgentWebResearchAllowed(allowed: boolean): void {
		this.agentWebResearchAllowed = allowed;
	}

	/** §5.L: live-update the per-role MCP-access capability gate when the runtime config (ruleset) changes. */
	setAgentMcpAccess(access: McpAccess): void {
		this.agentMcpAccess = access;
	}

	/**
	 * §5.L: whether curated sandbox-MCP tools should be offered — the config/env switch ANDed with the per-role
	 * capability gate. The ONE place both conditions meet, so the three tool-assembly sites can't drift (the §4A
	 * guard-drift lesson). `"off"` withholds MCP even with the switch on; `"local"`/`"on"` allow the (local) servers.
	 */
	private isSandboxMcpEnabled(): boolean {
		return (
			(this.sandboxMcpServersEnabled || isTruthyEnv(process.env.NKLEIN_SANDBOX_MCP)) && this.agentMcpAccess !== "off"
		);
	}

	/** §5.AN decision-9: live-update the model-stats tracking level when the runtime config changes. */
	setModelStatsTrackingLevel(level: ModelStatsTrackingLevel): void {
		this.modelStatsTrackingLevel = level;
	}

	setModelTurnAdmissionGate(gate: NKleinModelTurnAdmissionGate | null): void {
		this.modelTurnAdmissionGate = gate;
	}

	async waitUntilTaskResumed(taskId: string): Promise<void> {
		await this.pauseController.waitUntilResumed(taskId);
	}

	async verifyTaskAcceptanceInSandbox(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
		timeoutMs?: number;
		resultBranchTaskId?: string;
		useBaseTree?: boolean;
	}): Promise<RuntimeTaskAcceptanceResult> {
		return this.acceptanceVerifier.verify(input);
	}

	/**
	 * Runs one isolated second-opinion reviewer turn (todo §5.K): a fresh sandbox session under a synthetic
	 * `<taskId>::review` id (so it never collides with the worker session), prepared from the task's result
	 * branch, on the reviewer model, seeded with the review brief and given the `submit_review` tool. Resolves to
	 * the reviewer's structured verdict, or null if the turn ends without one (or the sandbox is unavailable).
	 * Bounded by a timeout and always tears its synthetic session + workspace down.
	 */
	/**
	 * W2.5a: pick a lineage-diverse LOADED model as the reviewer when no reviewer role is configured. The worker's
	 * REAL model key (descriptor.modelKey, not the per-machine alias) resolves its lineage; candidates are the other
	 * loaded non-embedding models, preferred diverse-first via applyDiversityPreference. Null ⇒ caller falls back to
	 * the worker model (today's behavior), with the waiver surfaced as a self-observation.
	 */
	async pickDiverseEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null> {
		const launch = this.launchConfigByTaskId.get(taskId) ?? null;
		if (!launch?.providerId || !launch.modelId) {
			return null;
		}
		// The escalated session is the card's WORKER session on a stronger model — batch toward worker shells.
		return await pickDiverseReviewerModel(launch, taskId, "worker", {
			lastShellKeyByModel: this.promptWarmthLedger.shellKeyByModelId,
		}).catch(() => null);
	}

	async runSecondOpinionReviewSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
	}): Promise<NKleinReviewResult | null> {
		return this.secondOpinionReviewRunner.runSecondOpinionReviewSession(input);
	}

	async rescueInterruptedTaskWithPriorWork(taskId: string): Promise<boolean> {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (entry?.summary.state !== "interrupted") {
			return false;
		}
		const repoPath = this.sandboxState.getRepoPath(taskId) ?? entry.summary.workspacePath ?? null;
		if (!repoPath) {
			return false;
		}
		const priorResultCommit = await resolveTaskResultBranchCommit({ repoPath, taskId }).catch(() => null);
		if (!priorResultCommit) {
			return false;
		}
		if (this.messageRepository.getTaskEntry(taskId)?.summary.state !== "interrupted") {
			return false; // something else revived it while we looked
		}
		this.emitSummary(
			updateSummary(entry, {
				state: "awaiting_review",
				reviewReason: "exit",
				lastOutputAt: now(),
				lastHookAt: now(),
				latestHookActivity: {
					activityText:
						"Watchdog rescue: interrupted session with a prior result branch rebound into review (salvage → judge, never lost).",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "interrupted_prior_work_rebound",
					notificationType: null,
					source: "nklein",
				},
			}),
		);
		return true;
	}

	cancelSpeculativeMirror(taskId: string): Promise<void> {
		return this.speculativeMirrorRunner.cancelSpeculativeMirror(taskId);
	}

	/**
	 * §5.AW opportunistic best-of-N: a SPECULATIVE WORKER session `<taskId>::spec` — a lineage-diverse idle
	 * model independently implementing the same card in its own sandbox workspace. Mirrors
	 * {@link runSecondOpinionReviewSession}'s bounded shape (auxiliary prepareWorkspace wait, bounded turn,
	 * full teardown, never throws), but unlike the verdict sessions it CAPTURES its work to the `::spec`
	 * result branch on completion — that branch's existence at review time is what arms the A/B arbitration
	 * seed. A mirror canceled via {@link cancelSpeculativeMirror} (the primary won the race) never captures.
	 */
	runSpeculativeMirrorSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		prompt: string;
		mirror: { providerId: string; modelId: string };
		timeoutMs?: number;
	}): Promise<boolean> {
		return this.speculativeMirrorRunner.runSpeculativeMirrorSession(input);
	}

	async runPlanCritiqueSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		timeoutMs?: number;
		/** Pre-picked diverse critic (the budget-owning handler probes first); absent ⇒ probe here. */
		critic?: { providerId: string; modelId: string } | null;
	}): Promise<NKleinPlanCritiqueResult | null> {
		return this.planCritiqueRunner.runPlanCritiqueSession(input);
	}

	runMergeResolutionSession(input: {
		taskId: string;
		projectRepoPath: string;
		mainRef: string;
		resultCommit: string;
		conflictedPaths: string[];
		timeoutMs?: number;
	}): Promise<NKleinMergeResolutionSessionOutcome | null> {
		return this.mergeResolutionRunner.runMergeResolutionSession(input);
	}

	async updateAgentSandboxPoolConfig(config: Partial<AgentSandboxPoolConfig>): Promise<void> {
		await this.agentSandboxManager?.updatePoolConfig(config);
	}

	async setSandboxNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void> {
		await this.agentSandboxManager?.setNetworkPolicy(policy);
	}

	async resumePausedTasks(): Promise<RuntimeTaskSessionSummary[]> {
		const resumed: RuntimeTaskSessionSummary[] = [];
		for (const taskId of this.pauseController.listControllerPausedTaskIds()) {
			if (this.pauseController.isPaused(taskId)) {
				continue;
			}
			const entry = this.messageRepository.getTaskEntry(taskId);
			if (entry?.summary.state !== "paused") {
				this.pauseController.clearTaskParked(taskId);
				continue;
			}
			const summary = await this.sendTaskSessionInput(taskId, "Continue from the paused checkpoint.");
			if (summary) {
				resumed.push(summary);
			}
			this.pauseController.clearTaskParked(taskId);
		}
		return resumed;
	}

	async listSlashCommands(workspacePath: string): Promise<NKleinSdkSlashCommand[]> {
		const runtimeSetup = await this.runtimeSetupLeaseCache.ensure(workspacePath);
		await Promise.all([
			runtimeSetup.userInstructionService.refreshType("skill"),
			runtimeSetup.userInstructionService.refreshType("workflow"),
		]);
		return listNKleinSdkWorkflowSlashCommands(runtimeSetup.userInstructionService);
	}

	async loadTaskSessionMessages(taskId: string): Promise<NKleinTaskMessage[]> {
		return await this.messageRepository.hydrateTaskMessages(taskId, async () => {
			return await this.sessionRuntime.readPersistedTaskSession(taskId);
		});
	}

	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null {
		const summary = this.messageRepository.applyTurnCheckpoint(taskId, checkpoint);
		if (!summary) {
			return null;
		}
		const guardedSummary = this.parkController.enforceAutonomyBudgets(taskId, checkpoint) ?? summary;
		this.emitSummary(guardedSummary);
		return guardedSummary;
	}

	async dispose(): Promise<void> {
		for (const taskId of this.timeoutController.taskIds()) {
			this.clearTaskTimeouts(taskId);
		}
		this.decompositionStallNudger.dispose();
		this.repeatedToolCallGuard.dispose();
		this.turnLoopGuard.dispose();
		this.autonomyBudgetWatchdog.dispose();
		this.timeoutController.clearSettings();
		await this.sessionRuntime.dispose();
		this.pendingTurnCancelTaskIds.clear();
		this.providerIdStore.clear();
		this.contextBudgetController.clear();
		this.modelEndpoint.clear();
		this.contextBudgetInputs.clear();
		this.requestTimer.clear();
		this.explicitDecompositionTaskIds.clear();
		this.sandboxState.clear();
		this.focusChainStore.clear();
		this.teamProgressEmitter.clear();
		await this.agentSandboxManager?.stopNow().catch(() => null);
		await this.runtimeSetupLeaseCache.disposeAll();
		this.messageRepository.dispose();
	}

	private emitSummary(summary: RuntimeTaskSessionSummary): void {
		const guardedSummary = this.repeatedToolCallGuard.check(summary) ?? summary;
		// §5.BG: stamp the STABLE publisher key (when resolved at start) on every emitted summary — this is the central
		// choke point through which telemetry consumers (fitness, model-behavior) receive summaries, so keying off it
		// here means a renamed LM Studio instance can't fragment its measured history. Absent ⇒ consumers fall back to
		// the runtime `modelId` (cloud / not-loaded / restart / legacy).
		const stableModelKey = this.modelEndpoint.getStableModelKey(guardedSummary.taskId);
		const keyedSummary = stableModelKey ? { ...guardedSummary, modelKey: stableModelKey } : guardedSummary;
		this.captureTerminalRunSummary(keyedSummary);
		this.messageRepository.emitSummary(keyedSummary);
	}

	/**
	 * follow-up-6 §3.6: persist a terminal run summary to the durable store the first time a task transitions
	 * into a terminal session state, so the last-run outcome survives runtime shutdown (when `sessions.json` is
	 * reset to `{}`) and unfinished cards stay diagnosable.
	 */
	private captureTerminalRunSummary(summary: RuntimeTaskSessionSummary): void {
		const state = summary.state;
		if (state !== "awaiting_review" && state !== "failed" && state !== "interrupted") {
			return;
		}
		const taskId = summary.taskId;
		if (this.lastRecordedRunStateByTaskId.get(taskId) === state) {
			return;
		}
		this.lastRecordedRunStateByTaskId.set(taskId, state);
		// W1.1b: flag-gated adaptive budget retry on the stall signature (see adaptiveBudgetController).
		this.adaptiveBudgetController.maybeAdaptiveBudgetRetry(taskId, summary);
		// W0.2 (run16: t4 died `interrupted` MID-WRITE and its partial work was lost): a dying terminal still
		// salvages its sandbox work. error→awaiting_review already captures via the finalize hook (run10 proved
		// it live); interrupted/failed did NOT — no capture, and the sandbox leaked until pool exhaustion.
		// finalizeSandboxReview is idempotent-guarded, captures the patch to the result branch, and disposes the
		// workspace — exactly the salvage+cleanup pair a dead session owes.
		if (
			isTerminalFailureSessionState(state) &&
			this.sandboxState.hasSandbox(taskId) &&
			!this.sandboxState.getResultBranch(taskId)
		) {
			this.sandboxReviewFinalizer.finalizeSandboxReview(taskId);
		}
		const usage = summary.latestUsage ?? null;
		// §5.AN decision-9: gate the recorded token telemetry by the configured level (full ⇒ as-is; basic ⇒ totals only;
		// off ⇒ suppress token stats, the attempt OUTCOME is still recorded). Applied ONCE so both recorders below (the
		// run-summary and the ledger attempt event) use the gated values.
		const gatedUsage = applyModelStatsTrackingLevel(this.modelStatsTrackingLevel, {
			promptTokens: usage?.inputTokens ?? null,
			completionTokens: usage?.outputTokens ?? null,
			totalTokens: null,
			reasoningTokens: null,
		});
		const promptTokens = gatedUsage.promptTokens;
		const completionTokens = gatedUsage.completionTokens;
		const { reason: timeoutReason, source: timeoutSource } = this.pendingTimeout.consume(taskId);
		// Coarse role attribution (todo §5.C) for by-role timeout breakdowns — same resolution as the live summary
		// stamp (resolveNKleinTaskRole), so the run summary and the session summary agree.
		const role = resolveNKleinTaskRole(taskId, this.explicitDecompositionTaskIds.has(taskId));
		// Dev-test runs seed tasks as `devtest-<scenarioId>-<timestamp>` (see `nklein dev test-project`), so the
		// scenario is parseable from the id for by-scenario timeout breakdowns (§5.C/§5.O). Null for ordinary runs.
		const scenario = /^devtest-(.+)-\d+$/.exec(taskId)?.[1] ?? null;
		void recordTaskRunSummary(
			{
				taskId,
				workspacePath: summary.workspacePath ?? null,
				state,
				reviewReason: summary.reviewReason ?? null,
				providerId: summary.providerId ?? this.resolveProviderIdForTask(taskId),
				modelId: summary.modelId ?? this.modelEndpoint.peekModelId(taskId) ?? null,
				endpoint: summary.endpoint ?? this.modelEndpoint.getEndpoint(taskId),
				lastActivity: summary.latestHookActivity?.activityText ?? null,
				warningMessage: summary.warningMessage ?? null,
				exitCode: summary.exitCode ?? null,
				startedAt: summary.startedAt ?? null,
				endedAt: summary.updatedAt,
				promptTokens,
				completionTokens,
				totalTokens: promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null,
				timeoutReason,
				timeoutSource,
				role,
				scenario,
				focusChain: this.focusChainStore.summarize(taskId),
				patchCaptureStatus: null,
			},
			{ rootDir: this.diagnosticStoreRoot },
		);
		// §5.AF: also record this terminal run as ONE attempt event in the Agent Attempt Ledger (best-effort; the
		// ledger is observational control-plane and must never break the session loop). This is the first live WRITER
		// of the ledger, making the §5.Z matrix + §5.AA model-behaviour profile real projections of one evidence stream.
		// Async + fire-and-forget: read the persisted transcript to extract per-tool-call detail, then append the
		// attempt event. The ledger is observational and must never break or block the session loop.
		void (async () => {
			try {
				const snapshot = await this.sessionRuntime.readPersistedTaskSession(taskId).catch(() => null);
				const toolCalls = extractTerminalToolCalls(snapshot?.messages ?? []);
				await appendAgentLedgerEvent(
					buildTerminalAttemptEvent({
						taskId,
						workspacePath: summary.workspacePath ?? null,
						state,
						role,
						providerId: summary.providerId ?? this.resolveProviderIdForTask(taskId),
						// §5.BG (c) routing-key flip — DEFAULT-ON (David 2026-07-07 rollout; opt out NKLEIN_STABLE_ROUTING_KEY=0).
						// The terminal-attempt ledger is the ROUTING EVIDENCE the start path looks up by the candidate's
						// re-keyed stable key — so the WRITE must resolve the SAME stable id (via the same shared map) the READ
						// does, or evidence written under one key is never found under the other.
						modelId: (() => {
							const runtimeModelId = summary.modelId ?? this.modelEndpoint.peekModelId(taskId) ?? null;
							return runtimeModelId && isEnabledByDefaultEnv(process.env.NKLEIN_STABLE_ROUTING_KEY)
								? resolveStableRoutingModelId(runtimeModelId)
								: runtimeModelId;
						})(),
						endpoint: summary.endpoint ?? this.modelEndpoint.getEndpoint(taskId),
						startedAt: summary.startedAt ?? null,
						endedAt: summary.updatedAt,
						promptTokens,
						completionTokens,
						timeoutReason,
						toolCalls,
					}),
					{ rootDir: this.diagnosticStoreRoot },
				);
			} catch {
				// Best-effort; never break the session loop on a ledger write.
			}
		})();
	}

	private forgetSandboxTask(taskId: string): void {
		this.sandboxState.deleteSandbox(taskId);
		this.sandboxState.unmarkFinalizing(taskId);
		this.focusChainStore.delete(taskId);
	}

	/** The shared teardown-forgets for an auxiliary synthetic session (§5.U harness + speculative-mirror runner). */
	private forgetSyntheticSessionState(taskId: string): void {
		this.launchConfigByTaskId.delete(taskId);
		this.providerIdStore.forget(taskId);
		this.modelEndpoint.forget(taskId);
		this.contextBudgetInputs.forget(taskId);
		this.sandboxState.deleteSandbox(taskId);
	}

	private emitMessage(taskId: string, message: NKleinTaskMessage): void {
		this.messageRepository.emitMessage(taskId, message);
	}

	/**
	 * W2.6c (audit 2026-07-02): append a FOLLOW-UP run-summary record carrying the REAL patch-capture status.
	 * The terminal record is written ON the terminal transition while the capture is still ASYNC, so its
	 * `patchCaptureStatus` cannot be known there (it stays null); this follow-up record (same taskId, appended by
	 * the capture completion) is the delivery-evidence signal — readers take the LAST record per task. Errored /
	 * empty-capture runs therefore stop looking identical to delivered ones in the evidence stream.
	 */

	private captureReviewCheckpoint(taskId: string, summary: RuntimeTaskSessionSummary): void {
		const nextTurn = (summary.latestTurnCheckpoint?.turn ?? 0) + 1;
		const staleRef = summary.previousTurnCheckpoint?.ref ?? null;
		void captureTaskTurnCheckpoint({
			cwd: summary.workspacePath ?? ".",
			taskId,
			turn: nextTurn,
		})
			.then((checkpoint) => {
				this.applyTurnCheckpoint(taskId, checkpoint);
				if (!staleRef) {
					return;
				}
				void deleteTaskTurnCheckpointRef({
					cwd: summary.workspacePath ?? ".",
					ref: staleRef,
				}).catch(() => {
					// Best effort cleanup only.
				});
			})
			.catch(() => {
				// Best effort checkpointing only.
			});
	}

	private handleTaskEvent(taskId: string, event: unknown): void {
		const sdkEvent = readSdkSessionEvent(event);
		if (sdkEvent) {
			this.runtimeObservationRecorder.recordModelRegistryObservation(taskId, sdkEvent);
		}
		this.runtimeObservationRecorder.recordSdkEventObservation(taskId, event);
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return;
		}
		if (DEBUG_STREAM_EVENTS) {
			const evtType =
				event && typeof event === "object" && "type" in event
					? String((event as { type: unknown }).type)
					: typeof event;
			const nowMs = Date.now();
			const lastAt = debugStreamEventLastAtByTaskId.get(taskId);
			debugStreamEventLastAtByTaskId.set(taskId, nowMs);
			process.stderr.write(
				`[nklein-stream-debug] ${new Date(nowMs).toISOString()} task=${taskId} evt=${evtType} gapMs=${lastAt ? nowMs - lastAt : 0} state=${entry.summary.state} hook=${entry.summary.latestHookActivity?.hookEventName ?? "-"}\n`,
			);
		}
		const previousSummary = cloneSummary(entry.summary);
		const focusChainTouchDelta = extractFocusChainTouchDeltaFromSdkEvent(taskId, event, {
			lookupToolInput: (toolCallId) => entry.toolInputByToolCallId.get(toolCallId),
		});
		let latestSummary: RuntimeTaskSessionSummary | null = null;
		applyNKleinSessionEvent({
			event,
			taskId,
			entry,
			pendingTurnCancelTaskIds: this.pendingTurnCancelTaskIds,
			isNKleinProvider: this.isNKleinProviderForTask(taskId),
			emitSummary: (summary: RuntimeTaskSessionSummary) => {
				latestSummary = summary;
				this.emitSummary(summary);
			},
			emitMessage: (taskIdFromEvent: string, message: NKleinTaskMessage) => {
				this.emitMessage(taskIdFromEvent, message);
			},
		});
		if ((focusChainTouchDelta.files?.length ?? 0) > 0 || (focusChainTouchDelta.cardIds?.length ?? 0) > 0) {
			this.focusChainStore.applyTouches(taskId, focusChainTouchDelta);
		}
		const shouldAbortForCreditLimit = didCreditLimitJustTrigger(previousSummary, entry.summary);
		if (this.sandboxReviewFinalizer.shouldFinalizeSandboxReview(previousSummary, latestSummary)) {
			this.sandboxReviewFinalizer.finalizeSandboxReview(taskId);
		} else if (shouldCaptureReviewCheckpoint(previousSummary, latestSummary)) {
			this.captureReviewCheckpoint(taskId, latestSummary);
		}
		// §12 turn-loop ladder: with the turn's text settled (no active assistant stream), scan the trailing
		// completed turns for a re-raised question/proposal loop. Cheap no-op mid-stream and below the window.
		this.turnLoopGuard.check(taskId);
		const hookEventName = entry.summary.latestHookActivity?.hookEventName;
		if (entry.summary.state !== "running") {
			this.clearTaskTimeout(taskId, "stream");
			this.clearTaskTimeout(taskId, "tool");
			this.clearTaskTimeout(taskId, "conversation");
			this.decompositionStallNudger.clearDecompositionChatNudge(taskId);
			this.activeToolTaskIds.delete(taskId);
			this.decompositionStallNudger.maybeContinueStalledDecomposition(taskId);
		} else if (hookEventName === "tool_call" && !this.activeToolTaskIds.has(taskId)) {
			if (entry.summary.latestHookActivity?.toolName?.trim().toLowerCase() === "decompose_project") {
				this.decompositionStallNudger.clearDecompositionChatNudge(taskId);
			}
			this.activeToolTaskIds.add(taskId);
			this.clearTaskTimeout(taskId, "stream");
			this.timeoutController.scheduleToolTimeout(taskId);
		} else if (hookEventName === "tool_result") {
			if (entry.summary.latestHookActivity?.toolName?.trim().toLowerCase() === "decompose_project") {
				this.decompositionStallNudger.clearDecompositionChatNudge(taskId);
			}
			this.activeToolTaskIds.delete(taskId);
			this.clearTaskTimeout(taskId, "tool");
			this.timeoutController.scheduleStreamTimeout(taskId);
		} else if (entry.summary.state === "running" && !this.activeToolTaskIds.has(taskId)) {
			if (isChatOnlyDecompositionActivity(entry.summary)) {
				this.decompositionStallNudger.scheduleDecompositionChatNudge(taskId);
			}
			this.timeoutController.scheduleStreamTimeout(taskId);
		}
		if (shouldAbortForCreditLimit) {
			void this.sessionRuntime.abortTaskSession(taskId).catch(() => undefined);
		}
	}
}

export function createInMemoryNKleinTaskSessionService(
	options: CreateInMemoryNKleinTaskSessionServiceOptions,
): NKleinTaskSessionService {
	return new InMemoryNKleinTaskSessionService(options);
}
