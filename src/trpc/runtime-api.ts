// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed NKlein, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { cpus, homedir, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { rankBasicMemoryNotesForRecall } from "../chat/basic-memory-recall";
import { applyCardMessageRelay, applyStreamMessageBroadcast } from "../chat/chat-board-tools";
import { applyOperatorChatFocusChainUpdate, readChatFocusChain } from "../chat/chat-focus-chain";
import { readChatHostActionAudit } from "../chat/chat-host-action-audit-store";
import { buildUnifiedMemoryNote, projectUnifiedMemory, selectMemoryBand } from "../chat/chat-memory-projection";
import { readChatMemories, recallChatMemories } from "../chat/chat-memory-store";
import { createChatService } from "../chat/chat-service";
import { hostActionConfirmQueue } from "../chat/host-action-confirm-wait";
import { buildKleinSelfCorpusNote, readKleinCorpusFreshnessFromGit } from "../chat/klein-self-corpus-note";
import { DEFAULT_LOCAL_CHAT_PROVIDER_ID, resolveLocalChatModelDeps } from "../chat/local-chat-model";
import { probeKleinCorePyHealth, resolveKleinCorePyConfig } from "../config/klein-core-config";
import type { RuntimeConfigState } from "../config/runtime-config";
import { loadGlobalRuntimeConfig } from "../config/runtime-config";
import {
	selectAttempts,
	summarizeKnowledgeDebtOutcomes,
	summarizeKnowledgeOutcomeByModel,
} from "../core/agent-attempt-ledger";
import type {
	RuntimeProtectedTestApprovalGrantResponse,
	RuntimeTaskContextImportResponse,
	RuntimeTaskEvidenceResponse,
} from "../core/api-contract";
import {
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
import { createRailOutcomeLog, type RailStatusSnapshot } from "../core/background-eval-controls";
import {
	nodeBasicMemoryFsDeps,
	readBasicMemoryNotes,
	readBasicMemoryRecallSources,
} from "../core/basic-memory-note-reader";
import { toStreamOverviewRows } from "../core/board-streams-summary";
import { computeFleetCapabilityUpgrades, type RoleQualityBar } from "../core/capability-ceiling-recommendation";
import { SELECTABLE_CHAT_SKILL_IDS } from "../core/chat-session-skill-profile";
import { resolveDeviceRamBytesFromEnv } from "../core/device-load-routing";
import { isTruthyEnv } from "../core/env-flag";
import { buildFitnessTableView } from "../core/fitness-table-view";
import {
	buildHostOpenCommand,
	hostOpenPlatformFromProcess,
	isHostOpenTargetId,
	validateHostOpenFilePath,
} from "../core/host-open-intents";
import { parseLmsLsCatalog } from "../core/lms-model-catalog";
import { createDefaultLmsRunner, fetchLmsPsModelsCached, LOCAL_MACHINE_ID } from "../core/lms-ps-json";
import { fetchLoadedModelIdsCached } from "../core/lmstudio-loaded-models";
import { DEFAULT_LOCAL_MODEL_BASE_URL } from "../core/local-model-endpoint";
import { auditMemoryFreshness } from "../core/memory-freshness-audit";
import { buildMemoryLayers } from "../core/memory-layers";
import { stripAddressingHandle } from "../core/message-target-resolver";
import {
	dominantFailureMode,
	preferredPromptVariantFamily,
	preferredToolCallFormat,
} from "../core/model-behavior-profile";
import { buildModelTuningRecommendations } from "../core/model-tuning-recommendations";
import type { RuntimeModelEvalSummary } from "../core/nklein-ops-api-contract";
import { summarizeWorkspaceBoardStreams } from "../core/operator-board-health";
import { summarizeOpportunisticValue } from "../core/opportunistic-work-value";
import { protectedTestApprovalStore } from "../core/protected-test-approval-store";
import { summarizeRetrievalUsefulness } from "../core/retrieval-ledger-projection";
import { buildModelVerdictBadges } from "../core/runtime-model-verdict";
import { isBusySessionState } from "../core/session-state-predicates";
import type { SkillId } from "../core/skill-registry";
import { deriveStreams } from "../core/stream-derivation";
import { computeProjectTimeTracking, computeTimeTracking, type TimeTrackingActivity } from "../core/time-tracking";
import { parseEgressAllowlist } from "../nklein-agent/egress-proxy-role-snapshot";
import { buildEnforcedEvalChat } from "../nklein-agent/enforced-eval-chat";
import {
	buildNoisyEvalChat,
	evalDifficultyToFitnessTier,
	type ModelEvalChat,
	type ModelEvalChatChoice,
	runModelEval,
} from "../nklein-agent/model-eval-runner";
import { buildNKleinAdvisorRequest } from "../nklein-agent/nklein-advisor";
import { buildTaskShellSpawnSpec } from "../nklein-agent/nklein-agent-sandbox";
import { countKanbanTextTokens } from "../nklein-agent/nklein-context-budgets";
import { NKLEIN_DEV_TEST_PROJECT_MARKER_PATH } from "../nklein-agent/nklein-dev-test-project";
import { writeNKleinDogfoodBacklog } from "../nklein-agent/nklein-dogfood-engine";
import { runNKleinDevSmokeEval } from "../nklein-agent/nklein-eval-harness";
import { buildChatAttemptEvent } from "../nklein-agent/nklein-ledger-chat-attempt";
import { resolveLlmfitModelCapabilityIds } from "../nklein-agent/nklein-llmfit-routing-prior";
import { buildLmStudioMachineByModelId } from "../nklein-agent/nklein-lmstudio-host-map";
import { assertLocalProviderAllowed } from "../nklein-agent/nklein-local-only-policy";
import { createNKleinMcpRuntimeService } from "../nklein-agent/nklein-mcp-runtime-service";
import { createNKleinMcpSettingsService } from "../nklein-agent/nklein-mcp-settings-service";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-agent/nklein-model-research";
import {
	listNKleinPlanArtifactsForSourceTask,
	type NKleinPlanArtifactSummary,
} from "../nklein-agent/nklein-plan-artifacts";
import { createNKleinProviderService } from "../nklein-agent/nklein-provider-service";
import { openInBrowser } from "../server/browser";
import { createRailControlCoordinator, type RailControlCoordinator } from "../server/rail-control-service";
import { appendAgentLedgerEvent, readAllAgentLedger } from "../state/agent-attempt-ledger-store";
import { appendCardMailboxNote, countPendingCardMailbox } from "../state/card-mailbox-store";
import { appendDistractorObservations } from "../state/distractor-observation-store";
import { readMergeHistory } from "../state/merge-history-store";
import { appendModelEvalRuns } from "../state/model-eval-run-store";
import { loadRailControlSettings, saveRailControlSettings } from "../state/rail-control-store";
import { appendReasoningObservations } from "../state/reasoning-observation-store";
import { loadWorkspaceState } from "../state/workspace-state";
import { readMergedFitnessRows, recordTaskFitnessOutcome } from "../telemetry/fitness-table-store";
import { readAllCombinedModelBehaviorProfiles } from "../telemetry/model-behavior-profile-store";
import { readModelPerformanceStats } from "../telemetry/model-performance-stats.js";
import { readSelfObservationEvents, recordSelfObservation } from "../telemetry/self-observation-sink";
import { buildRuntimeConfigResponse } from "../terminal/agent-registry";
import type { RuntimeTrpcContext } from "./app-router";
import { resolveKleinSourceRepoPath } from "./projects-api-helpers";
import { handleAnswerPlanQuestion, handleListPlanQuestions } from "./runtime-api/answer-plan-question.js";
import { createAutonomousChatRunController } from "./runtime-api/autonomous-chat-run.js";
import { buildChatAgentToolDepsResolver } from "./runtime-api/chat-agent-tool-deps-resolver.js";
import { handleGetNKleinCodeIntelligenceStatus } from "./runtime-api/code-intelligence-status.js";
import { handleExpandNKleinPlanTask } from "./runtime-api/expand-plan-task.js";
import { handleGetFleetStatus } from "./runtime-api/fleet-status";
import { handleGetFocusChainHistory } from "./runtime-api/focus-chain-history.js";
import { importGitHubIssueContext, importGitHubPrDiffContext } from "./runtime-api/github-context-import.js";
import { runLocalAdvisorCompletion } from "./runtime-api/local-advisor-completion.js";
import { handleMergeTaskWorktrees } from "./runtime-api/merge-task-worktrees.js";
import {
	defaultLlmfitCatalogSupplementRegistrar,
	defaultLlmfitCatalogUpdateChecker,
	defaultLlmfitCatalogUpdatePuller,
	handleCheckLlmfitCatalogUpdate,
	handlePullLlmfitCatalogUpdate,
} from "./runtime-api/model-catalog-update.js";
import {
	defaultModelFleetSuggestionDescriptorFetcher,
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

import type { CreateRuntimeApiDependencies } from "./runtime-api-types";

export type { CreateRuntimeApiDependencies } from "./runtime-api-types";

/** F3.35 per-role quality bars the LOADED fleet must clear (mirrors the `dev capability-ceiling` defaults). */
const CAPABILITY_UPGRADE_BARS: readonly RoleQualityBar[] = [
	{ role: "architect", minConfidence: 0.7 },
	{ role: "decompose", minConfidence: 0.7 },
	{ role: "reviewer", minConfidence: 0.7 },
	{ role: "worker", minConfidence: 0.6 },
];

/**
 * F3.35 enrichment for the fitness-table view: name the best NOT-loaded catalog upgrade per role the loaded fleet can't
 * clear. Gathers the effectful inputs (the `lms ls` catalog, real loaded ids, the NKLEIN_DEVICE_RAM_GB map) and defers
 * the logic to the shared {@link computeFleetCapabilityUpgrades}. Best-effort: the caller wraps this in `.catch(() => [])`.
 */
async function computeCapabilityUpgrades(
	fitnessRows: readonly { modelKey: string; role: string; successCount: number; sampleCount: number }[],
): Promise<ReturnType<typeof computeFleetCapabilityUpgrades>> {
	const runner = createDefaultLmsRunner();
	const [lsOut, loadedIds] = await Promise.all([
		runner(["ls"])
			.then((r) => r.stdout)
			.catch(() => ""),
		fetchLoadedModelIdsCached(DEFAULT_LOCAL_MODEL_BASE_URL).catch(() => [] as string[]),
	]);
	const catalog = parseLmsLsCatalog(lsOut, { localDeviceName: LOCAL_MACHINE_ID });
	const isLoaded = (modelKey: string): boolean =>
		loadedIds.some((id) => id === modelKey || modelKey.includes(id) || id.includes(modelKey));
	const ramBytes = resolveDeviceRamBytesFromEnv();
	const deviceRamGB = Object.fromEntries(Object.entries(ramBytes).map(([m, bytes]) => [m, bytes / 1024 ** 3]));
	return computeFleetCapabilityUpgrades({
		fitnessSamples: fitnessRows.map((r) => ({
			modelKey: r.modelKey,
			role: r.role,
			successCount: r.successCount,
			sampleCount: r.sampleCount,
		})),
		catalog,
		deviceRamGB,
		isLoaded,
		bars: CAPABILITY_UPGRADE_BARS,
	});
}

function toRuntimePlanArtifactSummary(summary: NKleinPlanArtifactSummary): NKleinPlanArtifactSummary {
	return summary;
}

async function resolveLlmfitCatalogUpdateMode(
	workspaceScope: RuntimeTrpcContext["workspaceScope"] | null,
	deps: CreateRuntimeApiDependencies,
): Promise<RuntimeConfigState["llmfitCatalogUpdateMode"]> {
	if (workspaceScope) {
		return (await deps.loadScopedRuntimeConfig(workspaceScope)).llmfitCatalogUpdateMode;
	}
	return (deps.getActiveRuntimeConfig?.() ?? (await loadGlobalRuntimeConfig())).llmfitCatalogUpdateMode;
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
/**
 * F1.35b — the service-less fallback rail coordinator: used when no `railControlCoordinator` dep is supplied (the
 * runtime didn't opt into hosting the F1.31 service). It is backed by the real on-disk store, so the operator's control
 * intent + tunables still persist and the status reads `disabled`/`idle`; there is simply nothing to start/stop.
 * Memoized once so its outcome log is stable across calls.
 */
/** Map the core's readonly snapshot onto the wire contract's (mutable-array) shape. Structurally identical otherwise. */
function toRailStatusResponse(snapshot: RailStatusSnapshot) {
	return {
		...snapshot,
		activeLeases: [...snapshot.activeLeases],
		cleanupErrors: [...snapshot.cleanupErrors],
		recentOutcomes: [...snapshot.recentOutcomes],
	};
}
let fallbackRailCoordinator: RailControlCoordinator | null = null;
function resolveRailCoordinator(deps: CreateRuntimeApiDependencies): RailControlCoordinator {
	if (deps.railControlCoordinator) {
		return deps.railControlCoordinator;
	}
	fallbackRailCoordinator ??= createRailControlCoordinator({
		loadSettings: () => loadRailControlSettings(),
		saveSettings: (settings) => saveRailControlSettings(settings),
		service: null,
		outcomeLog: createRailOutcomeLog(),
	});
	return fallbackRailCoordinator;
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
				getSandboxWorkspaceReadTools: deps.getSandboxWorkspaceReadTools,
				getSandboxWorkspaceWriteTools: deps.getSandboxWorkspaceWriteTools,
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
							// F12.56: chat guidance to a RUNNING card steers — it lands before the next iteration.
							(await service
								.sendTaskSessionInput(taskId, `${text}\n`, undefined, undefined, undefined, {
									delivery: "steer",
								})
								.catch(() => null)) !== null,
					};
				},
			}),
			// §5.AL: feed the active project's effective gate policy as the chat gate's base, so chat honors a per-project
			// policy like task-start does (env knobs still override on top).
			resolveModelGatePolicyBase: async () =>
				deps.getActiveRuntimeConfig?.()?.effectiveModelSuitabilityPolicy ?? null,
			// F2.7b: the selected model's llmfit capability ids (the vision gate for image attachments), from the cached
			// catalog — fail-closed to [] on an unknown model / catalog miss so images are never sent to a non-vision model.
			resolveModelCapabilityIds: (modelId) => resolveLlmfitModelCapabilityIds(modelId),
			// F2.7b hardening: the active chat provider id → its image-format quirks. The chat path runs on the local
			// default provider (`lmstudio`), which rejects WebP, so this refuses it up front with actionable guidance.
			resolveChatProviderId: () => DEFAULT_LOCAL_CHAT_PROVIDER_ID,
			// F2.9b: the OPT-IN unified-memory recall note (NKLEIN_UNIFIED_MEMORY). Off by default = byte-identical;
			// when on, query-relevant chat-memory recall + the focus chain project into one provenance-tagged band that
			// leads the turn. (§5.M four-layer + Basic-Memory sources compose in later; recall quality tuned then.)
			...(isTruthyEnv(process.env.NKLEIN_UNIFIED_MEMORY)
				? {
						buildUnifiedMemoryNote: async (session, query) => {
							const memories = await readChatMemories();
							const recalled = await recallChatMemories({
								query,
								sessionId: session.id,
								memories,
								limit: 12,
								...(session.scope === "all_projects" ? { allProjects: true } : {}),
							});
							const focusChain = await readChatFocusChain(session.id).catch(() => null);
							// F2.9b: also compose the §5.M four-layer projection (episodic/semantic from the ledger, procedural
							// from the session's selected skills). Working-memory + Basic-Memory sources still compose later (the
							// audit reader carries no note bodies; that needs a content-carrying reader + query ranking — deferred).
							const ledgerEvents = await readAllAgentLedger().catch(() => []);
							const knownSkillIds = new Set<string>(SELECTABLE_CHAT_SKILL_IDS);
							const skillIds = session.selectedSkillIds.filter((id): id is SkillId => knownSkillIds.has(id));
							const currentStep = focusChain?.steps.find((step) => step.status === "in_progress")?.text ?? null;
							const memoryLayers = buildMemoryLayers({
								events: ledgerEvents,
								skillIds,
								snapshot: { activeGoal: session.goal, currentStep },
							});
							const { homedir } = await import("node:os");
							const { join } = await import("node:path");
							const basicMemorySources = await readBasicMemoryRecallSources(
								join(homedir(), "basic-memory"),
								nodeBasicMemoryFsDeps(),
							).catch(() => []);
							const basicMemoryNotes = rankBasicMemoryNotesForRecall(basicMemorySources, query, 6);
							const records = projectUnifiedMemory({
								sessionMemories: recalled.map((entry) => ({
									id: entry.id,
									text: entry.text,
									score: entry.score,
									shared: entry.shared,
								})),
								layerRecords: memoryLayers.all,
								basicMemoryNotes,
								...(focusChain
									? {
											focusChainSteps: focusChain.steps.map((step) => ({
												step: step.text,
												status: step.status === "skipped" ? ("done" as const) : step.status,
											})),
										}
									: {}),
							});
							return buildUnifiedMemoryNote(selectMemoryBand(records));
						},
					}
				: {}),
			// F2.23: the OPT-IN reasoning-capture switch (NKLEIN_REASONING_CAPTURE). Off by default = byte-identical
			// transcript; on = each turn's model reasoning is secret-redacted, bounded, and persisted as a display-only
			// `reasoning` row that precedes the assistant reply.
			captureReasoning: isTruthyEnv(process.env.NKLEIN_REASONING_CAPTURE),
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
								? // F12.56: live chat guidance steers — front of the pending-prompt queue.
									(await service
										.sendTaskSessionInput(taskId, `${text}\n`, undefined, undefined, undefined, {
											delivery: "steer",
										})
										.catch(() => null)) !== null
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
						promptStrategy: input.promptStrategy ?? null,
						startedAt: input.startedAt,
						endedAt: input.endedAt,
					});
					void appendAgentLedgerEvent(event).catch(() => {});
				} catch {
					// Observational only — never let ledger writing affect the chat turn.
				}
			},
			// F2.19b/F2.20b: build the klein_self corpus grounding note — route the question to the authoritative planning
			// docs (routeKleinSelfCorpus) and stamp each with real git freshness (readKleinCorpusFreshnessFromGit) → the
			// current-source citations the turn leads with. klein_self roots in the !Klein source repo; a packaged install
			// without it resolves to null ⇒ no note (the answer path is unchanged).
			buildKleinSelfCorpusNote: async (_session, question) => {
				const repoRoot = await resolveKleinSourceRepoPath().catch(() => null);
				if (!repoRoot) {
					return null;
				}
				return buildKleinSelfCorpusNote(question, {
					now: Date.now(),
					repoRoot,
					readDocFreshness: readKleinCorpusFreshnessFromGit(repoRoot),
				});
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
		// §5.AA learned model behavior: fold the append-only outcome log into per-model profiles + project the
		// learned preferences (dominant failure mode / preferred format / responsive prompt family). Read-only;
		// empty when the store is missing/unreadable (never throws into the UI).
		getModelBehaviorProfiles: async () => {
			const byModel = await readAllCombinedModelBehaviorProfiles().catch(
				() => ({}) as Awaited<ReturnType<typeof readAllCombinedModelBehaviorProfiles>>,
			);
			const sorted = Object.values(byModel).sort((left, right) => left.modelId.localeCompare(right.modelId));
			return {
				generatedAt: Date.now(),
				profiles: sorted.map((profile) => ({
					modelId: profile.modelId,
					samples: profile.samples,
					successes: profile.successes,
					successRate: profile.successRate,
					avgRetries: profile.avgRetries,
					dominantFailureMode: dominantFailureMode(profile),
					preferredToolCallFormat: preferredToolCallFormat(profile),
					preferredPromptVariantFamily: preferredPromptVariantFamily(profile),
					complexityCeiling: profile.complexityCeiling,
					qualityEffectiveContextTokens: profile.qualityEffectiveContextTokens,
					qualityDegradedAtTokens: profile.qualityDegradedAtTokens,
					updatedAt: profile.updatedAt,
				})),
			};
		},
		// §5.AL fitness browser: the global per-(model × role × difficulty) fitness cells + the failing-LLM
		// projection. Read-only; empty when the store is missing/unreadable (never throws into the UI).
		getFitnessTable: async () => {
			// F1.15c: the unified read — persisted store (eval + legacy) merged with the live ledger projection.
			const rows = await readMergedFitnessRows().catch(() => ({}) as Record<string, never>);
			const fitnessRows = Object.values(rows);
			return {
				generatedAt: Date.now(),
				rows: buildFitnessTableView(fitnessRows),
				// F3.35 enrichment — best not-loaded upgrade per ceiling-hit role, from the fitness rows + the `lms ls`
				// catalog (machine + size) + the NKLEIN_DEVICE_RAM_GB map + real loaded state. Best-effort: any failing
				// source degrades to no upgrades (never breaks the fitness view).
				capabilityUpgrades: await computeCapabilityUpgrades(fitnessRows).catch(() => []),
			};
		},
		// Ledger analytics: retrieval-usefulness + knowledge-outcome lift + opportunistic-value — the same three
		// projections behind the `dev retrieval-usefulness` / `dev knowledge-outcomes` / `dev opportunistic-value`
		// CLIs, folded read-only for the operator telemetry UI. Empty-safe: a missing/unreadable ledger yields zeros.
		// F12.98 Trust & Privacy Panel: the trust-center's LIVE state — per-egress-class posture (F12.101 assessment)
		// + the hash-chained receipt log's verification. Read-only; renders what the architecture currently enforces.
		getTrustPosture: async () => {
			const { assessAirGapPosture, isAirGappedMode } = await import("../core/air-gap-posture");
			const { verifyEgressReceiptChain } = await import("../core/egress-receipt");
			const { readEgressReceipts } = await import("../state/egress-receipt-store");
			const { readFile } = await import("node:fs/promises");
			const { homedir } = await import("node:os");
			const { join } = await import("node:path");
			let configuredMcpServers = 0;
			try {
				const raw = await readFile(
					join(homedir(), ".nklein", "data", "settings", "nklein_mcp_settings.json"),
					"utf8",
				);
				configuredMcpServers = Object.keys(
					(JSON.parse(raw) as { mcpServers?: Record<string, unknown> }).mcpServers ?? {},
				).length;
			} catch {}
			let providerBaseUrl: string | null = null;
			try {
				const raw = await readFile(join(homedir(), ".nklein", "data", "settings", "providers.json"), "utf8");
				providerBaseUrl =
					(JSON.parse(raw) as { providers?: Record<string, { settings?: { baseUrl?: string } }> }).providers
						?.lmstudio?.settings?.baseUrl ?? null;
			} catch {}
			// F12.101: reflect the ENFORCING switch — the audit reports the EFFECTIVE posture, never "open" for a class
			// the profile hard-closes at its gate.
			const airGapped = isAirGappedMode();
			const posture = assessAirGapPosture({
				webResearchEnabled: process.env.KANBAN_ENABLE_WEB_RESEARCH === "1" && !airGapped,
				autoUpdateEnabled: !(process.env.NKLEIN_NO_AUTO_UPDATE || process.env.KANBAN_NO_AUTO_UPDATE) && !airGapped,
				configuredMcpServers: airGapped ? 0 : configuredMcpServers,
				providerBaseUrl,
			});
			const receipts = await readEgressReceipts().catch(() => []);
			const verification = verifyEgressReceiptChain(receipts);
			return {
				generatedAt: Date.now(),
				classes: [...posture.classes],
				airGapped: posture.airGapped,
				summary: posture.summary,
				egressReceiptCount: receipts.length,
				receiptChainValid: verification.valid,
				receiptChainReason: verification.reason,
			};
		},
		getLedgerAnalytics: async () => {
			const events = await readAllAgentLedger().catch(() => []);
			return {
				generatedAt: Date.now(),
				retrieval: summarizeRetrievalUsefulness(events),
				knowledgeByModel: summarizeKnowledgeOutcomeByModel(events),
				knowledgeDebt: summarizeKnowledgeDebtOutcomes(events),
				opportunistic: summarizeOpportunisticValue(events),
			};
		},
		// F5.2 memory-corpus health: the freshness audit (behind `dev memory-audit`) over the on-disk basic-memory
		// notes the knowledge tools read from. Only counts + bounded finding summaries cross the wire, never note
		// bodies. Empty-safe: a missing/unreadable corpus reports available=false with zero findings.
		getMemoryAudit: async () => {
			const { homedir } = await import("node:os");
			const { join } = await import("node:path");
			const root = join(homedir(), "basic-memory");
			const notes = await readBasicMemoryNotes(root, nodeBasicMemoryFsDeps()).catch(() => []);
			const result = auditMemoryFreshness(
				notes,
				{ stalenessThresholdMs: 180 * 24 * 60 * 60 * 1000, cadenceMs: 0 },
				Date.now(),
			);
			return {
				generatedAt: Date.now(),
				available: notes.length > 0,
				notesAudited: result.notesAudited,
				summary: result.summary,
				topFindings: result.findings
					.slice(0, 20)
					.map((finding) => ({ kind: finding.kind, noteTitle: finding.noteTitle, detail: finding.detail })),
			};
		},
		// F1.35b: background-eval rail controls/status. Read-only snapshot + the two operator mutations, all over the
		// injected (or fallback store-backed) coordinator. Byte-safe: without the F1.31 service the controls persist
		// intent + the status reads disabled/idle; a capable runtime hosts the service and enable/pause drive it.
		getRailStatus: async () => toRailStatusResponse(await resolveRailCoordinator(deps).getStatus()),
		setRailControl: async (input) =>
			toRailStatusResponse(
				await resolveRailCoordinator(deps).applyCommand(
					input.kind === "pause" ? { kind: "pause", reason: input.reason ?? null } : { kind: input.kind },
				),
			),
		setRailTunables: async (input) => toRailStatusResponse(await resolveRailCoordinator(deps).updateTunables(input)),
		// §5.AL/§10c#11: degraded-model badges for the model selector — derived from persisted self-observation
		// events + the ledger run denominator (same recipe as `dev model-verdict`). Read-only; empty on any error.
		getModelVerdictBadges: async () => {
			const [events, ledgerEvents] = await Promise.all([
				readSelfObservationEvents({ limit: 500 }).catch(() => []),
				readAllAgentLedger().catch(() => []),
			]);
			const runs = selectAttempts(ledgerEvents).map((attempt) => ({
				runId: attempt.attemptId,
				modelId: attempt.modelId,
			}));
			return { generatedAt: Date.now(), badges: buildModelVerdictBadges({ events, runs }) };
		},
		getFleetStatus: async (workspaceScope) => {
			return await handleGetFleetStatus({
				getMachineMap: async () =>
					buildLmStudioMachineByModelId(await fetchLmsPsModelsCached(createDefaultLmsRunner())),
				getWarmthLedger: () =>
					deps.getLoadedScopedNKleinTaskSessionService?.(workspaceScope)?.getPromptWarmthLedger() ?? null,
			});
		},
		// F1.40: per-card + per-project time tracking. Projects the model-performance observations (per session run)
		// grouped by taskId over the workspace's board cards -- age (now - createdAt), active time (union of run wall
		// spans [startedAt, startedAt+wallTimeMs]), and LLM processing time (SUM of timeToLastOutputMs = prompt-sent ->
		// response-streaming-ended, per David 2026-07-15; successful = outcome "completed"). Empty-safe on read failure.
		getTimeTracking: async (workspaceScope) => {
			const now = Date.now();
			const [board, stats] = await Promise.all([
				loadWorkspaceState(workspaceScope.workspacePath)
					.then((state) => state.board)
					.catch(() => null),
				handleGetModelPerformanceStats(workspaceScope).catch(() => ({ observations: [] as never[] })),
			]);
			const activitiesByTask = new Map<string, TimeTrackingActivity[]>();
			for (const observation of stats.observations) {
				const list = activitiesByTask.get(observation.taskId) ?? [];
				const endedAt =
					observation.startedAt !== null && observation.wallTimeMs !== null
						? observation.startedAt + observation.wallTimeMs
						: null;
				list.push({
					startedAt: observation.startedAt,
					endedAt,
					llmMs: observation.timeToLastOutputMs,
					successful: observation.outcome === "completed",
				});
				activitiesByTask.set(observation.taskId, list);
			}
			const cards = board ? board.columns.flatMap((column) => column.cards) : [];
			const cardRows = cards.map((card) => ({
				taskId: card.id,
				title: card.title ?? card.id,
				metrics: computeTimeTracking({
					createdAt: card.createdAt,
					activities: activitiesByTask.get(card.id) ?? [],
					now,
				}),
			}));
			const project = computeProjectTimeTracking({
				cards: cards.map((card) => ({ createdAt: card.createdAt })),
				activities: cards.flatMap((card) => activitiesByTask.get(card.id) ?? []),
				now,
			});
			return { generatedAt: now, project, cards: cardRows };
		},
		getModelTuning: async () => {
			// Fleet-wide (not workspace-scoped): learned budgets are per-model across all recorded history.
			const [ledgerEvents, stats] = await Promise.all([
				readAllAgentLedger().catch(() => []),
				readModelPerformanceStats({ limit: 5000 }).catch(() => ({ observations: [] as never[] })),
			]);
			const models = buildModelTuningRecommendations({
				ledgerEvents,
				answerSizeObservations: stats.observations.map((observation) => ({
					modelId: observation.modelId,
					usage: observation.usage,
				})),
			});
			return { generatedAt: Date.now(), models };
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
		// F2.18c: queue an OPERATOR note onto a card's mailbox. The redrive (start-task-session) drains pending
		// notes into the resumed session's prompt, so this + a redrive threads the operator's answer/context/
		// constraint into the SAME suspended state the card resumes from.
		sendCardMailboxNote: async (input) => {
			await appendCardMailboxNote({ taskId: input.taskId, text: input.text, source: "operator" });
			return { pending: await countPendingCardMailbox(input.taskId).catch(() => 0) };
		},
		// F2.12b: the host-action audit history for a chat session (read-only; secrets already masked at write time).
		getChatHostActionAudit: async (input) => {
			const entries = await readChatHostActionAudit(input).catch(() => []);
			return { entries: entries.map(({ schemaVersion: _schemaVersion, ...entry }) => entry) };
		},
		// F2.2b/F2.12b: the host-action confirm control channel — list the pending operator confirmations, and
		// resolve one (approve/deny). The queue is a runtime singleton the chat `confirm` callback parks on.
		getPendingHostActionConfirms: async (input) => {
			const all = hostActionConfirmQueue.listPending(Date.now());
			return { pending: input.sessionId ? all.filter((entry) => entry.sessionId === input.sessionId) : all };
		},
		resolveHostActionConfirm: async (input) => {
			const outcome = hostActionConfirmQueue.resolve(
				{
					attemptId: input.attemptId,
					sessionId: input.sessionId,
					action: input.action,
					target: input.target,
					approve: input.approve,
				},
				Date.now(),
			);
			return { outcome };
		},
		getGlobalSetupPlan: async () => {
			const globalConfig = await loadGlobalRuntimeConfig();
			const providerEndpoint = nkleinProviderService.getLocalChatBaseUrl() ?? DEFAULT_LOCAL_MODEL_BASE_URL;
			return await handleGetGlobalSetupPlan({
				getHardware: () => ({ totalRamMb: Math.round(totalmem() / (1024 * 1024)), cpuCount: cpus().length }),
				getLoadedModelIds: () => fetchLoadedModelIdsCached(providerEndpoint),
				providerEndpoint,
				getDockerAvailable: () => deps.getAgentSandboxStatus?.()?.dockerAvailable ?? null,
				getDockerVmMemoryMb: () => probeDockerVmMemoryMb(),
				getSecondOpinionReviewEnabled: () => globalConfig.secondOpinionReviewEnabled,
				getModelRoleCounts: () => {
					const entries = Object.values(globalConfig.modelRoles ?? {});
					const assigned = entries.filter(
						(role) => typeof role?.modelId === "string" && role.modelId.trim().length > 0,
					).length;
					return { assigned, total: entries.length };
				},
				getDeviceRamGb: () => {
					// Stored as a string; parse to the numeric GB budget the wizard step reports (null when unset/invalid).
					const parsed = globalConfig.deviceRamGb ? Number.parseInt(globalConfig.deviceRamGb, 10) : Number.NaN;
					return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
				},
				getMemorySettings: () => ({
					basicMemoryEnabled: globalConfig.basicMemoryEnabled,
					sandboxMcpServersEnabled: globalConfig.sandboxMcpServersEnabled,
					memoryFreshnessAuditEnabled: globalConfig.memoryFreshnessAudit.enabled,
				}),
				getEgressSettings: () => ({
					egressProxyEnabled: globalConfig.sandboxEgressProxyEnabled,
					allowlistCount: parseEgressAllowlist(globalConfig.sandboxEgressAllowlist).length,
					retrievalEgressEnabled: globalConfig.retrievalEgressEnabled,
				}),
				getCompletedAt: () => globalConfig.setupWizardCompletedAt,
			});
		},
		getProjectSetupPlan: async (workspaceScope) => {
			const scopedConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			const providerEndpoint = nkleinProviderService.getLocalChatBaseUrl() ?? DEFAULT_LOCAL_MODEL_BASE_URL;
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
				getCompletedAt: async () => {
					if (scopedConfig.projectSetupWizardCompletedAt !== null) {
						return scopedConfig.projectSetupWizardCompletedAt;
					}
					// A dev-test FIXTURE workspace is scaffolded ready-to-run — its marker counts as onboarding, so the
					// project wizard never auto-fires on it (live-found 2026-07-09: every scaffold popped the 6-step wizard).
					try {
						const raw = await readFile(
							join(workspaceScope.workspacePath, NKLEIN_DEV_TEST_PROJECT_MARKER_PATH),
							"utf8",
						);
						const marker = JSON.parse(raw) as { createdAt?: unknown };
						return typeof marker.createdAt === "number" ? marker.createdAt : Date.now();
					} catch {
						return null;
					}
				},
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
		listNKleinPlanQuestions: async (workspaceScope, input) => handleListPlanQuestions(workspaceScope, input),
		getTaskFocusChainHistory: async (workspaceScope, input) => handleGetFocusChainHistory(workspaceScope, input),
		answerNKleinPlanQuestion: async (workspaceScope, input) =>
			handleAnswerPlanQuestion(workspaceScope, input, {
				getScopedNKleinTaskSessionService: deps.getScopedNKleinTaskSessionService,
			}),
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
				fetchLoadedModelDescriptors: defaultModelFleetSuggestionDescriptorFetcher,
			});
		},
		checkLlmfitCatalogUpdate: async (workspaceScope) => {
			const mode = await resolveLlmfitCatalogUpdateMode(workspaceScope, deps);
			return await handleCheckLlmfitCatalogUpdate({
				mode,
				checkCatalogUpdate: defaultLlmfitCatalogUpdateChecker,
				pullCatalogUpdate: defaultLlmfitCatalogUpdatePuller,
				registerCatalogSupplement: defaultLlmfitCatalogSupplementRegistrar,
			});
		},
		pullLlmfitCatalogUpdate: async (workspaceScope) => {
			const mode = await resolveLlmfitCatalogUpdateMode(workspaceScope, deps);
			return await handlePullLlmfitCatalogUpdate({
				mode,
				pullCatalogUpdate: defaultLlmfitCatalogUpdatePuller,
				registerCatalogSupplement: defaultLlmfitCatalogSupplementRegistrar,
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
				return { enabled: false, reachable: false, sidecarUrl: config.sidecarUrl, loadedModels: [] };
			}
			const health = await probeKleinCorePyHealth({ config });
			return {
				enabled: true,
				reachable: health.reachable,
				sidecarUrl: health.sidecarUrl,
				loadedModels: health.loadedModels,
			};
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
		evaluateConnectedModels: async () => {
			// §5.AB "Evaluate connected models" (todo 6544): eval every ALREADY-LOADED model against the corpus and
			// persist per-cell fitness. Deliberately scoped to LOADED models only — never loads anything, so the
			// on-demand trigger can't overload the host (the deep, load-cycling sweep stays the CLI `verify-all-models`).
			const endpoint = nkleinProviderService.getLocalChatBaseUrl() ?? DEFAULT_LOCAL_MODEL_BASE_URL;
			const repeats = 1; // on-demand = a fast single pass; the CLI sweep owns the N× stability run.
			const loadedIds = await fetchLoadedModelIdsCached(endpoint).catch(() => [] as string[]);
			if (loadedIds.length === 0) {
				return {
					evaluatedAt: Date.now(),
					endpoint,
					repeats,
					models: [],
					skippedReason: "No loaded models found on the local endpoint — load a model in LM Studio first.",
				};
			}
			const chatBase = endpoint.replace(/\/+$/, "");
			const chatUrl = `${chatBase.endsWith("/v1") ? chatBase : `${chatBase}/v1`}/chat/completions`;
			const models: RuntimeModelEvalSummary[] = [];
			for (const modelId of loadedIds) {
				const chat: ModelEvalChat = async (messages, extra) => {
					try {
						const res = await fetch(chatUrl, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ model: modelId, messages, temperature: 0, max_tokens: 2500, ...extra }),
						});
						const json = (await res.json()) as { choices?: ModelEvalChatChoice[]; error?: unknown };
						return json.error ? null : (json.choices?.[0] ?? null);
					} catch {
						return null;
					}
				};
				// F4.13 OPT-IN (NKLEIN_EVAL_DISTRACTOR_PROBE, default off): also run each cell with distractor noise so
				// `dev distractor-sensitivity` learns per-cell degradation. Doubles this eval's cost when enabled; a
				// no-op otherwise (byte-identical single pass). Fleet produces the real data; the wiring is verifiable.
				const distractorProbe = isTruthyEnv(process.env.NKLEIN_EVAL_DISTRACTOR_PROBE)
					? buildNoisyEvalChat(chat)
					: null;
				// F3.16 OPT-IN (NKLEIN_ENFORCED_REASONING): also run each cell through the enforced-reasoning loop so
				// `dev reasoning-benefit` learns whether forcing reasoning helps. Same doubling/no-op contract.
				const enforcedChat = isTruthyEnv(process.env.NKLEIN_ENFORCED_REASONING)
					? buildEnforcedEvalChat(chat, modelId)
					: null;
				const result = await runModelEval(
					{ modelId, repeats },
					{
						chat,
						...(distractorProbe
							? {
									noisyChat: distractorProbe.noisyChat,
									noiseFraction: distractorProbe.noiseFraction,
									recordDistractorSensitivity: (obs) => void appendDistractorObservations(obs).catch(() => {}),
								}
							: {}),
						...(enforcedChat
							? {
									enforcedChat,
									recordReasoningBenefit: (obs) => void appendReasoningObservations(obs).catch(() => {}),
								}
							: {}),
					},
				);
				// Persist the raw per-run records so `dev model-role-stability` can measure settled-vs-flaky variance —
				// the aggregate fitness fold below loses the per-run spread. Best-effort; never breaks the eval.
				void appendModelEvalRuns(result.runs).catch(() => {});
				for (const cell of result.cells) {
					if (cell.score === null) {
						continue;
					}
					await recordTaskFitnessOutcome(
						{ modelKey: modelId, role: cell.role, difficultyTier: evalDifficultyToFitnessTier(cell.difficulty) },
						{
							success: cell.score >= 0.6,
							wallTimeMs: cell.latencyMs,
							failureMode: cell.score >= 0.6 ? undefined : "eval_below_bar",
						},
						{ now: Date.now() },
					).catch(() => undefined);
				}
				models.push({
					modelId,
					strategy: result.strategy,
					meanScore: result.meanScore,
					scoredAttempts: result.scoredAttempts,
					totalAttempts: result.totalAttempts,
					byRole: Object.entries(result.fitnessByRole).map(([role, rec]) => ({
						role,
						qualityScore: rec.qualityScore,
						reliability: rec.reliability,
						maxDifficultyCleared: rec.maxDifficultyCleared,
						samples: rec.samples,
					})),
				});
			}
			return { evaluatedAt: Date.now(), endpoint, repeats, models, skippedReason: null };
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
		openWorkspaceIn: async (workspaceScope, input) => {
			if (deps.isRemoteMode) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Host-local action unavailable in remote mode — runs on the server host, not your machine.",
				});
			}
			// F2.6: the client names a TYPED target; the server builds the command from its own platform and the
			// workspace path it already knows — no arbitrary command string ever crosses the wire.
			if (!isHostOpenTargetId(input.targetId)) {
				throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown open target: ${input.targetId}` });
			}
			try {
				const command = buildHostOpenCommand(
					input.targetId,
					workspaceScope.workspacePath,
					hostOpenPlatformFromProcess(process.platform),
				);
				return await deps.runCommand(command, workspaceScope.workspacePath);
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
			// F2.6 server-side target validation: absolute plain path (no URL schemes), and it must exist as a
			// regular file — the host opener never launches arbitrary URLs or guessed paths.
			const validated = validateHostOpenFilePath(input.filePath);
			if (!validated.ok) {
				throw new TRPCError({ code: "BAD_REQUEST", message: validated.reason });
			}
			let isFile = false;
			try {
				isFile = statSync(validated.path).isFile();
			} catch {
				isFile = false;
			}
			if (!isFile) {
				throw new TRPCError({ code: "BAD_REQUEST", message: "File does not exist on the host." });
			}
			openInBrowser(validated.path);
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
		// F2.7b: a chat message's out-of-band image attachments (data-URL-ready) for history rendering.
		getChatMessageImages: async (input) => ({
			images: await chatService.getMessageImages(input.sessionId, input.messageId),
		}),
		// F2.9b: the session's unified memory (provenance + typed delete control per record) + delete execution.
		getChatSessionMemory: async (input) => ({ records: await chatService.getSessionMemory(input.sessionId) }),
		deleteChatSessionMemory: async (input) => ({ outcome: await chatService.deleteSessionMemory(input.control) }),
		// §5.BB focus-chain surface: read-only projection of the session's live plan checklist (default store root —
		// the same place the agent-turn's readFocusChain dep reads).
		updateChatFocusChain: async (input) => {
			const result = await applyOperatorChatFocusChainUpdate(input.sessionId, input.steps);
			return {
				ok: result.ok,
				rejected: result.rejected,
				chain: result.chain
					? {
							steps: result.chain.steps.map((step) => ({ text: step.text, status: step.status })),
							updatedAt: result.chain.updatedAt,
						}
					: null,
			};
		},
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
		steerChatTurn: (input) => chatService.steerTurn(input),
		startAutonomousChatRun: (input) => autonomousChatRun.start(input),
		getAutonomousChatRunStatus: (input) => autonomousChatRun.status(input),
	};
}
