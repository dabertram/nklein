// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed NKlein, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type { ChatAgentModelResponse } from "../chat/chat-agent-loop";
import { createBoardMutationTools, createBoardReadTools } from "../chat/chat-board-tools";
import { createBrowserTools } from "../chat/chat-browser-tool";
import { classifyCommandSafety } from "../chat/chat-command-safety";
import { createCommandRunTool } from "../chat/chat-command-tool";
import type { ChatExecutionMode } from "../chat/chat-execution-mode";
import { createFocusChainTools, readChatFocusChain } from "../chat/chat-focus-chain";
import { recordChatHostAction } from "../chat/chat-host-action-audit-store";
import { appendChatToolExchange, createChatAgentModel, createChatModelDeps } from "../chat/chat-local-llm-adapter";
import { type ChatAgentToolDeps, type ChatService, createChatService } from "../chat/chat-service";
import type { ChatSession } from "../chat/chat-session-store";
import { createGatedChatToolExecutor } from "../chat/chat-tool-executor";
import type { ChatPromptMessage } from "../chat/chat-turn-context";
import { createWorkspaceReadTools } from "../chat/chat-workspace-tools";
import {
	DEFAULT_LOCAL_CHAT_BASE_URL,
	DEFAULT_LOCAL_CHAT_PROVIDER_ID,
	discoverLoadedModelId,
	resolveLocalChatModelDeps,
} from "../chat/local-chat-model";
import {
	buildPlanGapAdaptationRevision,
	buildPlanGapIntegrationRevision,
} from "../commands/task/task-plan-gap-prompts.js";
import {
	addPlanGapDecisionCardToBoard,
	addPlanGapIntegrationCardToBoard,
	addPlanGapScopeCardToBoard,
	inferNKleinPlanSlugForTask,
} from "../commands/task.js";
import { probeKleinCorePyHealth, resolveKleinCorePyConfig } from "../config/klein-core-config";
import type { RuntimeConfigState } from "../config/runtime-config";
import { loadGlobalRuntimeConfig, updateGlobalRuntimeConfig, updateRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeBoardCard,
	RuntimeCommandRunResponse,
	RuntimeProtectedTestApprovalGrantResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskContextImportResponse,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import {
	parseCommandRunRequest,
	parseNKleinAccountSwitchRequest,
	parseNKleinAddProviderRequest,
	parseNKleinAdvisorBuildRequest,
	parseNKleinAdvisorSendRequest,
	parseNKleinDeviceAuthCompleteRequest,
	parseNKleinDogfoodBacklogRequest,
	parseNKleinEndpointModelDiscoveryRequest,
	parseNKleinMcpOAuthRequest,
	parseNKleinMcpSettingsSaveRequest,
	parseNKleinOauthLoginRequest,
	parseNKleinProviderModelsRequest,
	parseNKleinProviderSettingsSaveRequest,
	parseNKleinUpdateProviderRequest,
	parseProtectedTestApprovalGrantRequest,
	parseRuntimeConfigSaveRequest,
	parseShellSessionStartRequest,
	parseTaskChatAbortRequest,
	parseTaskChatCancelRequest,
	parseTaskChatMessagesRequest,
	parseTaskChatReloadRequest,
	parseTaskChatSendRequest,
	parseTaskContextImportRequest,
	parseTaskEvidenceRequest,
	parseTaskPauseRequest,
	parseTaskSessionInputRequest,
	parseTaskSessionStartRequest,
	parseTaskSessionStopRequest,
} from "../core/api-validation";
import { readPausedTasks, setCardPaused } from "../core/card-pause";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { recordPlanGap } from "../core/plan-gap.js";
import { protectedTestApprovalStore } from "../core/protected-test-approval-store";
import { selectRoleModel } from "../core/role-model-selection";
import { clearSwarmStop, readSwarmStopSignal, requestSwarmStop } from "../core/swarm-guardrails";
import { reconcileStartedTaskBoardLane } from "../core/task-board-lane-reconcile";
import { findBoardCardWithColumn } from "../core/task-board-mutations";
import { resolveTaskTitle } from "../core/task-title.js";
import { buildNKleinAdvisorRequest } from "../nklein-sdk/nklein-advisor";
import { buildTaskShellSpawnSpec } from "../nklein-sdk/nklein-agent-sandbox";
import { createNKleinCodeEmbeddingProviderFromSettings } from "../nklein-sdk/nklein-code-embeddings";
import { isNKleinContextWindowPolicyError } from "../nklein-sdk/nklein-context-window-policy";
import {
	applyNKleinPlanTaskGraphToBoard,
	applyNKleinPlanTaskReplacementArtifacts,
} from "../nklein-sdk/nklein-decomposition-tool";
import { writeNKleinDogfoodBacklog } from "../nklein-sdk/nklein-dogfood-engine";
import { scheduleNKleinEndpointStart } from "../nklein-sdk/nklein-endpoint-scheduler";
import { runNKleinDevSmokeEval } from "../nklein-sdk/nklein-eval-harness";
import { LocalLlmClient } from "../nklein-sdk/nklein-local-llm-client";
import { assertLocalProviderAllowed, isCloudProviderDisabledError } from "../nklein-sdk/nklein-local-only-policy";
import { createNKleinMcpRuntimeService } from "../nklein-sdk/nklein-mcp-runtime-service";
import { createNKleinMcpSettingsService } from "../nklein-sdk/nklein-mcp-settings-service";
import { buildNKleinModelRegistryKey, getDefaultNKleinModelRegistry } from "../nklein-sdk/nklein-model-registry";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-sdk/nklein-model-research";
import {
	appendNKleinPlanRevision,
	listNKleinPlanArtifactsForSourceTask,
	type NKleinPlanArtifactSummary,
	readNKleinPlanArtifacts,
	readNKleinPlanArtifactsByArtifactId,
	summarizeNKleinPlanArtifacts,
	updateNKleinPlanArtifactApplicationStatus,
} from "../nklein-sdk/nklein-plan-artifacts";
import { createNKleinProviderService, type ResolvedNKleinLaunchConfig } from "../nklein-sdk/nklein-provider-service";
import { setNKleinLostHeartbeatPolicy } from "../nklein-sdk/nklein-session-state";
import { isNKleinClearSlashCommand } from "../nklein-sdk/nklein-slash-commands";
import { routeNKleinTask } from "../nklein-sdk/nklein-task-router";
import type { NKleinTaskSessionService } from "../nklein-sdk/nklein-task-session-service";
import {
	buildNKleinSandboxStartBlock,
	buildNKleinStartGuardCandidate,
	estimateNKleinStartDifficulty,
	estimateNKleinStartFitBudgetTokens,
	estimateNKleinStartPromptTokens,
	formatNKleinTaskRoutingBlockMessage,
	type NKleinStartGuardCandidate,
} from "../nklein-sdk/nklein-task-start-guard";
import { applyMcsrAwareLocalTimeoutScaling } from "../nklein-sdk/nklein-timeout-scaling";
import { openInBrowser } from "../server/browser";
import { readMergeHistory } from "../state/merge-history-store";
import { readTaskRunSummaries } from "../state/task-run-summary-store";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { createEvidenceBundle } from "../telemetry/evidence-bundle";
import { readSelfObservationEvents, recordSelfObservation } from "../telemetry/self-observation-sink";
import { buildRuntimeConfigResponse } from "../terminal/agent-registry";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { getWorkspaceChanges, getWorkspaceChangesBetweenRefs } from "../workspace/get-workspace-changes";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import {
	mergeTaskWorktreesInDependencyOrder,
	type TaskWorktreeAutoMergeStep,
} from "../workspace/task-worktree-auto-merge";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router";
import { handleGetNKleinCodeIntelligenceStatus } from "./runtime-api/code-intelligence-status.js";
import { importGitHubIssueContext, importGitHubPrDiffContext } from "./runtime-api/github-context-import.js";
import { runLocalAdvisorCompletion } from "./runtime-api/local-advisor-completion.js";
import {
	handleGetNKleinModelRegistry,
	handlePruneNKleinModelRegistry,
	handleRemoveNKleinModelRegistryEntry,
	handleSaveNKleinModelContextWindowOverride,
	handleSaveNKleinModelMaxConcurrentRequests,
} from "./runtime-api/model-registry.js";
import {
	countActiveProjectTaskSessions,
	createConcurrencyLimitStartError,
} from "./runtime-api/task-concurrency-gate.js";
import { buildTaskEvidencePromptBlock, renderWorkspaceChangesEvidence } from "./runtime-api/task-evidence-prompt.js";
import { resolveEffectiveTaskTimeoutSettings } from "./runtime-api/task-timeout-settings.js";
import {
	handleGetKnowledgeToolUsageStats,
	handleGetModelPerformanceStats,
	handleGetUpdateStatus,
	handleRunUpdateNow,
} from "./runtime-api/update-status.js";
import type { RuntimeTaskStartQueue } from "./runtime-task-start-queue";

const execFileAsync = promisify(execFile);

function withTaskPausedState(
	summary: RuntimeTaskSessionSummary | null,
	pausedTaskIds: Set<string>,
): RuntimeTaskSessionSummary | null {
	return summary ? { ...summary, paused: pausedTaskIds.has(summary.taskId) } : null;
}

export interface CreateRuntimeApiDependencies {
	getActiveWorkspaceId: () => string | null;
	/** The active workspace's repo root, or null when no project is active. Drives the chat agent's read-only tools
	 *  (todo §5.M G3a): with an active workspace the chat routes through the tool-using loop; without one it stays
	 *  plain. */
	getActiveWorkspacePath: () => string | null;
	getActiveRuntimeConfig?: () => RuntimeConfigState;
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	setActiveRuntimeConfig: (config: RuntimeConfigState) => void;
	getScopedTerminalManager: (scope: RuntimeTrpcWorkspaceScope) => Promise<TerminalSessionManager>;
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
	getLoadedScopedNKleinTaskSessionService?: (scope: RuntimeTrpcWorkspaceScope) => NKleinTaskSessionService | null;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	broadcastNKleinMcpAuthStatusesUpdated?: (
		statuses: Awaited<ReturnType<ReturnType<typeof createNKleinMcpRuntimeService>["getAuthStatuses"]>>,
	) => void;
	broadcastTaskChatCleared?: (workspaceId: string, taskId: string) => void;
	bumpNKleinSessionContextVersion?: () => void;
	prepareForStateReset?: () => Promise<void>;
	taskStartQueue?: RuntimeTaskStartQueue;
	getDogfoodTelemetryRoot?: () => string;
	getEvidenceBundleRoot?: () => string;
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
	getAgentSandboxStatus?: () => RuntimeAgentSandboxStatus;
	refreshAgentSandboxStatus?: () => Promise<RuntimeAgentSandboxStatus>;
	/** Board-independent chat service (todo §5.M); defaults to the real runtime home. Injected in tests. */
	chatService?: ChatService;
	/**
	 * True when the runtime is bound to a non-loopback host (remote/`--host` mode).
	 * Both `runCommand` and `openFile` refuse in remote mode because they execute
	 * host-local actions that only make sense on the server host, not on a remote
	 * browser client's machine. Defaults to `false` (local mode) when omitted so
	 * test helpers that do not set it continue to work.
	 */
	isRemoteMode?: boolean;
}

function findTaskCard(board: RuntimeWorkspaceStateResponse["board"], taskId: string): RuntimeBoardCard | null {
	for (const column of board.columns) {
		const card = column.cards.find((candidate) => candidate.id === taskId);
		if (card) {
			return card;
		}
	}
	return null;
}

async function resolveGitCommit(cwd: string, ref: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", ref], {
			cwd,
			timeout: 5_000,
			maxBuffer: 128 * 1024,
		});
		const commit = stdout.trim();
		return commit || null;
	} catch {
		return null;
	}
}

function findBoardCardById(cards: readonly RuntimeBoardCard[], taskId: string): RuntimeBoardCard | null {
	return cards.find((card) => card.id === taskId) ?? null;
}

function findSourceCardBaseRef(cards: readonly RuntimeBoardCard[], sourceTaskId: string | null): string | null {
	if (!sourceTaskId) {
		return null;
	}
	return findBoardCardById(cards, sourceTaskId)?.baseRef ?? null;
}

async function reconcileRunningTaskBoardLane(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	summary: RuntimeTaskSessionSummary,
): Promise<void> {
	await reconcileStartedTaskBoardLane({ workspacePath: workspaceScope.workspacePath, summary });
}

function toRuntimePlanArtifactSummary(summary: NKleinPlanArtifactSummary): NKleinPlanArtifactSummary {
	return summary;
}

function formatAcceptanceVerifyMessage(input: {
	present: boolean;
	passed: boolean | null;
	command: string | null;
	exitCode: number | null;
}): string {
	if (!input.present) {
		return "No Acceptance check line was found on this card.";
	}
	if (input.passed) {
		return `Acceptance check passed: ${input.command ?? "command"}.`;
	}
	return `Acceptance check failed${input.exitCode === null ? "" : ` with exit ${input.exitCode}`}: ${input.command ?? "command"}.`;
}

function recordTaskWorktreeMergeObservations(input: {
	workspacePath: string;
	steps: readonly TaskWorktreeAutoMergeStep[];
	ok: boolean;
}): void {
	for (const step of input.steps) {
		if (!step.taskId) {
			continue;
		}
		const severity = step.type === "conflict" || step.type === "blocked" ? "warning" : "info";
		const message =
			step.type === "merged"
				? `Task result merged: ${step.taskId}`
				: step.type === "skipped"
					? `Task result merge skipped: ${step.taskId}`
					: step.type === "conflict"
						? `Task result merge conflict: ${step.taskId}`
						: `Task result merge blocked: ${step.reason}`;
		recordSelfObservation({
			signal: "custom",
			severity,
			message,
			taskId: step.taskId,
			workspacePath: input.workspacePath,
			metadata: {
				category: "task_worktree_merge",
				ok: input.ok,
				type: step.type,
				reason: "reason" in step ? step.reason : null,
				headCommit: "headCommit" in step ? step.headCommit : null,
				conflictedPaths: "conflictedPaths" in step ? step.conflictedPaths : null,
			},
		});
	}
}

function formatMergeMessage(input: {
	ok: boolean;
	mergedTaskIds: readonly string[];
	skippedTaskIds: readonly string[];
	conflict?: { taskId: string; conflictedPaths: readonly string[] } | null;
	blocked?: { reason: string } | null;
}): string {
	if (input.conflict) {
		const paths =
			input.conflict.conflictedPaths.length > 0 ? ` Conflicts: ${input.conflict.conflictedPaths.join(", ")}.` : "";
		return `Merge conflict while merging ${input.conflict.taskId}.${paths}`;
	}
	if (input.blocked) {
		return `Merge blocked: ${input.blocked.reason}`;
	}
	return `Merged ${input.mergedTaskIds.length} task results; skipped ${input.skippedTaskIds.length}.`;
}

function applyCandidateEffectiveContextWindow<TLaunchConfig extends ResolvedNKleinLaunchConfig>(
	launchConfig: TLaunchConfig,
	candidate: NKleinStartGuardCandidate<TLaunchConfig>,
): TLaunchConfig {
	const effectiveContextWindow = candidate.entry.contextWindow.effective;
	if (
		typeof effectiveContextWindow !== "number" ||
		!Number.isFinite(effectiveContextWindow) ||
		effectiveContextWindow <= 0 ||
		launchConfig.contextWindow === effectiveContextWindow
	) {
		return launchConfig;
	}
	return {
		...launchConfig,
		contextWindow: effectiveContextWindow,
	};
}

/**
 * Build the chat service's `resolveAgentToolDeps` (todo §5.M G3a): for a session, when there IS an active workspace,
 * return the READ-ONLY tool-using agent deps — `read_file`/`list_dir` (`createWorkspaceReadTools`) + `get_board`
 * (`createBoardReadTools`), an `isolated_readonly` gated executor (every read tool is `sandbox_read` = always allowed,
 * so no confirm is ever needed), and a tools-aware local model — so the right-sidebar chat can read the project + see
 * the board. Returns null when there is no active workspace OR no loaded local model, so the session falls back to the
 * plain completion path. The audit log is written like the CLI (`recordChatHostAction`). The model dep also exposes a
 * final-answer streaming path: when the loop passes an `onToken` (the no-tool final reply), it streams via the client's
 * SSE completion (hybrid streaming) so a tool-routed turn that ends in plain text still emits token deltas.
 */
function buildChatAgentToolDepsResolver(input: {
	getActiveWorkspacePath: () => string | null;
	getLocalChatBaseUrl: () => string | null;
	/** Forwarded to `createBrowserTools` for §5.Y #5 SSRF protection. */
	isRemoteMode: boolean;
}): (session: ChatSession) => Promise<ChatAgentToolDeps | null> {
	return async (session) => {
		const workspacePath = input.getActiveWorkspacePath();
		if (!workspacePath) {
			return null;
		}
		const baseUrl = input.getLocalChatBaseUrl()?.trim() || DEFAULT_LOCAL_CHAT_BASE_URL;
		const modelId = await discoverLoadedModelId(baseUrl);
		if (!modelId) {
			// No loaded model: stay on the plain path (which resolves its own deps and surfaces a clear error).
			return null;
		}
		// LocalLlmClient fails closed against cloud (invariant #1) in its constructor.
		const client = new LocalLlmClient({ providerId: DEFAULT_LOCAL_CHAT_PROVIDER_ID, modelId, baseUrl });
		// Scope-driven capability (§5.M permission model). The session scope is the control: "chat only" is the
		// read-only floor; current/all-projects/host can act. Map scope → the execution mode the gate enforces.
		// read_file/list_dir/get_board/update_focus_chain are always offered (sandbox_read = always allowed);
		// create_card (control_plane) + run_command (host_command) are offered only to can-act scopes. run_command is
		// confirm-gated: the `confirm` callback below auto-approves commands the allowlist classifier deems SAFE and
		// denies UNSAFE ones (until the general risk-acknowledgement toggle lands — todo §5.M G3b).
		const mode: ChatExecutionMode =
			session.scope === "chat_only"
				? "isolated_readonly"
				: session.scope === "host_access"
					? "host"
					: "sandbox_with_host_escape";
		const canAct = session.scope !== "chat_only";
		const read = createWorkspaceReadTools(workspacePath);
		const board = createBoardReadTools(workspacePath);
		const focus = createFocusChainTools(session.id);
		const mutations = canAct ? createBoardMutationTools(workspacePath) : { tools: [], definitions: [] };
		const commands = canAct ? createCommandRunTool(workspacePath) : { tools: [], definitions: [] };
		// §5.M G6: the headless-browser tool is an orthogonal, per-session opt-in (`browserEnabled`). It's a host_command
		// (reaching the internet is a host action), so the mode gate denies it in chat-only and confirms it in the
		// host-capable scopes — the toggle is that confirmation (approved in the `confirm` callback below).
		// §5.Y #5: pass isRemoteMode so the tool blocks SSRF-risk internal addresses in remote (--host) mode.
		const browser = session.browserEnabled
			? createBrowserTools({ isRemoteMode: input.isRemoteMode })
			: { tools: [], definitions: [] };
		const tools = [
			...read.tools,
			...board.tools,
			...focus.tools,
			...mutations.tools,
			...commands.tools,
			...browser.tools,
		];
		const definitions = [
			...read.definitions,
			...board.definitions,
			...focus.definitions,
			...mutations.definitions,
			...commands.definitions,
			...browser.definitions,
		];

		const executeTool = createGatedChatToolExecutor({
			sessionId: session.id,
			mode,
			tools,
			// §5.M G3b safe/unsafe risk model: run_command is a confirm-gated host_command in can-act modes. A command
			// the allowlist classifier rules SAFE (build/test/inspection) auto-approves; an UNSAFE one runs only when
			// the user has acknowledged the risk for this session (`riskAcknowledged`, the general-ack toggle) —
			// otherwise it's denied. Other confirm-gated actions stay denied for now (no web-ui confirm dialog yet).
			confirm: async (call) => {
				if (call.name === "run_command" && typeof call.arguments.command === "string") {
					if (classifyCommandSafety(call.arguments.command).safety === "safe") {
						return true;
					}
					return session.riskAcknowledged === true;
				}
				// §5.M G6: browsing is gated by the explicit per-session `browserEnabled` toggle — that opt-in IS the
				// consent for the host_command confirm. (The tool is only present when enabled; this is belt-and-braces.)
				if (call.name === "browse_url") {
					return session.browserEnabled === true;
				}
				return false;
			},
			recordAudit: async (record) => {
				await recordChatHostAction({ ...record });
			},
		});

		const toolModel = createChatAgentModel(client, definitions);
		// Streaming final-answer dep: the tools-disabled final reply streams via the plain SSE completion (no tools);
		// tool-discovery turns use the non-streaming tools-aware completion so the model can still request tools.
		const streamComplete = createChatModelDeps(client).complete;
		const model = async (
			messages: readonly ChatPromptMessage[],
			allowTools: boolean,
			onToken?: (delta: string) => void,
		): Promise<ChatAgentModelResponse> => {
			if (onToken) {
				const text = await streamComplete([...messages], onToken);
				return { text, toolCalls: [] };
			}
			return toolModel(messages, allowTools);
		};

		return {
			model,
			executeTool,
			appendToolExchange: appendChatToolExchange,
			readFocusChain: (sessionId: string) => readChatFocusChain(sessionId),
		};
	};
}

export function createRuntimeApi(deps: CreateRuntimeApiDependencies): RuntimeTrpcContext["runtimeApi"] {
	const nkleinProviderService = createNKleinProviderService();
	const nkleinMcpSettingsService = createNKleinMcpSettingsService();
	const nkleinMcpRuntimeService = createNKleinMcpRuntimeService({
		onAuthStatusesChanged: (statuses) => {
			deps.broadcastNKleinMcpAuthStatusesUpdated?.(statuses);
		},
	});
	const debugResetTargetPaths = [
		join(homedir(), ".nklein", "data"),
		join(homedir(), ".nklein", "nklein"),
		join(homedir(), ".nklein", "worktrees"),
	] as const;
	// Board-independent chat service (todo §5.M); production uses the real runtime home (no rootDir) and resolves a
	// loaded local model per send (so "no model loaded" surfaces as a clear error at send time, not at startup).
	const chatService =
		deps.chatService ??
		createChatService({
			// Use the configured LOCAL provider endpoint (LM Studio / Ollama) when one is selected, so the chat hits the
			// same model server the user set — not a hardcoded default port. A cloud selection resolves to null and the
			// chat falls back to its own default local endpoint (the chat is local-only).
			resolveModelDeps: () =>
				resolveLocalChatModelDeps({ baseUrl: nkleinProviderService.getLocalChatBaseUrl() ?? undefined }),
			// G3a: when a project is active, route the chat through the tool-using agent loop with READ-ONLY tools
			// (read_file/list_dir/get_board); without an active workspace this returns null and the chat stays plain.
			resolveAgentToolDeps: buildChatAgentToolDepsResolver({
				getActiveWorkspacePath: deps.getActiveWorkspacePath,
				getLocalChatBaseUrl: () => nkleinProviderService.getLocalChatBaseUrl(),
				isRemoteMode: deps.isRemoteMode ?? false,
			}),
		});

	const buildConfigResponse = (runtimeConfig: RuntimeConfigState) =>
		buildRuntimeConfigResponse(
			runtimeConfig,
			nkleinProviderService.getProviderSettingsSummary(),
			deps.getAgentSandboxStatus?.(),
		);

	return {
		loadConfig: async (workspaceScope) => {
			const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
			if (!workspaceScope && !activeRuntimeConfig) {
				throw new Error("No active runtime config provider is available.");
			}
			let scopedRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			} else if (activeRuntimeConfig) {
				scopedRuntimeConfig = activeRuntimeConfig;
			} else {
				throw new Error("No active runtime config provider is available.");
			}
			setNKleinLostHeartbeatPolicy(scopedRuntimeConfig.lostHeartbeatPolicy);
			return buildConfigResponse(scopedRuntimeConfig);
		},
		saveConfig: async (workspaceScope, input) => {
			const parsed = parseRuntimeConfigSaveRequest(input);
			let nextRuntimeConfig: RuntimeConfigState;
			if (workspaceScope) {
				nextRuntimeConfig = await updateRuntimeConfig(workspaceScope.workspacePath, parsed);
			} else {
				const activeRuntimeConfig = deps.getActiveRuntimeConfig?.();
				if (!activeRuntimeConfig) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "No active runtime config is available.",
					});
				}
				nextRuntimeConfig = await updateGlobalRuntimeConfig(activeRuntimeConfig, parsed);
			}
			if (workspaceScope && workspaceScope.workspaceId === deps.getActiveWorkspaceId()) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			if (!workspaceScope) {
				deps.setActiveRuntimeConfig(nextRuntimeConfig);
			}
			setNKleinLostHeartbeatPolicy(nextRuntimeConfig.lostHeartbeatPolicy);
			return buildConfigResponse(nextRuntimeConfig);
		},
		getModelPerformanceStats: async (workspaceScope) => {
			return await handleGetModelPerformanceStats(workspaceScope);
		},
		getKnowledgeToolUsageStats: async (workspaceScope) => {
			return await handleGetKnowledgeToolUsageStats(workspaceScope);
		},
		getSwarmStop: async (workspaceScope) => {
			return {
				ok: true,
				signal: await readSwarmStopSignal(workspaceScope.workspacePath),
			};
		},
		requestSwarmStop: async (workspaceScope, input) => {
			const signal = await requestSwarmStop({
				workspacePath: workspaceScope.workspacePath,
				reason: input.reason,
			});
			deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope)?.setBoardPaused(true);
			return {
				ok: true,
				signal,
			};
		},
		clearSwarmStop: async (workspaceScope) => {
			await clearSwarmStop(workspaceScope.workspacePath);
			const nkleinTaskSessionService = deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope) ?? null;
			nkleinTaskSessionService?.setBoardPaused(false);
			await nkleinTaskSessionService?.resumePausedTasks();
			return {
				ok: true,
				signal: null,
			};
		},
		getTaskDiagnostics: async (workspaceScope, input) => {
			const [events, runSummaries] = await Promise.all([
				readSelfObservationEvents({
					taskId: input.taskId,
					workspacePath: workspaceScope.workspacePath,
					limit: input.limit ?? 25,
				}),
				readTaskRunSummaries({
					taskId: input.taskId,
					workspacePath: workspaceScope.workspacePath,
					limit: input.limit ?? 25,
				}),
			]);
			return {
				ok: true,
				events,
				runSummaries,
			};
		},
		listNKleinPlanArtifacts: async (workspaceScope, input) => {
			const artifacts = await listNKleinPlanArtifactsForSourceTask({
				workspacePath: workspaceScope.workspacePath,
				sourceTaskId: input.taskId,
				applicationStatus: "pending",
			});
			return {
				artifacts: artifacts.map(toRuntimePlanArtifactSummary),
			};
		},
		applyNKleinPlanArtifact: async (workspaceScope, input) => {
			const artifacts = await readNKleinPlanArtifactsByArtifactId({
				workspacePath: workspaceScope.workspacePath,
				artifactId: input.artifactId,
			});
			if (artifacts.metadata.applicationStatus === "rejected") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Rejected plan artifacts cannot be applied.",
				});
			}
			const runtimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope).catch(() => null);
			const mutation = await mutateWorkspaceState(workspaceScope.workspacePath, (state) => {
				const cards = state.board.columns.flatMap((column) => column.cards);
				const baseRef =
					findSourceCardBaseRef(cards, artifacts.metadata.sourceTaskId) ??
					state.git.currentBranch ??
					state.git.defaultBranch;
				if (!baseRef) {
					throw new Error("Could not determine a base branch for applying the plan artifact.");
				}
				if (artifacts.metadata.sourceTaskId && !findBoardCardById(cards, artifacts.metadata.sourceTaskId)) {
					throw new Error(`Source card ${artifacts.metadata.sourceTaskId} was not found on this board.`);
				}
				const applied = applyNKleinPlanTaskGraphToBoard({
					board: state.board,
					taskGraph: artifacts.taskGraph,
					baseRef,
					randomUuid: randomUUID,
					sourceTaskId: artifacts.metadata.sourceTaskId,
					modelRoleSettings: runtimeConfig?.effectiveModelRoles,
					sharedContext: {
						spec: artifacts.spec,
						decisionsMarkdown: artifacts.decisionsMarkdown,
					},
				});
				return {
					board: applied.board,
					value: {
						createdTaskCount: applied.createdTasks.length,
						createdDependencyCount: applied.createdDependencies.length,
					},
				};
			});
			await updateNKleinPlanArtifactApplicationStatus({
				workspacePath: workspaceScope.workspacePath,
				slug: artifacts.taskGraph.slug,
				applicationStatus: "applied",
			});
			const updatedArtifacts = await readNKleinPlanArtifactsByArtifactId({
				workspacePath: workspaceScope.workspacePath,
				artifactId: input.artifactId,
			});
			return {
				ok: true,
				artifact: summarizeNKleinPlanArtifacts(updatedArtifacts),
				createdTaskCount: mutation.value.createdTaskCount,
				createdDependencyCount: mutation.value.createdDependencyCount,
				message: `Applied ${artifacts.taskGraph.title}: created ${mutation.value.createdTaskCount} cards and ${mutation.value.createdDependencyCount} dependencies.`,
				workspaceState: mutation.state,
			};
		},
		rejectNKleinPlanArtifact: async (workspaceScope, input) => {
			const artifacts = await readNKleinPlanArtifactsByArtifactId({
				workspacePath: workspaceScope.workspacePath,
				artifactId: input.artifactId,
			});
			if (artifacts.metadata.applicationStatus === "applied") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Applied plan artifacts cannot be rejected.",
				});
			}
			await updateNKleinPlanArtifactApplicationStatus({
				workspacePath: workspaceScope.workspacePath,
				slug: artifacts.taskGraph.slug,
				applicationStatus: "rejected",
			});
			const updatedArtifacts = await readNKleinPlanArtifactsByArtifactId({
				workspacePath: workspaceScope.workspacePath,
				artifactId: input.artifactId,
			});
			return {
				ok: true,
				artifact: summarizeNKleinPlanArtifacts(updatedArtifacts),
				message: `Rejected ${artifacts.taskGraph.title}.`,
			};
		},
		recordNKleinPlanGap: async (workspaceScope, input) => {
			// Record telemetry observation (fire-and-forget, non-throwing).
			recordPlanGap({
				workspacePath: workspaceScope.workspacePath,
				taskId: input.taskId,
				kind: input.kind,
				description: input.description,
				evidence: input.evidence,
			});

			// Append a plan revision if this task belongs to a known plan.
			const planSlug = await inferNKleinPlanSlugForTask({
				workspacePath: workspaceScope.workspacePath,
				taskId: input.taskId,
			});

			let workspaceState: RuntimeWorkspaceStateResponse | undefined;

			if (
				input.kind === "integration_needed" ||
				input.kind === "missing_decision" ||
				input.kind === "contradictory_requirement" ||
				input.kind === "scope_too_large"
			) {
				// These kinds create a companion Planning card.
				const mutation = await mutateWorkspaceState<{ adaptationTaskId: string | null; created: boolean }>(
					workspaceScope.workspacePath,
					(latestState) => {
						const baseRef = latestState.git.currentBranch ?? latestState.git.defaultBranch ?? "main";
						let adapted: {
							board: typeof latestState.board;
							task: RuntimeBoardCard;
							created: boolean;
						};
						if (input.kind === "integration_needed") {
							adapted = addPlanGapIntegrationCardToBoard({
								state: latestState,
								taskId: input.taskId,
								description: input.description,
								evidence: input.evidence,
								baseRef,
							});
						} else if (input.kind === "scope_too_large") {
							adapted = addPlanGapScopeCardToBoard({
								state: latestState,
								taskId: input.taskId,
								description: input.description,
								evidence: input.evidence,
								baseRef,
							});
						} else {
							// TypeScript can't infer that only missing_decision/contradictory_requirement
							// reach here; the outer if already excludes integration_needed and scope_too_large.
							const decisionKind = input.kind as Extract<
								typeof input.kind,
								"missing_decision" | "contradictory_requirement"
							>;
							adapted = addPlanGapDecisionCardToBoard({
								state: latestState,
								taskId: input.taskId,
								kind: decisionKind,
								description: input.description,
								evidence: input.evidence,
								baseRef,
							});
						}
						return {
							board: adapted.board,
							value: {
								adaptationTaskId: typeof adapted.task.id === "string" ? adapted.task.id : null,
								created: adapted.created,
							},
						};
					},
				);
				workspaceState = mutation.state;

				// Append a plan revision cross-linking the new card.
				if (planSlug && mutation.value.adaptationTaskId && mutation.value.created) {
					if (input.kind === "integration_needed") {
						const revision = buildPlanGapIntegrationRevision({
							taskId: input.taskId,
							integrationTaskId: mutation.value.adaptationTaskId,
							description: input.description,
							evidence: input.evidence,
						});
						await appendNKleinPlanRevision({
							workspacePath: workspaceScope.workspacePath,
							slug: planSlug,
							taskId: input.taskId,
							kind: revision.kind,
							description: revision.description,
							evidence: revision.evidence ?? undefined,
						});
					} else {
						const revision = buildPlanGapAdaptationRevision({
							taskId: input.taskId,
							adaptationTaskId: mutation.value.adaptationTaskId,
							kind: input.kind,
							description: input.description,
							evidence: input.evidence,
						});
						await appendNKleinPlanRevision({
							workspacePath: workspaceScope.workspacePath,
							slug: planSlug,
							taskId: input.taskId,
							kind: revision.kind,
							description: revision.description,
							evidence: revision.evidence ?? undefined,
						});
					}
				}
			} else if (planSlug) {
				// For observation-only kinds (missing_dependency, other): just append the revision.
				await appendNKleinPlanRevision({
					workspacePath: workspaceScope.workspacePath,
					slug: planSlug,
					taskId: input.taskId,
					kind: input.kind,
					description: input.description,
					evidence: input.evidence,
				});
			}

			const kindLabel: Record<string, string> = {
				missing_decision: "missing decision",
				contradictory_requirement: "contradictory requirement",
				missing_dependency: "missing dependency",
				scope_too_large: "scope too large",
				integration_needed: "integration needed",
				other: "other",
			};
			return {
				ok: true,
				taskId: input.taskId,
				kind: input.kind,
				message: `Recorded plan gap (${kindLabel[input.kind] ?? input.kind}) for task "${input.taskId}".`,
				workspaceState,
			};
		},
		expandNKleinPlanTask: async (workspaceScope, input) => {
			// Resolve slug: use the caller's explicit planSlug, or infer from the board taskId.
			const planSlug =
				input.planSlug?.trim() ||
				(await inferNKleinPlanSlugForTask({
					workspacePath: workspaceScope.workspacePath,
					taskId: input.taskId,
				}));
			if (!planSlug) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Could not infer a plan slug for task "${input.taskId}". Pass planSlug explicitly.`,
				});
			}

			// Resolve planTaskId: use the caller's explicit value, or infer by scanning the plan's task graph.
			// The board taskId is composed as "<slugify(planSlug)>-<slugify(planTaskId)>" so we strip the prefix.
			let planTaskId = input.planTaskId?.trim() || null;
			if (!planTaskId) {
				const artifacts = await readNKleinPlanArtifacts(workspaceScope.workspacePath, planSlug);
				// Find the task whose board ID matches the input taskId (exact or with -N suffix).
				// Board IDs are generated as `${slugify(slug)}-${slugify(planTaskId)}` so strip the slug prefix.
				const slugPrefix = planSlug
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "");
				for (const task of artifacts.taskGraph.tasks) {
					const taskSlug = task.id
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-+|-+$/g, "");
					const baseId = `${slugPrefix}-${taskSlug}`;
					if (input.taskId === baseId || input.taskId.startsWith(`${baseId}-`)) {
						planTaskId = task.id;
						break;
					}
				}
			}
			if (!planTaskId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Could not infer a plan task ID for board task "${input.taskId}" in plan "${planSlug}". Pass planTaskId explicitly.`,
				});
			}

			// Map the web-UI items to the full NKleinPlanTask shape expected by the SDK.
			// Fields not provided by the user default to the same values the decomposition tool uses.
			const fullReplacements = input.replacements.map((item) => ({
				id: item.id,
				title: item.title,
				prompt: item.prompt,
				dependsOn: item.dependsOn,
				complexity: item.complexity,
				suggestedRole: null,
				filesLikelyTouched: [],
				acceptanceCommand: item.acceptanceCommand,
				testFirst: false,
				acceptanceTestPrompt: null,
			}));

			const result = await applyNKleinPlanTaskReplacementArtifacts({
				workspacePath: workspaceScope.workspacePath,
				slug: planSlug,
				taskId: planTaskId,
				replacements: fullReplacements,
				description: input.description?.trim() || null,
			});

			return {
				ok: true,
				taskId: input.taskId,
				planSlug,
				planTaskId,
				replacementTaskIds: result.replacementTaskIds,
				entryTaskIds: result.entryTaskIds,
				terminalTaskIds: result.terminalTaskIds,
				taskGraphPath: result.taskGraphPath,
				revisionsPath: result.revisionsPath,
				message: `Expanded plan task "${planTaskId}" into ${result.replacementTaskIds.length} replacement task(s) in plan "${planSlug}".`,
			};
		},
		verifyTaskAcceptance: async (workspaceScope, input) => {
			const state = await loadWorkspaceState(workspaceScope.workspacePath);
			const taskRecord = findBoardCardWithColumn(state.board, input.taskId);
			if (!taskRecord) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Task "${input.taskId}" was not found.`,
				});
			}
			const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
			const acceptance = await nkleinTaskSessionService.verifyTaskAcceptanceInSandbox({
				taskId: input.taskId,
				projectRepoPath: workspaceScope.workspacePath,
				baseRef: taskRecord.card.baseRef,
				taskPrompt: taskRecord.card.prompt,
				timeoutMs: input.timeoutMs,
			});
			return {
				ok: acceptance.present === true && acceptance.passed === true,
				taskId: input.taskId,
				taskWorkspacePath: null,
				acceptance,
				message: formatAcceptanceVerifyMessage(acceptance),
			};
		},
		mergeTaskWorktrees: async (workspaceScope, input) => {
			const state = await loadWorkspaceState(workspaceScope.workspacePath);
			const result = await mergeTaskWorktreesInDependencyOrder({
				repoPath: workspaceScope.workspacePath,
				board: state.board,
				columns: [input.column ?? "review"],
				taskIds: input.taskId ? [input.taskId] : undefined,
			});
			recordTaskWorktreeMergeObservations({
				workspacePath: workspaceScope.workspacePath,
				steps: result.steps,
				ok: result.ok,
			});
			return {
				ok: result.ok,
				column: input.column ?? "review",
				mergedTaskIds: result.mergedTaskIds,
				skippedTaskIds: result.skippedTaskIds,
				steps: result.steps,
				conflict: result.conflict ?? null,
				blocked: result.blocked ?? null,
				message: formatMergeMessage(result),
			};
		},
		saveNKleinProviderSettings: async (_workspaceScope, input) => {
			const body = parseNKleinProviderSettingsSaveRequest(input);
			const response = await nkleinProviderService.saveProviderSettings(body);
			deps.bumpNKleinSessionContextVersion?.();
			return response;
		},
		addNKleinProvider: async (_workspaceScope, input) => {
			const body = parseNKleinAddProviderRequest(input);
			const response = await nkleinProviderService.addCustomProvider(body);
			deps.bumpNKleinSessionContextVersion?.();
			return response;
		},
		updateNKleinProvider: async (_workspaceScope, input) => {
			const body = parseNKleinUpdateProviderRequest(input);
			const response = await nkleinProviderService.updateCustomProvider(body);
			deps.bumpNKleinSessionContextVersion?.();
			return response;
		},
		startTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStartRequest(input);
				if (body.resumeFromTrash) {
					deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
				}
				if (!isHomeAgentSessionId(body.taskId)) {
					const swarmStop = await readSwarmStopSignal(workspaceScope.workspacePath);
					if (swarmStop) {
						return {
							ok: false,
							summary: null,
							error: `Swarm stop signal is active: ${swarmStop.reason}`,
							errorCode: "swarm_stopped" as const,
						};
					}
				}
				const requestedNKleinTaskMode = body.mode ?? "act";
				const scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
				const effectiveTimeouts = resolveEffectiveTaskTimeoutSettings({
					runtimeConfig: scopedRuntimeConfig,
					taskSettings: body.nkleinSettings,
				});
				if (!isHomeAgentSessionId(body.taskId)) {
					const loadedNKleinTaskSessionService =
						deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope) ?? null;
					const activeProjectTaskCount = countActiveProjectTaskSessions(
						loadedNKleinTaskSessionService?.listSummaries() ?? [],
						body.taskId,
					);
					if (activeProjectTaskCount >= scopedRuntimeConfig.effectiveMaxConcurrentTasks) {
						return {
							ok: false,
							summary: null,
							error: createConcurrencyLimitStartError(scopedRuntimeConfig.effectiveMaxConcurrentTasks),
						};
					}
				}
				// Under the local-only lockdown every task runs on the NKlein agent path; terminal/CLI agents are
				// disabled and the host-worktree subsystem is retired (§5.A). The card's nkleinSettings override
				// (model + reasoning profile) is read fresh below, and resumeFromTrash is self-hydrated inside
				// nkleinTaskSessionService.startTaskSession (readPersistedTaskSession), so no path probe is needed.
				const sandboxStatus = deps.refreshAgentSandboxStatus
					? await deps.refreshAgentSandboxStatus()
					: deps.getAgentSandboxStatus?.();
				const sandboxStartBlock = buildNKleinSandboxStartBlock(sandboxStatus);
				if (sandboxStartBlock) {
					return {
						ok: false,
						summary: null,
						error: sandboxStartBlock.error,
						errorCode: sandboxStartBlock.errorCode,
					};
				}
				const hasTaskLevelNKleinSettingsOverride = body.nkleinSettings !== undefined;
				let nkleinLaunchConfig = await nkleinProviderService.resolveLaunchConfig({
					providerIdOverride: body.nkleinSettings?.providerId ?? undefined,
					modelIdOverride: body.nkleinSettings?.modelId ?? undefined,
					...(hasTaskLevelNKleinSettingsOverride
						? {
								reasoningEffortOverride: body.nkleinSettings?.reasoningEffort ?? null,
							}
						: {}),
				});
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				const modelRegistrySnapshot = await Promise.resolve(getDefaultNKleinModelRegistry().getSnapshot()).catch(
					() => ({
						schemaVersion: 1,
						updatedAt: 0,
						models: {},
					}),
				);
				const guardCandidates = new Map<string, NKleinStartGuardCandidate<ResolvedNKleinLaunchConfig>>();
				const selectedCandidate = buildNKleinStartGuardCandidate({
					launchConfig: nkleinLaunchConfig,
					role: null,
					modelRegistry: modelRegistrySnapshot,
				});
				nkleinLaunchConfig = applyCandidateEffectiveContextWindow(nkleinLaunchConfig, selectedCandidate);
				guardCandidates.set(selectedCandidate.entry.key, selectedCandidate);
				for (const [role, settings] of Object.entries(scopedRuntimeConfig.effectiveModelRoles)) {
					// #4 model pools: a role contributes its primary model plus every member of its additionalModels
					// pool, all tagged with the same role, so task-start fans out across the free, feasible ones.
					const roleModels = [
						{ model: settings, primary: true },
						...(settings.additionalModels ?? []).map((model) => ({ model, primary: false })),
					];
					for (const { model, primary } of roleModels) {
						if (!model.providerId && !model.modelId) {
							continue;
						}
						try {
							const roleLaunchConfig = await nkleinProviderService.resolveLaunchConfig({
								providerIdOverride: model.providerId ?? undefined,
								modelIdOverride: model.modelId ?? undefined,
								reasoningEffortOverride: model.reasoningEffort ?? null,
							});
							const roleCandidate = buildNKleinStartGuardCandidate({
								launchConfig: roleLaunchConfig,
								role,
								modelRegistry: modelRegistrySnapshot,
							});
							guardCandidates.set(roleCandidate.entry.key, roleCandidate);
						} catch (error) {
							// The primary role model keeps the fatal-on-context-policy behavior; an over-budget or
							// unrunnable *pool* member is skipped so the rest of the role's models still participate.
							if (primary && isNKleinContextWindowPolicyError(error)) {
								return {
									ok: false,
									summary: null,
									error: error.message,
									errorCode: "routing_escalation",
								};
							}
							// Ignore role models that are not currently runnable; the configured default still participates.
						}
					}
				}
				const preferredCandidate = body.startInPlanMode
					? ([...guardCandidates.values()].find((candidate) => candidate.role === "architect") ??
						selectedCandidate)
					: selectedCandidate;
				const promptTokens = estimateNKleinStartPromptTokens({
					prompt: body.prompt,
					taskTitle: body.taskTitle,
					images: body.images,
				});
				const largestContextWindow =
					[...guardCandidates.values()]
						.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
						.filter((contextWindow) => contextWindow > 0)
						.sort((left, right) => right - left)[0] ?? null;
				// #4 swarm fan-out: when several candidates are feasible, prefer one that is not currently busy so
				// parallel tasks spread across free models instead of all queueing on the single smallest-sufficient
				// one. Fully fallback-safe — with a single candidate this resolves to that candidate (no change), and
				// when no free feasible candidate exists the preferred candidate below is used unchanged.
				const runningModelKeys = new Set(
					nkleinTaskSessionService
						.listModelEndpointSessions()
						.filter((session) => session.state === "running")
						.map((session) =>
							buildNKleinModelRegistryKey({
								providerId: session.providerId,
								modelId: session.modelId,
								endpoint: session.endpoint,
							}),
						),
				);
				const freeFirstSelection = selectRoleModel({
					candidates: [...guardCandidates.values()].map((candidate) => ({
						modelKey: candidate.entry.key,
						capability: candidate.entry.capability.effectiveScore,
						contextWindow: candidate.entry.contextWindow.effective ?? 0,
						predictedWallTimeMs: candidate.entry.speed.wallTimeMsEwma,
						isFree: !runningModelKeys.has(candidate.entry.key),
					})),
					difficulty: estimateNKleinStartDifficulty(promptTokens),
					requiredContextTokens: estimateNKleinStartFitBudgetTokens(promptTokens, largestContextWindow),
					weighting: "efficient",
				});
				const freeFirstModelKey =
					runningModelKeys.has(preferredCandidate.entry.key) &&
					freeFirstSelection.type === "assign" &&
					!freeFirstSelection.busyFallback
						? freeFirstSelection.modelKey
						: null;
				const routingDecision = routeNKleinTask({
					difficulty: estimateNKleinStartDifficulty(promptTokens),
					fitBudgetTokens: estimateNKleinStartFitBudgetTokens(promptTokens, largestContextWindow),
					promptTokens,
					outputTokens: 1_000,
					preferredModelKey: freeFirstModelKey ?? preferredCandidate.entry.key,
					candidates: [...guardCandidates.values()].map((candidate) => ({
						entry: candidate.entry,
						role: candidate.role,
					})),
				});
				if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
					return {
						ok: false,
						summary: null,
						error: formatNKleinTaskRoutingBlockMessage(routingDecision),
						errorCode: routingDecision.type === "decompose" ? "needs_decomposition" : "routing_escalation",
					};
				}
				const routedCandidate = guardCandidates.get(routingDecision.modelKey) ?? null;
				if (routedCandidate) {
					nkleinLaunchConfig = applyCandidateEffectiveContextWindow(routedCandidate.launchConfig, routedCandidate);
				}
				assertLocalProviderAllowed({
					providerId: nkleinLaunchConfig.providerId,
					baseUrl: nkleinLaunchConfig.baseUrl,
				});
				const mcsrAwareTimeouts = applyMcsrAwareLocalTimeoutScaling({
					timeouts: effectiveTimeouts,
					launchConfig: nkleinLaunchConfig,
					modelRegistry: modelRegistrySnapshot,
					promptTokens,
				});
				const codeEmbeddingProvider = createNKleinCodeEmbeddingProviderFromSettings(
					scopedRuntimeConfig.effectiveCodeEmbeddingSettings,
				);
				const endpointDecision = scheduleNKleinEndpointStart({
					taskId: body.taskId,
					providerId: nkleinLaunchConfig.providerId,
					modelId: nkleinLaunchConfig.modelId ?? "",
					endpoint: nkleinLaunchConfig.baseUrl ?? null,
					runningSessions: nkleinTaskSessionService.listModelEndpointSessions(),
					modelRegistry: modelRegistrySnapshot,
					now: Date.now(),
				});
				if (!endpointDecision.ok) {
					if (body.queueOnEndpointBusy) {
						deps.taskStartQueue?.enqueue({
							workspaceScope,
							request: body,
							delayMs: endpointDecision.estimatedWaitMs,
							error: endpointDecision.reason,
						});
					}
					return {
						ok: false,
						summary: null,
						error: `${endpointDecision.reason} Wait for task "${endpointDecision.blockedByTaskId}" to finish, or choose a different model endpoint.`,
						errorCode: "endpoint_busy",
						retryAfterMs: endpointDecision.estimatedWaitMs,
						queued: body.queueOnEndpointBusy ? true : undefined,
					};
				}
				deps.taskStartQueue?.remove(workspaceScope.workspaceId, body.taskId);
				const resolvedNKleinTitle = resolveTaskTitle(body.taskTitle?.trim(), body.prompt);
				const summary = await nkleinTaskSessionService.startTaskSession({
					taskId: body.taskId,
					cwd: workspaceScope.workspacePath,
					workspaceRoot: workspaceScope.workspacePath,
					baseRef: body.baseRef,
					prompt: body.prompt,
					taskTitle: resolvedNKleinTitle.length > 0 ? resolvedNKleinTitle : undefined,
					images: body.images,
					filesLikelyTouched: body.filesLikelyTouched,
					resumeFromTrash: body.resumeFromTrash,
					providerId: nkleinLaunchConfig.providerId,
					modelId: nkleinLaunchConfig.modelId,
					mode: requestedNKleinTaskMode,
					startInPlanMode: body.startInPlanMode,
					apiKey: nkleinLaunchConfig.apiKey,
					baseUrl: nkleinLaunchConfig.baseUrl,
					reasoningEffort: nkleinLaunchConfig.reasoningEffort,
					contextScope: body.nkleinSettings?.contextScope,
					contextWindow: nkleinLaunchConfig.contextWindow ?? null,
					timeoutMode: mcsrAwareTimeouts.timeoutMode,
					requestTimeoutMs: mcsrAwareTimeouts.requestTimeoutMs,
					turnTimeoutMs: mcsrAwareTimeouts.agentTimeoutMs,
					streamTimeoutMs: mcsrAwareTimeouts.streamTimeoutMs,
					toolTimeoutMs: mcsrAwareTimeouts.toolTimeoutMs,
					conversationTimeoutMs: mcsrAwareTimeouts.conversationTimeoutMs,
					streamTimeoutSource: mcsrAwareTimeouts.streamTimeoutSource,
					toolTimeoutSource: mcsrAwareTimeouts.toolTimeoutSource,
					conversationTimeoutSource: mcsrAwareTimeouts.conversationTimeoutSource,
					maxAgentWritableFileLines: scopedRuntimeConfig.maxAgentWritableFileLines,
					codeEmbeddingProvider,
				});

				// Starting a task must move its card out of backlog (→ planning / in_progress) so the board reflects
				// that the agent is now working it — a card should never show agent activity while it sits in backlog.
				// Previously only the input/resume paths reconciled the lane, so a freshly-started card (e.g. a
				// dev-test seed started programmatically) stayed in backlog. Best-effort; never blocks the start.
				await reconcileRunningTaskBoardLane(workspaceScope, summary);

				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
					...(isCloudProviderDisabledError(error) ? { errorCode: "cloud_provider_disabled" as const } : {}),
				};
			}
		},
		stopTaskSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionStopRequest(input);
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				const nkleinSummary = await nkleinTaskSessionService.stopTaskSession(body.taskId);
				const pausedTaskIds = await setCardPaused({
					workspacePath: workspaceScope.workspacePath,
					taskId: body.taskId,
					paused: false,
				});
				// Terminal/CLI agents are disabled under the local-only lockdown (§5.A); only NKlein sessions exist.
				return {
					ok: Boolean(nkleinSummary),
					summary: withTaskPausedState(nkleinSummary, pausedTaskIds),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		pauseTask: async (workspaceScope, input) => {
			try {
				const body = parseTaskPauseRequest(input);
				const pausedTaskIds = await setCardPaused({
					workspacePath: workspaceScope.workspacePath,
					taskId: body.taskId,
					paused: true,
				});
				const nkleinTaskSessionService = deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope) ?? null;
				nkleinTaskSessionService?.setCardPaused(body.taskId, true);
				const summary = withTaskPausedState(
					nkleinTaskSessionService?.getSummary(body.taskId) ?? null,
					pausedTaskIds,
				);
				return {
					ok: true,
					summary,
					pausedTaskIds: [...pausedTaskIds].sort(),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const pausedTaskIds = await readPausedTasks(workspaceScope.workspacePath);
				return {
					ok: false,
					summary: null,
					pausedTaskIds: [...pausedTaskIds].sort(),
					error: message,
				};
			}
		},
		resumeTask: async (workspaceScope, input) => {
			try {
				const body = parseTaskPauseRequest(input);
				const wasTaskPaused = (await readPausedTasks(workspaceScope.workspacePath)).has(body.taskId);
				const pausedTaskIds = await setCardPaused({
					workspacePath: workspaceScope.workspacePath,
					taskId: body.taskId,
					paused: false,
				});
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				nkleinTaskSessionService.setCardPaused(body.taskId, false);
				const resumedSummaries = await nkleinTaskSessionService.resumePausedTasks();
				let resumedSummary = resumedSummaries.find((summary) => summary.taskId === body.taskId) ?? null;
				let fallbackSummary = nkleinTaskSessionService.getSummary(body.taskId);
				if (!resumedSummary && !fallbackSummary && wasTaskPaused) {
					fallbackSummary = await nkleinTaskSessionService
						.rebindPersistedTaskSession(body.taskId)
						.catch(() => null);
				}
				if (
					!resumedSummary &&
					wasTaskPaused &&
					(fallbackSummary?.state === "paused" || fallbackSummary?.state === "awaiting_review")
				) {
					resumedSummary = await nkleinTaskSessionService.sendTaskSessionInput(
						body.taskId,
						"Continue from the paused checkpoint.",
					);
					fallbackSummary = resumedSummary ?? fallbackSummary;
				}
				return {
					ok: true,
					summary: withTaskPausedState(resumedSummary ?? fallbackSummary, pausedTaskIds),
					pausedTaskIds: [...pausedTaskIds].sort(),
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const pausedTaskIds = await readPausedTasks(workspaceScope.workspacePath);
				return {
					ok: false,
					summary: null,
					pausedTaskIds: [...pausedTaskIds].sort(),
					error: message,
				};
			}
		},
		sendTaskSessionInput: async (workspaceScope, input) => {
			try {
				const body = parseTaskSessionInputRequest(input);
				const payloadText = body.appendNewline ? `${body.text}\n` : body.text;
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				const nkleinSummary = await nkleinTaskSessionService.sendTaskSessionInput(body.taskId, payloadText);
				// Terminal/CLI agents are disabled under the local-only lockdown (§5.A); only NKlein sessions exist.
				if (!nkleinSummary) {
					return {
						ok: false,
						summary: null,
						error: "Task session is not running.",
					};
				}
				await reconcileRunningTaskBoardLane(workspaceScope, nkleinSummary);
				return {
					ok: true,
					summary: nkleinSummary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		getTaskChatMessages: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatMessagesRequest(input);
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				const summary = nkleinTaskSessionService.getSummary(body.taskId);
				const messages = await nkleinTaskSessionService.loadTaskSessionMessages(body.taskId);
				if (!summary && messages.length === 0) {
					return {
						ok: false,
						messages: [],
						error: "Task chat session is not available.",
					};
				}
				return {
					ok: true,
					messages,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					messages: [],
					error: message,
				};
			}
		},
		getNKleinSlashCommands: async (workspaceScope) => {
			if (!workspaceScope) {
				return {
					commands: [],
				};
			}
			const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
			return {
				commands: await nkleinTaskSessionService.listSlashCommands(workspaceScope.workspacePath),
			};
		},
		reloadTaskChatSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatReloadRequest(input);
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				let summary = await nkleinTaskSessionService.reloadTaskSession(body.taskId);
				if (!summary && isHomeAgentSessionId(body.taskId)) {
					const nkleinLaunchConfig = await nkleinProviderService.resolveLaunchConfig();
					summary = await nkleinTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: workspaceScope.workspacePath,
						workspaceRoot: workspaceScope.workspacePath,
						prompt: "",
						resumeFromPersistence: true,
						providerId: nkleinLaunchConfig.providerId,
						modelId: nkleinLaunchConfig.modelId,
						apiKey: nkleinLaunchConfig.apiKey,
						baseUrl: nkleinLaunchConfig.baseUrl,
						reasoningEffort: nkleinLaunchConfig.reasoningEffort,
						contextWindow: nkleinLaunchConfig.contextWindow ?? null,
					});
				}
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session is not available.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		abortTaskChatTurn: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatAbortRequest(input);
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				const summary = await nkleinTaskSessionService.abortTaskSession(body.taskId);
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		cancelTaskChatTurn: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatCancelRequest(input);
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				const summary = await nkleinTaskSessionService.cancelTaskTurn(body.taskId);
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task chat session turn is not running.",
					};
				}
				return {
					ok: true,
					summary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		getNKleinProviderCatalog: async (_workspaceScope) => {
			return await nkleinProviderService.getProviderCatalog();
		},
		getNKleinAccountProfile: async (_workspaceScope) => {
			return await nkleinProviderService.getNKleinAccountProfile();
		},
		getNKleinKanbanAccess: async (_workspaceScope) => {
			return await nkleinProviderService.getNKleinKanbanAccess();
		},
		getFeaturebaseToken: async (_workspaceScope) => {
			return await nkleinProviderService.getFeaturebaseToken();
		},
		getNKleinAccountBalance: async (_workspaceScope) => {
			return await nkleinProviderService.getNKleinAccountBalance();
		},
		getNKleinAccountOrganizations: async (_workspaceScope) => {
			return await nkleinProviderService.getNKleinAccountOrganizations();
		},
		switchNKleinAccount: async (_workspaceScope, input) => {
			const body = parseNKleinAccountSwitchRequest(input);
			return await nkleinProviderService.switchNKleinAccount(body.organizationId);
		},
		getNKleinProviderModels: async (_workspaceScope, input) => {
			const body = parseNKleinProviderModelsRequest(input);
			return await nkleinProviderService.getProviderModels(body.providerId);
		},
		discoverNKleinEndpointModels: async (_workspaceScope, input) => {
			const body = parseNKleinEndpointModelDiscoveryRequest(input);
			return await nkleinProviderService.discoverEndpointModels(body);
		},
		getNKleinModelRegistry: async (workspaceScope) => {
			return await handleGetNKleinModelRegistry(workspaceScope, {
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
				nkleinProviderService,
			});
		},
		removeNKleinModelRegistryEntry: async (_workspaceScope, input) => {
			return await handleRemoveNKleinModelRegistryEntry(input);
		},
		pruneNKleinModelRegistry: async (workspaceScope) => {
			return await handlePruneNKleinModelRegistry(workspaceScope, {
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
				nkleinProviderService,
			});
		},
		saveNKleinModelContextWindowOverride: async (_workspaceScope, input) => {
			return await handleSaveNKleinModelContextWindowOverride(input);
		},
		saveNKleinModelMaxConcurrentRequests: async (_workspaceScope, input) => {
			return await handleSaveNKleinModelMaxConcurrentRequests(input);
		},
		getNKleinCodeIntelligenceStatus: async (workspaceScope) => {
			return await handleGetNKleinCodeIntelligenceStatus(workspaceScope, {
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
			});
		},
		getKleinCorePyHealth: async () => {
			const config = resolveKleinCorePyConfig();
			if (!config.enabled) {
				return { enabled: false, reachable: false, sidecarUrl: config.sidecarUrl };
			}
			const health = await probeKleinCorePyHealth({ config });
			return { enabled: true, reachable: health.reachable, sidecarUrl: health.sidecarUrl };
		},
		getMergeHistory: async (workspaceScope) => {
			const records = workspaceScope
				? await readMergeHistory({ workspacePath: workspaceScope.workspacePath, limit: 50 })
				: [];
			return {
				records: records.map((record) => ({
					recordedAt: record.recordedAt,
					taskId: record.taskId,
					ok: record.ok,
					mergedTaskIds: record.mergedTaskIds,
					skippedTaskIds: record.skippedTaskIds,
					conflictedPaths: record.conflictedPaths,
					reason: record.reason,
				})),
			};
		},
		buildNKleinModelFreshnessAdvisor: async (_workspaceScope) => {
			return await buildNKleinModelFreshnessAdvisorRequest();
		},
		buildNKleinAdvisor: async (workspaceScope, input) => {
			const body = parseNKleinAdvisorBuildRequest(input);
			if (body.kind === "model_freshness") {
				return await buildNKleinModelFreshnessAdvisorRequest();
			}
			return buildNKleinAdvisorRequest(body.kind, {
				workspacePath: workspaceScope?.workspacePath,
				repoSummary: body.repoSummary,
				modelRegistrySummary: body.modelRegistrySummary,
				runtimeConfigSummary: body.runtimeConfigSummary,
				telemetrySummary: body.telemetrySummary,
				taskSummary: body.taskSummary,
				userQuestion: body.userQuestion,
			});
		},
		sendNKleinAdvisor: async (_workspaceScope, input) => {
			const body = parseNKleinAdvisorSendRequest(input);
			const sentAt = Date.now();
			const launchConfig = await nkleinProviderService.resolveLaunchConfig({
				providerIdOverride: body.providerId,
				modelIdOverride: body.modelId,
			});
			assertLocalProviderAllowed({
				providerId: launchConfig.providerId,
				baseUrl: launchConfig.baseUrl,
			});
			const output = await runLocalAdvisorCompletion({
				launchConfig,
				prompt: body.prompt,
			});
			return {
				providerId: launchConfig.providerId,
				modelId: launchConfig.modelId ?? body.modelId,
				output,
				sentAt,
				receivedAt: Date.now(),
			};
		},
		writeNKleinDogfoodBacklog: async (workspaceScope, input) => {
			if (!workspaceScope) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A workspace is required to write dogfood backlog artifacts.",
				});
			}
			const body = parseNKleinDogfoodBacklogRequest(input);
			const artifacts = await writeNKleinDogfoodBacklog({
				workspacePath: workspaceScope.workspacePath,
				telemetryRootDir: deps.getDogfoodTelemetryRoot?.() ?? join(homedir(), ".nklein", "nklein", "telemetry"),
				slug: body.slug,
				userSuggestions: body.suggestion?.trim() ? [body.suggestion] : undefined,
			});
			return {
				rootPath: artifacts.rootPath,
				specPath: artifacts.specPath,
				planPath: artifacts.planPath,
				questionsPath: artifacts.questionsPath,
				decisionsPath: artifacts.decisionsPath,
				revisionsPath: artifacts.revisionsPath,
				summaryPath: artifacts.summaryPath,
				taskGraphPath: artifacts.taskGraphPath,
				slug: artifacts.taskGraph.slug,
				taskCount: artifacts.taskGraph.tasks.length,
				nextCommand: `nklein task decompose --slug ${artifacts.taskGraph.slug} --project-path ${workspaceScope.workspacePath}`,
			};
		},
		runNKleinSmokeEval: async (_workspaceScope) => {
			const launchConfig = await nkleinProviderService.resolveLaunchConfig();
			const modelId = launchConfig.modelId?.trim() || "unknown";
			// §5.W: honor the configured workspace base dir (global setting) for the eval's created workspace.
			const globalConfig = await loadGlobalRuntimeConfig();
			const result = await runNKleinDevSmokeEval({
				...(globalConfig.workspaceBaseDir ? { workspaceBaseDir: globalConfig.workspaceBaseDir } : {}),
				modelObservation: {
					providerId: launchConfig.providerId,
					modelId,
					endpoint: launchConfig.baseUrl ?? null,
				},
			});
			return {
				...result,
				providerId: launchConfig.providerId,
				modelId,
				endpoint: launchConfig.baseUrl ?? null,
			};
		},
		collectTaskEvidence: async (workspaceScope, input): Promise<RuntimeTaskEvidenceResponse> => {
			if (!workspaceScope) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A workspace is required to collect task evidence.",
				});
			}
			const body = parseTaskEvidenceRequest(input);
			const state = await loadWorkspaceState(workspaceScope.workspacePath);
			const task = findTaskCard(state.board, body.taskId);
			if (!task) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: `Task ${body.taskId} was not found in this workspace.`,
				});
			}
			const taskResultCommit = await resolveTaskResultBranchCommit({
				repoPath: workspaceScope.workspacePath,
				taskId: task.id,
			});
			// Evidence is gathered from the project repo: a completed task's delta is its result branch (used for
			// changesResult below), and an in-progress task has no host-visible working tree — work runs in its
			// sandbox (worktrees retired, §5.A; the old fallback here would *create* a host worktree on miss).
			const taskCwd = workspaceScope.workspacePath;
			const [nkleinTaskSessionService, runtimeConfig, baseCommit, changesResult] = await Promise.all([
				deps.getScopedNKleinTaskSessionService(workspaceScope),
				deps.loadScopedRuntimeConfig(workspaceScope),
				resolveGitCommit(workspaceScope.workspacePath, task.baseRef),
				taskResultCommit
					? getWorkspaceChangesBetweenRefs({
							cwd: workspaceScope.workspacePath,
							fromRef: task.baseRef,
							toRef: taskResultCommit,
						}).catch(() => null)
					: getWorkspaceChanges(taskCwd)
							.then((changes) => changes)
							.catch(() => null),
			]);
			const messages = nkleinTaskSessionService.listMessages(task.id);
			const diffPatch = renderWorkspaceChangesEvidence(changesResult);
			const title = task.title?.trim() || task.id;
			const summaryText = [
				`Task: ${title} (${task.id})`,
				`Workspace: ${workspaceScope.workspacePath}`,
				`Task workspace: ${taskCwd}`,
				`Base ref: ${task.baseRef}`,
				`Base commit: ${baseCommit ?? "unknown"}`,
				"",
				"Prompt:",
				task.prompt,
			].join("\n");
			const bundle = await createEvidenceBundle({
				rootDir: deps.getEvidenceBundleRoot?.(),
				scenario: `task-${task.id}-${title}`,
				outcome: task.autoReviewStatus === "failed" ? "failed" : "unknown",
				summary: summaryText,
				models: [
					task.nkleinSettings?.providerId && task.nkleinSettings?.modelId
						? `${task.nkleinSettings.providerId}/${task.nkleinSettings.modelId}`
						: "default",
				],
				metrics: [
					{ label: "changedFiles", value: changesResult?.files.length ?? 0 },
					{ label: "transcriptMessages", value: messages.length },
					{ label: "baseRef", value: task.baseRef },
					{ label: "baseCommit", value: baseCommit },
				],
				transcripts: [
					{
						taskId: task.id,
						title,
						messages,
					},
				],
				diffPatch,
				configSnapshot: {
					task,
					runtimeConfig: {
						codeEmbeddingDefaults: runtimeConfig.codeEmbeddingDefaults,
						codeEmbeddingOverride: runtimeConfig.codeEmbeddingOverride,
						effectiveCodeEmbeddingSettings: runtimeConfig.effectiveCodeEmbeddingSettings,
						maxConcurrentTasks: runtimeConfig.maxConcurrentTasks,
						lostHeartbeatPolicy: runtimeConfig.lostHeartbeatPolicy,
					},
					workspacePath: workspaceScope.workspacePath,
					taskCwd,
					baseCommit,
				},
			});
			return {
				bundlePath: bundle.bundlePath,
				summaryPath: bundle.summaryPath,
				files: {
					...bundle.files,
					transcripts: [...bundle.files.transcripts],
				},
				summaryText,
				diffPatchText: diffPatch,
				promptBlock: buildTaskEvidencePromptBlock({
					task,
					workspacePath: workspaceScope.workspacePath,
					taskCwd,
					baseCommit,
					bundlePath: bundle.bundlePath,
					transcriptCount: messages.length > 0 ? 1 : 0,
					changeCount: changesResult?.files.length ?? 0,
				}),
			};
		},
		getNKleinMcpAuthStatuses: async (_workspaceScope) => {
			const statuses = await nkleinMcpRuntimeService.getAuthStatuses();
			return {
				statuses,
			};
		},
		runNKleinMcpServerOAuth: async (_workspaceScope, input) => {
			const body = parseNKleinMcpOAuthRequest(input);
			const response = await nkleinMcpRuntimeService.authorizeServer({
				serverName: body.serverName,
				onAuthorizationUrl: (url: string) => {
					openInBrowser(url);
				},
			});
			deps.bumpNKleinSessionContextVersion?.();
			return response;
		},
		getNKleinMcpSettings: async (_workspaceScope) => {
			return nkleinMcpSettingsService.loadSettings();
		},
		saveNKleinMcpSettings: async (_workspaceScope, input) => {
			const body = parseNKleinMcpSettingsSaveRequest(input);
			const response = await nkleinMcpSettingsService.saveSettings(body);
			deps.bumpNKleinSessionContextVersion?.();
			return response;
		},
		runNKleinProviderOAuthLogin: async (_workspaceScope, input) => {
			const body = parseNKleinOauthLoginRequest(input);
			const response = await nkleinProviderService.runOauthLogin({
				providerId: body.provider,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpNKleinSessionContextVersion?.();
			}
			return response;
		},
		startNKleinDeviceAuth: async () => {
			return await nkleinProviderService.startDeviceAuth();
		},
		completeNKleinDeviceAuth: async (_workspaceScope, input) => {
			const body = parseNKleinDeviceAuthCompleteRequest(input);
			const response = await nkleinProviderService.completeDeviceAuth({
				deviceCode: body.deviceCode,
				expiresInSeconds: body.expiresInSeconds,
				pollIntervalSeconds: body.pollIntervalSeconds,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpNKleinSessionContextVersion?.();
			}
			return response;
		},
		sendTaskChatMessage: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatSendRequest(input);
				const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
				const providerIdOverride = body.providerId?.trim() || undefined;
				const modelIdOverride = body.modelId?.trim() || undefined;
				const hasReasoningEffortOverride = Object.hasOwn(body, "reasoningEffort");
				const launchConfigOverrides =
					providerIdOverride || modelIdOverride || hasReasoningEffortOverride
						? await nkleinProviderService.resolveLaunchConfig({
								providerIdOverride,
								modelIdOverride,
								...(hasReasoningEffortOverride
									? { reasoningEffortOverride: body.reasoningEffort ?? null }
									: {}),
							})
						: null;
				const sessionLaunchConfigOverrides = launchConfigOverrides?.modelId
					? {
							providerId: launchConfigOverrides.providerId,
							modelId: launchConfigOverrides.modelId,
							apiKey: launchConfigOverrides.apiKey,
							baseUrl: launchConfigOverrides.baseUrl,
							reasoningEffort: launchConfigOverrides.reasoningEffort,
							contextWindow: launchConfigOverrides.contextWindow,
						}
					: undefined;
				if (isNKleinClearSlashCommand(body.text)) {
					const summary = await nkleinTaskSessionService.clearTaskSession(body.taskId);
					deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
					return {
						ok: true,
						summary,
						message: null,
					};
				}
				const requestedMode = body.mode;
				let summary = sessionLaunchConfigOverrides
					? await nkleinTaskSessionService.sendTaskSessionInput(
							body.taskId,
							body.text,
							requestedMode,
							body.images,
							sessionLaunchConfigOverrides,
						)
					: await nkleinTaskSessionService.sendTaskSessionInput(
							body.taskId,
							body.text,
							requestedMode,
							body.images,
						);
				if (!summary) {
					if (!isHomeAgentSessionId(body.taskId)) {
						const reboundSummary = await nkleinTaskSessionService.rebindPersistedTaskSession(body.taskId);
						if (reboundSummary) {
							const nkleinLaunchConfig =
								launchConfigOverrides ?? (await nkleinProviderService.resolveLaunchConfig());
							summary = await nkleinTaskSessionService.startTaskSession({
								taskId: body.taskId,
								cwd: reboundSummary.workspacePath ?? workspaceScope.workspacePath,
								workspaceRoot: workspaceScope.workspacePath,
								prompt: body.text,
								images: body.images,
								resumeFromPersistence: true,
								providerId: nkleinLaunchConfig.providerId,
								modelId: nkleinLaunchConfig.modelId,
								mode: requestedMode,
								apiKey: nkleinLaunchConfig.apiKey,
								baseUrl: nkleinLaunchConfig.baseUrl,
								reasoningEffort: nkleinLaunchConfig.reasoningEffort,
								contextWindow: nkleinLaunchConfig.contextWindow ?? null,
							});
						}
						if (!summary) {
							return {
								ok: false,
								summary: null,
								error: "Task chat session is not running.",
							};
						}
					} else {
						const nkleinLaunchConfig =
							launchConfigOverrides ?? (await nkleinProviderService.resolveLaunchConfig());
						summary = await nkleinTaskSessionService.startTaskSession({
							taskId: body.taskId,
							cwd: workspaceScope.workspacePath,
							workspaceRoot: workspaceScope.workspacePath,
							prompt: body.text,
							images: body.images,
							resumeFromPersistence: true,
							providerId: nkleinLaunchConfig.providerId,
							modelId: nkleinLaunchConfig.modelId,
							mode: requestedMode,
							apiKey: nkleinLaunchConfig.apiKey,
							baseUrl: nkleinLaunchConfig.baseUrl,
							reasoningEffort: nkleinLaunchConfig.reasoningEffort,
							contextWindow: nkleinLaunchConfig.contextWindow ?? null,
						});
					}
				}
				const latestMessage = nkleinTaskSessionService.listMessages(body.taskId).at(-1) ?? null;
				await reconcileRunningTaskBoardLane(workspaceScope, summary);
				return {
					ok: true,
					summary,
					message: latestMessage,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					error: message,
				};
			}
		},
		grantProtectedTestApproval: async (workspaceScope, input): Promise<RuntimeProtectedTestApprovalGrantResponse> => {
			try {
				const body = parseProtectedTestApprovalGrantRequest(input);
				const approvedAt = Date.now();
				protectedTestApprovalStore.grant({
					taskId: body.taskId,
					workspacePath: workspaceScope.workspacePath,
					request: body.approval,
					approvedAt,
				});
				recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: "Protected-test edit approval granted.",
					taskId: body.taskId,
					workspacePath: workspaceScope.workspacePath,
					metadata: {
						operation: "grant_protected_test_approval",
						intent: body.approval.intent,
						reason: body.approval.reason,
						expectedEffects: body.approval.expectedEffects,
						approvedAt,
					},
				});
				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					error: message,
				};
			}
		},
		importTaskContext: async (workspaceScope, input): Promise<RuntimeTaskContextImportResponse> => {
			try {
				const body = parseTaskContextImportRequest(input);
				if (body.source === "github_issue") {
					return await importGitHubIssueContext(body.target, workspaceScope.workspacePath);
				}
				return await importGitHubPrDiffContext(body.target, workspaceScope.workspacePath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					sourceLabel: null,
					content: null,
					error: message,
				};
			}
		},
		startShellSession: async (workspaceScope, input) => {
			try {
				const body = parseShellSessionStartRequest(input);
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const shell = deps.resolveInteractiveShellCommand();
				// §5.A: a task with a prepared Docker sandbox shells INTO its hardened container via `docker exec`
				// (cwd is irrelevant there); a task without an active sandbox — or a non-task shell — opens at the
				// project root. No host worktree is ever created for a shell (worktree subsystem retired).
				const shellTarget = body.workspaceTaskId
					? (await deps.getScopedNKleinTaskSessionService(workspaceScope)).getTaskShellTarget(body.workspaceTaskId)
					: null;
				const spawnSpec = buildTaskShellSpawnSpec(shellTarget, shell);
				const summary = await terminalManager.startShellSession({
					taskId: body.taskId,
					cwd: workspaceScope.workspacePath,
					cols: body.cols,
					rows: body.rows,
					binary: spawnSpec.binary,
					args: spawnSpec.args,
				});
				return {
					ok: true,
					summary,
					shellBinary: spawnSpec.binary,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					summary: null,
					shellBinary: null,
					error: message,
				};
			}
		},
		runCommand: async (workspaceScope, input) => {
			if (deps.isRemoteMode) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Host-local action unavailable in remote mode — runs on the server host, not your machine.",
				});
			}
			try {
				const body = parseCommandRunRequest(input);
				return await deps.runCommand(body.command, workspaceScope.workspacePath);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message,
				});
			}
		},
		resetAllState: async (_workspaceScope) => {
			await deps.prepareForStateReset?.();
			await Promise.all(
				debugResetTargetPaths.map(async (path) => {
					await rm(path, { recursive: true, force: true });
				}),
			);
			return {
				ok: true,
				clearedPaths: [...debugResetTargetPaths],
			};
		},
		openFile: async (input) => {
			if (deps.isRemoteMode) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Host-local action unavailable in remote mode — runs on the server host, not your machine.",
				});
			}
			const filePath = input.filePath.trim();
			if (!filePath) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "File path cannot be empty.",
				});
			}
			openInBrowser(filePath);
			return { ok: true };
		},
		getUpdateStatus: async () => {
			return await handleGetUpdateStatus(deps);
		},
		runUpdateNow: async () => {
			return await handleRunUpdateNow(deps);
		},
		listChatSessions: () => chatService.listSessions(),
		getChatSession: (id) => chatService.getSession(id),
		createChatSession: (input) => chatService.createSession(input),
		updateChatSession: (input) => chatService.updateSession(input),
		deleteChatSession: (id) => chatService.deleteSession(id),
		readChatTranscript: (sessionId, limit) => chatService.readTranscript(sessionId, limit),
		sendChatMessage: async (input, onToken) => {
			const result = await chatService.sendMessage(input, onToken);
			return { userMessage: result?.userMessage ?? null, assistantMessage: result?.assistantMessage ?? null };
		},
	};
}
