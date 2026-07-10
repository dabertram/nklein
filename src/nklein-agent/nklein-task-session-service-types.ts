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
import type { PromptWarmthLedgerEntry } from "../core/cache-warmth";
import type { FocusChain } from "../core/focus-chain";
import type { ModelStatsTrackingLevel } from "../core/model-stats-tracking-level";
import type { SkillDynamicsLevel } from "../core/skill-resolver";
import type { TaskRunTimeoutSource } from "../state/task-run-summary-store";
import type { AgentSandboxManager, AgentSandboxPoolConfig, AgentSandboxShellTarget } from "./nklein-agent-sandbox";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import type { NKleinDecompositionAppliedHandler } from "./nklein-decomposition-tool";
import type { NKleinTaskLaunchConfigOverrides } from "./nklein-launch-config";
import type { NKleinMergeResolutionSessionOutcome } from "./nklein-merge-resolution-runner";
import type { NKleinMessageRepository } from "./nklein-message-repository";
import type { NKleinPauseController } from "./nklein-pause-controller";
import type { NKleinPlanCritiqueResult } from "./nklein-plan-critique-tool";
import type { NKleinCardPromotedHandler } from "./nklein-promotion-tool";
import type { NKleinReviewResult } from "./nklein-review-tool";
import type { NKleinRuntimeSetup } from "./nklein-runtime-setup";
import type { CreateInMemoryNKleinSessionRuntimeOptions, NKleinSessionRuntime } from "./nklein-session-runtime";
import { buildSessionSkillFragments } from "./nklein-session-skill-fragments";
import type { NKleinTaskMessage } from "./nklein-session-state";
import type { NKleinWatcherRegistry } from "./nklein-watcher-registry";
import type { NKleinSdkPersistedMessage, NKleinSdkSlashCommand } from "./sdk-runtime-boundary.js";
import type { TurnLoopEscalationEvent } from "./turn-loop-guard";

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
	/**
	 * §5.BG: the STABLE publisher model key (`descriptor.modelKey`) the caller resolved for this model, when it's a
	 * locally-loaded model. Telemetry/observations key off THIS (not the renamable runtime `modelId`). Absent for
	 * cloud / not-loaded models ⇒ telemetry falls back to `modelId`.
	 */
	stableModelKey?: string | null;
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

export interface NKleinModelTurnAdmissionRequest {
	taskId: string;
	providerId: string;
	modelId: string;
	endpoint: string | null;
	onWaiting?: (event: { reason: string; retryAfterMs: number | null }) => void | Promise<void>;
}

export type NKleinModelTurnAdmissionGate = <T>(
	request: NKleinModelTurnAdmissionRequest,
	run: () => Promise<T>,
) => Promise<T>;

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
	 * the `promptWarmthLedger`. Read-only view for warmth-aware routing (`applyWarmthPreference`) — exposed
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
	/** Apply the §5.AR/§5.BB basic-memory switch (off by default) when config changes (also updates the sandbox manager). */
	setBasicMemoryEnabled(enabled: boolean): void;
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
		/** Diagnostic phase stamps (todo §12 review-hang autopsy); absent ⇒ zero overhead. */
		stampPhase?: (phase: string) => void;
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
	setModelTurnAdmissionGate(gate: NKleinModelTurnAdmissionGate | null): void;
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
	/**
	 * §12 turn-loop ladder, escalate-model rung: a running agent confirmed LOOPING on a boundary it cannot resolve,
	 * with a lineage-diverse loaded model available. The runtime effects the §5.AG routing (card-mailbox boundary
	 * note + card model override + redrive); absent ⇒ the guard parks the task with the specific question instead.
	 */
	onTurnLoopEscalation?: (event: TurnLoopEscalationEvent) => void | Promise<void>;
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
	 * The §5.AR/§5.BB basic-memory switch — OFF BY DEFAULT. When true (or the `NKLEIN_BASIC_MEMORY` env override is
	 * set), the default-off basic-memory curated MCP server is offered to fitting models and the sandbox manager mounts
	 * the per-project writable store. Live-updated when config changes (same seam as `swarmGuardrails`).
	 */
	basicMemoryEnabled?: boolean;
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
	 * Admission gate for actual SDK model turns after a session exists. Normal card STARTS are already gated in the
	 * tRPC start path, but review nudges, review-bounce re-drives, synthetic reviewers, plan critics, merge helpers, and
	 * restarts can otherwise submit directly to the model runtime and overload a host.
	 */
	modelTurnAdmissionGate?: NKleinModelTurnAdmissionGate | null;
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
