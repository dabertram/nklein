// §5.U cohesive extraction (2026-07-07): the session-runtime PUBLIC TYPE CONTRACT — the launch-config overrides, the
// SDK session-host boundary, the start-session request/result/snapshot shapes, the NKleinSessionRuntime interface, and
// its create-options — lifted out of nklein-session-runtime.ts. Behavior-preserving (types erase). The runtime file
// imports these back (type-only) and re-exports the public ones, so every importer (incl. nklein-task-tool-approval's
// type-only back-import of StartNKleinSessionRuntimeRequest) is unchanged.

import type { ToolExecutors } from "@cline/sdk";
import type { RuntimeNKleinReasoningEffort, RuntimeTaskImage, RuntimeTaskSessionMode } from "../core/api-contract";
import type { SandboxExecTarget } from "../core/sandbox-mcp-catalog";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import type { NKleinDecompositionAppliedHandler } from "./nklein-decomposition-tool";
import type { NKleinFocusChainSubmittedHandler } from "./nklein-focus-chain-tool";
import type { NKleinMcpRuntimeService } from "./nklein-mcp-runtime-service";
import type { NKleinMergeResolutionSubmittedHandler } from "./nklein-merge-resolution-tool";
import type { NKleinPlanCritiqueRequestHandler, NKleinPlanCritiqueSubmittedHandler } from "./nklein-plan-critique-tool";
import type { NKleinCardPromotedHandler } from "./nklein-promotion-tool";
import type { NKleinReviewSubmittedHandler } from "./nklein-review-tool";
import type { AgentTool } from "./sdk-agent-types";
import type {
	NKleinSdkPersistedMessage,
	NKleinSdkSessionHost,
	NKleinSdkSessionRecord,
	NKleinSdkStartSessionInput,
	NKleinSdkTeamEvent,
	NKleinSdkToolApprovalRequest,
	NKleinSdkToolApprovalResult,
	NKleinSdkUserInstructionService,
} from "./sdk-runtime-boundary";

export type NKleinSessionLaunchConfigOverrides = {
	providerId: string;
	modelId: string;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	maxAgentWritableFileLines?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
};

export interface NKleinSessionHostBoundary {
	start(input: NKleinSdkStartSessionInput): Promise<{ sessionId: string; result?: unknown }>;
	send(input: Parameters<NKleinSdkSessionHost["send"]>[0]): Promise<unknown>;
	stop(sessionId: string): Promise<void>;
	abort(sessionId: string): Promise<void>;
	delete(sessionId: string): Promise<boolean>;
	dispose(reason?: string): Promise<void>;
	get(sessionId: string): Promise<NKleinSdkSessionRecord | undefined>;
	list(limit?: number): Promise<NKleinSdkSessionRecord[]>;
	update?(
		sessionId: string,
		updates: {
			prompt?: string | null;
			metadata?: Record<string, unknown> | null;
			title?: string | null;
		},
	): Promise<{ updated: boolean }>;
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>;
	readMessages(sessionId: string): Promise<NKleinSdkPersistedMessage[]>;
	subscribe(listener: (event: unknown) => void): () => void;
}

export interface StartNKleinSessionRuntimeRequest {
	taskId: string;
	/**
	 * The AGENT-PERCEIVED working directory: the in-container sandbox workdir (`/workspaces/<taskId>`)
	 * for an isolated task, or the host project path for home/chat/non-isolated sessions. This is what
	 * the agent sees and writes paths relative to — never feed it to a host-side surface (use
	 * `workspaceRoot` for that). The service resolves it (`sandboxWorkspace?.workdir ?? hostCwd`) before
	 * calling in, so a real task's value is already the sandbox path.
	 */
	cwd: string;
	/**
	 * ALWAYS the host workspace root. Trusted control-plane reads (plan artifacts, repo-map / git-changes
	 * orientation) must use this, never `cwd`, because the sandbox workdir does not exist on the host.
	 */
	workspaceRoot?: string | null;
	prompt: string;
	/** Normalized !Klein task title; persisted to SDK session metadata when supported. */
	taskTitle?: string;
	initialMessages?: NKleinSdkPersistedMessage[];
	images?: RuntimeTaskImage[];
	providerId: string;
	modelId: string;
	mode?: RuntimeTaskSessionMode;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	/**
	 * W1.1a (audit 2026-07-02): optional per-TURN output-token budget, threaded to the SDK's
	 * `config.maxTokensPerTurn` (→ the gateway request's max_tokens). Unset ⇒ the SDK/provider default,
	 * byte-identical to before. The §5.AA truncation-recovery retry raises this via `raisedTokenBudget`.
	 */
	maxTokensPerTurn?: number | null;
	maxAgentWritableFileLines?: number | null;
	codeEmbeddingProvider?: NKleinCodeEmbeddingProvider;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
	systemPrompt: string;
	userInstructionService?: NKleinSdkUserInstructionService;
	toolPolicies?: NKleinSdkStartSessionInput["toolPolicies"];
	requestToolApproval?: (request: NKleinSdkToolApprovalRequest) => Promise<NKleinSdkToolApprovalResult>;
	toolExecutors?: Partial<ToolExecutors>;
	extraTools?: AgentTool[];
	/**
	 * §5.AR — the task's sandbox `docker exec` target, when curated sandbox-hosted MCP servers should be offered. Passed
	 * to {@link NKleinMcpRuntimeService.createToolBundle} (gated per-model by the §5.AL fit); `null`/absent ⇒ none. The
	 * opt-out gate lives in the caller (the task-session-service), so this is only set when the feature is enabled.
	 */
	sandboxMcpExecTarget?: SandboxExecTarget | null;
	/** §5.AR: basic-memory MCP exec env (CONFIG_DIR + MCP_PROJECT + hardening) for this task's project (from the manager). */
	basicMemoryExecEnv?: Record<string, string>;
	/** §5.BB: the resolved basic-memory opt-in (runtime setting OR env) — forwarded to createToolBundle. */
	basicMemoryEnabled?: boolean;
	onDecompositionApplied?: NKleinDecompositionAppliedHandler;
	/** W4.3: executes one diverse-critic round for a high-stakes decomposition (see createNKleinDecompositionTools). */
	requestPlanCritique?: NKleinPlanCritiqueRequestHandler;
	/**
	 * When provided, the `begin_implementation` promotion tool (todo §5.B) is attached so a work card can move
	 * itself from the Planning/Refinement lane to In Progress after its refinement pass. The service supplies this
	 * only for work-card starts (not decompose/plan-mode cards, which use `decompose_project`), so its presence is
	 * the gate for attaching the tool.
	 */
	onCardPromoted?: NKleinCardPromotedHandler;
	/** When provided, this is a second-opinion review turn: the `submit_review` tool is attached and its verdict is reported here. */
	onReviewSubmitted?: NKleinReviewSubmittedHandler;
	/** When provided, this is a W4.3 plan-critique turn: the `submit_plan_critique` tool is attached and its verdict is reported here. */
	onPlanCritiqueSubmitted?: NKleinPlanCritiqueSubmittedHandler;
	/** When provided, this is a §5.AK `::merge` turn: the `submit_merge_resolution` tool is attached and its verdict is reported here. */
	onMergeResolutionSubmitted?: NKleinMergeResolutionSubmittedHandler;
	/** Receives the agent's focus chain (todo §5.N) when it calls `update_focus_chain`; null disables the tool. */
	onFocusChainUpdated?: NKleinFocusChainSubmittedHandler;
	onTeamEvent?: (event: NKleinSdkTeamEvent, teamName: string | null) => void;
}

export interface StartNKleinSessionRuntimeResult {
	sessionId: string;
	result: unknown;
	warnings?: string[];
}

export interface NKleinPersistedTaskSessionSnapshot {
	record: NKleinSdkSessionRecord;
	messages: NKleinSdkPersistedMessage[];
}

export interface NKleinSessionRuntime {
	startTaskSession(request: StartNKleinSessionRuntimeRequest): Promise<StartNKleinSessionRuntimeResult>;
	restartTaskSession(input: {
		taskId: string;
		prompt: string;
		initialMessages?: NKleinSdkPersistedMessage[];
		images?: RuntimeTaskImage[];
		mode?: RuntimeTaskSessionMode;
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides;
		onTeamEvent?: (event: NKleinSdkTeamEvent, teamName: string | null) => void;
	}): Promise<StartNKleinSessionRuntimeResult>;
	sendTaskSessionInput(
		taskId: string,
		prompt: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		delivery?: "queue" | "steer",
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides,
	): Promise<unknown>;
	requiresTaskSessionRestart(
		taskId: string,
		mode?: RuntimeTaskSessionMode,
		launchConfigOverrides?: NKleinSessionLaunchConfigOverrides,
	): boolean;
	resumeTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null>;
	stopTaskSession(taskId: string): Promise<void>;
	abortTaskSession(taskId: string): Promise<void>;
	clearTaskSessions(taskId: string): Promise<void>;
	getTaskSessionId(taskId: string): string | null;
	getTaskProviderId(taskId: string): string | null;
	canRestartTaskSession(taskId: string): boolean;
	readPersistedTaskSession(taskId: string): Promise<NKleinPersistedTaskSessionSnapshot | null>;
	/**
	 * Release task-scoped MCP transports without clearing the SDK session binding. Sandbox review finalization can
	 * dispose `/workspaces/<taskId>` while the card parks for review; Docker-hosted MCP stdio transports must be
	 * closed at that same boundary and recreated on the next sandbox restart.
	 */
	releaseTaskMcpTools(taskId: string): Promise<void>;
	dispose(): Promise<void>;
}

export interface CreateInMemoryNKleinSessionRuntimeOptions {
	onTaskEvent?: (taskId: string, event: unknown) => void;
	createSessionHost?: () => Promise<NKleinSessionHostBoundary>;
	createMcpRuntimeService?: () => NKleinMcpRuntimeService;
}
