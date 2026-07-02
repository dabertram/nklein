import { readAgentResultText, readSdkAgentEvent, readSdkSessionEvent } from "./nklein-sdk-event-readers";

// Task-oriented facade for native NKlein sessions.
// runtime-api.ts uses this service to start sessions, send messages, load
// history, and subscribe to summaries and chat events without knowing SDK
// host, repository, or event-adapter details.

import { DEFAULT_KNOWS_TODAY_ENABLED, DEFAULT_SANDBOX_MCP_SERVERS_ENABLED } from "../config/runtime-config-defaults";
import { buildModelBehaviorProfilesFromLedger } from "../core/agent-ledger-projections";
import type {
	RuntimeNKleinReasoningEffort,
	RuntimeNKleinTeamProgressEvent,
	RuntimeSwarmGuardrails,
	RuntimeTaskAcceptanceResult,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import {
	DEFAULT_RUNTIME_SWARM_GUARDRAILS,
	normalizeRuntimeSwarmGuardrails,
	RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "../core/api-contract";
import { isTruthyEnv } from "../core/env-flag";
import { applyFocusChainStepTiming, type FocusChain, summarizeFocusChain } from "../core/focus-chain";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { probeModelResidency, type ResidencyHeartbeatHandle, startResidencyHeartbeat } from "../core/lmstudio-liveness";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { learnedQualityEffectiveBudget } from "../core/model-behavior-profile";
import { applyDiversityPreference } from "../core/model-diversity";
import { resolveLineage } from "../core/model-lineage";
import { applyThinkingDisable } from "../core/model-thinking-control";
import { raisedTokenBudget } from "../core/retry-policy";
import { isEnteringAwaitingReview } from "../core/task-session-guards";
import { appendTemporalContext, decideTemporalContextInjection } from "../core/temporal-context-injection";
import { resolveHomeAgentAppendSystemPrompt } from "../prompts/append-system-prompt";
import { appendAgentLedgerEvent, readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import {
	recordTaskRunSummary,
	type TaskRunTerminalState,
	type TaskRunTimeoutSource,
} from "../state/task-run-summary-store";
import {
	readSelfObservationEvents,
	recordSelfObservation,
	type SelfObservationEventInput,
} from "../telemetry/self-observation-sink";
import { isTaskPatchCaptureError, type TaskPatchCaptureError } from "../workspace/task-patch-capture-diagnostics";
import { applyTaskPatchToResultBranch, resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { captureTaskTurnCheckpoint, deleteTaskTurnCheckpointRef } from "../workspace/turn-checkpoints";
import type { AutonomyBudgetWatchdogCallbacks } from "./autonomy-budget-watchdog";
import { AutonomyBudgetWatchdog } from "./autonomy-budget-watchdog";
import type { DecompositionStallNudgerCallbacks } from "./decomposition-stall-nudger";
import { DecompositionStallNudger, isChatOnlyDecompositionActivity } from "./decomposition-stall-nudger";
import { runNKleinAcceptanceGateInSandbox } from "./nklein-acceptance-gate";
import {
	type AgentSandboxManager,
	type AgentSandboxPoolConfig,
	type AgentSandboxShellTarget,
	createAgentSandboxToolExecutors,
	resolveNKleinAgentPerceivedCwd,
} from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { CONTEXT_BUDGET_SEND_RESERVE_TOKENS, planContextBudget } from "./nklein-context-budget-plan";
import {
	buildContextBudgetBreakdown,
	estimateKanbanToolSchemaTokens,
	estimateNextPromptTokens,
} from "./nklein-context-budget-tokens";
import { countKanbanPersistedMessagesTokens } from "./nklein-context-focus-policy";
import {
	compactPersistedMessagesForContextOverflow,
	isContextOverflowError,
} from "./nklein-context-overflow-compaction";
import type { NKleinDecompositionAppliedHandler } from "./nklein-decomposition-tool";
import { applyNKleinSessionEvent } from "./nklein-event-adapter";
import { computeNKleinFailureBackoff } from "./nklein-failure-backoff";
import { buildKanbanEfficiencyRules } from "./nklein-kanban-efficiency-rules";
import { buildTerminalAttemptEvent } from "./nklein-ledger-attempt";
import { extractTerminalToolCalls } from "./nklein-ledger-tool-calls";
import { assertLocalProviderAllowed, isLocalProvider } from "./nklein-local-only-policy";
import {
	createInMemoryNKleinMessageRepository,
	createTaskEntryFromPersistedSession,
	type NKleinMessageRepository,
} from "./nklein-message-repository";
import {
	buildSharedLocalEndpointId,
	extractNKleinModelRegistryObservationFromEvent,
	getDefaultNKleinModelRegistry,
} from "./nklein-model-registry";
import { NKleinPauseController } from "./nklein-pause-controller";
import type { NKleinCardPromotedHandler } from "./nklein-promotion-tool";
import type { NKleinReviewResult, NKleinReviewSubmittedHandler } from "./nklein-review-tool";
import { createNKleinRuntimeSetup, type NKleinRuntimeSetup } from "./nklein-runtime-setup";
import {
	type CreateInMemoryNKleinSessionRuntimeOptions,
	createInMemoryNKleinSessionRuntime,
	type NKleinPersistedTaskSessionSnapshot,
	type NKleinSessionRuntime,
	readKanbanLaunchConfigFromSessionRecord,
} from "./nklein-session-runtime";
import {
	clearActiveTurnState,
	cloneSummary,
	createAssistantMessage,
	createDefaultSummary,
	createMessage,
	createMessageWithMeta,
	createSessionId,
	isCreditLimitError,
	isLocalModelRuntimeUnavailableError,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	setOrCreateAssistantMessage,
	updateSummary,
} from "./nklein-session-state";
import { TaskContextBudgetInputs } from "./nklein-task-context-budget-inputs";
import { TaskContextWindowStore } from "./nklein-task-context-window-store";
import { TaskFailureBackoffTracker } from "./nklein-task-failure-backoff-tracker";
import { TaskModelEndpointStore, UNCONFIGURED_MODEL_ID } from "./nklein-task-model-endpoint-store";
import { TaskPendingTimeoutStore } from "./nklein-task-pending-timeout-store";
import { appendSystemPrompt, buildNKleinStartPromptParts } from "./nklein-task-prompt-builders";
import { isExplicitDecompositionPrompt } from "./nklein-task-prompt-parsing";
import { TaskProviderIdStore } from "./nklein-task-provider-id-store";
import { TaskRequestTimer } from "./nklein-task-request-timer";
import { TaskSandboxStateStore } from "./nklein-task-sandbox-state";
import {
	formatStartWarnings,
	isBenignSandboxPatchStagingTeardown,
	resolveNKleinTaskRole,
	toErrorMessage,
} from "./nklein-task-session-helpers";
import { shouldDisableSwarmThinking } from "./nklein-task-start-guard";
import {
	formatTaskTimeoutFailureMessage,
	formatTaskTimeoutLabel,
	formatTaskTimeoutMessage,
	formatTaskTimeoutReason,
} from "./nklein-task-timeout-diagnostics";
import type { NKleinTaskTimeoutKind } from "./nklein-task-timeout-handles";
import { TaskTimeoutScheduler } from "./nklein-task-timeout-scheduler";
import { projectNKleinTeamProgressEvent } from "./nklein-team-progress";
import {
	createNKleinWatcherRegistry,
	type NKleinRuntimeSetupLease,
	type NKleinWatcherRegistry,
} from "./nklein-watcher-registry";
import type { RepeatedToolCallGuardCallbacks } from "./repeated-tool-call-guard";
import { RepeatedToolCallGuard } from "./repeated-tool-call-guard";
import {
	listNKleinSdkWorkflowSlashCommands,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSessionEvent,
	type NKleinSdkSlashCommand,
	type NKleinSdkTeamEvent,
	resolveNKleinSdkSystemPrompt,
} from "./sdk-runtime-boundary.js";

export type { KanbanContextPressurePolicy, KanbanContextSafetyBudgets } from "./nklein-context-budgets";
export { buildKanbanContextPressurePolicy, buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";
export type { NKleinTaskMessage } from "./nklein-session-state";
export { computeRepeatedToolCallCandidate, formatRepeatedToolCallParkMessage } from "./repeated-tool-call-guard";

/** Overall time budget for a second-opinion reviewer session (first turn + any nudges) before it is abandoned (todo §5.K). */
const DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
/**
 * Opt-in stream-event tracing (`NKLEIN_DEBUG_STREAM_EVENTS=1`). Prints every SDK event reaching the service with a
 * wall-clock timestamp + the gap since the previous event for that task — so a "stream inactivity" stall can be read
 * from the data (is the model actively streaming events, or genuinely silent?) instead of inferred. Default off.
 */
const DEBUG_STREAM_EVENTS = isTruthyEnv(process.env.NKLEIN_DEBUG_STREAM_EVENTS);
const debugStreamEventLastAtByTaskId = new Map<string, number>();
/** Re-prompt budget when a reviewer turn ends without calling `submit_review` (small models often forget). */
const MAX_SECOND_OPINION_REVIEW_NUDGES = 2;
const SECOND_OPINION_REVIEW_NUDGE_PROMPT =
	"You ended your turn without calling `submit_review`, so no review was recorded. Your verdict is delivered ONLY by that tool. Call `submit_review` now: `approve`, or `request_changes` with concrete, actionable feedback. Do not answer in prose.";
const CONTEXT_BUDGET_WARNING_RATIO = 0.8;
const CONTEXT_BUDGET_COMPACT_RATIO = 0.92;
const UNCONFIGURED_PROVIDER_ID = "unconfigured";

interface NKleinTaskTimeoutSettings {
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	streamTimeoutSource: TaskRunTimeoutSource;
	toolTimeoutSource: TaskRunTimeoutSource;
	conversationTimeoutSource: TaskRunTimeoutSource;
}

export interface StartNKleinTaskSessionRequest {
	taskId: string;
	/**
	 * The HOST workspace path. The service derives the agent-perceived cwd from it
	 * (`sandboxWorkspace?.workdir ?? cwd`) before handing it to the session runtime, and keeps the host
	 * path for trusted control-plane reads. Never pass this through to an agent-facing surface directly.
	 */
	cwd: string;
	workspaceRoot?: string | null;
	baseRef?: string | null;
	prompt: string;
	startInPlanMode?: boolean;
	/** Normalized !Klein task title; written to SDK session metadata (best-effort). */
	taskTitle?: string;
	initialMessages?: NKleinSdkPersistedMessage[];
	images?: RuntimeTaskImage[];
	/** W1.1a: optional per-turn output-token budget → the SDK's maxTokensPerTurn (absent ⇒ provider default). */
	maxTokensPerTurn?: number | null;
	filesLikelyTouched?: readonly string[] | null;
	resumeFromTrash?: boolean;
	resumeFromPersistence?: boolean;
	providerId?: string | null;
	modelId?: string | null;
	mode?: RuntimeTaskSessionMode;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextScope?: "full" | "smart" | "minimal" | "custom";
	contextWindow?: number | null;
	timeoutMode?: "normal" | "long" | "extended" | "unlimited";
	requestTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
	streamTimeoutMs?: number | null;
	toolTimeoutMs?: number | null;
	conversationTimeoutMs?: number | null;
	/** Provenance of each bounded timeout, recorded on the terminal run summary if that timeout fires. */
	streamTimeoutSource?: TaskRunTimeoutSource;
	toolTimeoutSource?: TaskRunTimeoutSource;
	conversationTimeoutSource?: TaskRunTimeoutSource;
	maxAgentWritableFileLines?: number | null;
	codeEmbeddingProvider?: NKleinCodeEmbeddingProvider;
	systemPrompt?: string | null;
}

export interface NKleinTaskLaunchConfigOverrides {
	providerId: string;
	modelId: string;
	workspaceRoot?: string | null;
	filesLikelyTouched?: readonly string[] | null;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
	/** W1.1: per-turn output-token budget override (the §5.AA budget-raise retry lever); absent ⇒ unchanged. */
	maxTokensPerTurn?: number | null;
}

interface NKleinTaskRestartLaunchConfig extends NKleinTaskLaunchConfigOverrides {
	maxAgentWritableFileLines?: number | null;
}

export interface NKleinTaskSessionService {
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void;
	onMessage(listener: (taskId: string, message: NKleinTaskMessage) => void): () => void;
	onTeamProgress(listener: (taskId: string, event: RuntimeNKleinTeamProgressEvent) => void): () => void;
	startTaskSession(request: StartNKleinTaskSessionRequest): Promise<RuntimeTaskSessionSummary>;
	stopTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	completeTaskSessionAfterDecomposition(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	abortTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	cancelTaskTurn(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	sendTaskSessionInput(
		taskId: string,
		text: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides,
	): Promise<RuntimeTaskSessionSummary | null>;
	reloadTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	rebindPersistedTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	getSummary(taskId: string): RuntimeTaskSessionSummary | null;
	/** Interactive-shell target for a task's prepared sandbox container, or null (todo §5.A shell-on-task). */
	getTaskShellTarget(taskId: string): AgentSandboxShellTarget | null;
	listSummaries(): RuntimeTaskSessionSummary[];
	listModelEndpointSessions(): Array<{
		taskId: string;
		state: RuntimeTaskSessionSummary["state"];
		startedAt: number | null;
		providerId: string;
		modelId: string;
		endpoint: string | null;
	}>;
	listMessages(taskId: string): NKleinTaskMessage[];
	listSlashCommands(workspacePath: string): Promise<NKleinSdkSlashCommand[]>;
	loadTaskSessionMessages(taskId: string): Promise<NKleinTaskMessage[]>;
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	setBoardPaused(paused: boolean): void;
	setCardPaused(taskId: string, paused: boolean): void;
	/** Apply the operator-configurable autonomous-run guardrail limits (Settings → "Local swarm guardrails"). */
	setSwarmGuardrails(guardrails: RuntimeSwarmGuardrails): void;
	/** Apply the §5.AC "knows today" runtime-config switch (off by default) when config changes. */
	setKnowsTodayEnabled(enabled: boolean): void;
	/** Apply the §5.AR curated sandbox-MCP-servers switch (on by default) when config changes. */
	setSandboxMcpServersEnabled(enabled: boolean): void;
	waitUntilTaskResumed(taskId: string): Promise<void>;
	verifyTaskAcceptanceInSandbox(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
		timeoutMs?: number;
	}): Promise<RuntimeTaskAcceptanceResult>;
	runSecondOpinionReviewSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
	}): Promise<NKleinReviewResult | null>;
	updateAgentSandboxPoolConfig(config: Partial<AgentSandboxPoolConfig>): Promise<void>;
	resumePausedTasks(): Promise<RuntimeTaskSessionSummary[]>;
	dispose(): Promise<void>;
}

interface BaseCreateInMemoryNKleinTaskSessionServiceOptions {
	createSessionRuntime?: (options: CreateInMemoryNKleinSessionRuntimeOptions) => NKleinSessionRuntime;
	createMessageRepository?: () => NKleinMessageRepository;
	createRuntimeSetup?: (workspacePath: string) => Promise<NKleinRuntimeSetup>;
	watcherRegistry?: NKleinWatcherRegistry;
	pauseController?: NKleinPauseController;
	onDecompositionApplied?: NKleinDecompositionAppliedHandler;
	/** Promote a work card from Planning/Refinement to In Progress when it calls `begin_implementation` (todo §5.B). */
	onCardPromoted?: NKleinCardPromotedHandler;
	/** Persist an agent's focus chain (todo §5.N) when it calls `update_focus_chain`. */
	onFocusChainUpdated?: (taskId: string, chain: FocusChain) => void | Promise<void>;
	/** Operator-configurable autonomous-run guardrail limits; defaults to DEFAULT_RUNTIME_SWARM_GUARDRAILS. */
	swarmGuardrails?: RuntimeSwarmGuardrails;
	/**
	 * The §5.AC "knows today" runtime-config setting — OFF BY DEFAULT. When true (or the `NKLEIN_KNOWS_TODAY` env
	 * override is set), the relevance-gated date block is appended to each agent's system prompt. Live-updated by the
	 * runtime when config changes (same seam as `swarmGuardrails`); env override honored independently.
	 */
	knowsTodayEnabled?: boolean;
	/**
	 * The §5.AR curated sandbox-hosted MCP servers switch — ON BY DEFAULT. When true, a fitting model's task is offered
	 * the curated servers baked into the sandbox image (via `docker exec`); the `NKLEIN_SANDBOX_MCP` env can force it on
	 * independently. Live-updated when config changes (same seam as `swarmGuardrails`).
	 */
	sandboxMcpServersEnabled?: boolean;
	/**
	 * Root dir for the diagnostic stores this service writes (task-run summaries + the Agent Attempt Ledger).
	 * Defaults to the real `~/.nklein` runtime home; tests inject a temp dir so they don't pollute it.
	 */
	diagnosticStoreRoot?: string;
}

export type CreateInMemoryNKleinTaskSessionServiceOptions =
	| (BaseCreateInMemoryNKleinTaskSessionServiceOptions & {
			agentSandboxManager: AgentSandboxManager;
			allowUnisolatedTestRuntime?: never;
	  })
	| (BaseCreateInMemoryNKleinTaskSessionServiceOptions & {
			agentSandboxManager?: null;
			/**
			 * Test-only escape hatch for unit suites that stub the SDK runtime in-process.
			 * Runtime callers must pass an AgentSandboxManager so NKlein tools cannot fall back to host execution.
			 */
			allowUnisolatedTestRuntime: true;
	  });

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
	private readonly contextWindowStore = new TaskContextWindowStore();
	private readonly contextBudgetInputs = new TaskContextBudgetInputs();
	private readonly launchConfigByTaskId = new Map<string, NKleinTaskRestartLaunchConfig>();
	/** §5.AN opt-in residency heartbeats, one per running task (auto-cleaned on session end). */
	private readonly residencyHeartbeatByTaskId = new Map<string, ResidencyHeartbeatHandle>();
	private readonly requestTimer = new TaskRequestTimer(now);
	private readonly failureBackoff = new TaskFailureBackoffTracker();
	/** Last terminal state already persisted to the durable run-summary store, to dedupe repeated emits. */
	private readonly lastRecordedRunStateByTaskId = new Map<string, TaskRunTerminalState>();
	/** Structured timeout reason for the next terminal run summary, set when a task is aborted on timeout. */
	private readonly pendingTimeout = new TaskPendingTimeoutStore();
	private readonly autonomyBudgetWatchdog: AutonomyBudgetWatchdog;
	private readonly timeoutSettingsByTaskId = new Map<string, NKleinTaskTimeoutSettings>();
	private readonly timeoutScheduler = new TaskTimeoutScheduler();
	private readonly explicitDecompositionTaskIds = new Set<string>();
	private readonly decompositionStallNudger: DecompositionStallNudger;
	private readonly repeatedToolCallGuard: RepeatedToolCallGuard;
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
	/** Temp root for diagnostic stores in tests; undefined in production (→ the real `~/.nklein` home). */
	private readonly diagnosticStoreRoot: string | undefined;
	/** Latest focus chain each task emitted (todo §5.N), captured into the terminal run summary. */
	private readonly focusChainByTaskId = new Map<string, FocusChain>();
	private readonly runtimeSetupLeaseByWorkspacePath = new Map<string, Promise<NKleinRuntimeSetupLease>>();
	private readonly teamProgressListeners = new Set<(taskId: string, event: RuntimeNKleinTeamProgressEvent) => void>();

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
		this.diagnosticStoreRoot = options.diagnosticStoreRoot;
		this.decompositionStallNudger = new DecompositionStallNudger(this.buildNudgerCallbacks());
		this.repeatedToolCallGuard = new RepeatedToolCallGuard(this.buildGuardCallbacks());
		this.autonomyBudgetWatchdog = new AutonomyBudgetWatchdog(this.buildWatchdogCallbacks());
	}

	private buildGuardCallbacks(): RepeatedToolCallGuardCallbacks {
		return {
			getMaxRepeatedToolCallsPerTask: () => this.swarmGuardrails.maxRepeatedToolCallsPerTask,
			getTaskEntry: (taskId) => this.messageRepository.getTaskEntry(taskId) ?? null,
			parkTaskForAutonomyBudget: (input) => this.parkTaskForAutonomyBudget(input),
		};
	}

	private buildWatchdogCallbacks(): AutonomyBudgetWatchdogCallbacks {
		return {
			getSwarmGuardrails: () => this.swarmGuardrails,
			isTaskPaused: (taskId) => this.pauseController.isPaused(taskId),
			parkTaskForPause: (input) => this.parkTaskForPause(input),
			parkTaskForAutonomyBudget: (input) => this.parkTaskForAutonomyBudget(input),
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
		this.teamProgressListeners.add(listener);
		return () => {
			this.teamProgressListeners.delete(listener);
		};
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
		const normalized: NKleinTaskRestartLaunchConfig = {
			providerId: launchConfig.providerId.trim().toLowerCase(),
			modelId: launchConfig.modelId.trim(),
			...(Object.hasOwn(launchConfig, "workspaceRoot")
				? { workspaceRoot: launchConfig.workspaceRoot?.trim() || null }
				: {}),
			...(Object.hasOwn(launchConfig, "filesLikelyTouched")
				? { filesLikelyTouched: launchConfig.filesLikelyTouched ?? null }
				: {}),
			...(Object.hasOwn(launchConfig, "apiKey") ? { apiKey: launchConfig.apiKey } : {}),
			...(Object.hasOwn(launchConfig, "baseUrl") ? { baseUrl: launchConfig.baseUrl?.trim() || null } : {}),
			...(Object.hasOwn(launchConfig, "reasoningEffort") ? { reasoningEffort: launchConfig.reasoningEffort } : {}),
			...(Object.hasOwn(launchConfig, "contextWindow") ? { contextWindow: launchConfig.contextWindow } : {}),
			...(Object.hasOwn(launchConfig, "maxAgentWritableFileLines")
				? { maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines }
				: {}),
			...(Object.hasOwn(launchConfig, "apiTimeoutMs") ? { apiTimeoutMs: launchConfig.apiTimeoutMs } : {}),
			...(Object.hasOwn(launchConfig, "turnTimeoutMs") ? { turnTimeoutMs: launchConfig.turnTimeoutMs } : {}),
		};
		this.launchConfigByTaskId.set(taskId, normalized);
		this.providerIdStore.set(taskId, normalized.providerId);
		this.modelEndpoint.set(taskId, normalized.modelId, normalized.baseUrl ?? null);
		if (Object.hasOwn(normalized, "contextWindow")) {
			this.resolveContextWindowForTask(taskId, normalized.contextWindow);
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

	private async startRuntimeTaskSessionFromLaunchConfig(input: {
		taskId: string;
		cwd: string;
		workspaceRoot?: string | null;
		prompt: string;
		initialMessages?: NKleinSdkPersistedMessage[];
		/** W1.1a: optional per-turn output budget (see StartNKleinTaskSessionInput.maxTokensPerTurn). */
		maxTokensPerTurn?: number | null;
		images?: RuntimeTaskImage[];
		mode?: RuntimeTaskSessionMode;
		launchConfig: NKleinTaskRestartLaunchConfig;
		systemPrompt?: string | null;
		contextScope?: "full" | "smart" | "minimal" | "custom";
		timeoutMode?: "normal" | "long" | "extended" | "unlimited";
		codeEmbeddingProvider?: NKleinCodeEmbeddingProvider;
		onReviewSubmitted?: NKleinReviewSubmittedHandler;
		toolExecutors?: ReturnType<typeof createAgentSandboxToolExecutors>;
		extraTools?: ReturnType<typeof createAgentSandboxExtraTools>;
	}): Promise<{ result: unknown; warnings?: string[] }> {
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
		const runtimeSetup = await this.ensureRuntimeSetup(hostWorkspaceRoot);
		const requestContextWindow = this.resolveKnownContextWindowForTask(input.taskId, launchConfig.contextWindow);
		let systemPrompt =
			input.systemPrompt?.trim() ||
			(await resolveNKleinSdkSystemPrompt({
				// Sandbox-aware working directory for the `<env>` block; never the host mount (AGENTS.md).
				cwd: resolveNKleinAgentPerceivedCwd(input.taskId, agentPerceivedCwd),
				providerId: launchConfig.providerId,
				rules: runtimeSetup.loadRules(),
			}));
		const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(input.taskId);
		if (appendedSystemPrompt) {
			systemPrompt = `${systemPrompt}\n\n${appendedSystemPrompt}`;
		}
		// The "knows today" lighthouse (§5.AC): OFF BY DEFAULT (env NKLEIN_KNOWS_TODAY), relevance-gated (§5.AE), and
		// APPENDED AT THE END (§5.AQ cache-prefix stability). The decision core composes those three policies; when the
		// flag is unset or the turn isn't temporal, `appendTemporalContext` returns the prompt byte-unchanged (zero cost).
		// The clock is the trusted host `new Date()` — the sandbox never provides an authoritative "now".
		// ORDER MATTERS (§5.AQ cache-prefix stability; audit 2026-07-02): the efficiency rules go BEFORE the
		// temporal date block, so the DAILY-changing date stays the true suffix — previously the rules were appended
		// AFTER the date, so every date rollover invalidated the rules' cached prefix too.
		systemPrompt = `${systemPrompt}\n\n${buildKanbanEfficiencyRules({
			contextScope: input.contextScope ?? "smart",
			contextWindow: requestContextWindow,
			timeoutMode: input.timeoutMode ?? "normal",
			maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines ?? null,
			// W2.4a: small (quality-effective) windows get the LEAN rules. FLAG-GATED OFF after live A/B evidence
			// (run9 2026-07-02): the first lean run showed coder-gpu ping-ponging read_files/get_file_size for 14min
			// with zero writes — the dropped "never re-read covered ranges" lines plausibly serve as anti-loop rails
			// for small models. Enable with NKLEIN_LEAN_SYSPROMPT=1 to measure; default full until the scoreboard
			// proves lean safe (research: measure-first).
			level:
				isTruthyEnv(process.env.NKLEIN_LEAN_SYSPROMPT) && requestContextWindow && requestContextWindow <= 40_000
					? "lean"
					: "full",
		})}`;
		systemPrompt = appendTemporalContext(
			systemPrompt,
			decideTemporalContextInjection({
				enabled: this.knowsTodayEnabled || isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY),
				text: input.prompt,
				now: new Date(),
			}),
		);

		await this.waitUntilTaskResumed(input.taskId);
		this.requestTimer.markStarted(input.taskId);
		this.refreshLearnedQualityBudgets();
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
				...(sandboxExtraTools ? { extraTools: sandboxExtraTools } : {}),
				// §5.AR: offer the curated sandbox-hosted MCP servers (fit-gated per model) when enabled — the runtime-config
				// `sandboxMcpServersEnabled` (ON by default; global/per-project opt-out) OR the `NKLEIN_SANDBOX_MCP` env override.
				...((this.sandboxMcpServersEnabled || isTruthyEnv(process.env.NKLEIN_SANDBOX_MCP)) && sandboxWorkspace
					? { sandboxMcpExecTarget: sandboxWorkspace.manager.getSandboxExecTarget(input.taskId) }
					: {}),
				userInstructionService: runtimeSetup.userInstructionService,
				requestToolApproval: runtimeSetup.createToolApproval({
					taskId: input.taskId,
					contextWindow: requestContextWindow,
					maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					filesLikelyTouched: launchConfig.filesLikelyTouched ?? null,
				}),
				toolPolicies: runtimeSetup.toolPolicies,
				onDecompositionApplied: this.onDecompositionApplied,
				onCardPromoted: isHomeAgentSessionId(input.taskId) ? undefined : this.onCardPromoted,
				onReviewSubmitted: input.onReviewSubmitted,
				onFocusChainUpdated: (chain) => {
					const timed = applyFocusChainStepTiming(this.focusChainByTaskId.get(input.taskId), chain, now());
					this.focusChainByTaskId.set(input.taskId, timed);
					void this.onFocusChainUpdated?.(input.taskId, timed);
				},
				onTeamEvent: (event, teamName) => {
					this.emitTeamProgress(input.taskId, event, teamName);
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

	private emitTaskFailure(
		taskId: string,
		entry: NKleinTaskSessionEntry,
		context: "start" | "send",
		error: unknown,
	): void {
		this.clearTaskTimeout(taskId, "stream");
		this.clearTaskTimeout(taskId, "tool");
		this.clearTaskTimeout(taskId, "conversation");
		this.activeToolTaskIds.delete(taskId);
		const errorMessage = toErrorMessage(error);
		const creditLimitError = this.isNKleinProviderForTask(taskId) && isCreditLimitError(errorMessage);
		const providerId = this.resolveProviderIdForTask(taskId);
		const modelId = this.modelEndpoint.getModelId(taskId);
		const endpoint = this.modelEndpoint.getEndpoint(taskId);
		// A local model host (LM Studio/Ollama) that crashed or unloaded its model won't recover by retrying the
		// dead endpoint; classify it so the task parks fast with reload guidance instead of storming a gone model.
		const localModelUnavailable =
			!creditLimitError &&
			isLocalProvider(providerId, endpoint) &&
			isLocalModelRuntimeUnavailableError(errorMessage);
		const backoff = computeNKleinFailureBackoff({
			context,
			errorMessage,
			previousFailure: this.failureBackoff.getPrevious(taskId),
			localModelUnavailable,
		});
		if (backoff.alreadyParked) {
			return;
		}
		const { consecutiveFailures, shouldPark } = backoff;
		const localModelUnavailableGuidance = localModelUnavailable
			? `Local model "${modelId}" on ${endpoint ?? "its endpoint"} became unavailable mid-run (crashed or unloaded — local hosts like LM Studio drop a model under memory pressure, which a reasoning model at a large context window on limited hardware can trigger). Reload the model in your local host, or pick a smaller / non-reasoning model or a smaller context window, then resume this task.`
			: null;
		this.failureBackoff.record(taskId, backoff.nextState);
		recordSelfObservation({
			signal: creditLimitError ? "provider_error" : localModelUnavailable ? "provider_error" : "runtime_error",
			severity: "error",
			message: shouldPark
				? `NKlein SDK ${context} failed ${consecutiveFailures} consecutive times; parking task: ${errorMessage}`
				: `NKlein SDK ${context} failed: ${errorMessage}`,
			taskId,
			providerId,
			modelId,
			metadata: {
				context,
				creditLimitError,
				localModelUnavailable,
				consecutiveFailures,
				parked: shouldPark,
			},
		});
		if (!creditLimitError) {
			const baseMessage = shouldPark
				? `NKlein SDK ${context} failed ${consecutiveFailures} consecutive times with the same error, so !Klein parked this task to avoid retry storms: ${errorMessage}. Send a new message after fixing the cause to try again.`
				: `NKlein SDK ${context} failed: ${errorMessage}. You can send another message to continue the conversation.`;
			const systemMessage = createMessage(
				taskId,
				"system",
				localModelUnavailableGuidance ? `${localModelUnavailableGuidance}\n\n${baseMessage}` : baseMessage,
			);
			entry.messages.push(systemMessage);
			this.emitMessage(taskId, systemMessage);
		}
		clearActiveTurnState(entry);
		const errorSummary = updateSummary(entry, {
			state: shouldPark ? "failed" : "awaiting_review",
			reviewReason: "error",
			lastOutputAt: now(),
			lastHookAt: now(),
			warningMessage: creditLimitError ? null : (localModelUnavailableGuidance ?? errorMessage),
			latestHookActivity: {
				activityText: shouldPark
					? `${context === "start" ? "Start" : "Send"} parked after repeated failures: ${errorMessage}`
					: `${context === "start" ? "Start" : "Send"} failed: ${errorMessage}`,
				toolName: null,
				toolInputSummary: null,
				finalMessage: errorMessage,
				hookEventName: "agent_error",
				notificationType: creditLimitError ? "credit_limit" : null,
				source: "nklein-sdk",
			},
		});
		this.emitSummary(errorSummary);
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
		this.timeoutScheduler.clearKind(taskId, kind);
	}

	private clearTaskTimeouts(taskId: string): void {
		this.timeoutScheduler.clearAll(taskId);
		this.activeToolTaskIds.delete(taskId);
		this.stopModelResidencyWatch(taskId);
	}

	/**
	 * §5.AN residency heartbeat (OPT-IN via `NKLEIN_RESIDENCY_HEARTBEAT`): while a task runs, poll the model's residency
	 * and — if it crashes / is unloaded (memory pressure) — fail FAST instead of waiting out the ultra-long timeout. Inert
	 * by default (flag off) and auto-detected (a non-LM-Studio host reports `unobservable`, so it never aborts). The
	 * heartbeat self-cleans when the task leaves `running`; `stopModelResidencyWatch` in `clearTaskTimeouts` is a backstop.
	 */
	private beginModelResidencyWatch(taskId: string): void {
		if (!isTruthyEnv(process.env.NKLEIN_RESIDENCY_HEARTBEAT) || this.residencyHeartbeatByTaskId.has(taskId)) {
			return;
		}
		const launchConfig = this.launchConfigByTaskId.get(taskId);
		const baseUrl = launchConfig?.baseUrl?.trim();
		const modelId = launchConfig?.modelId?.trim();
		if (!baseUrl || !modelId) {
			return; // nothing to observe
		}
		const handle = startResidencyHeartbeat({
			probe: () => probeModelResidency(baseUrl, modelId),
			policy: { absentConfirmations: 3 },
			intervalMs: 15_000,
			shouldContinue: () => this.messageRepository.getTaskEntry(taskId)?.summary.state === "running",
			onModelLost: () => {
				void this.handleModelResidencyLost(taskId);
			},
		});
		this.residencyHeartbeatByTaskId.set(taskId, handle);
	}

	private stopModelResidencyWatch(taskId: string): void {
		const handle = this.residencyHeartbeatByTaskId.get(taskId);
		if (handle) {
			handle.stop();
			this.residencyHeartbeatByTaskId.delete(taskId);
		}
	}

	/** The model crashed/unloaded mid-run — abort + surface a diagnosable failure (mirrors the timeout path). */
	private async handleModelResidencyLost(taskId: string): Promise<void> {
		this.stopModelResidencyWatch(taskId);
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (entry?.summary.state !== "running") {
			return;
		}
		this.clearTaskTimeouts(taskId);
		await this.sessionRuntime.abortTaskSession(taskId).catch(() => undefined);
		this.recordObservationWithModel({
			signal: "model_stalled",
			severity: "warning",
			message: "Model is no longer resident in LM Studio (crashed or unloaded) — aborted to fail fast.",
			taskId,
			workspacePath: entry.summary.workspacePath ?? null,
			metadata: { category: "model_lost_residency" },
		});
		this.emitTaskFailure(
			taskId,
			entry,
			"send",
			new Error("Model is no longer resident in LM Studio (crashed or unloaded)."),
		);
	}

	private clearDecompositionChatNudge(taskId: string): void {
		this.decompositionStallNudger.clearDecompositionChatNudge(taskId);
	}

	private scheduleDecompositionChatNudge(taskId: string): void {
		this.decompositionStallNudger.scheduleDecompositionChatNudge(taskId);
	}

	/**
	 * When an explicit decomposition turn ends without a `decompose_project` tool call the planning card would
	 * otherwise sit in Review having never decomposed (and a planning card has no reviewer to pick it up).
	 * Delegates to {@link DecompositionStallNudger.maybeContinueStalledDecomposition} which classifies the two
	 * stall shapes (`decompose` / `continue_read`) and re-prompts within the nudge budget.
	 */
	private maybeContinueStalledDecomposition(taskId: string): void {
		this.decompositionStallNudger.maybeContinueStalledDecomposition(taskId);
	}

	private scheduleTaskTimeout(taskId: string, kind: NKleinTaskTimeoutKind, timeoutMs: number | null): void {
		this.timeoutScheduler.schedule(taskId, kind, timeoutMs, (firedTimeoutMs) => {
			void this.handleTaskTimeout(taskId, kind, firedTimeoutMs);
		});
	}

	private scheduleStreamTimeout(taskId: string): void {
		const settings = this.timeoutSettingsByTaskId.get(taskId);
		if (!settings || this.activeToolTaskIds.has(taskId)) {
			return;
		}
		this.scheduleTaskTimeout(taskId, "stream", settings.streamTimeoutMs);
	}

	private scheduleConversationTimeout(taskId: string): void {
		const settings = this.timeoutSettingsByTaskId.get(taskId);
		if (!settings) {
			return;
		}
		this.scheduleTaskTimeout(taskId, "conversation", settings.conversationTimeoutMs);
	}

	private async handleTaskTimeout(taskId: string, kind: NKleinTaskTimeoutKind, timeoutMs: number): Promise<void> {
		this.clearTaskTimeout(taskId, kind);
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (entry?.summary.state !== "running") {
			return;
		}
		this.clearTaskTimeouts(taskId);
		await this.sessionRuntime.abortTaskSession(taskId).catch(() => undefined);
		const timeoutLabel = formatTaskTimeoutLabel(kind);
		const timeoutSettings = this.timeoutSettingsByTaskId.get(taskId);
		const timeoutSource =
			kind === "stream"
				? timeoutSettings?.streamTimeoutSource
				: kind === "tool"
					? timeoutSettings?.toolTimeoutSource
					: timeoutSettings?.conversationTimeoutSource;
		this.pendingTimeout.record(taskId, formatTaskTimeoutReason(timeoutLabel, timeoutMs), timeoutSource ?? null);
		// follow-up-6 §3.5: a stream/tool inactivity timeout should leave a structured note on the card —
		// what the model was last doing, the last tool, whether any work was captured, and whether resuming is
		// safe — so a review caused by a stall is diagnosable instead of just "timeout after N seconds".
		const lastActivity = entry.summary.latestHookActivity?.activityText ?? null;
		const lastTool = entry.summary.latestHookActivity?.toolName ?? null;
		const changesCaptured = Boolean(entry.summary.latestTurnCheckpoint);
		const restartSafe = this.sessionRuntime.canRestartTaskSession(taskId);
		this.recordObservationWithModel({
			signal: "budget_wall",
			severity: "warning",
			message: formatTaskTimeoutMessage(timeoutLabel, timeoutMs),
			taskId,
			workspacePath: entry.summary.workspacePath ?? null,
			metadata: {
				category: "stream_inactivity_timeout",
				timeoutKind: kind,
				timeoutMs,
				lastActivity,
				lastTool,
				lastOutputAt: entry.summary.lastOutputAt ?? null,
				lastTokenAt: entry.summary.lastTokenAt ?? null,
				changesCaptured,
				restartSafe,
			},
		});
		this.emitTaskFailure(
			taskId,
			entry,
			"send",
			new Error(
				formatTaskTimeoutFailureMessage(timeoutLabel, timeoutMs, {
					lastActivity,
					lastTool,
					changesCaptured,
					restartSafe,
				}),
			),
		);
	}

	private async dispatchResolvedTaskInput(input: {
		taskId: string;
		prompt: string;
		mode?: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		delivery?: "queue" | "steer";
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides;
	}): Promise<{
		result: unknown;
		warnings?: string[];
	}> {
		if (
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
			const restartLaunchConfig =
				input.launchConfigOverrides ??
				this.resolvePersistedLaunchConfig({
					taskId: input.taskId,
					persistedSnapshot,
				});
			const contextWindow = this.resolveKnownContextWindowForTask(input.taskId, restartLaunchConfig?.contextWindow);
			const initialMessages = this.prepareMessagesForKnownContextWindow({
				taskId: input.taskId,
				messages: persistedSnapshot?.messages,
				prompt: input.prompt,
				images: input.images,
				contextWindow,
			});
			await this.sessionRuntime.stopTaskSession(input.taskId);
			if (this.sessionRuntime.canRestartTaskSession(input.taskId)) {
				await this.waitUntilTaskResumed(input.taskId);
				this.requestTimer.markStarted(input.taskId);
				const restartedSession = await this.sessionRuntime.restartTaskSession({
					taskId: input.taskId,
					prompt: input.prompt,
					mode: input.mode,
					images: input.images,
					initialMessages,
					launchConfigOverrides: restartLaunchConfig ?? undefined,
					onTeamEvent: (event, teamName) => {
						this.emitTeamProgress(input.taskId, event, teamName);
					},
				});
				if (restartLaunchConfig) {
					this.cacheLaunchConfig(input.taskId, restartLaunchConfig);
				}
				return {
					result: restartedSession.result,
					warnings: restartedSession.warnings,
				};
			}
			if (restartLaunchConfig && persistedSnapshot?.record.cwd) {
				return await this.startRuntimeTaskSessionFromLaunchConfig({
					taskId: input.taskId,
					cwd: persistedSnapshot.record.cwd,
					prompt: input.prompt,
					mode: input.mode,
					images: input.images,
					initialMessages,
					launchConfig: restartLaunchConfig,
				});
			}
			throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
		}

		if (isHomeAgentSessionId(input.taskId) && !this.sessionRuntime.canRestartTaskSession(input.taskId)) {
			throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
		}

		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId);
		const restartLaunchConfig =
			input.launchConfigOverrides ??
			this.resolvePersistedLaunchConfig({
				taskId: input.taskId,
				persistedSnapshot,
			});
		const contextWindow = this.resolveKnownContextWindowForTask(input.taskId, restartLaunchConfig?.contextWindow);
		const initialMessages = this.prepareMessagesForKnownContextWindow({
			taskId: input.taskId,
			messages: persistedSnapshot?.messages,
			prompt: input.prompt,
			images: input.images,
			contextWindow,
		});
		if (this.sessionRuntime.canRestartTaskSession(input.taskId)) {
			await this.waitUntilTaskResumed(input.taskId);
			this.requestTimer.markStarted(input.taskId);
			const restartedSession = await this.sessionRuntime.restartTaskSession({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages,
				launchConfigOverrides: restartLaunchConfig ?? undefined,
				onTeamEvent: (event, teamName) => {
					this.emitTeamProgress(input.taskId, event, teamName);
				},
			});
			if (restartLaunchConfig) {
				this.cacheLaunchConfig(input.taskId, restartLaunchConfig);
			}
			return {
				result: restartedSession.result,
				warnings: restartedSession.warnings,
			};
		}
		if (restartLaunchConfig && persistedSnapshot?.record.cwd) {
			return await this.startRuntimeTaskSessionFromLaunchConfig({
				taskId: input.taskId,
				cwd: persistedSnapshot.record.cwd,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages,
				launchConfig: restartLaunchConfig,
			});
		}
		throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
	}

	private async retryAfterContextOverflow(input: {
		taskId: string;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		error: unknown;
	}): Promise<{ result: unknown; warnings?: string[] } | null> {
		if (!isContextOverflowError(input.error)) {
			return null;
		}
		this.recordObservationWithModel({
			signal: "context_overflow",
			severity: "warning",
			message: toErrorMessage(input.error),
			taskId: input.taskId,
			metadata: {
				mode: input.mode,
			},
		});

		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId).catch(() => null);
		const compactedMessages = compactPersistedMessagesForContextOverflow(persistedSnapshot?.messages ?? []);
		if (!compactedMessages) {
			return null;
		}
		const restartLaunchConfig = this.resolvePersistedLaunchConfig({
			taskId: input.taskId,
			persistedSnapshot,
		});

		await this.sessionRuntime.stopTaskSession(input.taskId).catch(() => null);
		if (this.sessionRuntime.canRestartTaskSession(input.taskId)) {
			await this.waitUntilTaskResumed(input.taskId);
			this.requestTimer.markStarted(input.taskId);
			const restartedSession = await this.sessionRuntime.restartTaskSession({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: compactedMessages,
				launchConfigOverrides: restartLaunchConfig ?? undefined,
				onTeamEvent: (event, teamName) => {
					this.emitTeamProgress(input.taskId, event, teamName);
				},
			});
			return {
				result: restartedSession.result,
				warnings: restartedSession.warnings,
			};
		}
		if (restartLaunchConfig && persistedSnapshot?.record.cwd) {
			return await this.startRuntimeTaskSessionFromLaunchConfig({
				taskId: input.taskId,
				cwd: persistedSnapshot.record.cwd,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: compactedMessages,
				launchConfig: restartLaunchConfig,
			});
		}
		throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
	}

	private normalizeEffectiveContextWindow(contextWindow: number): number {
		return Math.trunc(contextWindow);
	}

	private resolveContextWindowForTask(taskId: string, launchContextWindow?: number | null): number | null {
		if (typeof launchContextWindow === "number" && Number.isFinite(launchContextWindow) && launchContextWindow > 0) {
			const normalized = this.normalizeEffectiveContextWindow(launchContextWindow);
			this.contextWindowStore.set(taskId, normalized);
			return normalized;
		}
		return this.contextWindowStore.get(taskId);
	}

	private resolveKnownContextWindowForTask(taskId: string, launchContextWindow?: number | null): number {
		const contextWindow =
			this.resolveContextWindowForTask(taskId, launchContextWindow) ?? RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS;
		// W2.3a: cap by the LEARNED quality-effective budget for this task's model when the ledger has observed a
		// quality knee below the advertised window (never below the 32k floor — the budget itself enforces it).
		const modelId = this.launchConfigByTaskId.get(taskId)?.modelId ?? null;
		const qualityBudget = modelId ? (this.qualityBudgetByModelId.get(modelId) ?? null) : null;
		const derated = qualityBudget !== null ? Math.min(contextWindow, qualityBudget) : contextWindow;
		return this.normalizeEffectiveContextWindow(derated);
	}

	private recordContextBudgetGuard(input: {
		taskId: string;
		action: "compacted" | "blocked";
		contextWindow: number;
		originalProjectedTokens: number;
		projectedTokens: number;
		originalHistoryTokens: number;
		compactedHistoryTokens: number;
		nextPromptTokens: number;
	}): void {
		this.recordObservationWithModel({
			signal: "context_overflow",
			severity: input.action === "blocked" ? "error" : "warning",
			message:
				input.action === "blocked"
					? `Pre-send context guard blocked an oversized prompt before provider dispatch (~${input.projectedTokens.toLocaleString()} projected tokens for ${input.contextWindow.toLocaleString()} available).`
					: `Pre-send context guard compacted history before provider dispatch (~${input.originalProjectedTokens.toLocaleString()} → ~${input.projectedTokens.toLocaleString()} projected tokens).`,
			taskId: input.taskId,
			metadata: {
				action: input.action,
				contextWindow: input.contextWindow,
				originalProjectedTokens: input.originalProjectedTokens,
				projectedTokens: input.projectedTokens,
				originalHistoryTokens: input.originalHistoryTokens,
				compactedHistoryTokens: input.compactedHistoryTokens,
				nextPromptTokens: input.nextPromptTokens,
				sendReserveTokens: CONTEXT_BUDGET_SEND_RESERVE_TOKENS,
				effectiveContextWindow: input.contextWindow,
			},
		});
	}

	private prepareMessagesForKnownContextWindow(input: {
		taskId: string;
		messages?: NKleinSdkPersistedMessage[] | null;
		prompt: string;
		images?: RuntimeTaskImage[];
		contextWindow: number;
	}): NKleinSdkPersistedMessage[] | undefined {
		const plan = planContextBudget({
			messages: input.messages,
			prompt: input.prompt,
			images: input.images,
			contextWindow: input.contextWindow,
		});
		if (plan.outcome === "blocked") {
			this.recordContextBudgetGuard({
				taskId: input.taskId,
				action: "blocked",
				contextWindow: input.contextWindow,
				originalProjectedTokens: plan.originalProjectedTokens,
				projectedTokens: plan.projectedTokens,
				originalHistoryTokens: plan.originalHistoryTokens,
				compactedHistoryTokens: plan.compactedHistoryTokens,
				nextPromptTokens: plan.nextPromptTokens,
			});
			if (plan.promptAloneOverflows) {
				throw new Error(
					`Your message (~${plan.nextPromptTokens.toLocaleString()} tokens) is larger than this model's ~${input.contextWindow.toLocaleString()} token working budget after reserving ${CONTEXT_BUDGET_SEND_RESERVE_TOKENS.toLocaleString()} tokens for the response. Shorten the message, ask !Klein to summarize pasted content first, or pick a larger-window local model.`,
				);
			}
			throw new Error(
				`Context would overflow the known ${input.contextWindow.toLocaleString()} token window after !Klein compaction (~${plan.projectedTokens.toLocaleString()} projected tokens). Old read_files tool output was omitted; clear or summarize the task history before sending more input.`,
			);
		}
		if (plan.outcome === "compacted") {
			this.recordContextBudgetGuard({
				taskId: input.taskId,
				action: "compacted",
				contextWindow: input.contextWindow,
				originalProjectedTokens: plan.originalProjectedTokens,
				projectedTokens: plan.projectedTokens,
				originalHistoryTokens: plan.originalHistoryTokens,
				compactedHistoryTokens: plan.compactedHistoryTokens,
				nextPromptTokens: plan.nextPromptTokens,
			});
		}
		return plan.compactedMessages.length > 0 ? plan.compactedMessages : undefined;
	}

	private async maybeCompactBeforeContextOverflow(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides;
		contextWindow: number;
	}): Promise<{ result: unknown; warnings?: string[] } | null> {
		const nextPromptTokens = estimateNextPromptTokens(input.prompt, input.images);
		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId).catch(() => null);
		const compactedMessages = this.prepareMessagesForKnownContextWindow({
			taskId: input.taskId,
			messages: persistedSnapshot?.messages,
			prompt: input.prompt,
			images: input.images,
			contextWindow: input.contextWindow,
		});
		const projectedTokens =
			(compactedMessages ? countKanbanPersistedMessagesTokens(compactedMessages) : 0) +
			nextPromptTokens +
			CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
		const usageRatio = projectedTokens / input.contextWindow;

		if (usageRatio >= CONTEXT_BUDGET_WARNING_RATIO) {
			this.emitSummary(
				updateSummary(input.entry, {
					warningMessage: `Context budget high (~${Math.round(usageRatio * 100)}%). Consider summarizing chat or narrowing scope.`,
				}),
			);
		}

		if (!compactedMessages) {
			return null;
		}

		const originalMessages = persistedSnapshot?.messages ?? [];
		if (compactedMessages === originalMessages && usageRatio < CONTEXT_BUDGET_COMPACT_RATIO) {
			return null;
		}

		await this.sessionRuntime.stopTaskSession(input.taskId).catch(() => null);
		const restartLaunchConfig =
			input.launchConfigOverrides ??
			this.resolvePersistedLaunchConfig({
				taskId: input.taskId,
				persistedSnapshot,
			});
		if (this.sessionRuntime.canRestartTaskSession(input.taskId)) {
			await this.waitUntilTaskResumed(input.taskId);
			this.requestTimer.markStarted(input.taskId);
			const restartedSession = await this.sessionRuntime.restartTaskSession({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: compactedMessages,
				launchConfigOverrides: restartLaunchConfig ?? undefined,
				onTeamEvent: (event, teamName) => {
					this.emitTeamProgress(input.taskId, event, teamName);
				},
			});
			return {
				result: restartedSession.result,
				warnings: restartedSession.warnings,
			};
		}
		if (restartLaunchConfig && persistedSnapshot?.record.cwd) {
			return await this.startRuntimeTaskSessionFromLaunchConfig({
				taskId: input.taskId,
				cwd: persistedSnapshot.record.cwd,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages: compactedMessages,
				launchConfig: restartLaunchConfig,
			});
		}
		throw new Error(`No previous NKlein session config is available for task ${input.taskId}.`);
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
		this.decompositionStallNudger.resetTask(request.taskId);
		if (request.startInPlanMode && isExplicitDecompositionPrompt(request.prompt)) {
			this.explicitDecompositionTaskIds.add(request.taskId);
		} else {
			this.explicitDecompositionTaskIds.delete(request.taskId);
		}
		const requestContextWindow = this.resolveKnownContextWindowForTask(request.taskId, request.contextWindow ?? null);
		const modelId = request.modelId?.trim() || UNCONFIGURED_MODEL_ID;
		const endpoint = request.baseUrl?.trim() || null;
		const sharedEndpointId = buildSharedLocalEndpointId({ providerId, modelId, endpoint });
		this.modelEndpoint.set(request.taskId, modelId, endpoint);
		this.recordLaunchContextWindow({
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
		this.timeoutSettingsByTaskId.set(request.taskId, {
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
				this.emitTaskFailure(request.taskId, entry, "start", error);
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
				const runtimeSetup = await this.ensureRuntimeSetup(request.cwd);
				const runtimePrompt = runtimeSetup.resolvePrompt(startPromptParts.userPrompt);
				const planningWorkflowPrompt = startPromptParts.systemWorkflowCommand
					? runtimeSetup.resolvePrompt(startPromptParts.systemWorkflowCommand)
					: null;
				const planningSystemPrompt = startPromptParts.systemPrompt
					? planningWorkflowPrompt
						? appendSystemPrompt(planningWorkflowPrompt, startPromptParts.systemPrompt)
						: startPromptParts.systemPrompt
					: null;
				let systemPrompt =
					request.systemPrompt?.trim() ||
					(await resolveNKleinSdkSystemPrompt({
						// The system prompt's `<env>` "Working Directory" must match the agent's actual (sandbox) cwd,
						// never the host mount — agents must never see host details (AGENTS.md). Same helper as the
						// agent-core `config.cwd`, so the two can't drift (the bug that leaked the host path here).
						cwd: resolveNKleinAgentPerceivedCwd(request.taskId, request.cwd),
						providerId,
						rules: runtimeSetup.loadRules(),
					}));
				const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(request.taskId);
				if (appendedSystemPrompt) {
					systemPrompt = `${systemPrompt}\n\n${appendedSystemPrompt}`;
				}
				systemPrompt = appendSystemPrompt(systemPrompt, planningSystemPrompt);
				// The "knows today" lighthouse (§5.AC): OFF BY DEFAULT (env NKLEIN_KNOWS_TODAY), relevance-gated (§5.AE),
				// and APPENDED AT THE END (§5.AQ cache-prefix stability), composed by the decision core. When the flag is
				// unset or the turn isn't temporal, the prompt is returned byte-unchanged (zero token cost). The clock is
				// the trusted host `new Date()` — the sandbox never provides an authoritative "now".
				systemPrompt = appendTemporalContext(
					systemPrompt,
					decideTemporalContextInjection({
						enabled: this.knowsTodayEnabled || isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY),
						text: request.prompt,
						now: new Date(),
					}),
				);
				systemPrompt = `${systemPrompt}\n\n${buildKanbanEfficiencyRules({
					contextScope: request.contextScope ?? "smart",
					contextWindow: requestContextWindow,
					timeoutMode: request.timeoutMode ?? "normal",
					maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
				})}`;
				const toolSchemaTokens = estimateKanbanToolSchemaTokens(runtimeSetup.toolPolicies);
				this.contextBudgetInputs.record(request.taskId, systemPrompt, toolSchemaTokens);

				const initialMessages = this.prepareMessagesForKnownContextWindow({
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
					this.scheduleStreamTimeout(request.taskId);
					this.scheduleConversationTimeout(request.taskId);
					this.beginModelResidencyWatch(request.taskId);
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
					extraTools: sandboxWorkspace
						? createAgentSandboxExtraTools(sandboxWorkspace.manager, request.taskId, {
								sessionId: createSessionId(request.taskId),
								contextWindow: requestContextWindow,
								maxFileLines: request.maxAgentWritableFileLines ?? null,
							})
						: undefined,
					// §5.AR: a RESTARTED isolated task gets the curated sandbox MCP servers too (consistent with the main
					// start path) — gated by the config setting (on by default) OR the env override, and only when a sandbox
					// exists for the rebuilt task.
					...((this.sandboxMcpServersEnabled || isTruthyEnv(process.env.NKLEIN_SANDBOX_MCP)) && sandboxWorkspace
						? { sandboxMcpExecTarget: sandboxWorkspace.manager.getSandboxExecTarget(request.taskId) }
						: {}),
					toolPolicies: runtimeSetup.toolPolicies,
					onDecompositionApplied: this.onDecompositionApplied,
					onCardPromoted: isHomeAgentSessionId(request.taskId) ? undefined : this.onCardPromoted,
					onFocusChainUpdated: (chain) => {
						const timed = applyFocusChainStepTiming(this.focusChainByTaskId.get(request.taskId), chain, now());
						this.focusChainByTaskId.set(request.taskId, timed);
						void this.onFocusChainUpdated?.(request.taskId, timed);
					},
					onTeamEvent: (event, teamName) => {
						this.emitTeamProgress(request.taskId, event, teamName);
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
				this.emitTaskFailure(request.taskId, entry, "start", error);
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
		await this.sessionRuntime.stopTaskSession(taskId).catch(() => null);
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
		this.clearDecompositionChatNudge(taskId);
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
			this.scheduleStreamTimeout(taskId);
			this.scheduleConversationTimeout(taskId);
			const assistantCountBeforeSend = entry.messages.filter((message) => message.role === "assistant").length;
			const runtimeSetupWorkspacePath = this.sandboxState.getRepoPath(taskId) ?? entry.summary.workspacePath ?? "";
			void this.ensureRuntimeSetup(runtimeSetupWorkspacePath)
				.then(async (runtimeSetup) => {
					const resolvedPrompt = runtimeSetup.resolvePrompt(normalized);
					const resolvedContextWindow = this.resolveKnownContextWindowForTask(
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
							const proactiveCompaction = await this.maybeCompactBeforeContextOverflow({
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
						});
					} catch (error) {
						const recovered = await this.retryAfterContextOverflow({
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
				})
				.then(({ result, warnings }) => {
					const warningMessage = formatStartWarnings(warnings);
					this.failureBackoff.forget(taskId);
					if (warningMessage) {
						this.emitSummary(
							updateSummary(entry, {
								warningMessage,
							}),
						);
					}
					const agentText = readAgentResultText(result);
					if (agentText) {
						const assistantCountAfterSend = entry.messages.filter(
							(message) => message.role === "assistant",
						).length;
						if (assistantCountAfterSend > assistantCountBeforeSend) {
							return;
						}
						const agentMessage =
							setOrCreateAssistantMessage(entry, taskId, agentText) ??
							createAssistantMessage(entry, taskId, agentText);
						this.emitMessage(taskId, agentMessage);
					}
				})
				.catch((error: unknown) => {
					this.emitTaskFailure(taskId, entry, "send", error);
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
			this.emitTaskFailure(taskId, entry, "start", error);
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
		this.contextWindowStore.forget(taskId);
		this.modelEndpoint.forget(taskId);
		this.contextBudgetInputs.forget(taskId);
		this.requestTimer.forget(taskId);
		this.failureBackoff.forget(taskId);
		this.autonomyBudgetWatchdog.resetTask(taskId);
		this.repeatedToolCallGuard.resetTask(taskId);
		this.pauseController.abortTaskWaiters(taskId);
		this.pauseController.clearTaskParked(taskId);
		this.pauseController.setCardPaused(taskId, false);
		this.clearTaskTimeouts(taskId);
		this.decompositionStallNudger.resetTask(taskId);
		this.explicitDecompositionTaskIds.delete(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
	}

	async clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const existingEntry = this.messageRepository.getTaskEntry(taskId);
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.providerIdStore.forget(taskId);
		this.contextWindowStore.forget(taskId);
		this.modelEndpoint.forget(taskId);
		this.contextBudgetInputs.forget(taskId);
		this.launchConfigByTaskId.delete(taskId);
		this.requestTimer.forget(taskId);
		this.failureBackoff.forget(taskId);
		this.autonomyBudgetWatchdog.resetTask(taskId);
		this.repeatedToolCallGuard.resetTask(taskId);
		this.clearTaskTimeouts(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
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

	listMessages(taskId: string): NKleinTaskMessage[] {
		return this.messageRepository.listMessages(taskId);
	}

	setBoardPaused(paused: boolean): void {
		this.pauseController.setBoardPaused(paused);
		if (paused) {
			this.parkActiveTasksForOperatorPause();
		}
	}

	setCardPaused(taskId: string, paused: boolean): void {
		this.pauseController.setCardPaused(taskId, paused);
		if (paused) {
			this.parkActiveTasksForOperatorPause(taskId);
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

	async waitUntilTaskResumed(taskId: string): Promise<void> {
		await this.pauseController.waitUntilResumed(taskId);
	}

	async verifyTaskAcceptanceInSandbox(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
		timeoutMs?: number;
	}): Promise<RuntimeTaskAcceptanceResult> {
		if (!this.agentSandboxManager) {
			throw new Error("!Klein acceptance verification requires the configured agent sandbox manager.");
		}
		return await runNKleinAcceptanceGateInSandbox({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: input.baseRef,
			taskPrompt: input.taskPrompt,
			timeoutMs: input.timeoutMs,
			sandboxManager: this.agentSandboxManager,
			pauseController: this.pauseController,
		});
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
	private async pickDiverseReviewerModel(
		workerLaunch: NKleinTaskRestartLaunchConfig,
		taskId: string,
	): Promise<{ providerId: string; modelId: string } | null> {
		const baseUrl = workerLaunch.baseUrl?.trim() || "http://127.0.0.1:1234/v1";
		const descriptors = await fetchLoadedModelDescriptors(baseUrl).catch(
			() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>,
		);
		if (descriptors.length === 0) {
			return null;
		}
		// The worker's launch modelId is usually the SERVED alias — resolve its REAL key for lineage when loaded.
		const workerDescriptor = descriptors.find(
			(descriptor) => descriptor.runtimeId === workerLaunch.modelId || descriptor.modelKey === workerLaunch.modelId,
		);
		const workerRealId = workerDescriptor?.modelKey ?? workerLaunch.modelId ?? "";
		const candidates = descriptors
			.filter(
				(descriptor) =>
					!descriptor.isEmbedding &&
					descriptor.runtimeId !== workerLaunch.modelId &&
					descriptor.modelKey !== workerRealId,
			)
			.map((descriptor) => ({
				// modelKey = the SERVABLE id (what the launch config needs); modelId = the REAL key (lineage).
				modelKey: descriptor.runtimeId,
				modelId: descriptor.modelKey,
				score: 50,
			}));
		if (candidates.length === 0) {
			return null;
		}
		const preferred = applyDiversityPreference({
			ranked: candidates,
			avoidLineages: [resolveLineage(workerRealId)],
		});
		if (!preferred.diversityAchieved || !preferred.ranked[0]) {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Reviewer diversity waived for ${taskId}: ${preferred.diversityWaivedReason ?? "no diverse loaded model"} — the worker model reviews its own work.`,
				taskId,
				metadata: { category: "reviewer_diversity_waived", reason: preferred.diversityWaivedReason ?? null },
			});
			return null;
		}
		const pick = preferred.ranked[0];
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message: `Auto-picked lineage-diverse reviewer ${pick.modelKey} (${resolveLineage(pick.modelId)}) for ${taskId} — worker is ${workerRealId} (${resolveLineage(workerRealId)}).`,
			taskId,
			metadata: { category: "reviewer_auto_diverse", reviewer: pick.modelKey, worker: workerRealId },
		});
		return { providerId: workerLaunch.providerId, modelId: pick.modelKey };
	}

	async runSecondOpinionReviewSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
	}): Promise<NKleinReviewResult | null> {
		if (!this.agentSandboxManager) {
			return null;
		}
		const workerLaunch = this.launchConfigByTaskId.get(input.taskId) ?? null;
		// W2.5a (audit 2026-07-02, §5.AB): with NO configured reviewer this previously fell back to the WORKER's
		// own model — the model reviewing its own work, the worst monoculture form. Auto-pick a lineage-DIVERSE
		// loaded model instead (best-effort; when nothing diverse is loaded the waiver is recorded and the old
		// fallback stands, so behavior only ever improves).
		const autoReviewer =
			!input.reviewer && workerLaunch?.providerId && workerLaunch.modelId
				? await this.pickDiverseReviewerModel(workerLaunch, input.taskId).catch(() => null)
				: null;
		const providerId = (
			input.reviewer?.providerId ??
			autoReviewer?.providerId ??
			workerLaunch?.providerId ??
			""
		).trim();
		const modelId = (input.reviewer?.modelId ?? autoReviewer?.modelId ?? workerLaunch?.modelId ?? "").trim();
		if (!providerId || !modelId) {
			return null;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...(workerLaunch ?? {}),
			providerId,
			modelId,
			workspaceRoot: input.projectRepoPath,
		};
		const reviewTaskId = `${input.taskId}::review`;
		await this.agentSandboxManager.assertAvailable();
		const resultCommit = await resolveTaskResultBranchCommit({
			repoPath: input.projectRepoPath,
			taskId: input.taskId,
		}).catch(() => null);
		const workspace = await this.agentSandboxManager.prepareWorkspace({
			taskId: reviewTaskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: resultCommit ?? input.baseRef ?? null,
		});
		this.sandboxState.setSandbox(
			reviewTaskId,
			input.projectRepoPath,
			(resultCommit ?? input.baseRef)?.trim() || "HEAD",
		);
		let verdict: NKleinReviewResult | null = null;
		const deadlineMs = Date.now() + (input.timeoutMs ?? DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS);
		const recordReviewSessionError = (error: unknown): void => {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `Second-opinion reviewer session failed: ${error instanceof Error ? error.message : String(error)}`,
				taskId: reviewTaskId,
				workspacePath: input.projectRepoPath,
				createdAt: Date.now(),
			});
		};
		// Awaits one reviewer turn, bounded by the remaining overall budget (an SDK turn can hang); turn errors are
		// recorded, not thrown, so they fall through to a null verdict (the caller then fail-safe-delivers).
		const runBoundedTurn = async (turn: Promise<unknown>): Promise<void> => {
			const remainingMs = deadlineMs - Date.now();
			if (remainingMs <= 0) {
				return;
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, remainingMs);
			});
			await Promise.race([turn.then(() => undefined, recordReviewSessionError), timeout]);
			if (timer) {
				clearTimeout(timer);
			}
		};
		try {
			// First turn: seed prompt + the submit_review tool. startRuntimeTaskSessionFromLaunchConfig awaits the
			// turn, so the tool's verdict (if emitted) is captured by the time it settles.
			await runBoundedTurn(
				this.startRuntimeTaskSessionFromLaunchConfig({
					taskId: reviewTaskId,
					cwd: workspace.workdir,
					workspaceRoot: input.projectRepoPath,
					prompt: input.seedPrompt,
					launchConfig,
					contextScope: "minimal",
					onReviewSubmitted: (result) => {
						verdict = result;
					},
					// Route the reviewer's file/bash tools into its sandbox container (so the host cwd is never
					// touched), exactly like a worker session — keeps strict isolation and lets the reviewer inspect.
					toolExecutors: createAgentSandboxToolExecutors(this.agentSandboxManager, reviewTaskId, {
						pauseController: this.pauseController,
					}),
					extraTools: createAgentSandboxExtraTools(this.agentSandboxManager, reviewTaskId, {
						sessionId: createSessionId(reviewTaskId),
						contextWindow: launchConfig.contextWindow ?? undefined,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					}),
				}),
			);
			// Re-prompt nudge: small models often end a turn without the structured call. Mirror the decomposition
			// re-prompt — if there's still no verdict, tell the reviewer to call submit_review now, bounded by a
			// small budget and the overall deadline.
			for (
				let nudge = 0;
				verdict === null && nudge < MAX_SECOND_OPINION_REVIEW_NUDGES && Date.now() < deadlineMs;
				nudge += 1
			) {
				await runBoundedTurn(
					this.sessionRuntime.sendTaskSessionInput(reviewTaskId, SECOND_OPINION_REVIEW_NUDGE_PROMPT),
				);
			}
			return verdict;
		} finally {
			await this.sessionRuntime.clearTaskSessions(reviewTaskId).catch(() => undefined);
			await this.agentSandboxManager.disposeWorkspace(reviewTaskId).catch(() => undefined);
			this.launchConfigByTaskId.delete(reviewTaskId);
			this.providerIdStore.forget(reviewTaskId);
			this.modelEndpoint.forget(reviewTaskId);
			this.contextBudgetInputs.forget(reviewTaskId);
			this.sandboxState.deleteSandbox(reviewTaskId);
		}
	}

	async updateAgentSandboxPoolConfig(config: Partial<AgentSandboxPoolConfig>): Promise<void> {
		await this.agentSandboxManager?.updatePoolConfig(config);
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

	private parkActiveTasksForOperatorPause(taskId?: string): void {
		const summaries = taskId
			? [this.messageRepository.getTaskEntry(taskId)?.summary].filter(Boolean)
			: this.messageRepository.listSummaries();
		for (const summary of summaries) {
			if (!summary || (summary.state !== "running" && summary.state !== "queued")) {
				continue;
			}
			const entry = this.messageRepository.getTaskEntry(summary.taskId);
			if (!entry) {
				continue;
			}
			this.emitSummary(
				this.parkTaskForPause({
					taskId: summary.taskId,
					entry,
					message: "Paused — will resume when the board/card is resumed.",
					metadata: {
						guardrail: "operator_pause",
						source: taskId ? "card_pause" : "board_pause",
					},
				}),
			);
		}
	}

	async listSlashCommands(workspacePath: string): Promise<NKleinSdkSlashCommand[]> {
		const runtimeSetup = await this.ensureRuntimeSetup(workspacePath);
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
		const guardedSummary = this.enforceAutonomyBudgets(taskId, checkpoint) ?? summary;
		this.emitSummary(guardedSummary);
		return guardedSummary;
	}

	private enforceAutonomyBudgets(
		taskId: string,
		checkpoint: RuntimeTaskTurnCheckpoint,
	): RuntimeTaskSessionSummary | null {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return null;
		}
		return this.autonomyBudgetWatchdog.check(taskId, checkpoint, entry);
	}

	/** Shared park teardown: stop the task's timers and reset its per-task guards (before the abort). */
	private resetGuardsForPark(taskId: string): void {
		this.clearTaskTimeouts(taskId);
		this.autonomyBudgetWatchdog.resetTask(taskId);
		this.repeatedToolCallGuard.resetTask(taskId);
	}

	/** Appends a park system message to the task transcript, emits it, and clears the active-turn state. */
	private pushParkSystemMessage(taskId: string, entry: NKleinTaskSessionEntry, message: string): void {
		const systemMessage = createMessage(taskId, "system", message);
		entry.messages.push(systemMessage);
		this.emitMessage(taskId, systemMessage);
		clearActiveTurnState(entry);
	}

	private parkTaskForPause(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary {
		this.resetGuardsForPark(input.taskId);
		this.pauseController.markTaskParked(input.taskId);
		void this.sessionRuntime.abortTaskSession(input.taskId).catch(() => undefined);
		this.recordObservationWithModel({
			signal: "custom",
			severity: "info",
			message: input.message,
			taskId: input.taskId,
			metadata: input.metadata,
		});
		this.pushParkSystemMessage(input.taskId, input.entry, input.message);
		return updateSummary(input.entry, {
			state: "paused",
			reviewReason: null,
			lastOutputAt: now(),
			lastHookAt: now(),
			warningMessage: null,
			latestHookActivity: {
				activityText: input.message,
				toolName: null,
				toolInputSummary: null,
				finalMessage: input.message,
				hookEventName: "operator_pause",
				notificationType: null,
				source: "kanban",
			},
		});
	}

	private parkTaskForAutonomyBudget(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary {
		this.resetGuardsForPark(input.taskId);
		void this.sessionRuntime.abortTaskSession(input.taskId).catch(() => undefined);
		this.recordObservationWithModel({
			signal: "budget_wall",
			severity: "warning",
			message: input.message,
			taskId: input.taskId,
			metadata: input.metadata,
		});
		this.pushParkSystemMessage(input.taskId, input.entry, input.message);
		return updateSummary(input.entry, {
			state: "awaiting_review",
			reviewReason: "attention",
			lastOutputAt: now(),
			lastHookAt: now(),
			warningMessage: input.message,
			latestHookActivity: {
				activityText: input.message,
				toolName: null,
				toolInputSummary: null,
				finalMessage: input.message,
				hookEventName: "guardrail",
				notificationType: "warning",
				source: "kanban",
			},
		});
	}

	async dispose(): Promise<void> {
		for (const taskId of this.timeoutScheduler.taskIds()) {
			this.clearTaskTimeouts(taskId);
		}
		this.decompositionStallNudger.dispose();
		this.repeatedToolCallGuard.dispose();
		this.autonomyBudgetWatchdog.dispose();
		this.timeoutSettingsByTaskId.clear();
		await this.sessionRuntime.dispose();
		this.pendingTurnCancelTaskIds.clear();
		this.providerIdStore.clear();
		this.contextWindowStore.clear();
		this.modelEndpoint.clear();
		this.contextBudgetInputs.clear();
		this.requestTimer.clear();
		this.explicitDecompositionTaskIds.clear();
		this.sandboxState.clear();
		this.focusChainByTaskId.clear();
		this.teamProgressListeners.clear();
		await this.agentSandboxManager?.stopNow().catch(() => null);
		for (const leasePromise of this.runtimeSetupLeaseByWorkspacePath.values()) {
			try {
				const lease = await leasePromise;
				await lease.release();
			} catch {
				// Ignore runtime setup disposal failures.
			}
		}
		this.runtimeSetupLeaseByWorkspacePath.clear();
		this.messageRepository.dispose();
	}

	private emitSummary(summary: RuntimeTaskSessionSummary): void {
		const guardedSummary = this.repeatedToolCallGuard.check(summary) ?? summary;
		this.captureTerminalRunSummary(guardedSummary);
		this.messageRepository.emitSummary(guardedSummary);
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
		// W1.1b: flag-gated adaptive budget retry on the stall signature (see maybeAdaptiveBudgetRetry).
		this.maybeAdaptiveBudgetRetry(taskId, summary);
		// W0.2 (run16: t4 died `interrupted` MID-WRITE and its partial work was lost): a dying terminal still
		// salvages its sandbox work. error→awaiting_review already captures via the finalize hook (run10 proved
		// it live); interrupted/failed did NOT — no capture, and the sandbox leaked until pool exhaustion.
		// finalizeSandboxReview is idempotent-guarded, captures the patch to the result branch, and disposes the
		// workspace — exactly the salvage+cleanup pair a dead session owes.
		if (
			(state === "interrupted" || state === "failed") &&
			this.sandboxState.hasSandbox(taskId) &&
			!this.sandboxState.getResultBranch(taskId)
		) {
			this.finalizeSandboxReview(taskId);
		}
		const usage = summary.latestUsage ?? null;
		const promptTokens = usage?.inputTokens ?? null;
		const completionTokens = usage?.outputTokens ?? null;
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
				focusChain: this.focusChainByTaskId.has(taskId)
					? summarizeFocusChain(this.focusChainByTaskId.get(taskId))
					: null,
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
						modelId: summary.modelId ?? this.modelEndpoint.peekModelId(taskId) ?? null,
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
		this.focusChainByTaskId.delete(taskId);
	}

	private emitMessage(taskId: string, message: NKleinTaskMessage): void {
		this.messageRepository.emitMessage(taskId, message);
	}

	private emitTeamProgress(taskId: string, event: NKleinSdkTeamEvent, teamName: string | null): void {
		if (this.teamProgressListeners.size === 0) {
			return;
		}
		const progressEvent = projectNKleinTeamProgressEvent({
			taskId,
			teamName,
			event,
		});
		for (const listener of this.teamProgressListeners) {
			listener(taskId, progressEvent);
		}
	}

	private shouldCaptureReviewCheckpoint(
		previousSummary: RuntimeTaskSessionSummary,
		nextSummary: RuntimeTaskSessionSummary | null,
	): nextSummary is RuntimeTaskSessionSummary {
		if (!nextSummary) {
			return false;
		}
		if (isHomeAgentSessionId(nextSummary.taskId) || !nextSummary.workspacePath) {
			return false;
		}
		return previousSummary.state !== "awaiting_review" && nextSummary.state === "awaiting_review";
	}

	/**
	 * W2.3a (audit 2026-07-02, §5.AD/§5.AQ): LEARNED quality-effective context budgets per model, from the ledger's
	 * qualityOk knee (`learnedQualityEffectiveBudget`) — the derate that was previously only printed to a dev
	 * console while live budgeting used the ADVERTISED window (the exact small-model semantic-collapse case: a 4B
	 * advertising 32k was budgeted as if all 32k were usable). Refreshed lazily+async at session start (sync reads
	 * from the cache; empty ledger ⇒ no entry ⇒ advertised window unchanged). Floor 32k (PRIME DIRECTIVE #3).
	 */
	private readonly qualityBudgetByModelId = new Map<string, number>();
	private qualityBudgetRefreshInFlight = false;

	private refreshLearnedQualityBudgets(): void {
		if (this.qualityBudgetRefreshInFlight) {
			return;
		}
		this.qualityBudgetRefreshInFlight = true;
		void (async () => {
			try {
				const events = await readAllAgentLedger();
				for (const profile of buildModelBehaviorProfilesFromLedger(events)) {
					const budget = learnedQualityEffectiveBudget(profile);
					if (budget !== null) {
						this.qualityBudgetByModelId.set(profile.modelId, budget);
					}
				}
			} catch {
				// Best-effort — an unreadable ledger leaves the advertised-window behavior unchanged.
			} finally {
				this.qualityBudgetRefreshInFlight = false;
			}
		})();
	}

	/** W1.1b adaptive-retry state: attempts + last budget per task (bounded by MAX_ADAPTIVE_RETRY_ATTEMPTS). */
	private readonly adaptiveRetryStateByTaskId = new Map<string, { attempt: number; lastBudget: number }>();

	/**
	 * W1.1b (audit 2026-07-02, §5.AA): the STALL-signature adaptive retry — flag-gated via `NKLEIN_ADAPTIVE_RETRY`
	 * (default OFF until the W1.4 scoreboard proves the win). A reasoning model that burns its whole output budget
	 * on reasoning_content terminates as awaiting_review with NO delivered work and a `model_stalled` observation;
	 * at temp 0 a plain re-run re-truncates identically, so the ROOT-cause recovery is a re-send with a RAISED
	 * per-turn budget (`raisedTokenBudget`, ceiling-clamped) through the W1.1a maxTokensPerTurn thread. Bounded to
	 * 2 attempts; every fire is recorded as a self-observation so the scoreboard can measure recovery rate.
	 */
	private maybeAdaptiveBudgetRetry(taskId: string, summary: RuntimeTaskSessionSummary): void {
		if (!isTruthyEnv(process.env.NKLEIN_ADAPTIVE_RETRY) || summary.state !== "awaiting_review") {
			return;
		}
		const providerId = summary.providerId ?? null;
		const modelId = summary.modelId ?? null;
		if (!providerId || !modelId || isHomeAgentSessionId(taskId)) {
			return;
		}
		const state = this.adaptiveRetryStateByTaskId.get(taskId) ?? { attempt: 0, lastBudget: 1024 };
		if (state.attempt >= 2) {
			return;
		}
		void (async () => {
			try {
				// Stall evidence: a model_stalled observation recorded during THIS run (since the session started).
				const since = summary.startedAt ?? 0;
				const events = await readSelfObservationEvents({ taskId, limit: 25 }).catch(() => []);
				const stalled = events.some(
					(event) =>
						event.createdAt >= since &&
						(event.signal === "model_stalled" || event.metadata?.category === "model_stalled"),
				);
				// Only a stall WITHOUT delivered work qualifies — a captured result branch means the turn produced
				// something despite the stall observation (leave it to the normal review flow).
				if (!stalled || this.sandboxState.getResultBranch(taskId)) {
					return;
				}
				const contextWindow = this.resolveKnownContextWindowForTask(taskId, null) ?? 32_000;
				const raised = raisedTokenBudget({
					current: state.lastBudget,
					attempt: state.attempt + 1,
					ceiling: Math.max(2_048, contextWindow - 8_192),
				});
				this.adaptiveRetryStateByTaskId.set(taskId, { attempt: state.attempt + 1, lastBudget: raised });
				recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: `Adaptive budget retry ${state.attempt + 1}/2 for ${taskId}: re-sending with maxTokensPerTurn=${raised} after a stalled (likely truncated-mid-reasoning) turn.`,
					taskId,
					metadata: { category: "adaptive_budget_retry", attempt: state.attempt + 1, raisedBudget: raised },
				});
				await this.sendTaskSessionInput(
					taskId,
					"Your previous turn produced no output (it likely exhausted the token budget mid-reasoning). Continue the task and complete it — the output budget has been raised.",
					"act",
					undefined,
					{ providerId, modelId, maxTokensPerTurn: raised },
				);
			} catch {
				// Best-effort recovery — a failed retry leaves the card held in Review exactly as before (fail-closed).
			}
		})();
	}

	/**
	 * W2.6c (audit 2026-07-02): append a FOLLOW-UP run-summary record carrying the REAL patch-capture status.
	 * The terminal record is written ON the terminal transition while the capture is still ASYNC, so its
	 * `patchCaptureStatus` cannot be known there (it stays null); this follow-up record (same taskId, appended by
	 * the capture completion) is the delivery-evidence signal — readers take the LAST record per task. Errored /
	 * empty-capture runs therefore stop looking identical to delivered ones in the evidence stream.
	 */
	private recordPatchCaptureStatus(taskId: string, status: "captured" | "empty" | "error"): void {
		const summary = this.messageRepository.getTaskEntry(taskId)?.summary ?? null;
		if (!summary) {
			return;
		}
		// The store records TERMINAL states only; capture always completes around the awaiting_review/failed/
		// interrupted transition, so a non-terminal snapshot (a benign race) maps to awaiting_review.
		const terminalState =
			summary.state === "failed" || summary.state === "interrupted" ? summary.state : ("awaiting_review" as const);
		void recordTaskRunSummary(
			{
				taskId,
				workspacePath: summary.workspacePath ?? null,
				state: terminalState,
				reviewReason: summary.reviewReason ?? null,
				providerId: summary.providerId ?? null,
				modelId: summary.modelId ?? null,
				endpoint: summary.endpoint ?? null,
				lastActivity: `patch capture: ${status}`,
				warningMessage: null,
				exitCode: summary.exitCode ?? null,
				startedAt: summary.startedAt ?? null,
				endedAt: summary.updatedAt,
				promptTokens: null,
				completionTokens: null,
				totalTokens: null,
				timeoutReason: null,
				timeoutSource: null,
				role: resolveNKleinTaskRole(taskId, this.explicitDecompositionTaskIds.has(taskId)),
				scenario: null,
				focusChain: null,
				patchCaptureStatus: status,
			},
			{ rootDir: this.diagnosticStoreRoot },
		);
	}

	private shouldFinalizeSandboxReview(
		previousSummary: RuntimeTaskSessionSummary,
		nextSummary: RuntimeTaskSessionSummary | null,
	): nextSummary is RuntimeTaskSessionSummary {
		if (!isEnteringAwaitingReview(previousSummary, nextSummary)) {
			return false;
		}
		if (isHomeAgentSessionId(nextSummary.taskId) || this.sandboxState.isFinalizing(nextSummary.taskId)) {
			return false;
		}
		return Boolean(this.agentSandboxManager && this.sandboxState.hasSandbox(nextSummary.taskId));
	}

	private finalizeSandboxReview(taskId: string): void {
		const manager = this.agentSandboxManager;
		const repoPath = this.sandboxState.getRepoPath(taskId);
		const baseRef = this.sandboxState.getBaseRef(taskId);
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!manager || !repoPath || !baseRef || !entry || this.sandboxState.isFinalizing(taskId)) {
			return;
		}
		this.sandboxState.markFinalizing(taskId);
		void (async () => {
			try {
				const patch = await manager.captureWorkspacePatch(taskId, { baseRef });
				const branch = await applyTaskPatchToResultBranch({
					repoPath,
					taskId,
					baseRef,
					patch,
				});
				if (branch) {
					this.sandboxState.setResultBranch(taskId, branch);
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Sandbox task result branch updated: ${branch.branchName}`,
						taskId,
						workspacePath: repoPath,
						metadata: {
							category: "agent_sandbox_result_patch",
							branchName: branch.branchName,
							headCommit: branch.headCommit,
							baseCommit: branch.baseCommit,
						},
					});
					const message = createMessage(
						taskId,
						"system",
						`Captured sandbox changes to task result branch ${branch.branchName} (${branch.headCommit.slice(
							0,
							12,
						)}).`,
					);
					entry.messages.push(message);
					this.emitMessage(taskId, message);
					this.emitSummary(
						updateSummary(entry, {
							workspacePath: repoPath,
							lastOutputAt: now(),
							lastHookAt: now(),
							latestHookActivity: {
								activityText: `Result patch captured: ${branch.branchName}`,
								toolName: null,
								toolInputSummary: null,
								finalMessage: branch.headCommit,
								hookEventName: "sandbox_patch_captured",
								notificationType: null,
								source: "nklein",
							},
						}),
					);
					this.recordPatchCaptureStatus(taskId, "captured");
				} else {
					this.emitSummary(
						updateSummary(entry, {
							workspacePath: repoPath,
							lastOutputAt: now(),
							lastHookAt: now(),
							latestHookActivity: {
								activityText: "Sandbox finished with no file changes",
								toolName: null,
								toolInputSummary: null,
								finalMessage: null,
								hookEventName: "sandbox_patch_empty",
								notificationType: null,
								source: "nklein",
							},
						}),
					);
					this.recordPatchCaptureStatus(taskId, "empty");
				}
				await manager.disposeWorkspace(taskId);
				this.forgetSandboxTask(taskId);
			} catch (error) {
				this.sandboxState.unmarkFinalizing(taskId);
				const errorMessage = toErrorMessage(error);
				// Benign teardown race: the sandbox workspace was disposed concurrently before the patch could
				// be captured. Genuine capture failures while the workspace still exists fall through below.
				const hasWorkspace = manager.hasWorkspace(taskId);
				const benignReason = !hasWorkspace
					? "workspace_disposed_before_capture"
					: isBenignSandboxPatchStagingTeardown(error)
						? "workspace_missing_before_capture"
						: null;
				if (benignReason) {
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Sandbox workspace for task ${taskId} was unavailable before a result patch could be captured; nothing to capture.`,
						taskId,
						workspacePath: repoPath,
						metadata: {
							category: "agent_sandbox_result_patch",
							reason: benignReason,
						},
					});
					if (hasWorkspace) {
						await manager.disposeWorkspace(taskId).catch(() => null);
					}
					this.forgetSandboxTask(taskId);
					return;
				}
				this.recordPatchCaptureStatus(taskId, "error");
				const captureError: TaskPatchCaptureError | null = isTaskPatchCaptureError(error) ? error : null;
				// follow-up-6 §3.5: distinguish a corrupt/garbled captured diff (an infrastructure capture
				// problem) from an agent failure, and keep the failing file/hunk + preserved artifact on the card.
				const classification = captureError?.classification ?? null;
				const cardNote = captureError
					? `Could not capture sandbox task result patch (${captureError.classification})${
							captureError.firstFailingFile ? ` in ${captureError.firstFailingFile}` : ""
						}${
							captureError.firstFailingHunkHeader ? ` ${captureError.firstFailingHunkHeader}` : ""
						}: ${captureError.gitError.trim()}${
							captureError.preservedPatchPath
								? ` Preserved failing patch: ${captureError.preservedPatchPath}`
								: ""
						}`
					: `Could not capture sandbox task result patch: ${errorMessage}`;
				recordSelfObservation({
					signal: "runtime_error",
					severity: "error",
					message: cardNote,
					taskId,
					workspacePath: repoPath,
					metadata: {
						category: "agent_sandbox_result_patch",
						...(classification ? { patchCaptureClassification: classification } : {}),
						...(captureError?.firstFailingFile ? { firstFailingFile: captureError.firstFailingFile } : {}),
						...(captureError?.firstFailingHunkHeader
							? { firstFailingHunkHeader: captureError.firstFailingHunkHeader }
							: {}),
						...(captureError?.failingLine !== null && captureError?.failingLine !== undefined
							? { failingLine: captureError.failingLine }
							: {}),
						...(captureError?.preservedPatchPath ? { preservedPatchPath: captureError.preservedPatchPath } : {}),
					},
				});
				const latestEntry = this.messageRepository.getTaskEntry(taskId);
				if (!latestEntry) {
					return;
				}
				this.emitSummary(
					updateSummary(latestEntry, {
						warningMessage: cardNote,
						lastHookAt: now(),
						latestHookActivity: {
							activityText: `Result patch capture failed${classification ? ` (${classification})` : ""}: ${errorMessage}`,
							toolName: null,
							toolInputSummary: null,
							finalMessage: errorMessage,
							hookEventName: "sandbox_patch_capture_failed",
							notificationType: null,
							source: "nklein",
						},
					}),
				);
			}
		})();
	}

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

	private async ensureRuntimeSetup(workspacePath: string): Promise<NKleinRuntimeSetup> {
		const normalizedWorkspacePath = workspacePath.trim();
		let leasePromise = this.runtimeSetupLeaseByWorkspacePath.get(normalizedWorkspacePath);
		if (!leasePromise) {
			leasePromise = this.watcherRegistry.acquire(normalizedWorkspacePath);
			this.runtimeSetupLeaseByWorkspacePath.set(normalizedWorkspacePath, leasePromise);
		}
		const lease = await leasePromise;
		return lease.setup;
	}

	private handleTaskEvent(taskId: string, event: unknown): void {
		const sdkEvent = readSdkSessionEvent(event);
		if (sdkEvent) {
			this.recordModelRegistryObservation(taskId, sdkEvent);
		}
		this.recordSdkEventObservation(taskId, event);
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
		const shouldAbortForCreditLimit =
			entry.summary.latestHookActivity?.notificationType === "credit_limit" &&
			previousSummary?.latestHookActivity?.notificationType !== "credit_limit";
		if (this.shouldFinalizeSandboxReview(previousSummary, latestSummary)) {
			this.finalizeSandboxReview(taskId);
		} else if (this.shouldCaptureReviewCheckpoint(previousSummary, latestSummary)) {
			this.captureReviewCheckpoint(taskId, latestSummary);
		}
		const hookEventName = entry.summary.latestHookActivity?.hookEventName;
		if (entry.summary.state !== "running") {
			this.clearTaskTimeout(taskId, "stream");
			this.clearTaskTimeout(taskId, "tool");
			this.clearTaskTimeout(taskId, "conversation");
			this.clearDecompositionChatNudge(taskId);
			this.activeToolTaskIds.delete(taskId);
			this.maybeContinueStalledDecomposition(taskId);
		} else if (hookEventName === "tool_call" && !this.activeToolTaskIds.has(taskId)) {
			if (entry.summary.latestHookActivity?.toolName?.trim().toLowerCase() === "decompose_project") {
				this.clearDecompositionChatNudge(taskId);
			}
			this.activeToolTaskIds.add(taskId);
			this.clearTaskTimeout(taskId, "stream");
			this.scheduleTaskTimeout(taskId, "tool", this.timeoutSettingsByTaskId.get(taskId)?.toolTimeoutMs ?? null);
		} else if (hookEventName === "tool_result") {
			if (entry.summary.latestHookActivity?.toolName?.trim().toLowerCase() === "decompose_project") {
				this.clearDecompositionChatNudge(taskId);
			}
			this.activeToolTaskIds.delete(taskId);
			this.clearTaskTimeout(taskId, "tool");
			this.scheduleStreamTimeout(taskId);
		} else if (entry.summary.state === "running" && !this.activeToolTaskIds.has(taskId)) {
			if (isChatOnlyDecompositionActivity(entry.summary)) {
				this.scheduleDecompositionChatNudge(taskId);
			}
			this.scheduleStreamTimeout(taskId);
		}
		if (shouldAbortForCreditLimit) {
			void this.sessionRuntime.abortTaskSession(taskId).catch(() => undefined);
		}
	}

	private recordModelRegistryObservation(taskId: string, event: NKleinSdkSessionEvent): void {
		const observedAt = now();
		const observation = extractNKleinModelRegistryObservationFromEvent(
			event,
			{
				...this.resolveTaskModelIdentity(taskId),
				endpoint: this.modelEndpoint.getEndpoint(taskId),
				contextWindow: this.resolveKnownContextWindowForTask(taskId, null),
			},
			observedAt,
			this.requestTimer.elapsedMs(taskId, observedAt),
		);
		if (!observation) {
			return;
		}
		this.requestTimer.forget(taskId);
		void getDefaultNKleinModelRegistry()
			.recordRequest(observation)
			.catch(() => undefined);
	}

	private recordLaunchContextWindow(input: {
		providerId: string;
		modelId: string;
		endpoint: string | null;
		contextWindow: number | null;
	}): void {
		if (!isLocalProvider(input.providerId, input.endpoint)) {
			return;
		}
		if (
			typeof input.contextWindow !== "number" ||
			!Number.isFinite(input.contextWindow) ||
			input.contextWindow <= 0
		) {
			return;
		}
		void getDefaultNKleinModelRegistry()
			.recordContextWindow({
				providerId: input.providerId,
				modelId: input.modelId,
				endpoint: input.endpoint,
				advertisedContextWindow: input.contextWindow,
			})
			.catch(() => undefined);
	}

	private recordSdkEventObservation(taskId: string, event: unknown): void {
		const agentEvent = readSdkAgentEvent(event);
		if (!agentEvent || (agentEvent.type !== "error" && agentEvent.type !== "run-failed")) {
			return;
		}
		const rawMessage = typeof agentEvent.message === "string" ? agentEvent.message : null;
		const errorMessage = toErrorMessage(agentEvent.error ?? rawMessage);
		this.recordObservationWithModel({
			signal:
				this.isNKleinProviderForTask(taskId) && isCreditLimitError(errorMessage)
					? "provider_error"
					: "runtime_error",
			severity: "error",
			message: errorMessage,
			taskId,
			metadata: {
				eventType: agentEvent.type,
			},
		});
	}
}

export function createInMemoryNKleinTaskSessionService(
	options: CreateInMemoryNKleinTaskSessionServiceOptions,
): NKleinTaskSessionService {
	return new InMemoryNKleinTaskSessionService(options);
}
