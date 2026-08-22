import { readdirSync } from "node:fs";
import { join } from "node:path";
import { buildEditorPrompt } from "../core/architect-editor-split";
import { foldCapturedWorkProbe } from "../core/captured-work-basis";
import { restrictToolPoliciesForPlanning } from "../core/decompose-tool-policy";
import { restrictToolPoliciesForVerdictSession, VERDICT_ONLY_SESSION_KINDS } from "../core/judge-tool-policy";
import {
	applyModelStatsTrackingLevel,
	DEFAULT_MODEL_STATS_TRACKING_LEVEL,
	type ModelStatsTrackingLevel,
} from "../core/model-stats-tracking-level";
import { MAX_RESTATEMENT_RESTARTS } from "../core/off-track-intervention";
import { getOffTrackRestartCount, recordOffTrackRestart } from "../core/off-track-restart-ledger";
import { createPendingWriteTracker } from "../core/pending-write-tracker";
import { parsePromptIntentMode } from "../core/prompt-intent-mode";
import {
	buildSessionForkPlan,
	latestStepBoundaryIndex,
	type SessionForkBoundary,
	type SessionForkRefusal,
} from "../core/session-fork";
import { isTerminalFailureSessionState } from "../core/session-state-predicates";
import { isDerivedTaskSessionId } from "../core/synthetic-task-id";
import { applyJudgeSessionPromptDiet, JUDGE_SESSION_KINDS } from "../core/sysprompt-level";
import {
	isCommunitySkillToolAllowed,
	restrictCommunitySkillExtraTools,
	restrictCommunitySkillToolExecutors,
	restrictCommunitySkillToolPolicies,
} from "./community-skill-tool-admission";
import { createArchitectRunner } from "./nklein-architect-runner";

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
import { type AgentLedgerEvent, buildRetryStrategyEvent, buildTransitionEvent } from "../core/agent-attempt-ledger";
import {
	buildAttemptRetryNoteFromLedger,
	buildModelBehaviorProfilesFromLedger,
	buildStrategyEffectivenessLedgersFromLedger,
} from "../core/agent-ledger-projections";
import type { McpAccess, SandboxNetworkPolicy } from "../core/agent-rulesets";
import type {
	RuntimeNKleinTeamProgressEvent,
	RuntimeSwarmGuardrails,
	RuntimeTaskAcceptanceResult,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionReviewReason,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS, normalizeRuntimeSwarmGuardrails } from "../core/api-contract";
import { derivePromptSessionKind, type PromptWarmthLedgerEntry } from "../core/cache-warmth";
import { ATTEMPT_STARTED_CATEGORY } from "../core/card-tracking-coverage";
import {
	type DecompositionResearchPreflightInput,
	type DecompositionResearchPreflightResult,
	runDecompositionResearchPreflight,
} from "../core/decomposition-research-preflight";
import { isEnabledByDefaultEnv, isTruthyEnv } from "../core/env-flag";
import { currentFocusChainStep, type FocusChain } from "../core/focus-chain";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { fetchLoadedModelDescriptors } from "../core/lmstudio-loaded-model-descriptors";
import { resolveDefaultLocalModelBaseUrl } from "../core/local-model-endpoint";
import {
	emptyModelBehaviorProfile,
	type ModelBehaviorProfile,
	type ModelOutcomeKind,
} from "../core/model-behavior-profile";
import { assessPredictedExecution } from "../core/predicted-execution-check";
import type { PromptFragment } from "../core/prompt-fragment-assembly";
import type { SandboxMcpServerControls } from "../core/sandbox-mcp-controls";
import {
	emptyStrategyEffectivenessLedger,
	type StrategyAttemptObservation,
	type StrategyEffectivenessLedger,
} from "../core/strategy-effectiveness-ledger";
import { didCreditLimitJustTrigger, shouldCaptureReviewCheckpoint } from "../core/task-session-guards";
import { decideTemporalContextInjection } from "../core/temporal-context-injection";
import { resolveHomeAgentAppendSystemPrompt } from "../prompts/append-system-prompt";
import type { CommunitySkillSessionAdmission } from "../server/community-skill-execution-service";
import { appendAgentLedgerEvent, readAgentLedger, readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { resolveStableRoutingModelId } from "../state/runtime-id-model-key-map-store";
import { recordTaskRunSummary, type TaskRunTerminalState } from "../state/task-run-summary-store";
import { loadWorkspaceState } from "../state/workspace-state";
import { summarizeAttemptKnowledgeUsage } from "../telemetry/attempt-knowledge-usage";
import { recordSelfObservation, type SelfObservationEventInput } from "../telemetry/self-observation-sink";
import { probeTaskResultBranchCommit, resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { captureTaskTurnCheckpoint, deleteTaskTurnCheckpointRef } from "../workspace/turn-checkpoints";
import type { AutonomyBudgetWatchdogCallbacks } from "./autonomy-budget-watchdog";
import { AutonomyBudgetWatchdog } from "./autonomy-budget-watchdog";
import type { DecompositionStallNudgerCallbacks } from "./decomposition-stall-nudger";
import {
	DecompositionStallNudger,
	isChatOnlyDecompositionActivity,
	isDecompositionProgressTool,
} from "./decomposition-stall-nudger";
import { forgetAcceptanceEvidence } from "./nklein-acceptance-evidence-registry.js";
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
import { forgetBaselineProbe } from "./nklein-baseline-probe-registry";
import { createContextBudgetController } from "./nklein-context-budget-controller";
import { buildContextBudgetBreakdown, estimateKanbanToolSchemaTokens } from "./nklein-context-budget-tokens";
import { createContextOverflowController } from "./nklein-context-overflow-controller";
import type { NKleinDecompositionAppliedHandler } from "./nklein-decomposition-tool";
import { applyNKleinSessionEvent } from "./nklein-event-adapter";
import { resolveExplorerLaunchConfig } from "./nklein-explorer-model-selection";
import { createExplorerRunner } from "./nklein-explorer-runner";
import { computeNKleinFailureBackoff } from "./nklein-failure-backoff";
import { createFocusChainStore } from "./nklein-focus-chain-store";
import { extractFocusChainTouchDeltaFromSdkEvent } from "./nklein-focus-chain-touch-delta";
import { readWorkspaceFrameworkPreamble } from "./nklein-framework-preamble-reader";
import { buildKanbanEfficiencyRules } from "./nklein-kanban-efficiency-rules";
import {
	type NKleinTaskLaunchConfigOverrides,
	type NKleinTaskRestartLaunchConfig,
	normalizeLaunchConfig,
} from "./nklein-launch-config";
import {
	buildTerminalAttemptEvent,
	hashWorkspacePathForLedger,
	isZombieTerminalAttempt,
	resolveAttemptToolCallDelta,
	resolveTaskKnowledgeDebtPresent,
} from "./nklein-ledger-attempt";
import { extractTerminalToolCalls } from "./nklein-ledger-tool-calls";
import { forgetLiveTaskUsage, getLiveTaskUsage, sumLiveUsageTokens } from "./nklein-live-usage-registry";
import { LocalLlmClient } from "./nklein-local-llm-client";
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
import { createModelFailoverController } from "./nklein-model-failover-controller";
import { buildNKleinModelRegistryKey, buildSharedLocalEndpointId } from "./nklein-model-registry";
import { createModelResidencyWatcher } from "./nklein-model-residency-watcher";
import { createParkController } from "./nklein-park-controller";
import { NKleinPauseController } from "./nklein-pause-controller";
import { createPlanCritiqueRunner } from "./nklein-plan-critique-runner";
import type { NKleinPlanCritiqueResult } from "./nklein-plan-critique-tool";
import { forgetPredictedOutput, getPredictedOutput } from "./nklein-predict-output-tool";
import type { NKleinCardPromotedHandler } from "./nklein-promotion-tool";
import { type AssembleSessionSystemPromptInput, createPromptWarmthLedger } from "./nklein-prompt-warmth-ledger";
import { createPropertyBindingModelCaller } from "./nklein-property-binding-model-caller";
import { forgetPropertyCheckEvidence } from "./nklein-property-evidence-registry";
import { forgetCompactionRequest, getCompactionRequest } from "./nklein-request-compaction-tool";
import { createRetrievalToolsBuilder, type RetrievalToolsBuilder } from "./nklein-retrieval-tools-builder";
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
import { buildSessionSkillContext } from "./nklein-session-skill-fragments";
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
import { readSpecDeliberationCompletionText, runSpecDeliberation } from "./nklein-spec-deliberation-runner";
import { createSpeculativeMirrorRunner } from "./nklein-speculative-mirror-runner";
import { TaskContextBudgetInputs } from "./nklein-task-context-budget-inputs";
import { TaskFailureBackoffTracker } from "./nklein-task-failure-backoff-tracker";
import { createTaskFailureEmitter } from "./nklein-task-failure-emitter";
import { TaskModelEndpointStore, UNCONFIGURED_MODEL_ID } from "./nklein-task-model-endpoint-store";
import { TaskPendingTimeoutStore } from "./nklein-task-pending-timeout-store";
import { appendSystemPrompt, buildNKleinStartPromptParts } from "./nklein-task-prompt-builders";
import { buildSessionCardContract } from "./nklein-task-prompt-parsing";
import { TaskProviderIdStore } from "./nklein-task-provider-id-store";
import { TaskRequestTimer } from "./nklein-task-request-timer";
import { TaskSandboxStateStore } from "./nklein-task-sandbox-state";
import { formatStartWarnings, resolveNKleinTaskRole, toErrorMessage } from "./nklein-task-session-helpers";
import { estimateNKleinStartDifficulty, estimateNKleinStartPromptTokens } from "./nklein-task-start-guard";
import type { NKleinTaskTimeoutKind } from "./nklein-task-timeout-handles";
import { createTeamProgressEmitter } from "./nklein-team-progress-emitter";
import { createTimeoutController } from "./nklein-timeout-controller";
import { computeNKleinToolInputFingerprint } from "./nklein-tool-call-fingerprint";
import { type SandboxVisualDeliveryResult, verifyCurrentBuildVisualInSandbox } from "./nklein-visual-delivery-verifier";
import { createNKleinWatcherRegistry, type NKleinWatcherRegistry } from "./nklein-watcher-registry";
import { maybeDistillAndStoreProcedure } from "./procedural-skill-producer";
import type { RepeatedToolCallGuardCallbacks } from "./repeated-tool-call-guard";
import { RepeatedToolCallGuard } from "./repeated-tool-call-guard";
import type { AgentTool } from "./sdk-agent-types";
import {
	listNKleinSdkWorkflowSlashCommands,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSlashCommand,
	resolveNKleinSdkSystemPromptParts,
} from "./sdk-runtime-boundary.js";
import { deriveTaskDifficultyTier } from "./task-fitness-recording";
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
const FRESH_MODEL_CARRY_CONTEXT_CHARS = 16_000;

function buildFreshModelCarryPrompt(basePrompt: string, messages: readonly NKleinTaskMessage[]): string {
	const originatingTask = messages.find(
		(message) => message.role === "user" && message.content.trim().length > 0,
	)?.content;
	const latestToolResult = [...messages]
		.reverse()
		.find((message) => message.role === "tool" && message.content.trim().length > 0)?.content;
	const sections = [basePrompt];
	if (originatingTask) {
		sections.push(`[Authoritative originating task]\n${originatingTask.slice(0, FRESH_MODEL_CARRY_CONTEXT_CHARS)}`);
	}
	if (latestToolResult) {
		sections.push(`[Latest terminal tool evidence]\n${latestToolResult.slice(-FRESH_MODEL_CARRY_CONTEXT_CHARS)}`);
	}
	return sections.join("\n\n");
}

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

/**
 * F4.37 second half: pick the tool-policy map for a session — planning seeds get the plan restriction (§5.B),
 * VERDICT-ONLY sessions (review / plan-critique, per derivePromptSessionKind) get the judge narrowing (the live
 * 2026-07-18 tee capture measured a 32.2KB serialized tools block burying submit_review among 25 worker schemas —
 * the reason dieted judges still ended turns with no tool call). Merge sessions keep editing tools. Same env
 * opt-out as the prompt diet (NKLEIN_JUDGE_PROMPT_DIET=0) so the diet is ONE lever.
 */
function resolveSessionToolPolicies<TValue extends { enabled?: boolean; autoApprove?: boolean }>(args: {
	taskId: string;
	isExplicitDecomposition: boolean;
	basePolicies: Readonly<Record<string, TValue>>;
}): Record<string, TValue> {
	if (args.isExplicitDecomposition) {
		return restrictToolPoliciesForPlanning(args.basePolicies);
	}
	const kind = derivePromptSessionKind(args.taskId, { isExplicitDecomposition: false });
	if (VERDICT_ONLY_SESSION_KINDS.has(kind) && isEnabledByDefaultEnv(process.env.NKLEIN_JUDGE_PROMPT_DIET)) {
		return restrictToolPoliciesForVerdictSession(args.basePolicies);
	}
	return { ...args.basePolicies };
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
	/** F4.26: host-verified activation grants retained only for this live task/restart lifecycle. */
	private readonly communitySkillAdmissionByTaskId = new Map<string, CommunitySkillSessionAdmission>();
	private readonly communitySkillSuggestionFragmentByTaskId = new Map<string, PromptFragment>();
	/** F12.29: procedural-skill ids surfaced into each task's session prompt (from `procedural-skill:` fragment keys). */
	private readonly surfacedSkillIdsByTaskId = new Map<string, string[]>();
	// F1.14: the recovery-rung label for the task's NEXT terminal attempt event (promptStrategy) — stamped by the
	// runtime's re-drive/steer rungs via noteNextAttemptStrategy, consumed (and cleared) at the terminal write.
	private readonly nextAttemptStrategyByTaskId = new Map<string, string>();
	private readonly recordedClarificationAskKeys = new Set<string>();
	private clarificationWriteTail: Promise<void> = Promise.resolve();
	private readonly onClarificationAsked: CreateInMemoryNKleinTaskSessionServiceOptions["onClarificationAsked"];
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
		getTaskRunSummaryRoot: () => this.taskRunSummaryRoot,
		releaseSandboxMcpResources: (taskId) => this.sessionRuntime.releaseTaskMcpTools(taskId),
	});
	/** §5.U auxiliary secondary-session runner: acceptance verification against the delivered tree in a sandbox. */
	private readonly acceptanceVerifier = createAcceptanceVerifier({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getPauseController: () => this.pauseController,
		getPropertyBindingModelCaller: async (taskId) => {
			const launch = this.launchConfigByTaskId.get(taskId);
			const baseUrl = launch?.baseUrl?.trim() || this.modelEndpoint.getEndpoint(taskId);
			if (!launch || !baseUrl || !launch.modelId.trim()) return null;
			// Prefer a lineage-diverse loaded model: deterministic extraction owns the oracle, while an independent
			// fresh context performs the implementation-specific binding. Fall back to a fresh worker-model context only
			// when the fleet has no eligible alternative; that is still translation, never invariant invention.
			const selected = await pickDiverseReviewerModel(launch, `${taskId}::property-binder`, "review", {
				lastShellKeyByModel: this.promptWarmthLedger.shellKeyByModelId,
			}).catch(() => null);
			return createPropertyBindingModelCaller(
				new LocalLlmClient({
					providerId: selected?.providerId ?? launch.providerId,
					modelId: selected?.modelId ?? launch.modelId,
					baseUrl,
					apiKey: launch.apiKey,
					...(launch.apiTimeoutMs ? { timeoutMs: launch.apiTimeoutMs } : {}),
				}),
			);
		},
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
		abortRuntimeSession: (taskId) => this.sessionRuntime.abortTaskSession(taskId),
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
		sendTaskSessionInput: (taskId, prompt, admissionParentTaskId) =>
			this.sendAuxiliaryTaskSessionInput(taskId, prompt, admissionParentTaskId),
		stopRuntimeSession: (taskId) => this.sessionRuntime.stopTaskSession(taskId, { suppressTaskEvents: true }),
		defaultTimeoutMs: DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS,
		maxNudges: MAX_SECOND_OPINION_REVIEW_NUDGES,
	});
	/** §5.U auxiliary secondary-session runner: the W4.3 pre-application plan-critique session. */
	private readonly planCritiqueRunner = createPlanCritiqueRunner({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId) ?? null,
		getShellKeyByModelId: () => this.promptWarmthLedger.shellKeyByModelId,
		getPauseController: () => this.pauseController,
		getHarness: () => this.secondarySessionHarness,
		pickEscalationModel: (taskId) => this.pickDiverseEscalationModel(taskId),
		getBaseRef: (taskId) => this.sandboxState.getBaseRef(taskId) ?? null,
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		sendTaskSessionInput: (taskId, prompt, admissionParentTaskId) =>
			this.sendAuxiliaryTaskSessionInput(taskId, prompt, admissionParentTaskId),
		defaultTimeoutMs: DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS,
		maxNudges: MAX_SECOND_OPINION_REVIEW_NUDGES,
	});
	/** F11.2j auxiliary secondary-session runner: the bounded read-only `::explore` subagent (per-run query budget). */
	private readonly explorerRunner = createExplorerRunner({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId) ?? null,
		resolveExplorerLaunchConfig: (workerLaunch) => resolveExplorerLaunchConfig(workerLaunch),
		getPauseController: () => this.pauseController,
		getHarness: () => this.secondarySessionHarness,
		getBaseRef: (taskId) => this.sandboxState.getBaseRef(taskId) ?? null,
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		sendTaskSessionInput: (taskId, prompt, admissionParentTaskId) =>
			this.sendAuxiliaryTaskSessionInput(taskId, prompt, admissionParentTaskId),
		defaultTimeoutMs: DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS,
		maxNudges: MAX_SECOND_OPINION_REVIEW_NUDGES,
		runBudget: 6,
	});
	/** F12.62 (opt-in NKLEIN_ARCHITECT_EDITOR): the bounded `::architect` pre-phase for write-scoped worker cards. */
	private readonly architectRunner = createArchitectRunner({
		getAgentSandboxManager: () => this.agentSandboxManager,
		getLaunchConfig: (taskId) => this.launchConfigByTaskId.get(taskId) ?? null,
		getPauseController: () => this.pauseController,
		getHarness: () => this.secondarySessionHarness,
		startRuntimeSession: (input) => this.startAuxiliaryRuntimeTaskSessionFromLaunchConfig(input),
		sendTaskSessionInput: (taskId, prompt) => this.sendAuxiliaryTaskSessionInput(taskId, prompt),
		defaultTimeoutMs: DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS,
		maxNudges: MAX_SECOND_OPINION_REVIEW_NUDGES,
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
	/** F3.2 failover leg: on an error-terminal summary, re-drive the card on the next untried ranked model (default-on;
	 * kill-switch NKLEIN_MODEL_FAILOVER=off). Candidates are stashed at start via {@link setTaskFailoverCandidates}. */
	private readonly modelFailoverController = createModelFailoverController({
		resendTaskInput: (taskId, text, mode, images, launchConfigOverrides, options) =>
			this.sendTaskSessionInput(taskId, text, mode, images, launchConfigOverrides, options),
		noteStrategyApplied: (taskId, strategy) => this.noteNextAttemptStrategy(taskId, strategy),
		resetDecompositionRecoveryBudget: (taskId) => {
			this.decompositionStallNudger.resetTask(taskId);
			this.repeatedToolCallGuard.resetDecompositionFailures(taskId);
		},
		resetPlanCritiqueBudget: (taskId) => this.planCritiqueRunner.resetTask(taskId),
	});

	/** Stash the router's ranked candidate model keys for a task (fitness-blended order) for F3.2 failover. */
	setTaskFailoverCandidates(taskId: string, rankedModelKeys: readonly string[]): void {
		this.modelFailoverController.setCandidates(taskId, rankedModelKeys);
	}
	/** §5.U: the context-overflow recovery pair (reactive retry-after + proactive compact-before). Session-lifecycle
	 * accessors are supplied lazily so field-init order is irrelevant. */
	private readonly contextOverflowController = createContextOverflowController({
		recordObservationWithModel: (event) => this.recordObservationWithModel(event),
		readPersistedTaskSession: (taskId) => this.sessionRuntime.readPersistedTaskSession(taskId),
		resolvePersistedLaunchConfig: (input) => this.resolvePersistedLaunchConfig(input),
		stopTaskSession: (taskId) => this.sessionRuntime.stopTaskSession(taskId, { suppressTaskEvents: true }),
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
	private readonly retrievalToolsBuilder: RetrievalToolsBuilder;
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
	/** P0.DSTALL layer 1: which plan-mode tasks actually APPLIED a decomposition — the terminal recorder
	 *  writes the "decomposition starved" brief only when a decompose session ends without one. */
	private readonly decompositionAppliedTaskIds = new Set<string>();
	private wrapDecompositionApplied(
		handler: NKleinDecompositionAppliedHandler | undefined,
	): NKleinDecompositionAppliedHandler | undefined {
		return (event) => {
			if (event.sourceTaskId) {
				this.decompositionAppliedTaskIds.add(event.sourceTaskId);
			}
			handler?.(event);
		};
	}
	private readonly runDecompositionResearchPreflight: (
		input: DecompositionResearchPreflightInput,
	) => Promise<DecompositionResearchPreflightResult>;
	private readonly onCardPromoted: NKleinCardPromotedHandler | undefined;
	private readonly onFocusChainUpdated: ((taskId: string, chain: FocusChain) => void | Promise<void>) | undefined;
	/** F1.5 — loads the card's persisted focus chain so the live store rehydrates on session start/rebind. */
	private readonly loadPersistedFocusChain:
		| ((taskId: string) => Promise<{ chain: FocusChain; source: "persisted" | "seeded" } | null>)
		| undefined;
	private swarmGuardrails: RuntimeSwarmGuardrails;
	/** §5.AC "knows today" runtime-config switch (off by default); live-updated with config, OR-ed with the env override. */
	private knowsTodayEnabled: boolean;
	/** §5.AR curated sandbox-MCP switch (on by default); live-updated with config, OR-ed with the env override. */
	private sandboxMcpServersEnabled: boolean;
	/** F4.28 concrete project→global per-server controls; only this resolved map reaches bundle creation. */
	private sandboxMcpServerControls: SandboxMcpServerControls;
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
	/**
	 * Per-store subdirs of `diagnosticStoreRoot`, mirroring the distinct production defaults
	 * (`~/.nklein/nklein/agent-attempt-ledger` vs `.../task-runs`). Both stores key files by the same
	 * workspace-path hash, so a shared FLAT root interleaved task-run summaries and ledger events in one
	 * `<hash>.jsonl` — and every reader then "skipping schema-invalid record"-dropped the other store's rows.
	 */
	private readonly agentLedgerRoot: string | undefined;
	private readonly taskRunSummaryRoot: string | undefined;
	/** Latest focus chain each task emitted (todo §5.N), captured into the terminal run summary. */
	private readonly focusChainStore = createFocusChainStore({
		now,
		onUpdated: (taskId, chain) => this.onFocusChainUpdated?.(taskId, chain),
		// F1.5 repair guard: a rejected destructive re-emit is surfaced, never silently swallowed.
		onRepaired: (taskId, reason) => {
			recordSelfObservation({
				signal: "custom",
				severity: "warning",
				message: `Focus-chain repair for ${taskId}: ${reason}`,
				taskId,
				metadata: { category: "focus_chain_repair" },
			});
		},
		// F1.5 transition history: every accepted step-status change lands durably in the attempt ledger (one
		// `transition` event per step change, reason "focus_step"), so step history survives beyond the snapshot.
		onTransitions: (taskId, transitions) => {
			const entry = this.messageRepository.getTaskEntry(taskId);
			for (const transition of transitions) {
				// N13 dispose-flush contract: tracked so dispose() can await stragglers instead of racing teardown.
				this.pendingLedgerWrites.track(
					appendAgentLedgerEvent(
						buildTransitionEvent({
							workflowId: taskId,
							taskId,
							workspacePathHash: hashWorkspacePathForLedger(
								this.resolveHostWorkspacePathForTask(taskId, entry?.summary.workspacePath ?? null),
							),
							role: null,
							from: transition.from ? `focus:${transition.from}` : null,
							to: `focus:${transition.to}`,
							reason: `focus_step: ${transition.stepText}`,
						}),
						{ rootDir: this.agentLedgerRoot },
					),
				);
			}
		},
	});
	/** N13: fire-and-forget durable writes tracked so dispose() flushes them (the ENOTEMPTY teardown race). */
	private readonly pendingLedgerWrites = createPendingWriteTracker();
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
		this.diagnosticStoreRoot = options.diagnosticStoreRoot;
		this.agentLedgerRoot = options.diagnosticStoreRoot
			? join(options.diagnosticStoreRoot, "agent-attempt-ledger")
			: undefined;
		this.taskRunSummaryRoot = options.diagnosticStoreRoot
			? join(options.diagnosticStoreRoot, "task-runs")
			: undefined;
		this.onDecompositionApplied = options.onDecompositionApplied;
		this.onCardPromoted = options.onCardPromoted;
		this.onFocusChainUpdated = options.onFocusChainUpdated;
		this.loadPersistedFocusChain = options.loadPersistedFocusChain;
		this.onClarificationAsked = options.onClarificationAsked;
		this.swarmGuardrails = options.swarmGuardrails ?? DEFAULT_RUNTIME_SWARM_GUARDRAILS;
		this.knowsTodayEnabled = options.knowsTodayEnabled ?? DEFAULT_KNOWS_TODAY_ENABLED;
		this.sandboxMcpServersEnabled = options.sandboxMcpServersEnabled ?? DEFAULT_SANDBOX_MCP_SERVERS_ENABLED;
		this.basicMemoryEnabled = options.basicMemoryEnabled ?? DEFAULT_BASIC_MEMORY_ENABLED;
		this.sandboxMcpServerControls = options.sandboxMcpServerControls ?? {
			"sequential-thinking": true,
			"codebase-memory": true,
			"lsp-symbols": true,
			"basic-memory": this.basicMemoryEnabled,
		};
		this.retrievalEgressEnabled = options.retrievalEgressEnabled ?? DEFAULT_RETRIEVAL_EGRESS_ENABLED;
		this.modelStatsTrackingLevel = options.modelStatsTrackingLevel ?? DEFAULT_MODEL_STATS_TRACKING_LEVEL;
		this.retrievalSearchBackendUrl = options.retrievalSearchBackendUrl ?? DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL;
		this.agentWebResearchAllowed = options.agentWebResearchAllowed ?? true;
		this.retrievalToolsBuilder = createRetrievalToolsBuilder({
			getRetrievalConfig: () => ({
				egressEnabled: this.retrievalEgressEnabled,
				agentWebResearchAllowed: this.agentWebResearchAllowed,
				searchBackendUrl: this.retrievalSearchBackendUrl,
			}),
			resolveProviderId: (taskId) => this.resolveProviderIdForTask(taskId),
			getModelId: (taskId) => this.modelEndpoint.getModelId(taskId),
			getEndpoint: (taskId) => this.modelEndpoint.getEndpoint(taskId),
			...(options.withSearchBackend ? { withSearchBackend: options.withSearchBackend } : {}),
		});
		this.agentMcpAccess = options.agentMcpAccess ?? "on";
		this.modelTurnAdmissionGate = options.modelTurnAdmissionGate ?? null;
		this.runDecompositionResearchPreflight =
			options.runDecompositionResearchPreflight ??
			((input) =>
				runDecompositionResearchPreflight(input, {
					now: () => new Date(),
					readLedger: (workspacePathHash) => readAgentLedger({ workspacePathHash, rootDir: this.agentLedgerRoot }),
					appendLedger: (event) => appendAgentLedgerEvent(event, { rootDir: this.agentLedgerRoot }),
					runResearch: (taskId, question) =>
						this.retrievalToolsBuilder.run(taskId, { question, synthesize: false }),
				}));
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
			getCapabilityBrokerHardDenial: (taskId) => this.sessionRuntime.getSessionCapabilityBrokerHardDenial(taskId),
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
			// F12.40 (record-only): live cumulative spend from the registry the context-focus extension stamps.
			getLiveUsageSignals: (taskId) => {
				const live = getLiveTaskUsage(taskId);
				return live
					? { cardTokens: live.inputTokens + live.outputTokens, boardTokens: sumLiveUsageTokens() }
					: null;
			},
			onRunawayBudgetSignal: ({ taskId, entry, verdict, signals }) => {
				recordSelfObservation({
					signal: "budget_wall",
					severity: "warning",
					message: `Runaway-budget breaker (record-only): ${verdict.reason}`,
					taskId,
					workspacePath: entry.summary.workspacePath,
					metadata: {
						category: "runaway_budget",
						tripped: verdict.tripped,
						cardTokens: signals.cardTokens,
						cardTurns: signals.cardTurns,
						boardTokens: signals.boardTokens,
						// Honest basis label: run-cumulative SDK usage (context re-reads count), live runs only.
						basis: "live_run_cumulative_sdk_usage",
					},
				});
			},
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

	/**
	 * Resolve the trusted host workspace identity for control-plane persistence.
	 *
	 * `summary.workspacePath` deliberately becomes the agent-perceived sandbox cwd (`/workspaces/<taskId>`) while an
	 * isolated turn runs. Hashing that presentation/execution path fragments one workspace's ledger from every host-side
	 * reader (reviews, workflow scope, retries). The launch contract is authoritative; the prepared sandbox's repo path
	 * is the same-host fallback for legacy launches that did not persist `workspaceRoot`.
	 */
	private resolveHostWorkspacePathForTask(taskId: string, fallback: string | null): string | null {
		return (
			this.launchConfigByTaskId.get(taskId)?.workspaceRoot?.trim() ||
			this.sandboxState.getRepoPath(taskId)?.trim() ||
			fallback?.trim() ||
			null
		);
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

	/**
	 * §dsh#32 — fork a session's CONTEXT at a safe step boundary into a NEW task session (the DeepSeek Harness
	 * `sessions.fork` take): the fork starts from the source's persisted transcript prefix + `prompt` as its
	 * continuation instruction, on the source's own launch config. The pure boundary rule (core/session-fork)
	 * refuses to cut a dangling tool_use. The SOURCE session is left untouched — cheap best-of-N and
	 * checkpoint-retry both build on exactly this.
	 */
	async previewSessionForkBoundary(
		taskId: string,
	): Promise<{ messageCount: number; boundaryIndex: number | null } | null> {
		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(taskId).catch(() => null);
		if (!persistedSnapshot?.messages) {
			return null;
		}
		return {
			messageCount: persistedSnapshot.messages.length,
			boundaryIndex: latestStepBoundaryIndex(persistedSnapshot.messages),
		};
	}

	async forkTaskSessionAtBoundary(input: {
		sourceTaskId: string;
		forkTaskId: string;
		/** The fork's continuation instruction (e.g. "try a different approach for step 3"). */
		prompt: string;
		boundary?: SessionForkBoundary;
		mode?: RuntimeTaskSessionMode;
	}): Promise<{ refusal: SessionForkRefusal } | { started: RuntimeTaskSessionStartResult; boundaryIndex: number }> {
		const persistedSnapshot = await this.sessionRuntime
			.readPersistedTaskSession(input.sourceTaskId)
			.catch(() => null);
		if (!persistedSnapshot?.messages?.length) {
			return { refusal: { kind: "empty_source" } };
		}
		const planned = buildSessionForkPlan({
			sourceTaskId: input.sourceTaskId,
			forkTaskId: input.forkTaskId,
			messages: persistedSnapshot.messages,
			boundary: input.boundary ?? "latest",
			forkedAt: new Date().toISOString(),
		});
		if ("refusal" in planned) {
			return { refusal: planned.refusal };
		}
		const launchConfig = this.resolveRestartLaunchConfig({
			taskId: input.sourceTaskId,
			persistedSnapshot,
		});
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Session ${input.sourceTaskId} forked at message ${planned.plan.provenance.boundaryIndex} into ${input.forkTaskId}.`,
				taskId: input.forkTaskId,
				metadata: {
					category: "session_forked",
					sourceTaskId: input.sourceTaskId,
					boundaryIndex: planned.plan.provenance.boundaryIndex,
				},
			});
		} catch {
			// Observability must never break a fork.
		}
		const started = await this.restartTaskSessionFromResolvedConfig({
			taskId: input.forkTaskId,
			prompt: input.prompt,
			...(input.mode ? { mode: input.mode } : {}),
			initialMessages: planned.plan.initialMessages,
			launchConfig,
			persistedSnapshot,
			fallbackCwd: persistedSnapshot.record?.cwd ?? null,
		});
		return { started, boundaryIndex: planned.plan.provenance.boundaryIndex };
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
		const sessionKind = derivePromptSessionKind(args.taskId, {
			isExplicitDecomposition: this.explicitDecompositionTaskIds.has(args.taskId),
		});
		// F4.37 first consumer (evidence-backed 2026-07-18): judgment sessions get the MINIMAL judge shell — the
		// full ~19.8KB worker prompt made small/medium reviewers exhaust their budget and return NO submission
		// (finish=length, empty content) on every review; lean shell ⇒ clean submit_review. Opt out with
		// NKLEIN_JUDGE_PROMPT_DIET=0.
		const dieted =
			JUDGE_SESSION_KINDS.has(sessionKind) && isEnabledByDefaultEnv(process.env.NKLEIN_JUDGE_PROMPT_DIET)
				? applyJudgeSessionPromptDiet({
						basePrompt: args.basePrompt,
						baseIsStaticShell: args.baseIsStaticShell,
						efficiencyRules: args.efficiencyRules,
						planningPrompt: args.planningPrompt ?? null,
						attemptRetryNote: args.attemptRetryNote ?? null,
						skillFragments: args.skillFragments ?? [],
					})
				: null;
		return {
			taskId: args.taskId,
			modelId: args.modelId,
			sessionKind,
			workspacePath: args.workspacePath,
			basePrompt: dieted?.basePrompt ?? args.basePrompt,
			baseIsStaticShell: dieted?.baseIsStaticShell ?? args.baseIsStaticShell,
			homeAgentAppend: resolveHomeAgentAppendSystemPrompt(args.taskId),
			sessionEnv: args.sessionEnv,
			planningPrompt: dieted ? dieted.planningPrompt : (args.planningPrompt ?? null),
			attemptRetryNote: dieted ? dieted.attemptRetryNote : (args.attemptRetryNote ?? null),
			efficiencyRules: dieted?.efficiencyRules ?? args.efficiencyRules,
			temporalBlock: decideTemporalContextInjection({
				enabled: this.knowsTodayEnabled || isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY),
				text: args.prompt,
				now: new Date(),
			}).block,
			skillFragments: (dieted ? dieted.skillFragments : (args.skillFragments ?? [])) as readonly PromptFragment[],
			// F4.39: configured intent mode (unset/unknown ⇒ max_task_info = byte-identical assembly).
			intentMode: parsePromptIntentMode(process.env.NKLEIN_PROMPT_INTENT),
		};
	}

	private async buildAttemptRetryContext(
		taskId: string,
		providerId: string,
		modelId: string,
		endpoint: string | null,
		taskKind: string,
	): Promise<{
		note: string | null;
		profile: ModelBehaviorProfile;
		strategyLedger: StrategyEffectivenessLedger;
	}> {
		const ledgerModelId = this.resolveLedgerModelId(providerId, modelId, endpoint);
		const empty = () => ({
			note: null,
			profile: emptyModelBehaviorProfile(ledgerModelId, 0),
			strategyLedger: emptyStrategyEffectivenessLedger(ledgerModelId, 0, taskKind),
		});
		if (this.agentLedgerRoot) {
			try {
				if (!readdirSync(this.agentLedgerRoot).some((file) => file.endsWith(".jsonl"))) {
					return empty();
				}
			} catch {
				return empty();
			}
		}
		const events = await readAllAgentLedger({ rootDir: this.agentLedgerRoot }).catch(() => []);
		const note = buildAttemptRetryNoteFromLedger(events, { workflowId: taskId }).trim();
		const profile =
			buildModelBehaviorProfilesFromLedger(events).find((candidate) => candidate.modelId === ledgerModelId) ??
			emptyModelBehaviorProfile(ledgerModelId, 0);
		const strategyLedger =
			buildStrategyEffectivenessLedgersFromLedger(events).find(
				(candidate) => candidate.modelId === ledgerModelId && candidate.taskKind === taskKind,
			) ?? emptyStrategyEffectivenessLedger(ledgerModelId, 0, taskKind);
		return { note: note.length > 0 ? note : null, profile, strategyLedger };
	}

	private resolveLedgerModelId(providerId: string, modelId: string, endpoint: string | null): string {
		const stableModelId = isEnabledByDefaultEnv(process.env.NKLEIN_STABLE_ROUTING_KEY)
			? resolveStableRoutingModelId(modelId)
			: modelId;
		return buildNKleinModelRegistryKey({ providerId, modelId: stableModelId, endpoint: endpoint ?? "" });
	}

	private recordRetryStrategyOutcome(input: {
		taskId: string;
		workspacePath: string | null;
		providerId: string;
		modelId: string;
		endpoint: string | null;
		role: string;
		observation: StrategyAttemptObservation & { strategyLabel: string | null; resultOutcome: ModelOutcomeKind };
	}): void {
		try {
			// N13 dispose-flush contract: tracked so dispose() can await stragglers instead of racing teardown.
			this.pendingLedgerWrites.track(
				appendAgentLedgerEvent(
					buildRetryStrategyEvent({
						workflowId: input.taskId,
						taskId: input.taskId,
						workspacePathHash: hashWorkspacePathForLedger(input.workspacePath),
						role: input.role,
						modelId: this.resolveLedgerModelId(input.providerId, input.modelId, input.endpoint),
						triggerOutcome: input.observation.outcome,
						strategy: input.observation.strategy,
						strategyLabel: input.observation.strategyLabel,
						resultOutcome: input.observation.resultOutcome,
						durationMs: input.observation.durationMs,
						totalTokens: input.observation.totalTokens,
					}),
					{ rootDir: this.agentLedgerRoot },
				),
			);
		} catch {
			// Observational durability must never alter the model turn.
		}
	}

	private async withModelTurnAdmission<T>(
		input: {
			taskId: string;
			admissionParentTaskId?: string | null;
			providerId: string | null | undefined;
			modelId: string | null | undefined;
			endpoint: string | null | undefined;
			freshSessionStart?: boolean;
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
				admissionParentTaskId: input.admissionParentTaskId ?? null,
				providerId,
				modelId,
				endpoint: input.endpoint?.trim() || null,
				...(input.freshSessionStart ? { freshSessionStart: true } : {}),
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
		admissionParentTaskId?: string | null,
	): Promise<T> {
		const launchConfig = this.resolveRestartLaunchConfig({ taskId, launchConfigOverrides });
		return await this.withModelTurnAdmission(
			{
				taskId,
				admissionParentTaskId,
				providerId: launchConfig?.providerId,
				modelId: launchConfig?.modelId,
				endpoint: launchConfig?.baseUrl ?? null,
			},
			run ?? (async () => undefined as T),
		);
	}

	private async sendAuxiliaryTaskSessionInput(
		taskId: string,
		prompt: string,
		admissionParentTaskId?: string | null,
	): Promise<unknown> {
		return await this.withModelTurnAdmissionForTask(
			taskId,
			undefined,
			() => this.sessionRuntime.sendTaskSessionInput(taskId, prompt),
			admissionParentTaskId,
		);
	}

	private async startAuxiliaryRuntimeTaskSessionFromLaunchConfig(
		input: StartRuntimeTaskSessionFromLaunchConfigInput,
	): Promise<RuntimeTaskSessionStartResult> {
		// F1.34c v5: the last un-instrumented span was "runner dispatched" → "first admission evaluation" — this
		// stamp closes it from the service side (synthetic ids only; evaluate-entry is stamped server-side).
		if (isDerivedTaskSessionId(input.taskId)) {
			try {
				recordSelfObservation({
					signal: "custom",
					severity: "debug",
					message: `Aux admission gate entered for ${input.taskId}.`,
					taskId: input.taskId,
					metadata: { category: "aux_session_start", phase: "admission gate entered" },
				});
			} catch {
				// Telemetry must never break session start.
			}
		}
		return await this.withModelTurnAdmission(
			{
				taskId: input.taskId,
				admissionParentTaskId: input.admissionParentTaskId ?? null,
				providerId: input.launchConfig.providerId,
				modelId: input.launchConfig.modelId,
				endpoint: input.launchConfig.baseUrl ?? null,
				freshSessionStart: true,
			},
			() => this.startRuntimeTaskSessionFromLaunchConfig(input),
		);
	}

	private async startRuntimeTaskSessionFromLaunchConfig(
		input: StartRuntimeTaskSessionFromLaunchConfigInput,
	): Promise<RuntimeTaskSessionStartResult> {
		const launchConfig = this.cacheLaunchConfig(input.taskId, input.launchConfig);
		// F1.34c stall forensics 2026-07-25: synthetic (::review/::plan-critique/…) session starts were observed
		// acquiring endpoint admission and then never emitting their model request, with no signal naming the
		// stuck segment. Phase observations (synthetic ids only — near-zero volume) make the NEXT such stall name
		// itself. Debug severity: invisible unless someone is looking.
		const auxStamp = (phase: string): void => {
			if (!isDerivedTaskSessionId(input.taskId)) {
				return;
			}
			try {
				recordSelfObservation({
					signal: "custom",
					severity: "debug",
					message: `Aux session start ${phase} for ${input.taskId}.`,
					taskId: input.taskId,
					metadata: { category: "aux_session_start", phase },
				});
			} catch {
				// Telemetry must never break session start.
			}
		};
		auxStamp("entered");
		const communitySkillAdmission = this.communitySkillAdmissionByTaskId.get(input.taskId) ?? null;
		const communitySkillSuggestionFragment = this.communitySkillSuggestionFragmentByTaskId.get(input.taskId) ?? null;
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
		auxStamp("runtime-setup ensured");
		const requestContextWindow = this.contextBudgetController.resolveKnownContextWindowForTask(
			input.taskId,
			launchConfig.contextWindow,
		);
		// W2.4a: small (quality-effective) windows get the LEAN rules. FLAG-GATED OFF after live A/B evidence
		// (run9 2026-07-02): the first lean run showed a small coder model ping-ponging read_files/get_file_size
		// for 14min with zero writes — the dropped "never re-read covered ranges" lines plausibly serve as
		// anti-loop rails for small models. Enable with NKLEIN_LEAN_SYSPROMPT=1 to measure; default full until the
		// scoreboard proves lean safe (research: measure-first).
		//
		// Hoisted out of the prompt-parts call so the chosen level can also be RECORDED — see the observation
		// below. It was previously computed inline and therefore unobservable.
		const leanSyspromptLevel =
			isTruthyEnv(process.env.NKLEIN_LEAN_SYSPROMPT) && requestContextWindow && requestContextWindow <= 40_000
				? "lean"
				: "full";
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
		// the task-id suffix) and bakes the lean/full efficiency-rules level. F4.15 resolves the same skill context here
		// as on primary starts so restarts and auxiliary reviewers cannot silently lose request-level skill policy.
		const role = resolveNKleinTaskRole(input.taskId, this.explicitDecompositionTaskIds.has(input.taskId));
		const baseSessionSkillContext = await buildSessionSkillContext({
			role,
			taskText: input.prompt,
			workspacePath: hostWorkspaceRoot,
			modelId: launchConfig.modelId,
			sandboxMcpEnabled: this.isSandboxMcpEnabled(),
			...(this.agentSandboxManager
				? { sandboxContainerMemoryLimitMb: this.agentSandboxManager.getContainerMemoryLimitMb() }
				: {}),
			fragmentBudgetTokens: Math.min(2_000, Math.round(((requestContextWindow ?? 32_000) || 32_000) * 0.08)),
			difficulty:
				estimateNKleinStartDifficulty(
					estimateNKleinStartPromptTokens({ prompt: input.prompt, images: input.images }),
					{ taskText: input.prompt, isPlanCard: role === "architect" },
				) / 100,
			proceduralSkillEmbeddingProvider: input.codeEmbeddingProvider,
		});
		const sessionSkillContext = {
			...baseSessionSkillContext,
			fragments: [
				...baseSessionSkillContext.fragments,
				...(communitySkillSuggestionFragment ? [communitySkillSuggestionFragment] : []),
				...(communitySkillAdmission?.fragments ?? []),
			],
		};
		auxStamp("skill context built");
		const attemptRetryContext = await this.buildAttemptRetryContext(
			input.taskId,
			launchConfig.providerId,
			launchConfig.modelId,
			launchConfig.baseUrl ?? null,
			role,
		);
		const attemptRetryNote = attemptRetryContext.note;
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
					level: leanSyspromptLevel,
					// G6.8a: decompose seeds are read-only + decompose_project (§5.B) — the worker write/run rules
					// were 116-vs-cap-60 lint noise on every architect start. Same explicit-decomposition membership
					// `derivePromptSessionKind` keys the "architect" kind on; opt out with NKLEIN_ARCHITECT_PROMPT_DIET=0
					// (mirrors NKLEIN_JUDGE_PROMPT_DIET).
					plannerScope:
						this.explicitDecompositionTaskIds.has(input.taskId) &&
						isEnabledByDefaultEnv(process.env.NKLEIN_ARCHITECT_PROMPT_DIET),
				}),
				skillFragments: sessionSkillContext.fragments,
			}),
		);
		// F4.8b: **the flag's own comment says "enable to measure" and "default full until the scoreboard proves
		// lean safe (research: measure-first)" — and nothing recorded which level was used.** Turning it on
		// therefore measured nothing: no telemetry could say whether a session ran lean or full, so the scoreboard
		// the comment defers to could never be built. The whole justification for the flag existing was
		// unreachable through the flag.
		//
		// Records the level on EVERY start, not only when lean wins, because the comparison is the entire point —
		// a lean-only record has no baseline to compare against.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `System prompt level for ${input.taskId}: ${leanSyspromptLevel} (context ${requestContextWindow ?? "unknown"}).`,
				taskId: input.taskId,
				metadata: {
					category: "sysprompt_level",
					level: leanSyspromptLevel,
					contextWindow: requestContextWindow ?? null,
					flagOn: isTruthyEnv(process.env.NKLEIN_LEAN_SYSPROMPT),
				},
			});
		} catch {
			// Telemetry must never break session start.
		}

		auxStamp("system prompt assembled; awaiting resume gate");
		await this.waitUntilTaskResumed(input.taskId);
		auxStamp("resume gate passed");
		this.requestTimer.markStarted(input.taskId);
		this.adaptiveBudgetController.refreshLearnedQualityBudgets();
		// Sandbox-proxied tool executors / extra tools for the rebuilt session (or the caller's, if supplied).
		const baseSandboxToolExecutors =
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
		const baseCombinedExtraTools = InMemoryNKleinTaskSessionService.combineExtraTools(
			sandboxExtraTools,
			this.retrievalToolsBuilder.build(input.taskId),
		);
		const sandboxToolExecutors = communitySkillAdmission
			? restrictCommunitySkillToolExecutors(baseSandboxToolExecutors, communitySkillAdmission.effectiveTools)
			: baseSandboxToolExecutors;
		const combinedExtraTools = communitySkillAdmission
			? restrictCommunitySkillExtraTools(baseCombinedExtraTools, communitySkillAdmission.effectiveTools)
			: baseCombinedExtraTools;
		const baseToolApproval = runtimeSetup.createToolApproval({
			taskId: input.taskId,
			contextWindow: requestContextWindow,
			maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines ?? null,
			filesLikelyTouched: launchConfig.filesLikelyTouched ?? null,
			writeScope: launchConfig.writeScope ?? null,
			forbiddenPaths: launchConfig.forbiddenPaths ?? null,
		});
		const requestToolApproval = communitySkillAdmission
			? async (request: Parameters<typeof baseToolApproval>[0]) =>
					isCommunitySkillToolAllowed(request.toolName, communitySkillAdmission.effectiveTools)
						? await baseToolApproval(request)
						: {
								approved: false,
								reason: `Community-skill activation did not grant tool '${request.toolName}'.`,
							}
			: baseToolApproval;
		const baseToolPolicies = resolveSessionToolPolicies({
			taskId: input.taskId,
			isExplicitDecomposition: this.explicitDecompositionTaskIds.has(input.taskId),
			basePolicies: runtimeSetup.toolPolicies,
		});
		const toolPolicies = communitySkillAdmission
			? restrictCommunitySkillToolPolicies(baseToolPolicies, communitySkillAdmission.effectiveTools)
			: baseToolPolicies;
		// F12.62 (opt-in NKLEIN_ARCHITECT_EDITOR): for a write-scoped WORKER card, run ONE bounded `::architect`
		// pre-phase (same model, fresh window) and start the worker as the EDITOR with the brief prepended — the
		// documented aider architect win for weak models. Every degraded path (no sandbox, no brief, throw) falls
		// back to the original prompt, so the flag can never cost a card. The score/difficulty auto-decision
		// (decideArchitectEditorSplit) engages when routing exposes those signals at this seam; the operator flag
		// is the explicit opt-in until then.
		let effectiveStartPrompt = input.prompt;
		if (
			isTruthyEnv(process.env.NKLEIN_ARCHITECT_EDITOR) &&
			!isDerivedTaskSessionId(input.taskId) &&
			!isHomeAgentSessionId(input.taskId) &&
			(launchConfig.filesLikelyTouched?.length ?? 0) > 0
		) {
			const architectBrief = await this.architectRunner
				.runArchitectPhase({
					taskId: input.taskId,
					projectRepoPath: input.workspaceRoot ?? launchConfig.workspaceRoot ?? input.cwd,
					baseRef: this.sandboxState.getBaseRef(input.taskId) ?? "HEAD",
					taskPrompt: input.prompt,
				})
				.catch(() => null);
			if (architectBrief) {
				effectiveStartPrompt = buildEditorPrompt({ taskPrompt: input.prompt, architectBrief });
			}
			// F4.8b: the architect phase runs an extra model pass, and `.catch(() => null)` above swallows its
			// failure COMPLETELY — the session then falls back to the plain prompt and looks identical to one where
			// architect/editor was never enabled. **A silent degradation to the default path is indistinguishable
			// from the feature being off**, so a card that quietly lost its architect brief was unfindable.
			//
			// Recorded on both outcomes: "ran and produced nothing" is the failure worth catching, and a
			// success-only emission would hide exactly it.
			try {
				recordSelfObservation({
					signal: "custom",
					severity: architectBrief ? "info" : "warning",
					message: architectBrief
						? `Architect phase produced a brief for ${input.taskId}; the editor prompt was used.`
						: `Architect phase produced NO brief for ${input.taskId} — silently fell back to the plain prompt.`,
					taskId: input.taskId,
					metadata: { category: "architect_editor_phase", producedBrief: architectBrief !== null },
				});
			} catch {
				// Telemetry must never break session start.
			}
		}
		auxStamp("dispatching session runtime start");
		// F4.8 (audit 2026-08-12): the card contract the goal re-anchor carries — write-scope boundaries from the
		// persisted launch config + the acceptance command parsed from the start prompt. Omitted when empty so a
		// contract-less session stays byte-identical.
		const restartCardContract = buildSessionCardContract({
			writeScope: launchConfig.writeScope,
			forbiddenPaths: launchConfig.forbiddenPaths,
			cardPrompt: input.prompt,
		});
		const startResult = await this.sessionRuntime
			.startTaskSession({
				taskId: input.taskId,
				cwd: agentPerceivedCwd,
				workspaceRoot: input.workspaceRoot ?? launchConfig.workspaceRoot,
				prompt: effectiveStartPrompt,
				...(restartCardContract.constraints !== null || restartCardContract.acceptanceCriteria !== null
					? { cardContract: restartCardContract }
					: {}),
				initialMessages: input.initialMessages,
				maxTokensPerTurn: input.maxTokensPerTurn ?? input.launchConfig.maxTokensPerTurn ?? null,
				images: input.images,
				providerId: launchConfig.providerId,
				modelId: launchConfig.modelId,
				behaviorProfile: attemptRetryContext.profile,
				strategyEffectivenessLedger: attemptRetryContext.strategyLedger,
				role,
				skillApiProfile: sessionSkillContext.apiProfile,
				onPromptStrategyApplied: (strategy) => this.noteNextAttemptStrategy(input.taskId, strategy),
				onRetryStrategyOutcome: (observation) =>
					this.recordRetryStrategyOutcome({
						taskId: input.taskId,
						workspacePath: hostWorkspaceRoot,
						providerId: launchConfig.providerId,
						modelId: launchConfig.modelId,
						endpoint: launchConfig.baseUrl ?? null,
						role,
						observation,
					}),
				mode: input.mode,
				executionMode: input.executionMode ?? launchConfig.executionMode,
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
				...(!communitySkillAdmission && this.isSandboxMcpEnabled() && sandboxWorkspace
					? {
							sandboxMcpExecTarget: sandboxWorkspace.manager.getSandboxExecTarget(input.taskId),
							basicMemoryExecEnv: sandboxWorkspace.manager.getBasicMemoryExecEnv?.(input.taskId),
							// §5.BB: the resolved basic-memory opt-in (setting OR env) rides along so the MCP bundle
							// offers/withholds the default-off basic-memory server consistently with the mounts.
							basicMemoryEnabled: this.isBasicMemoryEnabled(),
							sandboxMcpServerControls: this.sandboxMcpServerControls,
						}
					: {}),
				userInstructionService: runtimeSetup.userInstructionService,
				requestToolApproval,
				// Planning seeds: read-only + decompose_project (§5.B). Verdict-only sessions (review/plan-critique):
				// inspection + submission only — the 32.2KB worker tools block was the post-diet no-submission cause.
				toolPolicies,
				onDecompositionApplied: this.wrapDecompositionApplied(this.onDecompositionApplied),
				requestPlanCritique: this.planCritiqueRunner.buildRequestHandler(input.taskId, hostWorkspaceRoot),
				requestClarifyTurn: this.planCritiqueRunner.buildClarifyTurnHandler(input.taskId, hostWorkspaceRoot),
				onCardPromoted: isHomeAgentSessionId(input.taskId) ? undefined : this.onCardPromoted,
				onReviewSubmitted: input.onReviewSubmitted,
				onPlanCritiqueSubmitted: input.onPlanCritiqueSubmitted,
				onMergeResolutionSubmitted: input.onMergeResolutionSubmitted,
				onExplorerCitationsSubmitted: input.onExplorerCitationsSubmitted,
				onArchitectBriefSubmitted: input.onArchitectBriefSubmitted,
				// F11.2j (OPT-IN via NKLEIN_EXPLORER_SUBAGENT; default OFF = tool absent, byte-identical sessions):
				// the worker-side `explore` delegation — one bounded read-only subagent query per call.
				runExplorerQuery: isTruthyEnv(process.env.NKLEIN_EXPLORER_SUBAGENT)
					? this.explorerRunner.buildExploreHandler(input.taskId, hostWorkspaceRoot)
					: undefined,
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
		freshModelCarry?: boolean;
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
			const initialMessages = input.freshModelCarry
				? undefined
				: this.contextBudgetController.prepareMessagesForKnownContextWindow({
						taskId: input.taskId,
						messages: persistedSnapshot?.messages,
						prompt: input.prompt,
						images: input.images,
						contextWindow,
					});
			await this.sessionRuntime.stopTaskSession(input.taskId, { suppressTaskEvents: true });
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
		const initialMessages = input.freshModelCarry
			? undefined
			: this.contextBudgetController.prepareMessagesForKnownContextWindow({
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
		// N18: mark the attempt's START.
		//
		// The ledger records only the attempt's END (`buildTerminalAttemptEvent`), and it does so reliably — even
		// for an attempt that made no tool calls. But with only an end marker, **an attempt still IN FLIGHT is
		// invisible until it terminates**, which is precisely the state a stalled card is in when someone goes
		// looking at it. It also makes attempt DURATION underivable from the trail alone.
		//
		// Emitted before any of the setup below can throw, so a start that fails during initialisation still leaves
		// a record — an attempt that died on the way up is otherwise the most invisible failure there is.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Attempt started on ${request.taskId}${request.modelId ? ` with ${request.modelId}` : ""}.`,
				taskId: request.taskId,
				metadata: {
					category: ATTEMPT_STARTED_CATEGORY,
					modelId: request.modelId ?? null,
					providerId: request.providerId ?? null,
					mode: request.mode ?? null,
				},
			});
		} catch {
			// Telemetry must never prevent an attempt from starting.
		}
		// F4.8b: sandbox-MCP is a PREDICATE (`isSandboxMcpEnabled`) called four times per session, not an event.
		// Recorded ONCE here at session start with its own category — NOT folded into `attempt_started`, because a
		// registry entry keyed on `attempt_started` would count every attempt as this mechanism firing and report
		// it healthy even if MCP were never offered. That is the exact "records the wrong thing" defect found in
		// the stall-replan wiring; a dedicated category keeps the observation meaning what it says.
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Sandbox MCP ${this.isSandboxMcpEnabled() ? "offered" : "withheld"} for ${request.taskId} (basic-memory ${this.isBasicMemoryEnabled() ? "on" : "off"}).`,
				taskId: request.taskId,
				metadata: {
					category: "sandbox_mcp_offer",
					enabled: this.isSandboxMcpEnabled(),
					// F4.8b: basic-memory is a sibling predicate resolved at the same seam and offered through the
					// same MCP bundle, so its enablement rides the SAME once-per-session record rather than adding a
					// second. It is a distinct field, not a shared category count — the mistake caught on sandbox MCP.
					basicMemoryEnabled: this.isBasicMemoryEnabled(),
					sandboxMcpServerControls: this.sandboxMcpServerControls,
				},
			});
		} catch {
			// Telemetry must never prevent an attempt from starting.
		}
		// F1.5 rehydration + seeding: the card's persisted focus chain survives restarts, but the LIVE store starts
		// empty — reseed it (never clobbers a chain the session emits first). A fresh plan-born card with NO chain
		// yet gets an initial one from its plan task's contract, applied through the normal path so it persists to
		// the card and shows in the UI immediately.
		void this.loadPersistedFocusChain?.(request.taskId)
			.then((loaded) => {
				if (!loaded) {
					return;
				}
				if (loaded.source === "seeded") {
					if (!this.focusChainStore.get(request.taskId)) {
						this.focusChainStore.applyStep(request.taskId, loaded.chain);
					}
					return;
				}
				this.focusChainStore.seed(request.taskId, loaded.chain);
			})
			.catch(() => undefined);
		const existing = this.messageRepository.getTaskEntry(request.taskId);
		if (
			!request.resumeFromTrash &&
			!request.resumeFromPersistence &&
			existing &&
			(existing.summary.state === "queued" ||
				// P0.DSTALL: the state LABEL alone is not liveness. `heartbeatStatus: "lost"` is written
				// EXCLUSIVELY by the terminal turn-end paths (run-finished / done / turn-canceled — a slow live
				// turn reads healthy/stale), so running/awaiting_review with a lost heartbeat means the last turn
				// verifiably ENDED and this start is a REDRIVE that must proceed. Swallowing it left a plan-mode
				// card sessionless in `running` for 20 minutes on 2026-08-20 (run `.real-runs/20260820-222524`:
				// two zombie attempt rows, dead air, external kill). `queued` still swallows unconditionally —
				// a start is already in flight.
				((existing.summary.state === "running" || existing.summary.state === "awaiting_review") &&
					existing.summary.heartbeatStatus !== "lost"))
		) {
			return cloneSummary(existing.summary);
		}
		if (request.communitySkillAdmission) {
			this.communitySkillAdmissionByTaskId.set(request.taskId, request.communitySkillAdmission);
		} else {
			this.communitySkillAdmissionByTaskId.delete(request.taskId);
		}
		const communitySkillAdmission = this.communitySkillAdmissionByTaskId.get(request.taskId) ?? null;
		if (request.communitySkillSuggestionFragment) {
			this.communitySkillSuggestionFragmentByTaskId.set(request.taskId, request.communitySkillSuggestionFragment);
		} else {
			this.communitySkillSuggestionFragmentByTaskId.delete(request.taskId);
		}
		const communitySkillSuggestionFragment =
			this.communitySkillSuggestionFragmentByTaskId.get(request.taskId) ?? null;
		const pendingPlanRevision = this.planCritiqueRunner.getPendingRevisionPrompt(request.taskId);
		const taskPrompt = pendingPlanRevision ? `${request.prompt.trim()}\n\n${pendingPlanRevision}` : request.prompt;
		const providerId = request.providerId?.trim().toLowerCase() || UNCONFIGURED_PROVIDER_ID;
		this.providerIdStore.set(request.taskId, providerId);
		this.autonomyBudgetWatchdog.resetTask(request.taskId);
		this.repeatedToolCallGuard.resetTask(request.taskId);
		this.turnLoopGuard.resetTask(request.taskId);
		this.decompositionStallNudger.resetTask(request.taskId);
		// A plan-mode start IS a decomposition seed in this product — arm the planning tool restriction + the
		// decomposition-stall nudger for ALL of them, not only prompts that happen to name the tool contract.
		// (Live-found 2026-07-18, qwable deep_chain: a marker-less plan prompt produced a perfect trajectory that
		// ENDED on "Decomposing into 9 cards…" prose without the decompose_project call — say-then-stop — and the
		// nudger never armed because the registration demanded `decompose_project`/`minimumTaskCount` in the text.
		// Realistic user prompts are vague; the flag, not magic words, carries the intent.)
		if (request.startInPlanMode) {
			this.explicitDecompositionTaskIds.add(request.taskId);
		} else {
			this.explicitDecompositionTaskIds.delete(request.taskId);
		}
		const requestContextWindow = this.contextBudgetController.resolveKnownContextWindowForTask(
			request.taskId,
			request.contextWindow ?? null,
		);
		// ActionPlan mode is a worker execution strategy. Decomposition seeds need the trusted
		// control-plane planning tools, which intentionally have no worker tool manifest and
		// therefore cannot be represented inside an ActionPlan. Fail safe to the normal agent
		// loop even if a persisted card setting asks for ActionPlan execution.
		const executionMode = request.startInPlanMode ? "agent" : request.executionMode;
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
			writeScope: request.writeScope ?? null,
			forbiddenPaths: request.forbiddenPaths ?? null,
			apiKey: request.apiKey,
			baseUrl: request.baseUrl,
			reasoningEffort: request.reasoningEffort,
			contextWindow: requestContextWindow,
			executionMode,
			maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
			apiTimeoutMs: request.requestTimeoutMs,
			turnTimeoutMs: request.turnTimeoutMs,
		});
		const resolvedMode: RuntimeTaskSessionMode = request.startInPlanMode ? "act" : (request.mode ?? "act");
		// A work card (not plan-mode, not a home/chat session) gets the Planning/Refinement preamble + the
		// begin_implementation promotion tool (todo §5.B); home/chat and decompose/plan cards do not.
		const isRefinableWorkCard = !request.startInPlanMode && !isHomeAgentSessionId(request.taskId);
		let specDeliberationGuidance: readonly string[] | null = null;
		if (
			isTruthyEnv(process.env.NKLEIN_SPEC_DELIBERATION) &&
			request.startInPlanMode &&
			!pendingPlanRevision &&
			!request.resumeFromTrash &&
			!request.resumeFromPersistence &&
			providerId !== UNCONFIGURED_PROVIDER_ID &&
			modelId !== UNCONFIGURED_MODEL_ID
		) {
			const deliberationBaseUrl = endpoint ?? resolveDefaultLocalModelBaseUrl();
			const deliberation = await runSpecDeliberation({
				specText: taskPrompt,
				difficulty: Math.max(0, Math.min(1, request.taskDifficulty ?? 0.5)),
				primary: {
					providerId,
					modelId,
					modelKey: request.stableModelKey,
					baseUrl: deliberationBaseUrl,
					apiKey: request.apiKey,
					timeoutMs: request.requestTimeoutMs,
					contextWindow: requestContextWindow ?? 0,
				},
				loaded: await fetchLoadedModelDescriptors(deliberationBaseUrl).catch(() => []),
				runTurn: async ({ model, stance, prompt }) =>
					await this.withModelTurnAdmission(
						{
							taskId: `${request.taskId}::spec-deliberation:${stance.id}`,
							admissionParentTaskId: request.taskId,
							providerId: model.providerId,
							modelId: model.modelId,
							endpoint: model.baseUrl,
						},
						async () => {
							const completion = await new LocalLlmClient({
								providerId: model.providerId,
								modelId: model.modelId,
								baseUrl: model.baseUrl,
								apiKey: model.apiKey,
								...(model.timeoutMs ? { timeoutMs: model.timeoutMs } : {}),
							}).complete({
								messages: [{ role: "user", content: prompt }],
								sampling: { temperature: 0.2, topP: 0.9, topK: 40, minP: 0.05, maxTokens: 1_200 },
							});
							// Deliberation extracts a small structured ambiguity set and never persists chain-of-thought. Current
							// reasoning templates can place the entire reply in reasoning_content; treating that as empty would
							// turn a healthy mechanism into a silent no-op.
							return readSpecDeliberationCompletionText(completion);
						},
					),
			}).catch(() => null);
			specDeliberationGuidance = deliberation?.guidance ?? null;
			try {
				recordSelfObservation({
					signal: "custom",
					severity: deliberation && deliberation.guidance.length > 0 ? "warning" : "info",
					message: deliberation
						? `Spec-time deliberation for ${request.taskId}: ${deliberation.completedModelIds.length} turn(s), ${deliberation.deliberation.disagreements.length} disagreement(s), ${deliberation.guidance.length > 0 ? "clarification guidance injected" : "no question injected"}.`
						: `Spec-time deliberation for ${request.taskId}: gated off, unavailable, or insufficient independent completions; using the ordinary single-model clarification path.`,
					taskId: request.taskId,
					metadata: {
						category: "spec_deliberation",
						mode: deliberation?.mode ?? "skipped",
						completedTurns: deliberation?.completedModelIds.length ?? 0,
						disagreementCount: deliberation?.deliberation.disagreements.length ?? 0,
						questionInjected: Boolean(deliberation?.guidance.length),
					},
				});
			} catch {
				// Observational evidence must never block task start.
			}
		}
		// F12.89: workspace-stable frontend convention preamble (memoized per cwd; [] for backend workspaces or on any
		// read failure ⇒ byte-identical; kill-switch NKLEIN_FRAMEWORK_PREAMBLE=off).
		const frameworkPreamble = await readWorkspaceFrameworkPreamble(request.cwd);
		const startPromptParts = buildNKleinStartPromptParts(
			taskPrompt,
			request.startInPlanMode,
			isRefinableWorkCard,
			request.autoDecompositionDepth ?? null, // F4.38 — advisory depth line (null ⇒ byte-identical)
			frameworkPreamble,
			request.fleetDecompositionGuidance ?? null, // F12.110 — advisory fleet sharding (null ⇒ byte-identical)
			specDeliberationGuidance,
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
				let decompositionFreshnessPrompt: string | null = null;
				if (request.startInPlanMode) {
					const workspacePathHash = hashWorkspacePathForLedger(request.workspaceRoot ?? request.cwd);
					try {
						const freshness = await this.runDecompositionResearchPreflight({
							taskId: request.taskId,
							workspacePathHash,
							taskText: taskPrompt,
							egressAvailable: this.retrievalToolsBuilder.isAvailable(request.taskId),
						});
						decompositionFreshnessPrompt = freshness.promptBlock;
					} catch (error) {
						decompositionFreshnessPrompt = [
							"Decomposition freshness preflight (trusted runtime decision):",
							`- The preflight failed (${error instanceof Error ? error.message : String(error)}).`,
							"- No online freshness claim was established. Proceed from local evidence and state that limitation explicitly.",
						].join("\n");
					}
					const freshnessMessage = createMessageWithMeta(request.taskId, "system", decompositionFreshnessPrompt, {
						hookEventName: "research_freshness_decision",
						messageKind: "research_freshness_decision",
						displayRole: "Freshness preflight",
					});
					entry.messages.push(freshnessMessage);
					this.emitMessage(request.taskId, freshnessMessage);
				}
				const planningWorkflowPrompt = startPromptParts.systemWorkflowCommand
					? runtimeSetup.resolvePrompt(startPromptParts.systemWorkflowCommand)
					: null;
				let planningSystemPrompt = startPromptParts.systemPrompt
					? planningWorkflowPrompt
						? appendSystemPrompt(planningWorkflowPrompt, startPromptParts.systemPrompt)
						: startPromptParts.systemPrompt
					: null;
				if (decompositionFreshnessPrompt) {
					planningSystemPrompt = planningSystemPrompt
						? appendSystemPrompt(planningSystemPrompt, decompositionFreshnessPrompt)
						: decompositionFreshnessPrompt;
				}
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
				const role = resolveNKleinTaskRole(request.taskId, this.explicitDecompositionTaskIds.has(request.taskId));
				const baseSessionSkillContext = await buildSessionSkillContext({
					role,
					taskText: taskPrompt,
					workspacePath: request.workspaceRoot?.trim() || request.cwd,
					modelId,
					// Same gate the tool bundle uses to offer curated sandbox MCP servers — so the structural-retrieval
					// nudge is added exactly when (and only when) a structural code-graph server is offered to this model.
					sandboxMcpEnabled: this.isSandboxMcpEnabled(),
					// §5.AF: the pool's per-container memory limit, so the nudge honors the memory-fit gate too (a heavy
					// server withheld from a small container isn't advertised in guidance).
					...(this.agentSandboxManager
						? { sandboxContainerMemoryLimitMb: this.agentSandboxManager.getContainerMemoryLimitMb() }
						: {}),
					// §5.AE honor the user's skill-dynamics level so the fragment resolution matches the affinity-tag one.
					...(request.skillDynamicsLevel ? { dynamicsLevel: request.skillDynamicsLevel } : {}),
					// F4.17 overflow capping: skill-driven fragments get ≤8% of the window (cap 2k tokens) so one
					// retrieval pile can never blow a small context.
					fragmentBudgetTokens: Math.min(2_000, Math.round(((request.contextWindow ?? 32_000) || 32_000) * 0.08)),
					difficulty:
						estimateNKleinStartDifficulty(
							estimateNKleinStartPromptTokens({
								prompt: taskPrompt,
								taskTitle: request.taskTitle,
								images: request.images,
							}),
							{ taskText: taskPrompt, isPlanCard: request.startInPlanMode },
						) / 100,
					proceduralSkillEmbeddingProvider: request.codeEmbeddingProvider,
				});
				const sessionSkillContext = {
					...baseSessionSkillContext,
					fragments: [
						...baseSessionSkillContext.fragments,
						...(communitySkillSuggestionFragment ? [communitySkillSuggestionFragment] : []),
						...(communitySkillAdmission?.fragments ?? []),
					],
				};
				const sessionSkillFragments = sessionSkillContext.fragments;
				// F12.29: remember which procedures were surfaced so the terminal attempt event can stamp them
				// (the paired-trajectory audit needs the with-skill/without-skill split).
				const surfacedSkillIds = sessionSkillFragments
					.map((fragment) => fragment.key)
					.filter((key) => key.startsWith("procedural-skill:"))
					.map((key) => key.slice("procedural-skill:".length));
				if (surfacedSkillIds.length > 0) {
					this.surfacedSkillIdsByTaskId.set(request.taskId, surfacedSkillIds);
				} else {
					this.surfacedSkillIdsByTaskId.delete(request.taskId);
				}
				const attemptRetryContext = await this.buildAttemptRetryContext(
					request.taskId,
					providerId,
					modelId,
					endpoint,
					role,
				);
				const attemptRetryNote = attemptRetryContext.note;
				const systemPrompt = this.promptWarmthLedger.assembleAndRecord(
					this.buildSessionSystemPromptInput({
						taskId: request.taskId,
						prompt: taskPrompt,
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
							// Audit 2026-08-12 (B-F7): this main start path never passed `level`, so
							// NKLEIN_LEAN_SYSPROMPT could not take effect on ordinary card starts — the flag's
							// measure-first scoreboard was unbuildable from the path that matters. Same derivation
							// as the launch-config sibling.
							level:
								isTruthyEnv(process.env.NKLEIN_LEAN_SYSPROMPT) &&
								requestContextWindow &&
								requestContextWindow <= 40_000
									? "lean"
									: "full",
							// G6.8a: this is the start path decompose seeds actually take (it carries the planning
							// prompt) — same planner diet + opt-out as the sibling call site above.
							plannerScope:
								this.explicitDecompositionTaskIds.has(request.taskId) &&
								isEnabledByDefaultEnv(process.env.NKLEIN_ARCHITECT_PROMPT_DIET),
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
				// P0.1 (live-found 2026-07-13): primary/queued-drain starts used to bypass model-turn admission entirely.
				// A decomposition callback can mark its seed idle and force-drain a queued child before the seed's initial SDK
				// turn has unwound. Serializing the actual SDK bootstrap/send here lets the child prepare its sandbox/prompt,
				// but prevents re-entering the shared SDK/model runtime until the seed turn has really settled. Re-drives and
				// F12.62 (opt-in NKLEIN_ARCHITECT_EDITOR): the PRIMARY worker start runs the bounded `::architect`
				// pre-phase for a write-scoped card and starts as the EDITOR with the brief prepended. (The launch-config
				// path carries the same consult for restarts; primary starts bypass that path — live-found 2026-07-19:
				// the first A/B ran zero architect sessions because the consult sat only there.)
				let workerStartPrompt = runtimePrompt;
				if (
					isTruthyEnv(process.env.NKLEIN_ARCHITECT_EDITOR) &&
					!isDerivedTaskSessionId(request.taskId) &&
					!isHomeAgentSessionId(request.taskId) &&
					(request.filesLikelyTouched?.length ?? 0) > 0
				) {
					// Round-3 lesson: a swallowed failure here cost a whole A/B round — always say what happened.
					const architectBrief = await this.architectRunner
						.runArchitectPhase({
							taskId: request.taskId,
							projectRepoPath: request.workspaceRoot ?? request.cwd,
							baseRef: this.sandboxState.getBaseRef(request.taskId) ?? "HEAD",
							taskPrompt: runtimePrompt,
						})
						.catch((error) => {
							process.stderr.write(
								`[nklein] Architect phase FAILED for ${request.taskId}: ${error instanceof Error ? error.message : String(error)} — worker starts solo.\n`,
							);
							return null;
						});
					if (architectBrief) {
						process.stderr.write(
							`[nklein] Architect phase for ${request.taskId}: brief received (${architectBrief.length}b) — worker starts as EDITOR.\n`,
						);
						workerStartPrompt = buildEditorPrompt({ taskPrompt: runtimePrompt, architectBrief });
					} else {
						process.stderr.write(
							`[nklein] Architect phase for ${request.taskId}: no brief (session yielded null) — worker starts solo.\n`,
						);
					}
				}
				const baseToolApproval = runtimeSetup.createToolApproval({
					taskId: request.taskId,
					contextWindow: requestContextWindow,
					maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
					filesLikelyTouched: request.filesLikelyTouched ?? null,
					writeScope: request.writeScope ?? null,
					forbiddenPaths: request.forbiddenPaths ?? null,
				});
				const requestToolApproval = communitySkillAdmission
					? async (toolRequest: Parameters<typeof baseToolApproval>[0]) =>
							isCommunitySkillToolAllowed(toolRequest.toolName, communitySkillAdmission.effectiveTools)
								? await baseToolApproval(toolRequest)
								: {
										approved: false,
										reason: `Community-skill activation did not grant tool '${toolRequest.toolName}'.`,
									}
					: baseToolApproval;
				const baseToolExecutors = sandboxWorkspace
					? createAgentSandboxToolExecutors(sandboxWorkspace.manager, request.taskId, {
							pauseController: this.pauseController,
						})
					: undefined;
				const toolExecutors = communitySkillAdmission
					? restrictCommunitySkillToolExecutors(baseToolExecutors, communitySkillAdmission.effectiveTools)
					: baseToolExecutors;
				const baseExtraTools = InMemoryNKleinTaskSessionService.combineExtraTools(
					sandboxWorkspace
						? createAgentSandboxExtraTools(sandboxWorkspace.manager, request.taskId, {
								sessionId: createSessionId(request.taskId),
								contextWindow: requestContextWindow,
								maxFileLines: request.maxAgentWritableFileLines ?? null,
							})
						: undefined,
					this.retrievalToolsBuilder.build(request.taskId),
				);
				const extraTools = communitySkillAdmission
					? restrictCommunitySkillExtraTools(baseExtraTools, communitySkillAdmission.effectiveTools)
					: baseExtraTools;
				const baseToolPolicies = resolveSessionToolPolicies({
					taskId: request.taskId,
					isExplicitDecomposition: this.explicitDecompositionTaskIds.has(request.taskId),
					basePolicies: runtimeSetup.toolPolicies,
				});
				const toolPolicies = communitySkillAdmission
					? restrictCommunitySkillToolPolicies(baseToolPolicies, communitySkillAdmission.effectiveTools)
					: baseToolPolicies;
				// F4.8 (audit 2026-08-12): compose the card contract once, outside the request literal, so the
				// conditional spread below stays readable. taskPrompt is the card's effective brief for this start.
				const primaryCardContract = buildSessionCardContract({
					writeScope: request.writeScope,
					forbiddenPaths: request.forbiddenPaths,
					cardPrompt: taskPrompt,
				});
				// auxiliary sessions already use this same gate.
				const startResult = await this.withModelTurnAdmission(
					{
						taskId: request.taskId,
						providerId,
						modelId,
						endpoint,
					},
					() =>
						this.sessionRuntime.startTaskSession({
							taskId: request.taskId,
							cwd: agentPerceivedCwd,
							// P18.4b: read LIVE at drift-check time, never sampled at start. A result branch is captured
							// PART-WAY through a session, so a start-time snapshot would report `false` for exactly the
							// cards that have work worth preserving — and stale-false is the dangerous direction, since
							// it is what makes the remedy prefer RESTART (discarding the diff) over PARK.
							// The in-memory fast path answers only the POSITIVE case. Its null is NOT "no work" — it is
							// what a restarted service reports for exactly the cards whose diff a restart would destroy —
							// so null falls through to the REPO probe, folded by captured-work-basis (an unreadable probe
							// resolves to true, labelled assumed_safe; only a probe that positively said "no branch"
							// yields the restart-permitting false).
							offTrackSignalsProvider: async () => {
								if (this.sandboxState.getResultBranch(request.taskId) !== null) {
									return {
										hasCapturedWork: true,
										basis: "observed",
										detail: "in-memory sandbox state holds a captured result branch",
									};
								}
								const probe = await probeTaskResultBranchCommit({
									repoPath: request.workspaceRoot ?? request.cwd,
									taskId: request.taskId,
								}).catch((error: unknown) => ({
									status: "error" as const,
									commit: null,
									message: error instanceof Error ? error.message : String(error),
								}));
								const signal = foldCapturedWorkProbe(probe);
								return {
									hasCapturedWork: signal.hasCapturedWork,
									basis: signal.basis,
									detail: signal.detail,
								};
							},
							// P18.4b acting half (runtime-gated on NKLEIN_DRIFT_REMEDY_ENFORCE; wiring it here is inert
							// until that flag is set). restart_with_restatement is the redrive-after-stop pattern the
							// delivery holds already use: stop ends the derailed conversation, send-input starts a
							// CLEAN session carrying the original brief plus the restart framing — never a compaction
							// of the drifted transcript. The ledger WRITE happens before the stop so the budget binds
							// even if the fresh start fails. park is the F2.17b attention stop (the operator surface).
							onOffTrackRemedy: async ({ remedy, reason }) => {
								if (remedy === "restart_with_restatement") {
									recordOffTrackRestart(request.taskId);
									await this.stopTaskSession(request.taskId).catch(() => null);
									const restatement =
										`OFF-TRACK RESTART (${getOffTrackRestartCount(request.taskId)}/${MAX_RESTATEMENT_RESTARTS}): ` +
										`your previous attempt drifted from the card's brief (${reason}). Start clean and follow the brief STRICTLY.\n\n${workerStartPrompt}`;
									const sent = await this.sendTaskSessionInput(request.taskId, restatement, "act").catch(
										() => null,
									);
									return { applied: sent ? "restarted_with_restatement" : "restart_failed" };
								}
								if (remedy === "park") {
									await this.stopTaskSession(request.taskId, { reviewReason: "attention" }).catch(() => null);
									return { applied: "parked" };
								}
								return null;
							},
							// Always hand the runtime a host workspace root so the trusted control-plane decomposition
							// tools resolve plan artifacts + board mutations to the host owning workspace, never to the
							// container workdir (agentPerceivedCwd points inside the sandbox volume when isolation is active).
							workspaceRoot: request.workspaceRoot ?? request.cwd,
							prompt: workerStartPrompt,
							// F4.8 (audit 2026-08-12): the card contract the goal re-anchor carries — write-scope boundaries
							// + the acceptance command parsed from the card prompt. Omitted when empty so a contract-less
							// session stays byte-identical.
							...(primaryCardContract.constraints !== null || primaryCardContract.acceptanceCriteria !== null
								? { cardContract: primaryCardContract }
								: {}),
							taskTitle: request.taskTitle,
							maxTokensPerTurn: request.maxTokensPerTurn ?? null,
							initialMessages,
							images: request.images,
							providerId,
							modelId,
							behaviorProfile: attemptRetryContext.profile,
							strategyEffectivenessLedger: attemptRetryContext.strategyLedger,
							role,
							skillApiProfile: sessionSkillContext.apiProfile,
							onPromptStrategyApplied: (strategy) => this.noteNextAttemptStrategy(request.taskId, strategy),
							onRetryStrategyOutcome: (observation) =>
								this.recordRetryStrategyOutcome({
									taskId: request.taskId,
									workspacePath: request.workspaceRoot ?? request.cwd,
									providerId,
									modelId,
									endpoint,
									role,
									observation,
								}),
							mode: resolvedMode,
							executionMode,
							apiKey: request.apiKey,
							baseUrl: request.baseUrl,
							reasoningEffort: request.reasoningEffort,
							contextWindow: requestContextWindow,
							codeEmbeddingProvider: request.codeEmbeddingProvider,
							apiTimeoutMs: request.requestTimeoutMs,
							turnTimeoutMs: request.turnTimeoutMs,
							systemPrompt,
							userInstructionService: runtimeSetup.userInstructionService,
							requestToolApproval,
							toolExecutors,
							// §5.AC step 3: sandbox tools ⊕ the egress-gated web_search tool (config-gated, fail closed; [] for
							// synthetic `::` sessions). Concatenated here — createAgentSandboxExtraTools stays untouched.
							extraTools,
							// §5.AR: a RESTARTED isolated task gets the curated sandbox MCP servers too (consistent with the main
							// start path) — gated by the config setting (on by default) OR the env override, and only when a sandbox
							// exists for the rebuilt task.
							...(!communitySkillAdmission && this.isSandboxMcpEnabled() && sandboxWorkspace
								? {
										sandboxMcpExecTarget: sandboxWorkspace.manager.getSandboxExecTarget(request.taskId),
										basicMemoryExecEnv: sandboxWorkspace.manager.getBasicMemoryExecEnv?.(request.taskId),
										// §5.BB: same resolved basic-memory opt-in as the main start path.
										basicMemoryEnabled: this.isBasicMemoryEnabled(),
										sandboxMcpServerControls: this.sandboxMcpServerControls,
									}
								: {}),
							// Planning seeds: §5.B restriction; verdict-only sessions: judge narrowing (see resolveSessionToolPolicies).
							toolPolicies,
							onDecompositionApplied: this.wrapDecompositionApplied(this.onDecompositionApplied),
							requestPlanCritique: this.planCritiqueRunner.buildRequestHandler(request.taskId, request.cwd),
							requestClarifyTurn: this.planCritiqueRunner.buildClarifyTurnHandler(request.taskId, request.cwd),
							runExplorerQuery: isTruthyEnv(process.env.NKLEIN_EXPLORER_SUBAGENT)
								? this.explorerRunner.buildExploreHandler(request.taskId, request.cwd)
								: undefined,
							onCardPromoted: isHomeAgentSessionId(request.taskId) ? undefined : this.onCardPromoted,
							onFocusChainUpdated: (chain) => this.focusChainStore.applyStep(request.taskId, chain),
							onTeamEvent: (event, teamName) => {
								this.teamProgressEmitter.emit(request.taskId, event, teamName);
							},
						}),
				);
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

	/**
	 * N5 flaky-02: the delivery seam declares the task's capture obligations SETTLED (the merge consumed the result)
	 * BEFORE its cleanup stop, so a racing late finalize (e.g. a lost-heartbeat park flip) cannot capture against the
	 * retired workspace and manufacture a failed summary + infrastructure failure for a card that just delivered.
	 */
	markTaskDeliverySettled(taskId: string): void {
		this.sandboxState.markDeliverySettled(taskId);
	}

	async stopTaskSession(
		taskId: string,
		// F2.17b: the reviewReason to stamp on the interrupted summary (default "interrupted"). The delivery
		// boundary-hold path passes "protected_write" so the operator inbox surfaces the held card distinctly.
		options: { reviewReason?: RuntimeTaskSessionReviewReason; abortActiveTurn?: boolean } = {},
	): Promise<RuntimeTaskSessionSummary | null> {
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
		// N7d: snapshot the FUTURE obligation before reset/stop tears down task-local routing state. A review bounce
		// can race a late terminal stop between `review -> in_progress` persistence and its next turn dispatch.
		// That stop may interrupt the old SDK session, but it must retain both the sandbox and the launch recipe so
		// the already-promised re-drive can restart rather than becoming an `in_progress` card with no turn.
		const recaptureReason = this.sandboxState.recaptureExpectedReason(taskId);
		this.resetInterruptedTaskState(taskId);
		if (recaptureReason === null) {
			this.launchConfigByTaskId.delete(taskId);
			this.communitySkillAdmissionByTaskId.delete(taskId);
			this.communitySkillSuggestionFragmentByTaskId.delete(taskId);
		}
		if (options.abortActiveTurn) {
			await this.sessionRuntime.abortTaskSession(taskId).catch(() => null);
		} else {
			await this.sessionRuntime.stopTaskSession(taskId).catch(() => null);
		}
		// P0.8: stop used to dispose + forget the sandbox BEFORE the interrupted summary was emitted, so the
		// terminal-salvage hook (captureTerminalRunSummary → finalizeSandboxReview) saw no sandbox and the round ended
		// with no captured result, no failure marker, and no prior-work rebound. When the finalizer can still salvage
		// (a sandbox placement without a captured result branch, or a capture already in flight), leave teardown to
		// it — it captures or fail-closes, rebounds prior-round work into review, and disposes the workspace itself.
		// N7d (David 2026-07-20, option B — "do not dispose before capture"): a THIRD salvage case.
		//
		// The two clauses below describe the PAST: is a capture running, and did one already happen? A bounce is
		// neither — round 1 captured (so `getResultBranch` is truthy) and round 2 has not started. Reading "a
		// result branch exists" as "nothing left to salvage" then disposed the workspace the NEXT capture needs,
		// which is how a bounced card reached `workspace_disposed_before_capture` and held in Review with 22
		// dependents behind it. `recaptureExpectedReason` describes what is still OWED rather than what happened.
		const finalizerOwnsSandboxTeardown =
			entry.summary.state !== "idle" &&
			Boolean(this.agentSandboxManager) &&
			this.sandboxState.hasSandbox(taskId) &&
			// A settled delivery owes nothing further — dispose here even if a superseded capture is still in flight
			// (its failure is benign, see the finalizer's delivery-settled catch branch). Without this, the retained
			// placement let a post-delivery salvage re-enter capture against a workspace the merge already consumed.
			!this.sandboxState.isDeliverySettled(taskId) &&
			(this.sandboxState.isFinalizing(taskId) ||
				!this.sandboxState.getResultBranch(taskId) ||
				recaptureReason !== null);
		if (!finalizerOwnsSandboxTeardown) {
			// RAIL (David 2026-07-20): a disposal must be explainable. Record WHY the workspace went, linked to the
			// task, so "where did my sandbox go?" is answerable from the card's own trail rather than by reasoning
			// backwards from a guard. Disposals that are correct still deserve a reason; the ones that are wrong are
			// only findable if the correct ones are recorded too.
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Sandbox workspace disposed for ${taskId} on stop: ${
					entry.summary.state === "idle"
						? "session was idle"
						: !this.sandboxState.hasSandbox(taskId)
							? "no sandbox placement was tracked"
							: "a result branch was already captured and no further capture is owed"
				}.`,
				taskId,
				metadata: {
					category: "sandbox_workspace_disposed",
					state: entry.summary.state,
					hadResultBranch: Boolean(this.sandboxState.getResultBranch(taskId)),
					recaptureExpected: false,
				},
			});
			await this.agentSandboxManager?.disposeWorkspace(taskId).catch(() => null);
			this.forgetSandboxTask(taskId);
		} else if (recaptureReason !== null) {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Sandbox workspace RETAINED for ${taskId} on stop: ${recaptureReason}. Disposing here would break the next capture (N7d).`,
				taskId,
				metadata: { category: "sandbox_workspace_retained", reason: recaptureReason },
			});
		}
		if (entry.summary.state === "idle") {
			return cloneSummary(entry.summary);
		}
		const summary = updateSummary(entry, {
			state: "interrupted",
			reviewReason: options.reviewReason ?? "interrupted",
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
		this.communitySkillAdmissionByTaskId.delete(taskId);
		this.communitySkillSuggestionFragmentByTaskId.delete(taskId);
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

	/**
	 * N7d option B: declare that a FURTHER sandbox capture is owed for this task, so `stopTaskSession` does not
	 * dispose the workspace the next round needs. Called on a review BOUNCE — the one case where a result branch
	 * exists (round 1) and another capture is still coming (round 2).
	 *
	 * Idempotent, and cleared by `deleteSandbox`/`forgetSandboxTask` so a marker cannot outlive its task and pin a
	 * workspace forever.
	 */
	markSandboxRecaptureExpected(taskId: string, reason: string): void {
		// Only isolated tasks owe a sandbox recapture. Marking an in-process task would retain restart config with no
		// sandbox finalizer capable of consuming the obligation.
		if (this.sandboxState.hasSandbox(taskId)) {
			this.sandboxState.markRecaptureExpected(taskId, reason);
		}
	}

	/** Clear the recapture marker once the owed capture has settled. */
	clearSandboxRecaptureExpected(taskId: string): void {
		this.sandboxState.clearRecaptureExpected(taskId);
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

	/** F1.14: label the task's NEXT attempt event with the recovery rung that produced it (e.g. redrive_empty_patch). */
	noteNextAttemptStrategy(taskId: string, strategy: string): void {
		this.nextAttemptStrategyByTaskId.set(taskId, strategy);
	}

	async sendTaskSessionInput(
		taskId: string,
		text: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		launchConfigOverrides?: NKleinTaskLaunchConfigOverrides,
		options?: { delivery?: "queue" | "steer"; freshModelCarry?: boolean },
	): Promise<RuntimeTaskSessionSummary | null> {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return null;
		}
		const interruptedRecaptureOwed =
			entry.summary.state === "interrupted" && this.sandboxState.recaptureExpectedReason(taskId) !== null;
		if (
			entry.summary.state !== "running" &&
			entry.summary.state !== "paused" &&
			entry.summary.state !== "awaiting_review" &&
			entry.summary.state !== "idle" &&
			entry.summary.state !== "failed" &&
			!interruptedRecaptureOwed
		) {
			return null;
		}
		// A capture marker can trigger a reviewer bounce while its finalizer is still releasing MCP transports and the
		// workspace. Wait for that transaction before changing the entry to running; otherwise restore can see the old cwd
		// as prepared, no-op, and then finalization deletes it under the live turn.
		await this.sandboxState.waitForFinalization(taskId);
		if (this.messageRepository.getTaskEntry(taskId) !== entry) {
			return null;
		}
		this.pendingTurnCancelTaskIds.delete(taskId);
		const normalized = options?.freshModelCarry
			? buildFreshModelCarryPrompt(text.trim(), entry.messages)
			: text.trim();
		const hasImages = Boolean(images && images.length > 0);
		const effectiveMode: RuntimeTaskSessionMode = mode ?? entry.summary.mode ?? "act";
		const effectiveLaunchConfig = this.resolveRestartLaunchConfig({ taskId, launchConfigOverrides });
		// A launch override changes the authoritative route for this task, even when the runtime can switch models
		// in-place without rebuilding the session. Keep the service's restart cache in lock-step with the runtime's
		// last-start request. Otherwise a later review/acceptance re-drive with no explicit override resurrects the
		// pre-failover model (live endpoint-loss proof 2026-07-22: Qwable disappeared, failover ran on Qwen, then the
		// acceptance bounce silently selected Qwable again). `startTaskSession` already caches before attempting the
		// effect, so doing the same here preserves the existing desired-config semantics if the turn itself fails.
		if (launchConfigOverrides && effectiveLaunchConfig) {
			this.cacheLaunchConfig(taskId, effectiveLaunchConfig);
		}
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
					...(effectiveLaunchConfig
						? {
								providerId: effectiveLaunchConfig.providerId,
								modelId: effectiveLaunchConfig.modelId,
								endpoint: effectiveLaunchConfig.baseUrl ?? null,
								sharedEndpointId: buildSharedLocalEndpointId({
									providerId: effectiveLaunchConfig.providerId,
									modelId: effectiveLaunchConfig.modelId,
									endpoint: effectiveLaunchConfig.baseUrl ?? null,
								}),
							}
						: {}),
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
							if (!queueDelivery && !options?.freshModelCarry) {
								// F12.6 consult (record-only first): the agent's own request_compaction fire is consumed at
								// this turn boundary and logged beside whether the budget compaction then actually ran —
								// once live data shows requests track real need, this flips to FORCING the compaction.
								const compactionRequest = getCompactionRequest(taskId);
								if (compactionRequest) {
									forgetCompactionRequest(taskId);
								}
								const proactiveCompaction = await this.contextOverflowController.compactBeforeOverflow({
									taskId,
									entry,
									prompt: resolvedPrompt,
									mode: effectiveMode,
									images,
									launchConfigOverrides,
									contextWindow: resolvedContextWindow,
								});
								if (compactionRequest) {
									recordSelfObservation({
										signal: "custom",
										severity: "info",
										message: `Agent requested compaction (${compactionRequest.reason}); budget compaction ${proactiveCompaction ? "FIRED" : "did not fire"} at this boundary.`,
										taskId,
										metadata: {
											category: "self_compaction_request",
											budgetCompactionFired: Boolean(proactiveCompaction),
										},
									});
								}
								if (proactiveCompaction) {
									return proactiveCompaction;
								}
							}
							return await this.dispatchResolvedTaskInput({
								taskId,
								prompt: resolvedPrompt,
								mode: effectiveMode,
								images,
								// F12.56: "steer" jumps the pending-prompt queue — the note lands before the next iteration.
								delivery: queueDelivery ? (options?.delivery ?? "queue") : undefined,
								launchConfigOverrides,
								forceRestart: restoredSandboxWorkspace,
								freshModelCarry: options?.freshModelCarry,
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
		await this.sessionRuntime.stopTaskSession(taskId, { suppressTaskEvents: true }).catch(() => null);
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
		// Review-found: a stale round-N prediction/compaction request surviving into round N+1 pollutes the very
		// divergence measurement F12.96's observe-first rollout depends on — forget them with the other per-task state.
		forgetPredictedOutput(taskId);
		forgetLiveTaskUsage(taskId);
		forgetBaselineProbe(taskId);
		forgetAcceptanceEvidence(taskId);
		forgetPropertyCheckEvidence(taskId);
		forgetCompactionRequest(taskId);
	}

	async clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const existingEntry = this.messageRepository.getTaskEntry(taskId);
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.providerIdStore.forget(taskId);
		this.contextBudgetController.forget(taskId);
		this.modelEndpoint.forget(taskId);
		this.contextBudgetInputs.forget(taskId);
		this.launchConfigByTaskId.delete(taskId);
		this.communitySkillAdmissionByTaskId.delete(taskId);
		this.communitySkillSuggestionFragmentByTaskId.delete(taskId);
		this.requestTimer.forget(taskId);
		this.failureBackoff.forget(taskId);
		this.autonomyBudgetWatchdog.resetTask(taskId);
		this.repeatedToolCallGuard.resetTask(taskId);
		this.turnLoopGuard.resetTask(taskId);
		this.clearTaskTimeouts(taskId);
		this.timeoutController.deleteSettings(taskId);
		forgetPredictedOutput(taskId);
		forgetLiveTaskUsage(taskId);
		forgetBaselineProbe(taskId);
		forgetAcceptanceEvidence(taskId);
		forgetPropertyCheckEvidence(taskId);
		forgetCompactionRequest(taskId);
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

	getTaskTurnGeneration(taskId: string): number {
		return this.sessionRuntime.getTaskTurnGeneration(taskId);
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

	getPromptCacheStats(): ReturnType<(typeof this.promptWarmthLedger)["getCacheStats"]> {
		return this.promptWarmthLedger.getCacheStats();
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

	setSandboxMcpServerControls(controls: SandboxMcpServerControls): void {
		this.sandboxMcpServerControls = { ...controls };
		this.basicMemoryEnabled = controls["basic-memory"];
		this.agentSandboxManager?.setBasicMemoryEnabled(this.isBasicMemoryEnabled());
	}

	/**
	 * §5.BB live-update the basic-memory switch when the runtime config changes (same seam as
	 * `setSandboxMcpServersEnabled`), forwarding to the sandbox manager so the per-project writable-store plan follows
	 * the setting for subsequently registered projects.
	 */
	setBasicMemoryEnabled(enabled: boolean): void {
		this.basicMemoryEnabled = enabled;
		this.sandboxMcpServerControls = { ...this.sandboxMcpServerControls, "basic-memory": enabled };
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
		resultCommit?: string;
		useBaseTree?: boolean;
	}): Promise<RuntimeTaskAcceptanceResult> {
		const result = await this.acceptanceVerifier.verify(input);
		// F12.96 predict-then-execute (record-only): when the worker predicted the acceptance output, compare the
		// prediction against REALITY — a divergence means its mental trace of its own code is wrong (a bug signal
		// tests alone miss). Best-effort; never alters the acceptance result.
		try {
			const prediction = getPredictedOutput(input.taskId);
			if (prediction && result.present) {
				const verdict = assessPredictedExecution([
					{ label: result.command ?? "acceptance", predicted: prediction.predicted, actual: result.output },
				]);
				forgetPredictedOutput(input.taskId);
				if (!verdict.pass) {
					recordSelfObservation({
						signal: "custom",
						severity: "warning",
						message: `Predicted-execution divergence for ${input.taskId}: ${verdict.reason}`,
						taskId: input.taskId,
						metadata: { category: "predicted_execution_divergence" },
					});
				}
			}
		} catch {
			// Observational only.
		}
		return result;
	}

	async verifyTaskVisualInSandbox(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		resultCommit?: string | null;
		route?: string;
		timeoutMs?: number;
	}): Promise<SandboxVisualDeliveryResult> {
		if (!this.agentSandboxManager) {
			throw new Error("!Klein visual verification requires the configured agent sandbox manager.");
		}
		return await verifyCurrentBuildVisualInSandbox({
			...input,
			sandboxManager: this.agentSandboxManager,
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
	async pickDiverseEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null> {
		// A worker's terminal transition deliberately clears the volatile launch cache before review begins. Review
		// escalation happens later, so consulting only that map falsely reports "no candidate" for every normally
		// completed worker. Recover the launch config from the SDK-owned persisted session metadata, using the same
		// cache/hydration path as restart and rebind. This keeps escalation available across both terminal cleanup and
		// runtime restarts.
		let launch = this.launchConfigByTaskId.get(taskId) ?? null;
		if (!launch) {
			const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(taskId).catch(() => null);
			launch = this.resolvePersistedLaunchConfig({ taskId, persistedSnapshot });
		}
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

	isSecondOpinionReviewInFlight(taskId: string): boolean {
		return this.secondOpinionReviewRunner.isSecondOpinionReviewInFlight(taskId);
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

	/** §5.L egress proxy (§6 I3): forward the persisted proxy flag + host allowlist to the sandbox manager. */
	setSandboxEgressConfig(enabled: boolean, allowlist: string): void {
		this.agentSandboxManager?.setSandboxEgressConfig(enabled, allowlist);
	}

	/** F2.3b control-plane access only; never exposes the manager to agent/model code. */
	getAgentSandboxManagerForEgressControl(): AgentSandboxManager | null {
		return this.agentSandboxManager;
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
		await this.clarificationWriteTail;
		// N13 dispose-flush contract: a disposed service has FLUSHED its fire-and-forget ledger writes — a late
		// write must never race whatever tears the store root down next (the live ENOTEMPTY flake's root cause).
		await this.pendingLedgerWrites.flush();
		// Patch capture is only the first half of finalization; host-side result-branch assembly and the durable marker
		// continue asynchronously. Drain them before clearing state/stopping Docker so clean shutdown cannot lose a result.
		await this.sandboxReviewFinalizer.drain();
		this.pendingTurnCancelTaskIds.clear();
		this.providerIdStore.clear();
		this.contextBudgetController.clear();
		this.modelEndpoint.clear();
		this.contextBudgetInputs.clear();
		this.requestTimer.clear();
		this.explicitDecompositionTaskIds.clear();
		this.recordedClarificationAskKeys.clear();
		this.sandboxState.clear();
		this.focusChainStore.clear();
		this.teamProgressEmitter.clear();
		await this.agentSandboxManager?.stopNow().catch(() => null);
		await this.runtimeSetupLeaseCache.disposeAll();
		this.messageRepository.dispose();
	}

	private emitSummary(summary: RuntimeTaskSessionSummary): void {
		const briefedSummary = this.withDecompositionStarvedBrief(summary);
		const guardedSummary = this.repeatedToolCallGuard.check(briefedSummary) ?? briefedSummary;
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
	 * P0.DSTALL layer 1 (the terminal semantic): a plan-mode session that reaches awaiting_review WITHOUT an
	 * applied decomposition is a STARVED decompose, not reviewable work — there is nothing to review. The
	 * state machinery stays untouched (the plan gate and operator flows key off awaiting_review); what was
	 * missing was the card SAYING so and naming the levers. The brief is idempotent (guarded by its own
	 * marker) and never overwrites an existing warning.
	 */
	private withDecompositionStarvedBrief(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary {
		if (
			summary.state !== "awaiting_review" ||
			!this.explicitDecompositionTaskIds.has(summary.taskId) ||
			this.decompositionAppliedTaskIds.has(summary.taskId) ||
			isDerivedTaskSessionId(summary.taskId)
		) {
			return summary;
		}
		if (summary.warningMessage) {
			return summary;
		}
		return {
			...summary,
			warningMessage:
				"Decomposition did not complete: the planning session ended without applying a decompose_project " +
				"result (typically the output budget ran out mid-graph, or the model stopped short). The board is NOT " +
				"waiting on a review — restart the card to continue the recovery ladder, lower the reasoning effort, " +
				"or split the objective by hand.",
		};
	}

	/**
	 * follow-up-6 §3.6: persist a terminal run summary to the durable store the first time a task transitions
	 * into a terminal session state, so the last-run outcome survives runtime shutdown (when `sessions.json` is
	 * reset to `{}`) and unfinished cards stay diagnosable.
	 */
	private captureTerminalRunSummary(summary: RuntimeTaskSessionSummary): void {
		const state = summary.state;
		if (state !== "awaiting_review" && state !== "failed" && state !== "interrupted") {
			// Terminal dedupe is per transition/attempt, not permanent per task. A model failover moves the same card
			// back through `running`; clear the prior terminal marker so an identical terminal state from the fresh
			// architect can trigger the next bounded failover hop and record its own attempt evidence.
			this.lastRecordedRunStateByTaskId.delete(summary.taskId);
			return;
		}
		const taskId = summary.taskId;
		// Snapshot before asynchronous capture/finalization can prune the launch/sandbox maps. The summary's path is the
		// sandbox cwd under isolation; ledger/task-run readers use the host workspace identity.
		const hostWorkspacePath = this.resolveHostWorkspacePathForTask(taskId, summary.workspacePath ?? null);
		if (this.lastRecordedRunStateByTaskId.get(taskId) === state) {
			return;
		}
		this.lastRecordedRunStateByTaskId.set(taskId, state);
		// W1.1b: flag-gated adaptive budget retry on the stall signature (see adaptiveBudgetController).
		this.adaptiveBudgetController.maybeAdaptiveBudgetRetry(taskId, summary);
		// F3.2 failover leg (default-on, NKLEIN_MODEL_FAILOVER=off to disable): a MODEL-side terminal error re-drives
		// the card on the next untried ranked candidate instead of parking (live-found twice — m4mini crash 2026-07-11,
		// ministral engine-500 2026-07-17). The controller's pure policy refuses task/sandbox/user errors and caps hops.
		this.modelFailoverController.maybeModelFailover(taskId, summary);
		// W0.2 (run16: t4 died `interrupted` MID-WRITE and its partial work was lost): a dying terminal still
		// salvages its sandbox work. error→awaiting_review already captures via the finalize hook (run10 proved
		// it live); interrupted/failed did NOT — no capture, and the sandbox leaked until pool exhaustion.
		// finalizeSandboxReview is idempotent-guarded, captures the patch to the result branch, and disposes the
		// workspace — exactly the salvage+cleanup pair a dead session owes.
		if (
			isTerminalFailureSessionState(state) &&
			this.sandboxState.hasSandbox(taskId) &&
			!this.sandboxState.getResultBranch(taskId) &&
			// A settled delivery owes no salvage: the merge already consumed the result (N5 flaky-02 late-capture race).
			!this.sandboxState.isDeliverySettled(taskId)
		) {
			this.sandboxReviewFinalizer.finalizeSandboxReview(taskId);
		}
		const usage = summary.latestUsage ?? null;
		// §5.AN decision-9: gate the recorded token telemetry by the configured level (full ⇒ as-is; basic ⇒ totals only;
		// off ⇒ suppress token stats, the attempt OUTCOME is still recorded). Applied ONCE so both recorders below (the
		// run-summary and the ledger attempt event) use the gated values.
		// N18 note: `totalTokens`/`reasoningTokens` are null in THIS input, but that is not the gap it first looked
		// like — checked 2026-07-20. `gatedUsage.totalTokens` is never READ: the run-summary recorder recomputes
		// total inline from prompt+completion, and the ledger attempt event records prompt+completion (from which
		// total is trivially derivable) and no separate total. Filling `totalTokens` here changes nothing
		// observable, so it is left null rather than dressed up as a fix. `reasoningTokens` is the only genuinely
		// missing datum, and it needs `readSessionUsage` to carry a reasoning field with the wire spelling
		// verified against a real reasoning model — not guessed.
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
				workspacePath: hostWorkspacePath,
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
			{ rootDir: this.taskRunSummaryRoot },
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
				// F1.1: distill the knowledge-tool usage summary here, where the transcript's tool calls are in hand —
				// projections correlate it with the attempt outcome without re-reading transcripts. The plan-declared
				// knowledge debt of the originating card rides along (null when unknown / not plan-born).
				const knowledgeDebtPresent = await resolveTaskKnowledgeDebtPresent(hostWorkspacePath, taskId);
				const knowledge = summarizeAttemptKnowledgeUsage(toolCalls, { knowledgeDebtPresent });
				// F1.5: the ledger and the reviewer prompt derive "the current step" from the SAME core helper.
				const focusStep = currentFocusChainStep(this.focusChainStore.get(taskId))?.text ?? null;
				// F1.14: the rung index = attempts this task already recorded (durable across restarts, so a re-driven
				// round is never mistaken for a first try); the captured result branch is the attempt's durable output
				// pointer; the configured context window is the budget its contextTokens are measured against.
				const attemptStrategy = this.nextAttemptStrategyByTaskId.get(taskId) ?? null;
				this.nextAttemptStrategyByTaskId.delete(taskId);
				// F1.15a: the SAME difficulty tier the fitness fold records, so ledger projections can key fitness cells.
				const difficultyCard = hostWorkspacePath
					? await loadWorkspaceState(hostWorkspacePath)
							.then(
								(state) =>
									state.board.columns
										.flatMap((column) => column.cards)
										.find((candidate) => candidate.id === taskId) ?? null,
							)
							.catch(() => null)
					: null;
				const difficulty = deriveTaskDifficultyTier(taskId, difficultyCard);
				// P21.14: ONE ledger read serves both the rung index and the tool-call watermark. Reading twice would
				// let the two disagree about which attempts exist for this task.
				const priorTaskAttempts = await readAgentLedger({
					workspacePathHash: hashWorkspacePathForLedger(hostWorkspacePath),
					rootDir: this.agentLedgerRoot,
				})
					.then((events) =>
						events.filter(
							(event): event is Extract<AgentLedgerEvent, { kind: "attempt" }> =>
								event.kind === "attempt" && event.taskId === taskId,
						),
					)
					.catch(() => [] as Extract<AgentLedgerEvent, { kind: "attempt" }>[]);
				const priorAttempts = priorTaskAttempts.length;
				// The transcript accumulates across a task's attempts; without this delta every terminal capture
				// re-records the whole history as if it were this attempt's work.
				const { toolCalls: attemptToolCalls, transcriptToolCallCount } = resolveAttemptToolCallDelta({
					allToolCalls: toolCalls,
					priorWatermarks: priorTaskAttempts.map((event) => event.transcriptToolCallCount ?? null),
				});
				await appendAgentLedgerEvent(
					buildTerminalAttemptEvent({
						taskId,
						workspacePath: hostWorkspacePath,
						state,
						role,
						// F12.29: stamp the surfaced procedures (empty/absent = the without-skill trajectory side).
						...(this.surfacedSkillIdsByTaskId.has(taskId)
							? { surfacedSkillIds: this.surfacedSkillIdsByTaskId.get(taskId) ?? [] }
							: {}),
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
						// P21.6b: the ledger's `contextTokens` means DEPTH — the last request's true prompt size —
						// while `usage.inputTokens` (the run result) SUMS input tokens across every model call of the
						// run (a Dschinn planning attempt recorded 449,707 against a 262,144 window). Depth-fitness
						// rows built from the sum are wrong-by-construction; null stays honest when no per-request
						// measurement was observed.
						promptTokens: this.sessionRuntime.getSessionLastRequestInputTokens(taskId),
						completionTokens,
						// N18: reasoning tokens now flow to the ledger too (per-ATTEMPT), from the same
						// `readSessionUsage` result that `usage` came from. null when the server reported no
						// breakdown — the fitness rollups keep null and 0 apart.
						reasoningTokens: usage?.reasoningTokens ?? null,
						timeoutReason,
						toolCalls: attemptToolCalls,
						transcriptToolCallCount,
						knowledge,
						focusStep,
						resultBranch: this.sandboxState.getResultBranch(taskId)?.refName ?? null,
						contextBudgetTarget: this.launchConfigByTaskId.get(taskId)?.contextWindow ?? null,
						retriesBefore: priorAttempts,
						promptStrategy: attemptStrategy,
						difficulty,
						taintLabels: this.sessionRuntime.getSessionTaintLabels(taskId),
						// P21.15: what the model was OFFERED. Read from the runtime's session binding, since only the
						// extension sees the post-transform, SDK-complete list.
						toolSetOffered: this.sessionRuntime.getSessionOfferedToolNames(taskId),
					}),
					{ rootDir: this.agentLedgerRoot },
				);
				// P0.DSTALL layer 2: a terminal row for a session that never ran a model turn is the ZOMBIE
				// signature (run-3: two rows 129ms apart for swallowed starts). The row stays — evidence is never
				// silently dropped — but the writer is LOUD so the pattern is diagnosable the moment it recurs.
				if (
					isZombieTerminalAttempt({
						toolCalls: attemptToolCalls.length,
						transcriptToolCallCount,
						promptTokens: this.sessionRuntime.getSessionLastRequestInputTokens(taskId),
						completionTokens,
						toolSetOffered: this.sessionRuntime.getSessionOfferedToolNames(taskId) ?? undefined,
					})
				) {
					recordSelfObservation({
						signal: "runtime_error",
						severity: "warning",
						message: `Zombie terminal attempt recorded for ${taskId} (state ${state}): the session never ran a model turn — no tools offered, no tokens, no tool calls. A start was likely swallowed or the dispatch was lost (P0.DSTALL).`,
						taskId,
						workspacePath: hostWorkspacePath,
						metadata: { category: "zombie_terminal_attempt", state },
					});
				}
				// F4.19: distill this finished task into the ProceduralSkillBank (opt-in NKLEIN_PROCEDURAL_SKILLS — the SAME
				// flag the consumer reads). A clean worker finish (`awaiting_review`, not failed/interrupted) with a
				// substantive completed focus chain becomes a CANDIDATE procedure — never surfaced until the lifecycle
				// promotes it on real helped/hurt evidence, so this can populate the bank without risking a live prompt.
				if (difficultyCard) {
					const chainSteps = this.focusChainStore.get(taskId)?.steps ?? [];
					const focusChainText = chainSteps
						.map((step) => `- [${step.status === "done" ? "x" : " "}] ${step.text}`)
						.join("\n");
					await maybeDistillAndStoreProcedure({
						taskId,
						taskTitle: difficultyCard.title?.trim() || difficultyCard.prompt.slice(0, 80),
						taskObjective: difficultyCard.prompt,
						focusChain: focusChainText,
						succeeded: state === "awaiting_review",
						role,
						now: Date.now(),
					});
				}
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
		this.communitySkillAdmissionByTaskId.delete(taskId);
		this.communitySkillSuggestionFragmentByTaskId.delete(taskId);
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
			onClarificationAsked: (ask) => {
				if (!this.onClarificationAsked) {
					return;
				}
				const key = `${ask.taskId}:${ask.toolCallId ?? computeNKleinToolInputFingerprint({ question: ask.question, options: ask.options })}`;
				this.clarificationWriteTail = this.clarificationWriteTail
					.then(async () => {
						// Check inside the serialized write, not when the event arrives. The SDK can emit both content_start and
						// tool-started for one native ask. If the first durable write fails, the already-queued duplicate then
						// retries it; only a completed write earns the dedupe marker.
						if (this.recordedClarificationAskKeys.has(key)) {
							return;
						}
						await this.onClarificationAsked?.(ask);
						this.recordedClarificationAskKeys.add(key);
					})
					.then(() => undefined)
					.catch((error) => {
						this.recordObservationWithModel({
							signal: "custom",
							severity: "warning",
							message: `Could not persist clarification block for ${ask.taskId}: ${error instanceof Error ? error.message : String(error)}`,
							taskId: ask.taskId,
							workspacePath: entry.summary.workspacePath,
							metadata: { category: "clarification_block_persist_failed" },
						});
					});
			},
		});
		if ((focusChainTouchDelta.files?.length ?? 0) > 0 || (focusChainTouchDelta.cardIds?.length ?? 0) > 0) {
			this.focusChainStore.applyTouches(taskId, focusChainTouchDelta);
		}
		// The repeated-tool guard runs inside emitSummary and may replace the adapter's still-running summary with an
		// awaiting_review guardrail summary. Finalization must inspect that authoritative post-guard state, not the
		// pre-guard object retained by applyNKleinSessionEvent, or a guarded task's real sandbox edits never capture and
		// the card remains permanently "unsettled" in Review.
		const effectiveLatestSummary = latestSummary ? entry.summary : null;
		const shouldAbortForCreditLimit = didCreditLimitJustTrigger(previousSummary, entry.summary);
		if (this.sandboxReviewFinalizer.shouldFinalizeSandboxReview(previousSummary, effectiveLatestSummary)) {
			this.sandboxReviewFinalizer.finalizeSandboxReview(taskId);
		} else if (shouldCaptureReviewCheckpoint(previousSummary, effectiveLatestSummary)) {
			this.captureReviewCheckpoint(taskId, effectiveLatestSummary);
		}
		const hookEventName = entry.summary.latestHookActivity?.hookEventName;
		let decompositionRecoveryScheduled = false;
		if (entry.summary.state !== "running") {
			this.clearTaskTimeout(taskId, "stream");
			this.clearTaskTimeout(taskId, "tool");
			this.clearTaskTimeout(taskId, "conversation");
			this.decompositionStallNudger.clearDecompositionChatNudge(taskId);
			this.activeToolTaskIds.delete(taskId);
			// An explicit planning turn that cleanly ended without applying a graph gets first claim on recovery.
			// The generic loop guard can otherwise park it as attention before this targeted bounded nudge sees `exit`.
			decompositionRecoveryScheduled = this.decompositionStallNudger.maybeContinueStalledDecomposition(taskId);
		}
		// §12 turn-loop ladder: with the turn's text settled (no active assistant stream), scan the trailing
		// completed turns for a re-raised question/proposal loop. Do not race a more-specific decomposition recovery.
		if (!decompositionRecoveryScheduled) {
			this.turnLoopGuard.check(taskId);
		}
		if (entry.summary.state === "running" && hookEventName === "tool_call" && !this.activeToolTaskIds.has(taskId)) {
			if (isDecompositionProgressTool(entry.summary.latestHookActivity?.toolName)) {
				// A normal work card may discover during refinement that it must split itself. The promotion prompt
				// explicitly permits that path, so the ACTUAL decomposition tool boundary must arm the same bounded
				// turn-end recovery as a card that started in plan mode. Without this promotion, a rejected graph
				// followed by a clean model stop was misclassified as ordinary worker completion and held in Review.
				this.explicitDecompositionTaskIds.add(taskId);
				this.decompositionStallNudger.clearDecompositionChatNudge(taskId);
			}
			this.activeToolTaskIds.add(taskId);
			this.clearTaskTimeout(taskId, "stream");
			this.timeoutController.scheduleToolTimeout(taskId);
		} else if (entry.summary.state === "running" && hookEventName === "tool_result") {
			if (isDecompositionProgressTool(entry.summary.latestHookActivity?.toolName)) {
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
