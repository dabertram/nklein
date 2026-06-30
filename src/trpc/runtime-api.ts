// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed NKlein, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type { ChatAgentModelResponse } from "../chat/chat-agent-loop";
import { type ChatToolSet, createBoardMutationTools, createBoardReadTools } from "../chat/chat-board-tools";
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
import { probeKleinCorePyHealth, resolveKleinCorePyConfig } from "../config/klein-core-config";
import type { RuntimeConfigState } from "../config/runtime-config";
import { loadGlobalRuntimeConfig, updateGlobalRuntimeConfig, updateRuntimeConfig } from "../config/runtime-config";
import { buildTaskEscalationReport } from "../core/agent-attempt-ledger";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeCommandRunResponse,
	RuntimeProtectedTestApprovalGrantResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskContextImportResponse,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
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
	parseTaskChatMessagesRequest,
	parseTaskChatReloadRequest,
	parseTaskContextImportRequest,
	parseTaskSessionInputRequest,
	parseTaskSessionStopRequest,
} from "../core/api-validation";
import { setCardPaused } from "../core/card-pause";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { protectedTestApprovalStore } from "../core/protected-test-approval-store";
import { reconcileStartedTaskBoardLane } from "../core/task-board-lane-reconcile";
import { buildNKleinAdvisorRequest } from "../nklein-agent/nklein-advisor";
import { buildTaskShellSpawnSpec } from "../nklein-agent/nklein-agent-sandbox";
import { writeNKleinDogfoodBacklog } from "../nklein-agent/nklein-dogfood-engine";
import { runNKleinDevSmokeEval } from "../nklein-agent/nklein-eval-harness";
import { buildChatAttemptEvent } from "../nklein-agent/nklein-ledger-chat-attempt";
import { LocalLlmClient } from "../nklein-agent/nklein-local-llm-client";
import { assertLocalProviderAllowed } from "../nklein-agent/nklein-local-only-policy";
import { createNKleinMcpRuntimeService } from "../nklein-agent/nklein-mcp-runtime-service";
import { createNKleinMcpSettingsService } from "../nklein-agent/nklein-mcp-settings-service";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-agent/nklein-model-research";
import {
	listNKleinPlanArtifactsForSourceTask,
	type NKleinPlanArtifactSummary,
} from "../nklein-agent/nklein-plan-artifacts";
import { createNKleinProviderService } from "../nklein-agent/nklein-provider-service";
import { setNKleinLostHeartbeatPolicy } from "../nklein-agent/nklein-session-state";
import type { NKleinTaskSessionService } from "../nklein-agent/nklein-task-session-service";
import { openInBrowser } from "../server/browser";
import { appendAgentLedgerEvent, readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { readMergeHistory } from "../state/merge-history-store";
import { readTaskRunSummaries } from "../state/task-run-summary-store";
import { readSelfObservationEvents, recordSelfObservation } from "../telemetry/self-observation-sink";
import { buildRuntimeConfigResponse } from "../terminal/agent-registry";
import type { TerminalSessionManager } from "../terminal/session-manager";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router";
import { createAutonomousChatRunController } from "./runtime-api/autonomous-chat-run.js";
import { handleGetNKleinCodeIntelligenceStatus } from "./runtime-api/code-intelligence-status.js";
import { handleExpandNKleinPlanTask } from "./runtime-api/expand-plan-task.js";
import { importGitHubIssueContext, importGitHubPrDiffContext } from "./runtime-api/github-context-import.js";
import { runLocalAdvisorCompletion } from "./runtime-api/local-advisor-completion.js";
import { handleMergeTaskWorktrees } from "./runtime-api/merge-task-worktrees.js";
import {
	handleGetNKleinModelRegistry,
	handlePruneNKleinModelRegistry,
	handleRemoveNKleinModelRegistryEntry,
	handleSaveNKleinModelContextWindowOverride,
	handleSaveNKleinModelMaxConcurrentRequests,
} from "./runtime-api/model-registry.js";
import {
	handleApplyNKleinPlanArtifact,
	handleRejectNKleinPlanArtifact,
} from "./runtime-api/plan-artifact-application.js";
import { handleRecordNKleinPlanGap } from "./runtime-api/record-plan-gap.js";
import { handleStartTaskSession } from "./runtime-api/start-task-session.js";
import { handleClearSwarmStop, handleGetSwarmStop, handleRequestSwarmStop } from "./runtime-api/swarm-stop-control.js";
import { handleSendTaskChatMessage } from "./runtime-api/task-chat-send.js";
import { handleAbortTaskChatTurn, handleCancelTaskChatTurn } from "./runtime-api/task-chat-turn-control.js";
import { handleCollectTaskEvidence } from "./runtime-api/task-evidence.js";
import { handlePauseTask, handleResumeTask } from "./runtime-api/task-pause-resume.js";
import {
	handleGetKnowledgeToolUsageStats,
	handleGetModelPerformanceStats,
	handleGetUpdateStatus,
	handleRunUpdateNow,
} from "./runtime-api/update-status.js";
import { handleVerifyTaskAcceptance } from "./runtime-api/verify-task-acceptance.js";
import { withTaskPausedState } from "./runtime-task-paused-state";
import type { RuntimeTaskStartQueue } from "./runtime-task-start-queue";

const _execFileAsync = promisify(execFile);

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

async function reconcileRunningTaskBoardLane(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	summary: RuntimeTaskSessionSummary,
): Promise<void> {
	await reconcileStartedTaskBoardLane({ workspacePath: workspaceScope.workspacePath, summary });
}

function toRuntimePlanArtifactSummary(summary: NKleinPlanArtifactSummary): NKleinPlanArtifactSummary {
	return summary;
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
}): (session: ChatSession, extra?: ChatToolSet) => Promise<ChatAgentToolDeps | null> {
	return async (session, extra) => {
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
			// Autonomous mode (todo §5.0.1) merges in the per-turn control tools (request_user_input /
			// declare_goal_complete); interactive chat passes no extras.
			...(extra?.tools ?? []),
		];
		const definitions = [
			...read.definitions,
			...board.definitions,
			...focus.definitions,
			...mutations.definitions,
			...commands.definitions,
			...browser.definitions,
			...(extra?.definitions ?? []),
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

		const toolModel = createChatAgentModel(client, definitions, { modelId });
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
			// §5.AL: feed the active project's effective gate policy as the chat gate's base, so chat honors a per-project
			// policy like task-start does (env knobs still override on top).
			resolveModelGatePolicyBase: async () =>
				deps.getActiveRuntimeConfig?.()?.effectiveModelSuitabilityPolicy ?? null,
			// §5.AF: the chat-flow ledger writer — assemble the envelope (workspace/provider/endpoint) from the active
			// runtime + append one `chat` attempt event. Fully best-effort: any failure is swallowed (observational only).
			recordChatAttempt: (input) => {
				try {
					const event = buildChatAttemptEvent({
						sessionId: input.sessionId,
						workspacePath: deps.getActiveWorkspacePath?.() ?? null,
						providerId: DEFAULT_LOCAL_CHAT_PROVIDER_ID,
						modelId: input.modelId,
						endpoint: nkleinProviderService.getLocalChatBaseUrl() ?? null,
						toolCalls: input.toolNames.map((name) => ({ name, fingerprint: null, outcome: null })),
						hitIterationLimit: input.hitIterationLimit,
						flow: input.flow,
						startedAt: input.startedAt,
						endedAt: input.endedAt,
					});
					void appendAgentLedgerEvent(event).catch(() => {});
				} catch {
					// Observational only — never let ledger writing affect the chat turn.
				}
			},
		});
	// Autonomous chat runs (todo §5.0.1): background driver + per-session status, bounded by the global swarm guardrails.
	const autonomousChatRun = createAutonomousChatRunController({
		chatService,
		resolveGuardrails: async () => (await loadGlobalRuntimeConfig()).swarmGuardrails,
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
		getSwarmStop: async (workspaceScope) => handleGetSwarmStop(workspaceScope),
		requestSwarmStop: async (workspaceScope, input) =>
			handleRequestSwarmStop(workspaceScope, input, {
				getLoadedScopedNKleinTaskSessionService: deps.getLoadedScopedNKleinTaskSessionService,
			}),
		clearSwarmStop: async (workspaceScope) =>
			handleClearSwarmStop(workspaceScope, {
				getLoadedScopedNKleinTaskSessionService: deps.getLoadedScopedNKleinTaskSessionService,
			}),
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
		getTaskEscalation: async (_workspaceScope, input) => {
			return buildTaskEscalationReport(await readAllAgentLedger(), input.taskId);
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
		applyNKleinPlanArtifact: async (workspaceScope, input) =>
			handleApplyNKleinPlanArtifact(workspaceScope, input, {
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
			}),
		rejectNKleinPlanArtifact: async (workspaceScope, input) => handleRejectNKleinPlanArtifact(workspaceScope, input),
		recordNKleinPlanGap: async (workspaceScope, input) => {
			return await handleRecordNKleinPlanGap(workspaceScope, input);
		},
		expandNKleinPlanTask: async (workspaceScope, input) => {
			return await handleExpandNKleinPlanTask(workspaceScope, input);
		},
		verifyTaskAcceptance: async (workspaceScope, input) =>
			handleVerifyTaskAcceptance(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
			}),
		mergeTaskWorktrees: async (workspaceScope, input) => handleMergeTaskWorktrees(workspaceScope, input),
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
			return await handleStartTaskSession(workspaceScope, input, {
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				getLoadedScopedNKleinTaskSessionService: deps.getLoadedScopedNKleinTaskSessionService,
				refreshAgentSandboxStatus: deps.refreshAgentSandboxStatus,
				getAgentSandboxStatus: deps.getAgentSandboxStatus,
				broadcastTaskChatCleared: deps.broadcastTaskChatCleared,
				taskStartQueue: deps.taskStartQueue,
				nkleinProviderService,
			});
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
		pauseTask: async (workspaceScope, input) =>
			handlePauseTask(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				getLoadedScopedNKleinTaskSessionService: deps.getLoadedScopedNKleinTaskSessionService,
			}),
		resumeTask: async (workspaceScope, input) =>
			handleResumeTask(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				getLoadedScopedNKleinTaskSessionService: deps.getLoadedScopedNKleinTaskSessionService,
			}),
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
		abortTaskChatTurn: async (workspaceScope, input) =>
			handleAbortTaskChatTurn(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
			}),
		cancelTaskChatTurn: async (workspaceScope, input) =>
			handleCancelTaskChatTurn(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
			}),
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
			return await handleCollectTaskEvidence(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
				getEvidenceBundleRoot: deps.getEvidenceBundleRoot,
			});
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
			return await handleSendTaskChatMessage(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				nkleinProviderService,
				broadcastTaskChatCleared: deps.broadcastTaskChatCleared,
			});
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
			return {
				userMessage: result?.userMessage ?? null,
				assistantMessage: result?.assistantMessage ?? null,
				capabilityNotice: result?.capabilityNotice ?? null,
			};
		},
		startAutonomousChatRun: (input) => autonomousChatRun.start(input),
		getAutonomousChatRunStatus: (input) => autonomousChatRun.status(input),
	};
}
