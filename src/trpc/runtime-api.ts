// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed NKlein, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { applyCardMessageRelay, applyStreamMessageBroadcast } from "../chat/chat-board-tools";
import { readChatFocusChain } from "../chat/chat-focus-chain";
import { type ChatService, createChatService } from "../chat/chat-service";
import { DEFAULT_LOCAL_CHAT_PROVIDER_ID, resolveLocalChatModelDeps } from "../chat/local-chat-model";
import { probeKleinCorePyHealth, resolveKleinCorePyConfig } from "../config/klein-core-config";
import type { RuntimeConfigState } from "../config/runtime-config";
import { loadGlobalRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeCommandRunResponse,
	RuntimeProtectedTestApprovalGrantResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskContextImportResponse,
	RuntimeTaskEvidenceResponse,
	RuntimeUpdateStatusResponse,
} from "../core/api-contract";
import {
	parseCommandRunRequest,
	parseNKleinAccountSwitchRequest,
	parseNKleinAdvisorBuildRequest,
	parseNKleinAdvisorSendRequest,
	parseNKleinDeviceAuthCompleteRequest,
	parseNKleinDogfoodBacklogRequest,
	parseNKleinEndpointModelDiscoveryRequest,
	parseNKleinMcpOAuthRequest,
	parseNKleinMcpSettingsSaveRequest,
	parseNKleinOauthLoginRequest,
	parseNKleinProviderModelsRequest,
	parseProtectedTestApprovalGrantRequest,
	parseShellSessionStartRequest,
	parseTaskContextImportRequest,
} from "../core/api-validation";
import { toStreamOverviewRows } from "../core/board-streams-summary";
import { isTruthyEnv } from "../core/env-flag";
import { buildFitnessTableView } from "../core/fitness-table-view";
import { createDefaultLmsRunner, fetchLmsPsModelsCached } from "../core/lms-ps-json";
import { fetchLoadedModelIdsCached } from "../core/lmstudio-loaded-models";
import { stripAddressingHandle } from "../core/message-target-resolver";
import { summarizeWorkspaceBoardStreams } from "../core/operator-board-health";
import { protectedTestApprovalStore } from "../core/protected-test-approval-store";
import { isBusySessionState } from "../core/session-state-predicates";
import { deriveStreams } from "../core/stream-derivation";
import { buildNKleinAdvisorRequest } from "../nklein-agent/nklein-advisor";
import { buildTaskShellSpawnSpec } from "../nklein-agent/nklein-agent-sandbox";
import { countKanbanTextTokens } from "../nklein-agent/nklein-context-budgets";
import { writeNKleinDogfoodBacklog } from "../nklein-agent/nklein-dogfood-engine";
import { runNKleinDevSmokeEval } from "../nklein-agent/nklein-eval-harness";
import { buildChatAttemptEvent } from "../nklein-agent/nklein-ledger-chat-attempt";
import { assertLocalProviderAllowed } from "../nklein-agent/nklein-local-only-policy";
import { createNKleinMcpRuntimeService } from "../nklein-agent/nklein-mcp-runtime-service";
import { createNKleinMcpSettingsService } from "../nklein-agent/nklein-mcp-settings-service";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-agent/nklein-model-research";
import {
	listNKleinPlanArtifactsForSourceTask,
	type NKleinPlanArtifactSummary,
} from "../nklein-agent/nklein-plan-artifacts";
import { createNKleinProviderService } from "../nklein-agent/nklein-provider-service";
import type { NKleinTaskSessionService } from "../nklein-agent/nklein-task-session-service";
import { openInBrowser } from "../server/browser";
import { appendAgentLedgerEvent } from "../state/agent-attempt-ledger-store";
import { appendCardMailboxNote, countPendingCardMailbox } from "../state/card-mailbox-store";
import { readMergeHistory } from "../state/merge-history-store";
import { loadWorkspaceState } from "../state/workspace-state";
import { readFitnessTable } from "../telemetry/fitness-table-store";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { buildRuntimeConfigResponse } from "../terminal/agent-registry";
import type { TerminalSessionManager } from "../terminal/session-manager";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router";
import { createAutonomousChatRunController } from "./runtime-api/autonomous-chat-run.js";
import { buildChatAgentToolDepsResolver } from "./runtime-api/chat-agent-tool-deps-resolver.js";
import { handleGetNKleinCodeIntelligenceStatus } from "./runtime-api/code-intelligence-status.js";
import { handleExpandNKleinPlanTask } from "./runtime-api/expand-plan-task.js";
import { handleGetFleetStatus } from "./runtime-api/fleet-status";
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
import {
	handleAddNKleinProvider,
	handleSaveNKleinProviderSettings,
	handleUpdateNKleinProvider,
} from "./runtime-api/provider-settings.js";
import { handleRecordNKleinPlanGap } from "./runtime-api/record-plan-gap.js";
import { handleLoadConfig, handleSaveConfig } from "./runtime-api/runtime-config-io.js";
import { handleGetGlobalSetupPlan, handleGetProjectSetupPlan } from "./runtime-api/setup-plan";
import { handleStartTaskSession } from "./runtime-api/start-task-session.js";
import { handleClearSwarmStop, handleGetSwarmStop, handleRequestSwarmStop } from "./runtime-api/swarm-stop-control.js";
import { handleSendTaskChatMessage } from "./runtime-api/task-chat-send.js";
import {
	handleGetNKleinSlashCommands,
	handleGetTaskChatMessages,
	handleReloadTaskChatSession,
} from "./runtime-api/task-chat-session.js";
import { handleAbortTaskChatTurn, handleCancelTaskChatTurn } from "./runtime-api/task-chat-turn-control.js";
import { handleGetTaskDiagnostics, handleGetTaskEscalation } from "./runtime-api/task-diagnostics.js";
import { handleCollectTaskEvidence } from "./runtime-api/task-evidence.js";
import { handlePauseTask, handleResumeTask } from "./runtime-api/task-pause-resume.js";
import { handleSendTaskSessionInput, handleStopTaskSession } from "./runtime-api/task-session-io.js";
import {
	handleGetKnowledgeToolUsageStats,
	handleGetModelPerformanceStats,
	handleGetUpdateStatus,
	handleRunUpdateNow,
} from "./runtime-api/update-status.js";
import { handleVerifyTaskAcceptance } from "./runtime-api/verify-task-acceptance.js";
import type { RuntimeTaskStartQueue } from "./runtime-task-start-queue";

const execFileAsync = promisify(execFile);

/**
 * Probe the Docker VM's total memory (MB) via `docker info`. On macOS/Windows the sandbox container lives inside this
 * VM, so its size — not host RAM — is the real ceiling the setup wizard must size against (todo §5.AR). Returns null on
 * any failure (Docker down, Linux host where MemTotal is host RAM anyway, parse miss) so the recommender falls back to
 * its host-RAM budget + emits the "verify the Docker VM" warning rather than throwing.
 */
async function probeDockerVmMemoryMb(): Promise<number | null> {
	try {
		const { stdout } = await execFileAsync("docker", ["info", "--format", "{{.MemTotal}}"], { timeout: 10_000 });
		const bytes = Number.parseInt(stdout.trim(), 10);
		if (!Number.isFinite(bytes) || bytes <= 0) return null;
		return Math.round(bytes / (1024 * 1024));
	} catch {
		return null;
	}
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
			// §5.M: split the lean chat window on ACTUAL (bounded BPE) token counts, not the crude length/4 placeholder —
			// so the short-term memory boundary + overflow summarization trigger at the real budget the model sees.
			estimateTokens: countKanbanTextTokens,
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
				// §5.L: read the capability-broker opt-in per-turn (a config flip takes effect on the next turn).
				getCapabilityBrokerEnabled: async () => (await loadGlobalRuntimeConfig()).capabilityBrokerEnabled,
				// decision-2: the chat web_search egress config, read per-turn (off by default: egress off / no backend).
				getRetrievalConfig: async () => {
					const config = await loadGlobalRuntimeConfig();
					return {
						egressEnabled: config.retrievalEgressEnabled,
						searchBackendUrl: config.retrievalSearchBackendUrl,
					};
				},
				// §5.AU relay: the ACTIVE workspace's live task sessions, so `send_to_card` can deliver into a running
				// agent's turn (falls back to the durable mailbox when the service isn't loaded or the card isn't live).
				getActiveTaskSessions: () => {
					const workspaceId = deps.getActiveWorkspaceId();
					const workspacePath = deps.getActiveWorkspacePath();
					if (!workspaceId || !workspacePath) {
						return null;
					}
					const service = deps.getLoadedScopedNKleinTaskSessionService?.({ workspaceId, workspacePath });
					if (!service) {
						return null;
					}
					return {
						listActiveTaskIds: () =>
							new Set(
								service
									.listSummaries()
									.filter((summary) => isBusySessionState(summary.state))
									.map((summary) => summary.taskId),
							),
						sendInput: async (taskId, text) =>
							(await service.sendTaskSessionInput(taskId, `${text}\n`).catch(() => null)) !== null,
					};
				},
			}),
			// §5.AL: feed the active project's effective gate policy as the chat gate's base, so chat honors a per-project
			// policy like task-start does (env knobs still override on top).
			resolveModelGatePolicyBase: async () =>
				deps.getActiveRuntimeConfig?.()?.effectiveModelSuitabilityPolicy ?? null,
			// §5.AC: resolve the "knows today" switch per turn = the runtime-config setting (off by default) OR the
			// `NKLEIN_KNOWS_TODAY` env override, so a live config change (or a dev flag) takes effect on the next turn.
			resolveKnowsTodayEnabled: () =>
				(deps.getActiveRuntimeConfig?.()?.knowsTodayEnabled ?? false) ||
				isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY),
			// §5.AU: the message-target index — the active board's cards + streams (persisted streams when present,
			// else the same pure derivation the board uses), so an @card/@stream/@<title-slug> message resolves.
			// Best-effort: any load failure just means "no index" ⇒ the turn routes to the goal like before.
			resolveMessageTargetIndex: async () => {
				const workspacePath = deps.getActiveWorkspacePath();
				if (!workspacePath) {
					return null;
				}
				try {
					const board = (await loadWorkspaceState(workspacePath)).board;
					const rawCards = board.columns
						.filter((column) => column.id !== "trash")
						.flatMap((column) => column.cards);
					const derived = deriveStreams({
						cards: rawCards.map((card) => ({
							id: card.id,
							title: card.title,
							planSlug: card.generatedFromPlan?.planSlug ?? null,
						})),
						dependencies: board.dependencies ?? [],
					});
					const cards = rawCards.map((card) => {
						const streamId = card.streamId ?? derived.cardStreamId[card.id];
						return { id: card.id, title: card.title, ...(streamId ? { streamId } : {}) };
					});
					const streams =
						board.streams && board.streams.length > 0
							? board.streams.map((stream) => ({ id: stream.id, title: stream.title }))
							: derived.streams.map((stream) => ({ id: stream.id, title: stream.title }));
					return { cards, streams };
				} catch {
					return null;
				}
			},
			// §5.AU item 9 — deterministic relay: a message the addressing resolves to a specific CARD (or an `answer` to a
			// card's question) is relayed straight to that card (deliver live / queue mailbox / suggest-unblock / answer
			// from state) via the SAME applyCardMessageRelay path send_to_card uses, returning the confirmation to post as
			// the assistant reply. Other kinds (goal / stream / needs_clarify) ⇒ null ⇒ the normal model turn answers in
			// chat. Best-effort: any load failure ⇒ null (falls through to the model turn). Communication is always
			// possible; execution stays readiness-gated (a blocked/ready card is never started — the note is queued).
			relayAddressedMessage: async (target, message) => {
				if ((target.kind !== "card" && target.kind !== "answer" && target.kind !== "stream") || !target.id) {
					return null;
				}
				const workspacePath = deps.getActiveWorkspacePath();
				const workspaceId = deps.getActiveWorkspaceId();
				if (!workspacePath || !workspaceId) {
					return null;
				}
				try {
					const board = (await loadWorkspaceState(workspacePath)).board;
					const service = deps.getLoadedScopedNKleinTaskSessionService?.({ workspaceId, workspacePath }) ?? null;
					const activeSessionTaskIds = service
						? new Set(
								service
									.listSummaries()
									.filter((summary) => isBusySessionState(summary.state))
									.map((summary) => summary.taskId),
							)
						: new Set<string>();
					const relayDeps = {
						deliverLive: async (taskId: string, text: string) =>
							service
								? (await service.sendTaskSessionInput(taskId, `${text}\n`).catch(() => null)) !== null
								: false,
						queueMailbox: async (taskId: string, text: string) => {
							await appendCardMailboxNote({ taskId, text, source: "chat" });
							return countPendingCardMailbox(taskId);
						},
					};
					// Deliver a CLEAN message — strip the `@card:…`/`@stream:…` addressing handle the user typed (the chat
					// transcript keeps the original; only the relayed text is stripped).
					const clean = stripAddressingHandle(message);
					if (target.kind === "stream") {
						return await applyStreamMessageBroadcast(board, activeSessionTaskIds, target.id, clean, relayDeps);
					}
					return await applyCardMessageRelay(
						board,
						activeSessionTaskIds,
						target.id,
						clean,
						target.kind === "answer" ? "answer" : null,
						relayDeps,
					);
				} catch {
					return null;
				}
			},
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
		loadConfig: async (workspaceScope) =>
			handleLoadConfig(workspaceScope, {
				buildConfigResponse,
				getActiveRuntimeConfig: deps.getActiveRuntimeConfig,
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
				getActiveWorkspaceId: deps.getActiveWorkspaceId,
				setActiveRuntimeConfig: deps.setActiveRuntimeConfig,
			}),
		saveConfig: async (workspaceScope, input) =>
			handleSaveConfig(workspaceScope, input, {
				buildConfigResponse,
				getActiveRuntimeConfig: deps.getActiveRuntimeConfig,
				loadScopedRuntimeConfig: deps.loadScopedRuntimeConfig,
				getActiveWorkspaceId: deps.getActiveWorkspaceId,
				setActiveRuntimeConfig: deps.setActiveRuntimeConfig,
			}),
		getModelPerformanceStats: async (workspaceScope) => {
			return await handleGetModelPerformanceStats(workspaceScope);
		},
		// §5.AL fitness browser: the global per-(model × role × difficulty) fitness cells + the failing-LLM
		// projection. Read-only; empty when the store is missing/unreadable (never throws into the UI).
		getFitnessTable: async () => {
			const table = await readFitnessTable().catch(() => ({ version: 0, rows: {} }));
			return {
				generatedAt: Date.now(),
				rows: buildFitnessTableView(Object.values(table.rows)),
			};
		},
		getFleetStatus: async (workspaceScope) => {
			return await handleGetFleetStatus({
				getMachineMap: async () =>
					new Map(
						(await fetchLmsPsModelsCached(createDefaultLmsRunner())).map((model) => [
							model.identifier,
							model.machineId,
						]),
					),
				getWarmthLedger: () =>
					deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope)?.getPromptWarmthLedger() ?? null,
			});
		},
		// W3.4 mailbox badge: pending mailbox-note counts for the board's cards (only non-zero entries returned).
		getCardMailboxCounts: async (input) => {
			const counts: Record<string, number> = {};
			await Promise.all(
				input.taskIds.map(async (taskId) => {
					const count = await countPendingCardMailbox(taskId).catch(() => 0);
					if (count > 0) {
						counts[taskId] = count;
					}
				}),
			);
			return { counts };
		},
		getGlobalSetupPlan: async () => {
			const globalConfig = await loadGlobalRuntimeConfig();
			const providerEndpoint = nkleinProviderService.getLocalChatBaseUrl() ?? "http://localhost:1234/v1";
			return await handleGetGlobalSetupPlan({
				getHardware: () => ({ totalRamMb: Math.round(totalmem() / (1024 * 1024)), cpuCount: cpus().length }),
				getLoadedModelIds: () => fetchLoadedModelIdsCached(providerEndpoint),
				providerEndpoint,
				getDockerAvailable: () => deps.getAgentSandboxStatus?.()?.dockerAvailable ?? null,
				getDockerVmMemoryMb: () => probeDockerVmMemoryMb(),
				getSecondOpinionReviewEnabled: () => globalConfig.secondOpinionReviewEnabled,
				getCompletedAt: () => globalConfig.setupWizardCompletedAt,
			});
		},
		getProjectSetupPlan: async (workspaceScope) => {
			const scopedConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			const providerEndpoint = nkleinProviderService.getLocalChatBaseUrl() ?? "http://localhost:1234/v1";
			return await handleGetProjectSetupPlan({
				readPackageJson: async () => {
					try {
						const raw = await readFile(join(workspaceScope.workspacePath, "package.json"), "utf8");
						return JSON.parse(raw) as { scripts?: Record<string, string> };
					} catch {
						return null;
					}
				},
				getLoadedModelIds: () => fetchLoadedModelIdsCached(providerEndpoint),
				getHardware: () => ({ cpuCount: cpus().length }),
				detectBaseBranch: async () => {
					try {
						const { stdout } = await execFileAsync(
							"git",
							["-C", workspaceScope.workspacePath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
							{ timeout: 4000 },
						);
						const ref = stdout.trim();
						return ref.includes("/") ? (ref.split("/").pop() ?? null) : ref || null;
					} catch {
						return null;
					}
				},
				getCompletedAt: () => scopedConfig.projectSetupWizardCompletedAt,
			});
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
		getTaskDiagnostics: async (workspaceScope, input) => handleGetTaskDiagnostics(workspaceScope, input),
		getTaskEscalation: async (_workspaceScope, input) => handleGetTaskEscalation(input),
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
		saveNKleinProviderSettings: async (_workspaceScope, input) =>
			handleSaveNKleinProviderSettings(input, {
				nkleinProviderService,
				bumpNKleinSessionContextVersion: deps.bumpNKleinSessionContextVersion,
			}),
		addNKleinProvider: async (_workspaceScope, input) =>
			handleAddNKleinProvider(input, {
				nkleinProviderService,
				bumpNKleinSessionContextVersion: deps.bumpNKleinSessionContextVersion,
			}),
		updateNKleinProvider: async (_workspaceScope, input) =>
			handleUpdateNKleinProvider(input, {
				nkleinProviderService,
				bumpNKleinSessionContextVersion: deps.bumpNKleinSessionContextVersion,
			}),
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
		stopTaskSession: async (workspaceScope, input) =>
			handleStopTaskSession(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
			}),
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
		sendTaskSessionInput: async (workspaceScope, input) =>
			handleSendTaskSessionInput(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
			}),
		getTaskChatMessages: async (workspaceScope, input) =>
			handleGetTaskChatMessages(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				nkleinProviderService,
			}),
		getNKleinSlashCommands: async (workspaceScope) =>
			handleGetNKleinSlashCommands(workspaceScope, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				nkleinProviderService,
			}),
		reloadTaskChatSession: async (workspaceScope, input) =>
			handleReloadTaskChatSession(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
				nkleinProviderService,
			}),
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
		// §5.BB focus-chain surface: read-only projection of the session's live plan checklist (default store root —
		// the same place the agent-turn's readFocusChain dep reads).
		getChatFocusChain: async (sessionId) => {
			const chain = await readChatFocusChain(sessionId);
			return {
				chain: chain
					? {
							steps: chain.steps.map((step) => ({ text: step.text, status: step.status })),
							updatedAt: chain.updatedAt,
						}
					: null,
			};
		},
		getChatBoardStreams: async () => {
			// §5.AU: the main chat's stream-overview surface. Roll up the ACTIVE workspace's streams server-side (the
			// board-independent chat client has no per-card session signals to do it itself), flattened to the lean DTO.
			const workspacePath = deps.getActiveWorkspacePath();
			if (!workspacePath) {
				return { streams: [], ungroupedCardCount: 0 };
			}
			try {
				const state = await loadWorkspaceState(workspacePath);
				const summary = summarizeWorkspaceBoardStreams(state, { now: Date.now() });
				return {
					streams: toStreamOverviewRows(summary),
					ungroupedCardCount: summary.ungroupedCardIds.length,
				};
			} catch {
				// A missing/unreadable workspace ⇒ an empty overview (never throws into the chat UI).
				return { streams: [], ungroupedCardCount: 0 };
			}
		},
		sendChatMessage: async (input, onToken, onToolEvent) => {
			const result = await chatService.sendMessage(input, onToken, onToolEvent);
			return {
				userMessage: result?.userMessage ?? null,
				assistantMessage: result?.assistantMessage ?? null,
				capabilityNotice: result?.capabilityNotice ?? null,
				targetLabel: result?.targetLabel ?? null,
				...(result?.clarifyCandidates ? { clarifyCandidates: result.clarifyCandidates } : {}),
				...(result?.contextTruncated ? { contextTruncated: true } : {}),
			};
		},
		startAutonomousChatRun: (input) => autonomousChatRun.start(input),
		getAutonomousChatRunStatus: (input) => autonomousChatRun.status(input),
	};
}
