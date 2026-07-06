import {
	applyModelStatsTrackingLevel,
	DEFAULT_MODEL_STATS_TRACKING_LEVEL,
	type ModelStatsTrackingLevel,
} from "../core/model-stats-tracking-level";
import { readAgentResultText, readSdkAgentEvent, readSdkSessionEvent } from "./nklein-sdk-event-readers";

// Task-oriented facade for native NKlein sessions.
// runtime-api.ts uses this service to start sessions, send messages, load
// history, and subscribe to summaries and chat events without knowing SDK
// host, repository, or event-adapter details.

import { buildSsrfGuardedPageFetcher } from "../chat/chat-browser-tool";
import { DEFAULT_LOCAL_CHAT_BASE_URL } from "../chat/local-chat-model";
import { DEFAULT_KNOWS_TODAY_ENABLED, DEFAULT_SANDBOX_MCP_SERVERS_ENABLED } from "../config/runtime-config-defaults";
import {
	DEFAULT_RETRIEVAL_EGRESS_ENABLED,
	DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL,
} from "../config/runtime-config-retrieval-resolver";
import { buildModelBehaviorProfilesFromLedger } from "../core/agent-ledger-projections";
import type { McpAccess, SandboxNetworkPolicy } from "../core/agent-rulesets";
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
import {
	applyWarmthPreference,
	buildPromptShellKey,
	derivePromptSessionKind,
	type PromptSessionKind,
	type PromptWarmthLedgerEntry,
} from "../core/cache-warmth";
import { isTruthyEnv } from "../core/env-flag";
import { applyFocusChainStepTiming, type FocusChain, summarizeFocusChain } from "../core/focus-chain";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { probeModelResidency, type ResidencyHeartbeatHandle, startResidencyHeartbeat } from "../core/lmstudio-liveness";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { fetchLoadedModelIdsCached } from "../core/lmstudio-loaded-models";
import { learnedQualityEffectiveBudget } from "../core/model-behavior-profile";
import { applyDiversityPreference } from "../core/model-diversity";
import { resolveLineage } from "../core/model-lineage";
import { applyThinkingDisable } from "../core/model-thinking-control";
import { computeSharedPrefixRatio, type PromptFragment } from "../core/prompt-fragment-assembly";
import { browserFetchAdapter } from "../core/retrieval-fetch-adapter";
import { runRetrievalLoop } from "../core/retrieval-loop-driver";
import { searchHitsAdapter } from "../core/retrieval-search-adapter";
import { citedSynthesisAdapter } from "../core/retrieval-synthesis-adapter";
import { raisedTokenBudget } from "../core/retry-policy";
import type { SkillDynamicsLevel } from "../core/skill-resolver";
import { isEnteringAwaitingReview, shouldCaptureReviewCheckpoint } from "../core/task-session-guards";
import { decideTemporalContextInjection } from "../core/temporal-context-injection";
import { resolveHomeAgentAppendSystemPrompt } from "../prompts/append-system-prompt";
import { createSearxngWebSearchClient } from "../server/web-search-searxng";
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
import { hasStallEvidence, shouldAttemptAdaptiveBudgetRetry } from "./nklein-adaptive-retry-policy";
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
import {
	type NKleinTaskLaunchConfigOverrides,
	type NKleinTaskRestartLaunchConfig,
	normalizeLaunchConfig,
} from "./nklein-launch-config";
import { buildTerminalAttemptEvent } from "./nklein-ledger-attempt";
import { extractTerminalToolCalls } from "./nklein-ledger-tool-calls";
import { LocalLlmClient } from "./nklein-local-llm-client";
import { assertLocalProviderAllowed, isLocalProvider } from "./nklein-local-only-policy";
import {
	buildMergeResolutionSeedPrompt,
	type NKleinMergeResolutionResult,
	type NKleinMergeResolutionSubmittedHandler,
} from "./nklein-merge-resolution-tool";
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
import {
	buildPlanCritiqueSeedPrompt,
	type NKleinPlanCritiqueRequestHandler,
	type NKleinPlanCritiqueResult,
	type NKleinPlanCritiqueSubmittedHandler,
} from "./nklein-plan-critique-tool";
import type { NKleinCardPromotedHandler } from "./nklein-promotion-tool";
import { createNKleinResearchTool } from "./nklein-research-tool";
import { shouldAttachRetrievalTools } from "./nklein-retrieval-tools-gate";
import type { NKleinReviewResult, NKleinReviewSubmittedHandler } from "./nklein-review-tool";
import { buildReviewerCandidates, resolveWorkerRealId } from "./nklein-reviewer-candidate-selection";
import { createNKleinRuntimeSetup, type NKleinRuntimeSetup } from "./nklein-runtime-setup";
import {
	type CreateInMemoryNKleinSessionRuntimeOptions,
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
	isCreditLimitError,
	isLocalModelRuntimeUnavailableError,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	setOrCreateAssistantMessage,
	updateSummary,
} from "./nklein-session-state";
import { buildSessionSystemPrompt } from "./nklein-session-system-prompt";
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
import type { AgentTool } from "./sdk-agent-types";
import {
	listNKleinSdkWorkflowSlashCommands,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSessionEvent,
	type NKleinSdkSlashCommand,
	type NKleinSdkTeamEvent,
	resolveNKleinSdkSystemPromptParts,
} from "./sdk-runtime-boundary.js";

export type { KanbanContextPressurePolicy, KanbanContextSafetyBudgets } from "./nklein-context-budgets";
export { buildKanbanContextPressurePolicy, buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";
export type { NKleinTaskMessage } from "./nklein-session-state";
export { computeRepeatedToolCallCandidate, formatRepeatedToolCallParkMessage } from "./repeated-tool-call-guard";

/** Overall time budget for a second-opinion reviewer session (first turn + any nudges) before it is abandoned (todo §5.K). */
const DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
/** §5.AW: a speculative mirror is a full worker attempt — give it a worker-scale bound (arbitration usually cancels it sooner). */
const DEFAULT_SPECULATIVE_MIRROR_TIMEOUT_MS = 15 * 60 * 1000;
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
const MERGE_RESOLUTION_NUDGE_PROMPT =
	"You ended your turn without calling `submit_merge_resolution`, so no resolution was recorded. Your outcome is delivered ONLY by that tool. Finish resolving the conflict markers, then call `submit_merge_resolution` now: `resolved`, or `cannot_resolve` with the concrete blocker. Do not answer in prose.";
/** §5.AK Phase B: conflicted files this large (or binary) are beyond a bounded text-edit session — fall back to abort. */
const MAX_MERGE_RESOLUTION_FILE_BYTES = 1024 * 1024;
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
	/**
	 * §5.AE the user's effective skill-dynamics level (global default ← per-project override), forwarded from the tRPC
	 * layer so {@link buildSessionSkillFragments}'s `resolveActiveSkills` honors the SAME setting the affinity-tag
	 * resolution already uses. Absent ⇒ the resolver's own default (`fully_dynamic`).
	 */
	skillDynamicsLevel?: SkillDynamicsLevel | null;
}

/** One conflicted file's agent-resolved contents, captured from the `::merge` sandbox (§5.AK Phase B). */
export interface NKleinMergeResolutionResolvedFile {
	path: string;
	content: string;
}

/**
 * Outcome of a `::merge` resolution session (§5.AK Phase B). `clean` = the sandbox reproduction merged with no
 * conflict (no model turn was spent); `resolved` = the agent edited every marker away and the resolved contents
 * of ONLY the conflicted files were captured for host-side application; `cannot_resolve` carries the agent's
 * concrete blocker. Callers treat anything but `resolved` (and a null session yield) as "abort and surface the
 * conflict exactly as before" — the agent is strictly additive.
 */
export type NKleinMergeResolutionSessionOutcome =
	| { outcome: "clean" }
	| { outcome: "resolved"; resolvedFiles: NKleinMergeResolutionResolvedFile[] }
	| { outcome: "cannot_resolve"; reason: string };

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
	/**
	 * §5.AQ (a)+(d) cache-warmth ledger: the last assembled prompt-SHELL key per model id (+ when), tracked by
	 * `assembleSessionSystemPrompt`. Read-only view for warmth-aware routing (`applyWarmthPreference`) — exposed
	 * the same way `listModelEndpointSessions` is, so the start-selection seam can consult live session state.
	 */
	getPromptWarmthLedger(): ReadonlyMap<string, PromptWarmthLedgerEntry>;
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
	/** Apply the §5.AC egress-gated retrieval config (OFF by default, fail closed) when config changes. */
	setRetrievalConfig(egressEnabled: boolean, searchBackendUrl: string | null): void;
	/** Apply the §5.L per-role web-research capability gate (default allowed = fully_open) when config changes. */
	setAgentWebResearchAllowed(allowed: boolean): void;
	/** Apply the §5.L per-role MCP-access capability gate (default "on" = fully_open) when config changes. */
	setAgentMcpAccess(access: McpAccess): void;
	/** Apply the §5.AN model-stats tracking level (full by default) when config changes. */
	setModelStatsTrackingLevel(level: ModelStatsTrackingLevel): void;
	waitUntilTaskResumed(taskId: string): Promise<void>;
	verifyTaskAcceptanceInSandbox(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
		timeoutMs?: number;
		/** §5.AW arbitration: run acceptance against ANOTHER taskId's result branch (the `::spec` candidate). */
		resultBranchTaskId?: string;
		/** #39: run against the BASE tree (no result branch) — the baseline sample for the was-it-already-broken waiver. */
		useBaseTree?: boolean;
	}): Promise<RuntimeTaskAcceptanceResult>;
	/**
	 * W4.2 (layer 3): a lineage-diverse loaded model to ESCALATE a stuck card's worker to (null when none exists
	 * or the task has no cached launch config). Reuses the W2.5a diverse-pick machinery.
	 */
	pickDiverseEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null>;
	runSecondOpinionReviewSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
	}): Promise<NKleinReviewResult | null>;
	runPlanCritiqueSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		timeoutMs?: number;
		critic?: { providerId: string; modelId: string } | null;
	}): Promise<NKleinPlanCritiqueResult | null>;
	runMergeResolutionSession(input: {
		taskId: string;
		projectRepoPath: string;
		mainRef: string;
		resultCommit: string;
		conflictedPaths: string[];
		timeoutMs?: number;
	}): Promise<NKleinMergeResolutionSessionOutcome | null>;
	/**
	 * §5.AW opportunistic best-of-N: run a speculative worker session `<taskId>::spec` — a lineage-diverse
	 * idle model independently implementing the same card in its own sandbox — capturing its work to the
	 * `::spec` result branch. Resolves true when a non-empty spec result branch was captured.
	 */
	runSpeculativeMirrorSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		prompt: string;
		mirror: { providerId: string; modelId: string };
		timeoutMs?: number;
	}): Promise<boolean>;
	/** §5.AW: the primary handed off first — abort a still-running `::spec` mirror; its work is discarded. */
	cancelSpeculativeMirror(taskId: string): Promise<void>;
	/**
	 * §5.BD watchdog rescue: an INTERRUPTED session whose card still has a result branch is salvage the
	 * capture-path rebounds sometimes miss (stop-path capture errors bypass recordPatchCaptureStatus — seen
	 * live in runs 36/38 as docker-409 races). Re-checks state + prior branch and rebinds the session into
	 * awaiting_review so the review/delivery machinery judges the existing work. True when rebound.
	 */
	rescueInterruptedTaskWithPriorWork(taskId: string): Promise<boolean>;
	updateAgentSandboxPoolConfig(config: Partial<AgentSandboxPoolConfig>): Promise<void>;
	setSandboxNetworkPolicy(policy: SandboxNetworkPolicy): Promise<void>;
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
	 * The §5.AC online-retrieval egress switch — OFF BY DEFAULT (fail closed). When true AND a search backend URL is
	 * configured, worker sessions get the egress-gated `web_search` extra tool; synthetic sessions (`::review` /
	 * `::plan-critique` / `::acceptance`) never do. Live-updated when config changes (same seam as `swarmGuardrails`).
	 */
	retrievalEgressEnabled?: boolean;
	/** §5.AN decision-9: how much per-request token stats to record (default full). */
	modelStatsTrackingLevel?: ModelStatsTrackingLevel;
	/** The §5.AC SearXNG-compatible search endpoint base URL; null (default) keeps `web_search` detached. */
	retrievalSearchBackendUrl?: string | null;
	/**
	 * §5.L — whether the resolved capability ruleset GRANTS the agent web-research (`resolveAgentToolAccess().webResearch`).
	 * Default `true` (the shipped `fully_open` preset ⇒ byte-identical). When a restricted role's ruleset denies it, the
	 * `research` tool is withheld EVEN IF egress + a backend are configured — the per-role capability gate ANDed on top of
	 * the global egress switch. Live-updated on config change (same seam as `retrievalEgressEnabled`).
	 */
	agentWebResearchAllowed?: boolean;
	/**
	 * §5.L — the resolved capability ruleset's MCP access (`resolveAgentToolAccess().mcp`). Default `"on"` (the shipped
	 * `fully_open` preset ⇒ byte-identical). `"off"` withholds ALL curated sandbox-MCP tools even when the config/env
	 * switch is on; `"local"`/`"on"` allow them (every curated server is local/offline). Live-updated on config change.
	 */
	agentMcpAccess?: McpAccess;
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
		this.retrievalEgressEnabled = options.retrievalEgressEnabled ?? DEFAULT_RETRIEVAL_EGRESS_ENABLED;
		this.modelStatsTrackingLevel = options.modelStatsTrackingLevel ?? DEFAULT_MODEL_STATS_TRACKING_LEVEL;
		this.retrievalSearchBackendUrl = options.retrievalSearchBackendUrl ?? DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL;
		this.agentWebResearchAllowed = options.agentWebResearchAllowed ?? true;
		this.agentMcpAccess = options.agentMcpAccess ?? "on";
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
		// §5.U: the subtle present-vs-absent field normalization is the pure `normalizeLaunchConfig` (unit-tested); this
		// method keeps only the store writes below.
		const normalized = normalizeLaunchConfig(launchConfig);
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

	/** W2.3b: last assembled system prompt per model — the baseline for the prefix reuseRatio observation. */
	private lastAssembledSystemPromptByModelId = new Map<string, string>();

	/**
	 * §5.AQ (a)+(d): last prompt-SHELL key per model id (+ when) — the cache-warmth ledger. Where the map above
	 * holds the full prompt BYTES (reuse telemetry), this holds the shell IDENTITY (kind + workspace + model) the
	 * model last prefilled, which is what warmth-aware routing compares prospective starts against. Deterministic —
	 * we know every prompt we send, so no server probing is needed (see `src/core/cache-warmth.ts`).
	 */
	private readonly lastShellKeyByModelId = new Map<string, PromptWarmthLedgerEntry>();

	/**
	 * W2.3b (§5.AQ): assemble the session system prompt from VOLATILITY-ORDERED fragments instead of raw concat —
	 * static/config content first, the daily date next, per-task content last — so the byte-prefix shared across
	 * session starts is maximal by construction (local endpoints cache by longest byte-stable prefix). The SDK base
	 * prompt must open the message (hard contract), so it is head-pinned; since the §5.AQ(e) shell restructure it is
	 * genuinely static per model+workspace (its cwd/date arrive separately as the `session-env` trailer), so only a
	 * caller-supplied CUSTOM base still shows up as the visible cache cost (`headPinnedVolatileKeys`). Also records
	 * the measured `reuseRatio` vs the previous start on the same model — the telemetry that tells us whether the
	 * cache design works on real traffic.
	 */
	private assembleSessionSystemPrompt(input: {
		taskId: string;
		modelId: string | null | undefined;
		/**
		 * §5.AQ warmth ledger: which prompt SHELL this assembly builds. Derived at the call sites (they know the
		 * task-id shape + the explicit-decomposition set) via `derivePromptSessionKind`; recorded per model so
		 * warmth-aware routing can match prospective starts against the shell each model last prefilled.
		 */
		sessionKind: PromptSessionKind;
		/** The HOST workspace root of the session — the workspace part of the recorded shell key. */
		workspacePath: string | null;
		basePrompt: string;
		/**
		 * True when `basePrompt` is the restructured SDK shell (cwd/date extracted into `sessionEnv`) — byte-stable
		 * per model+workspace. False for caller-supplied custom prompts, which still embed per-task content.
		 */
		baseIsStaticShell: boolean;
		planningPrompt?: string | null;
		efficiencyRules: string;
		temporalBlock: string;
		/** The home-agent sidebar append (per-session-kind, task-tier) — folded in here instead of raw concat. */
		homeAgentAppend?: string | null;
		/** The `<session>` cwd+date trailer extracted from the SDK base — see the fragment ordering note below. */
		sessionEnv?: string | null;
		/**
		 * §5.AE: skill-driven fragments (from the approved skill→fragment bridge — {@link buildSessionSkillFragments}).
		 * Appended and DEDUPED against the fixed keys below, so a skill declaring an already-injected fragment
		 * (efficiency_rules/temporal) never doubles it; today this only ever adds a `repo-map`. The assembler re-sorts
		 * by volatility, so these land in their correct churn bucket regardless of append position.
		 */
		skillFragments?: readonly PromptFragment[];
	}): string {
		// §5.U: the byte-stability-critical fragment ordering + assembly is the pure `buildSessionSystemPrompt`
		// (extracted + unit-tested); this method keeps only the instance-stateful warmth-ledger bookkeeping below.
		const assembled = buildSessionSystemPrompt(input);
		const modelKey = input.modelId?.trim() || "(unconfigured)";
		const previous = this.lastAssembledSystemPromptByModelId.get(modelKey);
		this.lastAssembledSystemPromptByModelId.set(modelKey, assembled.text);
		// §5.AQ warmth ledger: record the shell identity this model is about to prefill (same modelKey normalization
		// as the byte map above, so the routing lookup and this record can never drift apart).
		this.lastShellKeyByModelId.set(modelKey, {
			shellKey: buildPromptShellKey({
				sessionKind: input.sessionKind,
				workspacePath: input.workspacePath?.trim() ?? "",
				modelId: modelKey,
			}),
			at: now(),
		});
		if (previous !== undefined) {
			// run42 (§5.BE) lesson: an IDENTICAL reassembly — the perfect cache hit, exactly what per-alias warm
			// rails produce card after card — was previously SILENT, making the best outcome invisible on the
			// scoreboard. Log both cases with the same category so reuse is measurable per model/alias.
			const identical = previous === assembled.text;
			const reuseRatio = identical ? 1 : computeSharedPrefixRatio(previous, assembled.text);
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: identical
					? `Prompt prefix reuse for ${modelKey}: 100% — byte-identical shell (perfect prefix-cache hit).`
					: `Prompt prefix reuse for ${modelKey}: ${(reuseRatio * 100).toFixed(0)}% of the new system prompt is byte-shared with the previous start.`,
				taskId: input.taskId,
				metadata: {
					category: "prompt_prefix_reuse",
					reuseRatio: Number(reuseRatio.toFixed(4)),
					identical,
					headPinnedVolatileKeys: assembled.headPinnedVolatileKeys,
				},
			});
		}
		return assembled.text;
	}

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
	private buildRetrievalExtraTools(taskId: string): AgentTool[] {
		// §5.U: the fail-closed attach decision (synthetic ⇒ no egress; egress literally true; §5.L role gate; a search
		// backend is configured) is the pure `shouldAttachRetrievalTools` (unit-tested). Read the LIVE service fields so a
		// config-off mid-session fails closed on the very next call. The egress itself lives entirely in the injected
		// adapters (SearXNG search + SSRF-guarded browse fetch) constructed below.
		if (
			!shouldAttachRetrievalTools({
				taskId,
				egressEnabled: this.retrievalEgressEnabled,
				agentWebResearchAllowed: this.agentWebResearchAllowed,
				searchBackendUrl: this.retrievalSearchBackendUrl,
			})
		) {
			return [];
		}
		return [
			createNKleinResearchTool({
				runLoop: (input) =>
					runRetrievalLoop(
						input.question,
						{
							// §5.AC: enable lexical query-relevance ranking in the live loop — hits that actually match the
							// query terms are folded above ones that are merely fresh/authoritative.
							search: searchHitsAdapter(
								(query) =>
									createSearxngWebSearchClient({
										backendBaseUrl: this.retrievalSearchBackendUrl,
										egressEnabled: this.retrievalEgressEnabled,
									}).search(query),
								{ rerankByRelevance: true },
							),
							// PRIME DIRECTIVE #1: the retrieval loop fetches untrusted, backend/SEO-controllable result URLs,
							// so the egress MUST be SSRF-guarded. buildSsrfGuardedPageFetcher enforces the same floor as
							// browse_url (http/https only + pre-fetch DNS-resolve-all-IPs private/reserved refusal +
							// post-redirect re-check); a blocked URL throws and the driver skips that hit (fail-closed).
							fetch: browserFetchAdapter(buildSsrfGuardedPageFetcher()),
							// §5.AC: synthesize the gathered evidence into a CITED answer via the task's own local model
							// (validated 2026-07-04: a capable local model reliably emits the {claim,cite[]} contract). The
							// model call is fail-soft — any error / no model ⇒ "" ⇒ the loop returns evidence only (its prior
							// behavior), so enabling synthesis never degrades the result below evidence-only.
							synthesize: citedSynthesisAdapter(async (prompt) => {
								const modelId = this.modelEndpoint.getModelId(taskId);
								if (!modelId) {
									return "";
								}
								try {
									const client = new LocalLlmClient({
										providerId: this.resolveProviderIdForTask(taskId),
										modelId,
										baseUrl: this.modelEndpoint.getEndpoint(taskId) ?? DEFAULT_LOCAL_CHAT_BASE_URL,
									});
									const res = await client.complete({
										messages: [{ role: "user", content: prompt }],
										sampling: { temperature: 0.2, maxTokens: 1500 },
									});
									return res.content;
								} catch {
									return ""; // fail-soft → evidence-only (unchanged from before synthesis was wired)
								}
							}),
							now: () => Date.now(),
						},
						{ ...(input.knowledgeDebt ? { knowledgeDebt: [...input.knowledgeDebt] } : {}) },
					),
			}),
		];
	}

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
		onPlanCritiqueSubmitted?: NKleinPlanCritiqueSubmittedHandler;
		onMergeResolutionSubmitted?: NKleinMergeResolutionSubmittedHandler;
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
		const customSystemPrompt = input.systemPrompt?.trim() || null;
		const sdkPromptParts = customSystemPrompt
			? null
			: await resolveNKleinSdkSystemPromptParts({
					// Sandbox-aware working directory for the `<session>` trailer; never the host mount (AGENTS.md).
					cwd: resolveNKleinAgentPerceivedCwd(input.taskId, agentPerceivedCwd),
					providerId: launchConfig.providerId,
					rules: runtimeSetup.loadRules(),
				});
		// W2.3b (§5.AQ): VOLATILITY-ORDERED fragment assembly replaces raw concat — base (head-pinned; a byte-stable
		// static shell since the §5.AQ(e) restructure moved its cwd/date out) → efficiency rules (config) → knows-
		// today date (daily; empty unless enabled+relevant, §5.AC/§5.AE) → home-agent append (task) → session-env
		// (the extracted cwd/date `<session>` trailer, LAST — the true task-volatile suffix).
		const systemPrompt = this.assembleSessionSystemPrompt({
			taskId: input.taskId,
			modelId: launchConfig.modelId,
			// §5.AQ warmth ledger: this seam builds the SYNTHETIC sessions too (`::review`/`::plan-critique`/
			// `::merge` launch configs carry their kind in the task-id suffix) — derive the shell kind from the id.
			sessionKind: derivePromptSessionKind(input.taskId, {
				isExplicitDecomposition: this.explicitDecompositionTaskIds.has(input.taskId),
			}),
			workspacePath: hostWorkspaceRoot,
			basePrompt: customSystemPrompt ?? sdkPromptParts?.staticText ?? "",
			baseIsStaticShell: !customSystemPrompt,
			homeAgentAppend: resolveHomeAgentAppendSystemPrompt(input.taskId),
			sessionEnv: sdkPromptParts?.sessionEnvText ?? null,
			efficiencyRules: buildKanbanEfficiencyRules({
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
			}),
			temporalBlock: decideTemporalContextInjection({
				enabled: this.knowsTodayEnabled || isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY),
				text: input.prompt,
				now: new Date(),
			}).block,
		});

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
		// §5.AC step 3: append the egress-gated web_search tool AFTER the sandbox tools (never mutate what
		// createAgentSandboxExtraTools returns). buildRetrievalExtraTools fails closed (default-off config, blank
		// backend) and returns [] for synthetic `::` sessions, so reviewers/critics rebuilt here get no egress.
		const combinedExtraTools = InMemoryNKleinTaskSessionService.combineExtraTools(
			sandboxExtraTools,
			this.buildRetrievalExtraTools(input.taskId),
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
						}
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
				requestPlanCritique: this.buildPlanCritiqueRequestHandler(input.taskId, hostWorkspaceRoot),
				onCardPromoted: isHomeAgentSessionId(input.taskId) ? undefined : this.onCardPromoted,
				onReviewSubmitted: input.onReviewSubmitted,
				onPlanCritiqueSubmitted: input.onPlanCritiqueSubmitted,
				onMergeResolutionSubmitted: input.onMergeResolutionSubmitted,
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
			// §5.AL runtime-verdict precision (approved follow-up, 2026-07-05): stamp a per-run id (mirroring the ledger's
			// `${taskId}:${startedAt}` attempt identity) so assessRuntimeModelVerdict can DEDUP this stall to its run
			// instead of falling back to a raw capped event count when multiple stalls land on the same run.
			...(entry.summary.startedAt ? { runId: `${taskId}:${entry.summary.startedAt}` } : {}),
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
				const systemPrompt = this.assembleSessionSystemPrompt({
					taskId: request.taskId,
					modelId,
					// §5.AQ warmth ledger: the primary seam is worker/architect (same signal as the summary's role
					// stamp above) or the home-agent "chat" — synthetic `::` kinds never start here.
					sessionKind: derivePromptSessionKind(request.taskId, {
						isExplicitDecomposition: this.explicitDecompositionTaskIds.has(request.taskId),
					}),
					workspacePath: request.workspaceRoot?.trim() || request.cwd,
					basePrompt: customSystemPrompt ?? sdkPromptParts?.staticText ?? "",
					baseIsStaticShell: !customSystemPrompt,
					homeAgentAppend: resolveHomeAgentAppendSystemPrompt(request.taskId),
					sessionEnv: sdkPromptParts?.sessionEnvText ?? null,
					planningPrompt: planningSystemPrompt,
					efficiencyRules: buildKanbanEfficiencyRules({
						contextScope: request.contextScope ?? "smart",
						contextWindow: requestContextWindow,
						timeoutMode: request.timeoutMode ?? "normal",
						maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
					}),
					temporalBlock: decideTemporalContextInjection({
						enabled: this.knowsTodayEnabled || isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY),
						text: request.prompt,
						now: new Date(),
					}).block,
					skillFragments: sessionSkillFragments,
				});
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
						this.buildRetrievalExtraTools(request.taskId),
					),
					// §5.AR: a RESTARTED isolated task gets the curated sandbox MCP servers too (consistent with the main
					// start path) — gated by the config setting (on by default) OR the env override, and only when a sandbox
					// exists for the rebuilt task.
					...(this.isSandboxMcpEnabled() && sandboxWorkspace
						? {
								sandboxMcpExecTarget: sandboxWorkspace.manager.getSandboxExecTarget(request.taskId),
								basicMemoryExecEnv: sandboxWorkspace.manager.getBasicMemoryExecEnv?.(request.taskId),
							}
						: {}),
					toolPolicies: runtimeSetup.toolPolicies,
					onDecompositionApplied: this.onDecompositionApplied,
					requestPlanCritique: this.buildPlanCritiqueRequestHandler(request.taskId, request.cwd),
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

	/**
	 * Run20 live finding: `finalizeSandboxReview` disposes the worker's sandbox workspace right after capturing
	 * the result branch (the branch holds the work; the slot frees) — but a review BOUNCE/ESCALATION re-drives
	 * the SAME live session, whose tools then operate on a DELETED cwd (every read ENOENT'd; the worker flailed
	 * "the repository is missing critical files" until the park rung gave up). The placement path is
	 * deterministic from the taskId, so re-preparing under the same id makes the session's existing sandbox
	 * executors valid again — checked out at the RESULT BRANCH first, so the accumulated work is present for the
	 * follow-up round. No-op when there is no sandbox manager, the task never had a sandbox, or it still has one.
	 */
	private async restoreDisposedSandboxWorkspaceForRedrive(taskId: string): Promise<void> {
		const manager = this.agentSandboxManager;
		const repoPath = this.sandboxState.getRepoPath(taskId);
		if (!manager || !repoPath || manager.hasWorkspace(taskId)) {
			return;
		}
		try {
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
		} catch (error) {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `Could not restore the sandbox workspace for ${taskId} before a re-drive: ${error instanceof Error ? error.message : String(error)}`,
				taskId,
				workspacePath: repoPath,
				createdAt: Date.now(),
			});
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
					// A bounced/escalated card's workspace may have been disposed at capture — restore it BEFORE
					// the turn so the session's sandbox tools work again (see the helper's run20 story).
					await this.restoreDisposedSandboxWorkspaceForRedrive(taskId);
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
					this.emitTaskFailure(taskId, live, "send", error);
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

	getPromptWarmthLedger(): ReadonlyMap<string, PromptWarmthLedgerEntry> {
		return this.lastShellKeyByModelId;
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
		if (!this.agentSandboxManager) {
			throw new Error("!Klein acceptance verification requires the configured agent sandbox manager.");
		}
		// Test the DELIVERED tree: acceptance evidence must run against the task's result branch, not the base
		// ref the callers hold (run19 autopsy: base-tree acceptance is false evidence in both directions — a
		// base-green repo rubber-stamps a no-op, a base-red repo fail-holds perfect work). No result branch yet
		// (e.g. empty patch) falls back to the base ref, where the empty-patch hold already governs.
		// §5.AW: when the reviewer preferred the speculative candidate, the DELIVERED tree is the ::spec
		// branch — acceptance evidence must run against what actually ships.
		const resultCommit = input.useBaseTree
			? null
			: await resolveTaskResultBranchCommit({
					repoPath: input.projectRepoPath,
					taskId: input.resultBranchTaskId ?? input.taskId,
				}).catch(() => null);
		return await runNKleinAcceptanceGateInSandbox({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: resultCommit ?? input.baseRef,
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
		/** §5.AQ (d): the shell KIND the picked model will assemble — the same-kind warmth batching signal. */
		sessionKind: PromptSessionKind = "review",
	): Promise<{ providerId: string; modelId: string } | null> {
		const baseUrl = workerLaunch.baseUrl?.trim() || "http://127.0.0.1:1234/v1";
		const descriptors = await fetchLoadedModelDescriptors(baseUrl).catch(
			() => [] as Awaited<ReturnType<typeof fetchLoadedModelDescriptors>>,
		);
		if (descriptors.length === 0) {
			return null;
		}
		// The worker's launch modelId is usually the SERVED alias — resolve its REAL key for lineage when loaded.
		const workerRealId = resolveWorkerRealId(descriptors, workerLaunch.modelId);
		const candidates = buildReviewerCandidates(descriptors, workerLaunch.modelId, workerRealId);
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
		// §5.AQ (d) session-KIND batching: among the candidates DIVERSITY allows (its result above is authoritative
		// — never weakened here), prefer the one whose last prompt shell is the SAME KIND (review→review etc.), so
		// back-to-back decision turns land on an already-warm shell instead of interleaving kinds across models.
		// The warmth ledger is keyed by the SERVED id (what the launch config gets) — candidate.modelKey here.
		const workerLineage = resolveLineage(workerRealId);
		const diverseCandidates = preferred.ranked.filter((candidate) => {
			const lineage = resolveLineage(candidate.modelId);
			return lineage !== "unknown" && lineage !== workerLineage;
		});
		const warmth = applyWarmthPreference({
			ranked: diverseCandidates.map((candidate) => ({
				modelKey: candidate.modelKey,
				modelId: candidate.modelKey,
				score: candidate.score,
			})),
			sessionKind,
			workspacePath: workerLaunch.workspaceRoot?.trim() ?? "",
			lastShellKeyByModel: this.lastShellKeyByModelId,
			now: now(),
		});
		const warmthPick = warmth.warmthApplied
			? (diverseCandidates.find((candidate) => candidate.modelKey === warmth.ranked[0]?.modelKey) ?? null)
			: null;
		if (warmthPick && warmth.warmthReason) {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Cache-warmth kind-batching for ${taskId}: ${warmth.warmthReason} (within the lineage-diverse set).`,
				taskId,
				metadata: { category: "reviewer_warmth_batched", reason: warmth.warmthReason },
			});
		}
		const pick = warmthPick ?? preferred.ranked[0];
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message: `Auto-picked lineage-diverse reviewer ${pick.modelKey} (${resolveLineage(pick.modelId)}) for ${taskId} — worker is ${workerRealId} (${resolveLineage(workerRealId)}).`,
			taskId,
			metadata: { category: "reviewer_auto_diverse", reviewer: pick.modelKey, worker: workerRealId },
		});
		return { providerId: workerLaunch.providerId, modelId: pick.modelKey };
	}

	async pickDiverseEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null> {
		const launch = this.launchConfigByTaskId.get(taskId) ?? null;
		if (!launch?.providerId || !launch.modelId) {
			return null;
		}
		// The escalated session is the card's WORKER session on a stronger model — batch toward worker shells.
		return await this.pickDiverseReviewerModel(launch, taskId, "worker").catch(() => null);
	}

	/** #31: `::review` sessions share one workspace path per task — two concurrent rounds destroy each other. */
	private readonly inFlightSecondOpinionReviewTaskIds = new Set<string>();

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
		// #31 (run32 live): a second concurrent review for the same task would prepare the SAME
		// `<taskId>::review` workspace and the first round's teardown would destroy it mid-turn (the grinding
		// blocked-read loop + no verdict). Single-flight: the caller treats null as "skipped" (fail-closed
		// hold), and the in-flight round concludes normally.
		if (this.inFlightSecondOpinionReviewTaskIds.has(input.taskId)) {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Second-opinion review already in flight for ${input.taskId}; skipping the concurrent round.`,
				taskId: `${input.taskId}::review`,
				workspacePath: input.projectRepoPath,
				metadata: { category: "second_opinion_review_single_flight" },
			});
			return null;
		}
		this.inFlightSecondOpinionReviewTaskIds.add(input.taskId);
		try {
			return await this.runSecondOpinionReviewSessionInner(input);
		} finally {
			this.inFlightSecondOpinionReviewTaskIds.delete(input.taskId);
		}
	}

	/** The body of {@link runSecondOpinionReviewSession}; the wrapper owns ONLY the single-flight flag, so no
	 * early return or pre-`try` throw (sandbox unavailable, prepareWorkspace queue rejection, unresolvable
	 * reviewer) can leak it and permanently wedge the card's reviews (adversarial finding, 2026-07-02). */
	private async runSecondOpinionReviewSessionInner(input: {
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
				? await this.pickDiverseReviewerModel(workerLaunch, input.taskId, "review").catch(() => null)
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
			// Auxiliary seam — NEVER wait forever on a slot (run19 froze here for 15+ min after a leaked slot).
			// A rejection propagates to the review runner's catch ⇒ review "skipped" ⇒ fail-closed hold, run alive.
			maxQueueWaitMs: 180_000,
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

	/** §5.AW: specs the arbitration seam canceled — the runner must NOT capture their (partial) work. */
	private readonly canceledSpeculativeMirrorTaskIds = new Set<string>();

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

	/** §5.AW: the primary handed off first — abort a still-running `::spec` mirror and discard its work. */
	async cancelSpeculativeMirror(taskId: string): Promise<void> {
		const specTaskId = `${taskId}::spec`;
		this.canceledSpeculativeMirrorTaskIds.add(specTaskId);
		await this.cancelTaskTurn(specTaskId).catch(() => undefined);
	}

	/**
	 * §5.AW opportunistic best-of-N: a SPECULATIVE WORKER session `<taskId>::spec` — a lineage-diverse idle
	 * model independently implementing the same card in its own sandbox workspace. Mirrors
	 * {@link runSecondOpinionReviewSession}'s bounded shape (auxiliary prepareWorkspace wait, bounded turn,
	 * full teardown, never throws), but unlike the verdict sessions it CAPTURES its work to the `::spec`
	 * result branch on completion — that branch's existence at review time is what arms the A/B arbitration
	 * seed. A mirror canceled via {@link cancelSpeculativeMirror} (the primary won the race) never captures.
	 */
	async runSpeculativeMirrorSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		prompt: string;
		mirror: { providerId: string; modelId: string };
		timeoutMs?: number;
	}): Promise<boolean> {
		if (!this.agentSandboxManager) {
			return false;
		}
		const specTaskId = `${input.taskId}::spec`;
		// Adversarial finding (2026-07-02): NEVER erase a prior cancel here — a stale tick snapshot can start a
		// mirror after arbitration already canceled it, and erasing the flag would let post-handoff speculative
		// work capture. A lingering flag is harmless (one mirror per card per run).
		if (this.canceledSpeculativeMirrorTaskIds.has(specTaskId)) {
			return false;
		}
		// The mirror only makes sense while the PRIMARY is still working the card (a stale tick snapshot may
		// fire after a fast handoff — arbitration is already running or done by then).
		if (this.messageRepository.getTaskEntry(input.taskId)?.summary.state !== "running") {
			return false;
		}
		// No-model-load directive (§5.AB): a mirror must never trigger an LM Studio JIT auto-load. Re-verify the
		// mirror model is STILL resident at start time (the tick's snapshot can be a whole tick stale).
		const workerLaunch = this.launchConfigByTaskId.get(input.taskId) ?? null;
		const residencyBaseUrl = workerLaunch?.baseUrl?.trim() || "http://127.0.0.1:1234/v1";
		const residentIds = await fetchLoadedModelIdsCached(residencyBaseUrl).catch(() => [] as string[]);
		if (residentIds.length > 0 && !residentIds.includes(input.mirror.modelId)) {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Speculative mirror skipped for ${input.taskId}: model ${input.mirror.modelId} is no longer resident (never auto-load for speculation).`,
				taskId: specTaskId,
				workspacePath: input.projectRepoPath,
				metadata: { category: "speculative_mirror_residency_skip", mirrorModelId: input.mirror.modelId },
			});
			return false;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...(workerLaunch ?? {}),
			providerId: input.mirror.providerId,
			modelId: input.mirror.modelId,
			workspaceRoot: input.projectRepoPath,
		};
		await this.agentSandboxManager.assertAvailable();
		const baseRef = input.baseRef.trim() || "HEAD";
		const workspace = await this.agentSandboxManager.prepareWorkspace({
			taskId: specTaskId,
			projectRepoPath: input.projectRepoPath,
			baseRef,
			// Auxiliary seam — never wait forever on a slot (the run19 lesson); a rejection propagates to the
			// tick's catch and the mirror is simply skipped this round.
			maxQueueWaitMs: 180_000,
		});
		this.sandboxState.setSandbox(specTaskId, input.projectRepoPath, baseRef);
		const deadlineMs = Date.now() + (input.timeoutMs ?? DEFAULT_SPECULATIVE_MIRROR_TIMEOUT_MS);
		const recordSpecError = (error: unknown): void => {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `Speculative mirror session failed: ${error instanceof Error ? error.message : String(error)}`,
				taskId: specTaskId,
				workspacePath: input.projectRepoPath,
				createdAt: Date.now(),
			});
		};
		const runBoundedTurn = async (turn: Promise<unknown>): Promise<"settled" | "timeout"> => {
			const remainingMs = deadlineMs - Date.now();
			if (remainingMs <= 0) {
				return "timeout";
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<"timeout">((resolve) => {
				timer = setTimeout(() => resolve("timeout"), remainingMs);
			});
			const outcome = await Promise.race([
				turn.then(
					() => "settled" as const,
					(error) => {
						recordSpecError(error);
						return "settled" as const;
					},
				),
				timeout,
			]);
			if (timer) {
				clearTimeout(timer);
			}
			return outcome;
		};
		try {
			// Cancel raced the sandbox prep (the primary handed off while this workspace queued) — stop before
			// spending a model turn on a lost race.
			if (this.canceledSpeculativeMirrorTaskIds.has(specTaskId)) {
				return false;
			}
			const turnOutcome = await runBoundedTurn(
				this.startRuntimeTaskSessionFromLaunchConfig({
					taskId: specTaskId,
					cwd: workspace.workdir,
					workspaceRoot: input.projectRepoPath,
					prompt: input.prompt,
					launchConfig,
					// "smart" = the real-work default (the launch config does not persist the primary's scope choice;
					// the spec is attempting the same card, so it gets the same default treatment).
					contextScope: "smart",
					toolExecutors: createAgentSandboxToolExecutors(this.agentSandboxManager, specTaskId, {
						pauseController: this.pauseController,
					}),
					extraTools: createAgentSandboxExtraTools(this.agentSandboxManager, specTaskId, {
						sessionId: createSessionId(specTaskId),
						contextWindow: launchConfig.contextWindow ?? undefined,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					}),
				}),
			);
			if (this.canceledSpeculativeMirrorTaskIds.has(specTaskId)) {
				return false; // The primary won the race — partial speculative work is discarded, never captured.
			}
			if (turnOutcome === "timeout") {
				// The turn is (possibly) STILL RUNNING — capturing now would snapshot a mid-write tree as the
				// candidate. A spec that can't finish inside its bound is not a candidate; discard it.
				await this.cancelTaskTurn(specTaskId).catch(() => undefined);
				return false;
			}
			const patch = await this.agentSandboxManager.captureWorkspacePatch(specTaskId, { baseRef });
			const branch = await applyTaskPatchToResultBranch({
				repoPath: input.projectRepoPath,
				taskId: specTaskId,
				baseRef,
				patch,
			});
			if (!branch) {
				return false;
			}
			this.sandboxState.setResultBranch(specTaskId, branch);
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Speculative mirror captured a candidate: ${branch.branchName} (worker ${workerLaunch?.modelId ?? "unknown"} vs mirror ${input.mirror.modelId}).`,
				taskId: specTaskId,
				workspacePath: input.projectRepoPath,
				metadata: {
					category: "speculative_mirror_captured",
					branchName: branch.branchName,
					headCommit: branch.headCommit,
					mirrorModelId: input.mirror.modelId,
				},
			});
			return true;
		} catch (error) {
			recordSpecError(error);
			return false;
		} finally {
			await this.sessionRuntime.clearTaskSessions(specTaskId).catch(() => undefined);
			await this.agentSandboxManager.disposeWorkspace(specTaskId).catch(() => undefined);
			this.launchConfigByTaskId.delete(specTaskId);
			this.providerIdStore.forget(specTaskId);
			this.modelEndpoint.forget(specTaskId);
			this.contextBudgetInputs.forget(specTaskId);
			this.sandboxState.deleteSandbox(specTaskId);
			this.canceledSpeculativeMirrorTaskIds.delete(specTaskId);
		}
	}

	/** W4.3 per-run critique budget: deliberation is rare by design (high-stakes × unclean quality only). */
	private planCritiqueRunsUsed = 0;
	private static readonly PLAN_CRITIQUE_RUN_BUDGET = 2;

	/**
	 * W4.3: build the `requestPlanCritique` executor for a session's decompose tool — or undefined for synthetic
	 * sessions (`::review`/`::plan-critique`/`::acceptance` must never recurse into a critique). Enforces the
	 * per-run count budget; failures and empty verdicts degrade to null (proceed) so a critique never blocks.
	 */
	private buildPlanCritiqueRequestHandler(
		taskId: string,
		projectRepoPath: string,
	): NKleinPlanCritiqueRequestHandler | undefined {
		if (taskId.includes("::") || isHomeAgentSessionId(taskId)) {
			return undefined;
		}
		return async (request) => {
			if (this.planCritiqueRunsUsed >= InMemoryNKleinTaskSessionService.PLAN_CRITIQUE_RUN_BUDGET) {
				return null;
			}
			if (!this.agentSandboxManager) {
				return null;
			}
			// Adversarial-review fix (2026-07-02): probe for the diverse critic BEFORE spending budget — degraded
			// no-op attempts (single-model fleets) were burning the whole budget without ever running a session,
			// permanently self-disabling deliberation for the service lifetime. And the waiver is SURFACED here
			// (the shared trigger's waiver path is unreachable from the tool seam, which only knows an executor
			// exists — see the decompose tool's gate comment).
			const critic = await this.pickDiverseEscalationModel(taskId).catch(() => null);
			if (!critic) {
				recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: `Plan-critique diversity waived for ${request.slug}: no lineage-diverse capable critic is loaded — proceeding without deliberation (a same-family debate is correlated noise).`,
					taskId,
					metadata: { category: "plan_critique_diversity_waived", planSlug: request.slug },
				});
				return null;
			}
			this.planCritiqueRunsUsed += 1;
			return await this.runPlanCritiqueSession({
				taskId,
				projectRepoPath,
				baseRef: this.sandboxState.getBaseRef(taskId) ?? "HEAD",
				seedPrompt: buildPlanCritiqueSeedPrompt(request),
				critic,
			}).catch(() => null);
		};
	}

	/**
	 * W4.3: one bounded DIVERSE-CRITIC turn over a validated decomposition plan, BEFORE the cascade starts —
	 * mirrors {@link runSecondOpinionReviewSession} 1:1 (synthetic `<taskId>::plan-critique` session, lineage-
	 * diverse auto-pick, sandbox workspace at the source card's base so the critic can verify file claims,
	 * bounded turn + nudges, full teardown). Resolves to the critic's structured verdict, or null when the turn
	 * ends without one / no diverse critic exists / the sandbox is unavailable — callers treat null as "proceed"
	 * (a critique must NEVER block a decomposition; it only ever adds one revision round).
	 */
	async runPlanCritiqueSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		timeoutMs?: number;
		/** Pre-picked diverse critic (the budget-owning handler probes first); absent ⇒ probe here. */
		critic?: { providerId: string; modelId: string } | null;
	}): Promise<NKleinPlanCritiqueResult | null> {
		if (!this.agentSandboxManager) {
			return null;
		}
		const architectLaunch = this.launchConfigByTaskId.get(input.taskId) ?? null;
		if (!architectLaunch?.providerId || !architectLaunch.modelId) {
			return null;
		}
		// The whole point is a DIVERSE second perspective — degrade to null (proceed) without one.
		const critic =
			input.critic ??
			(await this.pickDiverseReviewerModel(architectLaunch, input.taskId, "plan-critique").catch(() => null));
		if (!critic) {
			return null;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...architectLaunch,
			providerId: critic.providerId,
			modelId: critic.modelId,
			workspaceRoot: input.projectRepoPath,
		};
		const critiqueTaskId = `${input.taskId}::plan-critique`;
		await this.agentSandboxManager.assertAvailable();
		const workspace = await this.agentSandboxManager.prepareWorkspace({
			taskId: critiqueTaskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: input.baseRef ?? null,
			// Auxiliary seam — bounded like ::review/::acceptance; a rejection degrades to null (proceed).
			maxQueueWaitMs: 180_000,
		});
		this.sandboxState.setSandbox(critiqueTaskId, input.projectRepoPath, input.baseRef?.trim() || "HEAD");
		let verdict: NKleinPlanCritiqueResult | null = null;
		const deadlineMs = Date.now() + (input.timeoutMs ?? DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS);
		const runBoundedTurn = async (turn: Promise<unknown>): Promise<void> => {
			const remainingMs = deadlineMs - Date.now();
			if (remainingMs <= 0) {
				return;
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, remainingMs);
			});
			await Promise.race([
				turn.then(
					() => undefined,
					(error) => {
						recordSelfObservation({
							signal: "runtime_error",
							severity: "warning",
							message: `Plan-critique session failed: ${error instanceof Error ? error.message : String(error)}`,
							taskId: critiqueTaskId,
							workspacePath: input.projectRepoPath,
							createdAt: Date.now(),
						});
					},
				),
				timeout,
			]);
			if (timer) {
				clearTimeout(timer);
			}
		};
		try {
			await runBoundedTurn(
				this.startRuntimeTaskSessionFromLaunchConfig({
					taskId: critiqueTaskId,
					cwd: workspace.workdir,
					workspaceRoot: input.projectRepoPath,
					prompt: input.seedPrompt,
					launchConfig,
					contextScope: "minimal",
					onPlanCritiqueSubmitted: (result) => {
						verdict = result;
					},
					toolExecutors: createAgentSandboxToolExecutors(this.agentSandboxManager, critiqueTaskId, {
						pauseController: this.pauseController,
					}),
					extraTools: createAgentSandboxExtraTools(this.agentSandboxManager, critiqueTaskId, {
						sessionId: createSessionId(critiqueTaskId),
						contextWindow: launchConfig.contextWindow ?? undefined,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					}),
				}),
			);
			for (
				let nudge = 0;
				verdict === null && nudge < MAX_SECOND_OPINION_REVIEW_NUDGES && Date.now() < deadlineMs;
				nudge += 1
			) {
				await runBoundedTurn(
					this.sessionRuntime.sendTaskSessionInput(
						critiqueTaskId,
						"Submit your critique now by calling the submit_plan_critique tool with a `proceed` or `revise` verdict. Do not reply in prose.",
					),
				);
			}
			return verdict;
		} finally {
			await this.sessionRuntime.clearTaskSessions(critiqueTaskId).catch(() => undefined);
			await this.agentSandboxManager.disposeWorkspace(critiqueTaskId).catch(() => undefined);
			this.launchConfigByTaskId.delete(critiqueTaskId);
			this.providerIdStore.forget(critiqueTaskId);
			this.modelEndpoint.forget(critiqueTaskId);
			this.contextBudgetInputs.forget(critiqueTaskId);
			this.sandboxState.deleteSandbox(critiqueTaskId);
		}
	}

	/**
	 * §5.AK Phase B: one bounded `::merge` session that resolves a result-branch merge conflict inside a SANDBOX
	 * reproduction — the host repo never holds the agent's dirty merge state. Mirrors
	 * {@link runSecondOpinionReviewSession} structurally (synthetic `<taskId>::merge` id, bounded turn + nudges,
	 * full teardown in finally), with the conflict reproduced in the sandbox (merge the delivered result commit
	 * at the project main ref) BEFORE the model turn. A merge is high-stakes, so the lineage-diverse escalation
	 * pick is PREFERRED over the task's own model when one is loaded. Resolves to:
	 * - `{ outcome: "clean" }` when the sandbox merge lands conflict-free (no model turn is spent),
	 * - `{ outcome: "resolved", resolvedFiles }` carrying the resolved contents of ONLY the conflicted files —
	 *   the host-side caller re-merges, overwrites the conflicted files with these, adds, and commits, keeping
	 *   the host dirty-window tiny and deterministic,
	 * - `{ outcome: "cannot_resolve", reason }` for a concrete blocker (binary / >1MB files included),
	 * - null when the session yields nothing usable — callers fall back to abort-and-surface exactly as before,
	 *   so the agent is strictly additive over today's hard-abort.
	 */
	async runMergeResolutionSession(input: {
		taskId: string;
		projectRepoPath: string;
		mainRef: string;
		resultCommit: string;
		conflictedPaths: string[];
		timeoutMs?: number;
	}): Promise<NKleinMergeResolutionSessionOutcome | null> {
		if (!this.agentSandboxManager) {
			return null;
		}
		const manager = this.agentSandboxManager;
		const workerLaunch = this.launchConfigByTaskId.get(input.taskId) ?? null;
		// High-stakes merge: prefer the lineage-diverse (typically stronger) escalation pick when one is loaded;
		// the task's own launch config is the fallback. With neither there is no way to run a session at all.
		const diverse = await this.pickDiverseEscalationModel(input.taskId).catch(() => null);
		const providerId = (diverse?.providerId ?? workerLaunch?.providerId ?? "").trim();
		const modelId = (diverse?.modelId ?? workerLaunch?.modelId ?? "").trim();
		if (!providerId || !modelId) {
			return null;
		}
		const launchConfig: NKleinTaskRestartLaunchConfig = {
			...(workerLaunch ?? {}),
			providerId,
			modelId,
			workspaceRoot: input.projectRepoPath,
			// EXPLICITLY drop the worker card's write-scope guards: conflicted paths routinely fall outside the
			// card's declared filesLikelyTouched (bash side effects: lockfiles, codegen), and an inherited
			// per-file line cap can forbid writing a large resolved file — either would burn the whole bounded
			// session on hard-blocked edits. The merge agent's real boundary is the conflicted-path capture:
			// only those files ever reach the host.
			filesLikelyTouched: null,
			maxAgentWritableFileLines: null,
		};
		const mergeTaskId = `${input.taskId}::merge`;
		await manager.assertAvailable();
		const workspace = await manager.prepareWorkspace({
			taskId: mergeTaskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: input.mainRef?.trim() || null,
			// Auxiliary seam — NEVER wait forever on a slot (run19 froze here for 15+ min after a leaked slot).
			// A rejection propagates to the delivery caller's catch ⇒ null ⇒ abort-and-surface, run alive.
			maxQueueWaitMs: 180_000,
		});
		this.sandboxState.setSandbox(mergeTaskId, input.projectRepoPath, input.mainRef?.trim() || "HEAD");
		let verdict: NKleinMergeResolutionResult | null = null;
		const deadlineMs = Date.now() + (input.timeoutMs ?? DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS);
		const recordMergeSessionError = (message: string): void => {
			recordSelfObservation({
				signal: "runtime_error",
				severity: "warning",
				message: `Merge-resolution session failed: ${message}`,
				taskId: mergeTaskId,
				workspacePath: input.projectRepoPath,
				createdAt: Date.now(),
			});
		};
		// Awaits one merge-agent turn, bounded by the remaining overall budget (an SDK turn can hang); turn errors
		// are recorded, not thrown, so they fall through to a null verdict (the caller then aborts-and-surfaces).
		// Returns whether the turn actually SETTLED (resolved/rejected) — false means the deadline fired with the
		// turn STILL RUNNING in the background, so the sandbox tree may keep changing under later execs (TOCTOU).
		const runBoundedTurn = async (turn: Promise<unknown>): Promise<boolean> => {
			let turnSettled = false;
			const settleTracked = turn.then(
				() => {
					turnSettled = true;
				},
				(error) => {
					turnSettled = true;
					recordMergeSessionError(error instanceof Error ? error.message : String(error));
				},
			);
			const remainingMs = deadlineMs - Date.now();
			if (remainingMs <= 0) {
				return turnSettled;
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<void>((resolve) => {
				timer = setTimeout(resolve, remainingMs);
			});
			await Promise.race([settleTracked, timeout]);
			if (timer) {
				clearTimeout(timer);
			}
			return turnSettled;
		};
		// TOCTOU guard (fix 5): true only while every bounded turn settled BEFORE its deadline. When false, a
		// live agent turn may still be writing into the sandbox and the scan/commit/capture sequence below must
		// hard-stop the session first.
		let lastTurnSettled = true;
		try {
			// REPRODUCE the conflict inside the sandbox: merge the delivered result commit onto the main ref. The
			// result branch ref is host-side only, but the sandbox clone copies the host object store (/repos
			// mount), so the raw commit sha resolves. Non-zero exit leaves the conflict markers in the working
			// tree — exactly the state the agent must fix. A CLEAN merge is instant success without a model turn.
			// Explicit generous timeout: the 30s exec default can kill the docker CLIENT mid-merge on a large
			// merge / slow machine (exitCode null, merge still running in-container) — a poisoned reproduction.
			const reproduce = await manager.exec(
				mergeTaskId,
				["git", "-C", workspace.workdir, "merge", "--no-ff", "--no-edit", input.resultCommit],
				{ timeoutMs: 600_000 },
			);
			if (reproduce.exitCode === 0) {
				return { outcome: "clean" };
			}
			if (reproduce.exitCode === null) {
				recordMergeSessionError(
					"sandbox merge reproduction did not finish (exec exit null) — cannot trust the sandbox state",
				);
				return null;
			}
			// VERIFY the reproduction matches the host conflict EXACTLY: a merge can fail differently in the
			// sandbox (missing host merge drivers, git-version drift, unmergeable sha), and every downstream
			// guard only inspects the host-provided conflictedPaths — a divergent reproduction could otherwise
			// let the agent "resolve" a tree that never held the host's conflict and commit a semantically wrong
			// merge. Require the sandbox unmerged set to equal input.conflictedPaths (order-insensitive; empty
			// means no real mid-merge conflict). Any mismatch is fail-safe null → abort-and-surface.
			const sandboxUnmerged = await manager.exec(mergeTaskId, [
				"git",
				"-C",
				workspace.workdir,
				"diff",
				"--name-only",
				"--diff-filter=U",
				"-z",
			]);
			// Mirrors the host-side parseNullSeparatedPaths (trim each entry, drop empties) so the two sets are
			// byte-comparable.
			const sandboxConflictedPaths =
				sandboxUnmerged.exitCode === 0
					? sandboxUnmerged.stdout
							.split("\0")
							.map((path) => path.trim())
							.filter((path) => path.length > 0)
					: null;
			const hostSet = new Set(input.conflictedPaths);
			const sandboxSet = new Set(sandboxConflictedPaths ?? []);
			const conflictSetsMatch =
				sandboxConflictedPaths !== null &&
				sandboxSet.size > 0 &&
				sandboxSet.size === hostSet.size &&
				[...sandboxSet].every((path) => hostSet.has(path));
			if (!conflictSetsMatch) {
				recordMergeSessionError(
					`sandbox merge reproduction diverged from the host conflict — host unmerged: [${[...hostSet].join(", ")}]; sandbox unmerged: ${
						sandboxConflictedPaths === null
							? `(unreadable — git diff exit ${sandboxUnmerged.exitCode ?? "null"})`
							: `[${[...sandboxSet].join(", ")}]`
					}`,
				);
				return null;
			}
			// Binary or oversized conflicted files are beyond a bounded text-edit session — don't spend a model turn.
			for (const path of input.conflictedPaths) {
				const size = await manager.exec(mergeTaskId, ["wc", "-c", "--", path]);
				const bytes = Number.parseInt(size.stdout.trim().split(/\s+/u)[0] ?? "", 10);
				if (size.exitCode !== 0 || !Number.isFinite(bytes) || bytes > MAX_MERGE_RESOLUTION_FILE_BYTES) {
					return {
						outcome: "cannot_resolve",
						reason:
							size.exitCode === 0 && Number.isFinite(bytes)
								? `Conflicted file "${path}" is ${bytes} bytes — over the ${MAX_MERGE_RESOLUTION_FILE_BYTES}-byte cap for agent merge resolution.`
								: `Conflicted file "${path}" could not be measured in the sandbox reproduction.`,
					};
				}
				// GNU grep -I never matches binary files; a conflicted TEXT file always has lines here (the merge
				// machinery just wrote markers into it), so the match-anything empty pattern hits. Exit 0 = text.
				const textProbe = await manager.exec(mergeTaskId, ["grep", "-Iq", "", "--", path]);
				if (textProbe.exitCode !== 0) {
					return {
						outcome: "cannot_resolve",
						reason: `Conflicted file "${path}" looks binary; agent merge resolution only handles text files.`,
					};
				}
			}
			// First turn: seed prompt + the submit_merge_resolution tool, file/bash tools routed into the sandbox.
			lastTurnSettled = await runBoundedTurn(
				this.startRuntimeTaskSessionFromLaunchConfig({
					taskId: mergeTaskId,
					cwd: workspace.workdir,
					workspaceRoot: input.projectRepoPath,
					prompt: buildMergeResolutionSeedPrompt({
						taskId: input.taskId,
						conflictedPaths: input.conflictedPaths,
					}),
					launchConfig,
					contextScope: "minimal",
					onMergeResolutionSubmitted: (result) => {
						verdict = result;
					},
					toolExecutors: createAgentSandboxToolExecutors(manager, mergeTaskId, {
						pauseController: this.pauseController,
					}),
					extraTools: createAgentSandboxExtraTools(manager, mergeTaskId, {
						sessionId: createSessionId(mergeTaskId),
						contextWindow: launchConfig.contextWindow ?? undefined,
						maxFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					}),
				}),
			);
			for (
				let nudge = 0;
				verdict === null && nudge < MAX_SECOND_OPINION_REVIEW_NUDGES && Date.now() < deadlineMs;
				nudge += 1
			) {
				lastTurnSettled = await runBoundedTurn(
					this.sessionRuntime.sendTaskSessionInput(mergeTaskId, MERGE_RESOLUTION_NUDGE_PROMPT),
				);
			}
			// Widen past TS's closure-assignment blind spot: `verdict` is only ever written inside the
			// onMergeResolutionSubmitted callback, so control-flow analysis still sees the `null` initializer here.
			const submission = verdict as NKleinMergeResolutionResult | null;
			if (!submission) {
				return null;
			}
			if (submission.outcome === "cannot_resolve") {
				return { outcome: "cannot_resolve", reason: submission.reason ?? submission.summary };
			}
			// TOCTOU guard (fix 5): if the deadline fired while a turn was STILL RUNNING, the agent may keep
			// issuing sandbox writes concurrently with the scan/commit/capture below — a file rewritten between
			// the marker scan and its cat could be captured marker-free but semantically half-edited. Hard-stop
			// the session (clearTaskSessions aborts the live session host) BEFORE touching the sandbox tree.
			if (!lastTurnSettled) {
				await this.sessionRuntime.clearTaskSessions(mergeTaskId).catch(() => undefined);
			}
			// Trust but verify the "resolved" claim: any leftover conflict marker in a conflicted file is a hard
			// fail. grep exit codes: 0 = markers found (unresolved), 1 = none (good), 2+ = probe failure (fail safe).
			const markerScan = await manager.exec(mergeTaskId, [
				"grep",
				"-l",
				"-E",
				"^(<<<<<<<|>>>>>>>)",
				"--",
				...input.conflictedPaths,
			]);
			if (markerScan.exitCode !== 1) {
				recordMergeSessionError(
					markerScan.exitCode === 0
						? `agent reported "resolved" but conflict markers remain in: ${markerScan.stdout.trim()}`
						: `leftover-marker verification could not run (grep exit ${markerScan.exitCode ?? "null"})`,
				);
				return null;
			}
			// Complete the merge commit in the sandbox (validates the merge state is committable; the sandbox has
			// no git identity, so pass one inline). The commit does not change the working tree we capture below.
			// Agents habitually finish a mid-merge fix with their OWN `git commit` (git's conflict hints tell them
			// to) — that consumes MERGE_HEAD, and a follow-up commit would fail with "nothing to commit" and throw
			// away a perfectly valid resolution. So: MERGE_HEAD gone + clean worktree = already-committed success;
			// MERGE_HEAD present = commit as usual (non-zero → fail-safe null).
			const sandboxMergeHead = await manager.exec(mergeTaskId, [
				"git",
				"-C",
				workspace.workdir,
				"rev-parse",
				"-q",
				"--verify",
				"MERGE_HEAD",
			]);
			if (sandboxMergeHead.exitCode === 0) {
				const commit = await manager.exec(mergeTaskId, [
					"git",
					"-C",
					workspace.workdir,
					"-c",
					"user.name=nklein-merge-agent",
					"-c",
					"user.email=nklein-merge-agent@local.invalid",
					"commit",
					"-am",
					`Merge resolution for ${input.taskId}`,
				]);
				if (commit.exitCode !== 0) {
					recordMergeSessionError(`sandbox merge commit failed: ${commit.stderr.trim() || commit.stdout.trim()}`);
					return null;
				}
			} else {
				const worktreeStatus = await manager.exec(mergeTaskId, [
					"git",
					"-C",
					workspace.workdir,
					"status",
					"--porcelain",
				]);
				if (worktreeStatus.exitCode !== 0 || worktreeStatus.stdout.trim() !== "") {
					recordMergeSessionError(
						`sandbox MERGE_HEAD is gone but the worktree is not clean (status exit ${worktreeStatus.exitCode ?? "null"}) — cannot trust the agent's own commit`,
					);
					return null;
				}
			}
			// Capture the resolved contents of ONLY the conflicted files back to the host (the sandbox tree is a
			// container volume — there is nothing host-fetchable, so the file contents ARE the deliverable).
			const resolvedFiles: NKleinMergeResolutionResolvedFile[] = [];
			for (const path of input.conflictedPaths) {
				// Symlink guard (mirrors the host-side lstat rule): cat/grep/wc all FOLLOW a sandbox symlink, so a
				// conflicted path that is a symlink would capture the TARGET's content while the host applies it to
				// the link path. `test -L` exit 1 = not a symlink (good); anything else is fail-safe null.
				const symlinkProbe = await manager.exec(mergeTaskId, ["test", "-L", path]);
				if (symlinkProbe.exitCode !== 1) {
					recordMergeSessionError(
						symlinkProbe.exitCode === 0
							? `conflicted path "${path}" is a symlink in the sandbox — capture would follow the link target`
							: `symlink probe for "${path}" could not run (test exit ${symlinkProbe.exitCode ?? "null"})`,
					);
					return null;
				}
				const content = await manager.exec(mergeTaskId, ["cat", "--", path]);
				if (content.exitCode !== 0) {
					recordMergeSessionError(`could not capture resolved file "${path}": ${content.stderr.trim()}`);
					return null;
				}
				resolvedFiles.push({ path, content: content.stdout });
			}
			return { outcome: "resolved", resolvedFiles };
		} finally {
			await this.sessionRuntime.clearTaskSessions(mergeTaskId).catch(() => undefined);
			await manager.disposeWorkspace(mergeTaskId).catch(() => undefined);
			this.launchConfigByTaskId.delete(mergeTaskId);
			this.providerIdStore.forget(mergeTaskId);
			this.modelEndpoint.forget(mergeTaskId);
			this.contextBudgetInputs.forget(mergeTaskId);
			this.sandboxState.deleteSandbox(mergeTaskId);
		}
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
		const providerId = summary.providerId ?? null;
		const modelId = summary.modelId ?? null;
		const state = this.adaptiveRetryStateByTaskId.get(taskId) ?? { attempt: 0, lastBudget: 1024 };
		if (
			!shouldAttemptAdaptiveBudgetRetry({
				adaptiveRetryEnabled: isTruthyEnv(process.env.NKLEIN_ADAPTIVE_RETRY),
				summaryState: summary.state,
				providerId,
				modelId,
				isHomeAgentSession: isHomeAgentSessionId(taskId),
				attempt: state.attempt,
			})
		) {
			return;
		}
		// The eligibility gate already guarantees provider+model are set; narrow for the async re-send below.
		if (!providerId || !modelId) {
			return;
		}
		void (async () => {
			try {
				// Stall evidence: a model_stalled observation recorded during THIS run (since the session started).
				const since = summary.startedAt ?? 0;
				const events = await readSelfObservationEvents({ taskId, limit: 25 }).catch(() => []);
				const stalled = hasStallEvidence(events, since);
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
		const entry = this.messageRepository.getTaskEntry(taskId);
		const summary = entry?.summary ?? null;
		if (!summary) {
			return;
		}
		// RESURRECTION (run18 live finding — the last stall class): an INTERRUPTED card whose dying-terminal
		// salvage (W0.2) just CAPTURED real work has no path back into the flow — isReviewableNKleinSummary
		// excludes `interrupted`, so the captured work sat unjudged and the run stalled. Rebind it into the
		// reviewable flow: the review + fail-closed gate machinery decides its fate exactly like any handoff.
		if (status === "captured" && summary.state === "interrupted" && entry) {
			this.emitSummary(
				updateSummary(entry, {
					state: "awaiting_review",
					reviewReason: "exit",
					lastOutputAt: now(),
					lastHookAt: now(),
					latestHookActivity: {
						activityText:
							"Interrupted session's captured work rebound into review (salvage → judge, never lost).",
						toolName: null,
						toolInputSummary: null,
						finalMessage: null,
						hookEventName: "interrupted_salvage_rebound",
						notificationType: null,
						source: "nklein",
					},
				}),
			);
		} else if ((status === "empty" || status === "error") && summary.state === "interrupted" && entry) {
			// run21 stall class: an abandoned/interrupted session whose FINAL round captured nothing — but a
			// PRIOR round already delivered a result branch (e.g. delivered → bounced → the re-drive died) —
			// stranded the card in In Progress forever: the rebound above only looks at THIS capture, and the
			// terminal sweep only rescues OTHER waiting cards. If reviewable work exists from any earlier round,
			// rebind to review exactly like the salvage case — the review loop (bounce/escalate/park) owns it.
			const repoPath = this.sandboxState.getRepoPath(taskId) ?? summary.workspacePath ?? null;
			if (repoPath) {
				void resolveTaskResultBranchCommit({ repoPath, taskId })
					.catch(() => null)
					.then((priorResultCommit) => {
						const current = this.messageRepository.getTaskEntry(taskId);
						if (!priorResultCommit || !current || current.summary.state !== "interrupted") {
							return;
						}
						this.emitSummary(
							updateSummary(current, {
								state: "awaiting_review",
								reviewReason: "exit",
								lastOutputAt: now(),
								lastHookAt: now(),
								latestHookActivity: {
									activityText:
										"Interrupted session left no new changes, but a prior round's result branch exists — rebound into review so the existing work gets judged instead of stranding the card.",
									toolName: null,
									toolInputSummary: null,
									finalMessage: null,
									hookEventName: "interrupted_prior_work_rebound",
									notificationType: null,
									source: "nklein",
								},
							}),
						);
					});
			}
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
				// #31 (run32 live): a fast bounce can RE-DRIVE the worker (restore + running) while this
				// fire-and-forget finalize is still capturing. Disposing then rips the workspace out from under
				// the live turn (ENOENT '/workspaces', capture-unavailable, dead round-2 reviews). Dispose only
				// while the card is still parked; a session back in flight owns its workspace, and the NEXT
				// handoff re-finalizes (and disposes) as usual.
				const stateAfterCapture = this.messageRepository.getTaskEntry(taskId)?.summary.state;
				if (stateAfterCapture !== "running" && stateAfterCapture !== "queued") {
					await manager.disposeWorkspace(taskId);
				}
				// Keep the sandbox STATE (repoPath/baseRef): the card is only AWAITING REVIEW — a bounce or
				// escalation re-drive needs it to RESTORE the disposed workspace (run20 #17 / harness v3: with the
				// state forgotten here, the restore helper no-op'd, the re-driven worker's tools had no placement,
				// and the session could never finalize a second round). True terminal cleanup forgets it.
				this.sandboxState.unmarkFinalizing(taskId);
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
					if (hasWorkspace && this.messageRepository.getTaskEntry(taskId)?.summary.state !== "running") {
						await manager.disposeWorkspace(taskId).catch(() => null);
					}
					// Same as the capture path above: keep the sandbox state for a possible re-drive round.
					this.sandboxState.unmarkFinalizing(taskId);
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
		} else if (shouldCaptureReviewCheckpoint(previousSummary, latestSummary)) {
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
