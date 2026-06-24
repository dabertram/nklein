// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed NKlein, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { probeKleinCorePyHealth, resolveKleinCorePyConfig } from "../config/klein-core-config";
import type { RuntimeConfigState } from "../config/runtime-config";
import { updateGlobalRuntimeConfig, updateRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeBoardCard,
	RuntimeCommandRunResponse,
	RuntimeNKleinProviderSettings,
	RuntimeProtectedTestApprovalGrantResponse,
	RuntimeRunUpdateResponse,
	RuntimeTaskContextImportResponse,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskSessionSummary,
	RuntimeUpdateStatusResponse,
	RuntimeWorkspaceChangesResponse,
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
	parseNKleinModelContextWindowOverrideRequest,
	parseNKleinModelMaxConcurrentRequestsRequest,
	parseNKleinModelRegistryRemoveRequest,
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
import { protectedTestApprovalStore } from "../core/protected-test-approval-store";
import { selectRoleModel } from "../core/role-model-selection";
import { clearSwarmStop, readSwarmStopSignal, requestSwarmStop } from "../core/swarm-guardrails";
import { moveTaskToColumn } from "../core/task-board-mutations";
import {
	formatGitHubContextLabel,
	type GitHubIssueView,
	parseGitHubContextTarget,
	renderGitHubIssueContext,
} from "../core/task-context-import";
import { resolveTaskTitle } from "../core/task-title.js";
import { buildNKleinAdvisorRequest } from "../nklein-sdk/nklein-advisor";
import { buildTaskShellSpawnSpec } from "../nklein-sdk/nklein-agent-sandbox";
import { createNKleinCodeEmbeddingProviderFromSettings } from "../nklein-sdk/nklein-code-embeddings";
import { getNKleinCodeIndexStatus } from "../nklein-sdk/nklein-code-index";
import {
	assertNKleinContextWindowPolicy,
	isNKleinContextWindowPolicyError,
} from "../nklein-sdk/nklein-context-window-policy";
import { applyNKleinPlanTaskGraphToBoard } from "../nklein-sdk/nklein-decomposition-tool";
import { writeNKleinDogfoodBacklog } from "../nklein-sdk/nklein-dogfood-engine";
import {
	DEFAULT_EMBEDDING_MODEL_MANIFEST,
	getEmbeddingModelPath,
	isEmbeddingModelInstalled,
} from "../nklein-sdk/nklein-embedding-model-manager";
import { scheduleNKleinEndpointStart } from "../nklein-sdk/nklein-endpoint-scheduler";
import { runNKleinDevSmokeEval } from "../nklein-sdk/nklein-eval-harness";
import {
	assertLocalProviderAllowed,
	isCloudProviderDisabledError,
	isLocalProvider,
} from "../nklein-sdk/nklein-local-only-policy";
import { createNKleinMcpRuntimeService } from "../nklein-sdk/nklein-mcp-runtime-service";
import { createNKleinMcpSettingsService } from "../nklein-sdk/nklein-mcp-settings-service";
import {
	buildNKleinModelRegistryKey,
	createNKleinModelRegistryEntry,
	getDefaultNKleinModelRegistry,
	type NKleinModelRegistryEntry,
	type NKleinModelRegistryKeyInput,
} from "../nklein-sdk/nklein-model-registry";
import { buildNKleinModelFreshnessAdvisorRequest } from "../nklein-sdk/nklein-model-research";
import {
	listNKleinPlanArtifactsForSourceTask,
	type NKleinPlanArtifactSummary,
	readNKleinPlanArtifactsByArtifactId,
	summarizeNKleinPlanArtifacts,
	updateNKleinPlanArtifactApplicationStatus,
} from "../nklein-sdk/nklein-plan-artifacts";
import { createNKleinProviderService } from "../nklein-sdk/nklein-provider-service";
import { buildNKleinRepoMap } from "../nklein-sdk/nklein-repo-map";
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
import { readTaskRunSummaries, type TaskRunTimeoutSource } from "../state/task-run-summary-store";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { createEvidenceBundle } from "../telemetry/evidence-bundle";
import { readKnowledgeToolUsageStats } from "../telemetry/knowledge-tool-usage-stats";
import { readModelPerformanceStats } from "../telemetry/model-performance-stats";
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
import type { RuntimeTaskStartQueue } from "./runtime-task-start-queue";

type ResolvedNKleinLaunchConfig = Awaited<
	ReturnType<ReturnType<typeof createNKleinProviderService>["resolveLaunchConfig"]>
>;

const execFileAsync = promisify(execFile);
const GITHUB_CONTEXT_IMPORT_TIMEOUT_MS = 20_000;
const GITHUB_CONTEXT_IMPORT_MAX_BUFFER_BYTES = 512_000;

interface AdvisorChatCompletionInput {
	launchConfig: ResolvedNKleinLaunchConfig;
	prompt: string;
}

function joinUrlPath(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

function withTaskPausedState(
	summary: RuntimeTaskSessionSummary | null,
	pausedTaskIds: Set<string>,
): RuntimeTaskSessionSummary | null {
	return summary ? { ...summary, paused: pausedTaskIds.has(summary.taskId) } : null;
}

function resolveAdvisorOpenAiBaseUrl(launchConfig: ResolvedNKleinLaunchConfig): string {
	const configured = launchConfig.baseUrl?.trim();
	if (configured) {
		const trimmed = configured.replace(/\/+$/u, "");
		try {
			const url = new URL(trimmed);
			if (!url.pathname.endsWith("/v1")) {
				url.pathname = `${url.pathname.replace(/\/+$/u, "")}/v1`;
			}
			return url.toString().replace(/\/+$/u, "");
		} catch {
			return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
		}
	}
	if (launchConfig.providerId === "lmstudio" || launchConfig.providerId === "lm-studio") {
		return "http://localhost:1234/v1";
	}
	return "http://localhost:11434/v1";
}

function resolveAdvisorOllamaBaseUrl(launchConfig: ResolvedNKleinLaunchConfig): string {
	return launchConfig.baseUrl?.trim().replace(/\/+$/u, "") || "http://localhost:11434";
}

function readAdvisorTextResponse(value: unknown): string {
	if (!value || typeof value !== "object") {
		return "";
	}
	const record = value as Record<string, unknown>;
	const message = record.message;
	if (message && typeof message === "object") {
		const content = (message as Record<string, unknown>).content;
		if (typeof content === "string") {
			return content;
		}
	}
	const response = record.response;
	if (typeof response === "string") {
		return response;
	}
	const choices = record.choices;
	if (Array.isArray(choices)) {
		const firstChoice = choices[0];
		if (firstChoice && typeof firstChoice === "object") {
			const choiceRecord = firstChoice as Record<string, unknown>;
			const choiceMessage = choiceRecord.message;
			if (choiceMessage && typeof choiceMessage === "object") {
				const content = (choiceMessage as Record<string, unknown>).content;
				if (typeof content === "string") {
					return content;
				}
			}
			const text = choiceRecord.text;
			if (typeof text === "string") {
				return text;
			}
		}
	}
	return "";
}

async function runGitHubCli(args: string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("gh", args, {
		cwd,
		timeout: GITHUB_CONTEXT_IMPORT_TIMEOUT_MS,
		maxBuffer: GITHUB_CONTEXT_IMPORT_MAX_BUFFER_BYTES,
	});
	return stdout.toString();
}

async function importGitHubIssueContext(targetText: string, cwd: string): Promise<RuntimeTaskContextImportResponse> {
	const target = parseGitHubContextTarget(targetText);
	const sourceLabel = formatGitHubContextLabel("github_issue", target);
	const stdout = await runGitHubCli(
		[
			"issue",
			"view",
			target.number,
			"--repo",
			`${target.owner}/${target.repo}`,
			"--json",
			"title,body,comments,url,state,labels",
		],
		cwd,
	);
	const issue = JSON.parse(stdout) as GitHubIssueView;
	const content = renderGitHubIssueContext(issue);
	if (!content) {
		throw new Error("GitHub issue returned no importable content.");
	}
	return {
		ok: true,
		sourceLabel,
		title: issue.title?.trim() || null,
		content,
	};
}

async function importGitHubPrDiffContext(targetText: string, cwd: string): Promise<RuntimeTaskContextImportResponse> {
	const target = parseGitHubContextTarget(targetText);
	const sourceLabel = formatGitHubContextLabel("github_pr_diff", target);
	const content = (
		await runGitHubCli(["pr", "diff", target.number, "--repo", `${target.owner}/${target.repo}`], cwd)
	).trim();
	if (!content) {
		throw new Error("GitHub PR diff returned no importable content.");
	}
	return {
		ok: true,
		sourceLabel,
		title: null,
		content,
	};
}

async function fetchAdvisorJson(url: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(url, init);
	const text = await response.text();
	if (!response.ok) {
		throw new Error(text.trim() || `Advisor model request failed with HTTP ${response.status}.`);
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new Error("Advisor model returned a non-JSON response.");
	}
}

async function runLocalAdvisorCompletion(input: AdvisorChatCompletionInput): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 120_000);
	try {
		const providerId = input.launchConfig.providerId.trim().toLowerCase();
		if (providerId === "ollama") {
			const value = await fetchAdvisorJson(
				joinUrlPath(resolveAdvisorOllamaBaseUrl(input.launchConfig), "/api/chat"),
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(input.launchConfig.apiKey ? { authorization: `Bearer ${input.launchConfig.apiKey}` } : {}),
					},
					body: JSON.stringify({
						model: input.launchConfig.modelId,
						stream: false,
						messages: [{ role: "user", content: input.prompt }],
					}),
					signal: controller.signal,
				},
			);
			const output = readAdvisorTextResponse(value).trim();
			if (!output) {
				throw new Error("Advisor model returned an empty response.");
			}
			return output;
		}

		const value = await fetchAdvisorJson(
			joinUrlPath(resolveAdvisorOpenAiBaseUrl(input.launchConfig), "/chat/completions"),
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(input.launchConfig.apiKey ? { authorization: `Bearer ${input.launchConfig.apiKey}` } : {}),
				},
				body: JSON.stringify({
					model: input.launchConfig.modelId,
					messages: [{ role: "user", content: input.prompt }],
					temperature: 0.2,
					stream: false,
				}),
				signal: controller.signal,
			},
		);
		const output = readAdvisorTextResponse(value).trim();
		if (!output) {
			throw new Error("Advisor model returned an empty response.");
		}
		return output;
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new Error("Advisor model request timed out after 120 seconds.");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

export interface CreateRuntimeApiDependencies {
	getActiveWorkspaceId: () => string | null;
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

function truncateEvidenceText(value: string, maxChars: number): string {
	const normalized = value.trimEnd();
	if (normalized.length <= maxChars) {
		return normalized;
	}
	return `${normalized.slice(0, maxChars).trimEnd()}\n[truncated after ${maxChars.toLocaleString()} characters]`;
}

function renderWorkspaceChangesEvidence(changes: RuntimeWorkspaceChangesResponse | null): string | null {
	if (!changes || changes.files.length === 0) {
		return null;
	}
	const sections: string[] = [];
	for (const file of changes.files.slice(0, 20)) {
		sections.push(
			[
				`diff --nklein ${file.path}`,
				`status: ${file.status}; additions: ${file.additions}; deletions: ${file.deletions}`,
				file.previousPath ? `previous: ${file.previousPath}` : null,
				file.oldText !== null ? "--- old" : null,
				file.oldText !== null ? truncateEvidenceText(file.oldText, 4_000) : null,
				file.newText !== null ? "+++ new" : null,
				file.newText !== null ? truncateEvidenceText(file.newText, 4_000) : null,
			]
				.filter((line): line is string => line !== null)
				.join("\n"),
		);
	}
	if (changes.files.length > 20) {
		sections.push(`[${changes.files.length - 20} additional changed files omitted from evidence preview]`);
	}
	return `${sections.join("\n\n")}\n`;
}

function buildTaskEvidencePromptBlock(input: {
	task: RuntimeBoardCard;
	workspacePath: string;
	taskCwd: string;
	baseCommit: string | null;
	bundlePath: string;
	transcriptCount: number;
	changeCount: number;
}): string {
	return [
		"Here is evidence from a !Klein task.",
		"",
		`Evidence bundle: ${input.bundlePath}`,
		`Workspace: ${input.workspacePath}`,
		`Task workspace: ${input.taskCwd}`,
		`Task: ${input.task.title?.trim() || input.task.id} (${input.task.id})`,
		`Base ref: ${input.task.baseRef}`,
		`Base commit: ${input.baseCommit ?? "unknown"}`,
		`Transcript files: ${input.transcriptCount}`,
		`Changed files captured: ${input.changeCount}`,
		"",
		"Please inspect the files in the evidence bundle, especially summary.md, transcript/, diff.patch, and config-snapshot.json. Then diagnose the issue, propose the smallest safe fix, and update the code/tests accordingly.",
	].join("\n");
}

function getProfileTimeoutDefaults(profile: "cloud" | "local" | "custom"): {
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
} {
	if (profile === "cloud" || profile === "local") {
		return {
			requestTimeoutMs: 60 * 60 * 1000,
			streamTimeoutMs: 24 * 60 * 60 * 1000,
			toolTimeoutMs: 24 * 60 * 60 * 1000,
			agentTimeoutMs: 24 * 60 * 60 * 1000,
			conversationTimeoutMs: 7 * 24 * 60 * 60 * 1000,
		};
	}
	return {
		requestTimeoutMs: null,
		streamTimeoutMs: null,
		toolTimeoutMs: null,
		agentTimeoutMs: null,
		conversationTimeoutMs: null,
	};
}

function scaleTimeoutMs(value: number | null, factor: number): number | null {
	if (value === null) {
		return null;
	}
	return Math.max(0, Math.trunc(value * factor));
}

const MIN_POSITIVE_NKLEIN_TIMEOUT_MS = 60 * 1000;

function enforceLocalNKleinTimeoutFloor(value: number | null): number | null {
	if (value === null || value === 0) {
		return value;
	}
	return Math.max(MIN_POSITIVE_NKLEIN_TIMEOUT_MS, value);
}

/**
 * Provenance of a resolved timeout value, mirroring the precedence in `resolveEffectiveTaskTimeoutSettings`:
 * a per-task/role override wins, then the global runtime config, then the autonomous profile default. Surfaced
 * on terminal run summaries so a timeout-triggered review records *where* the bound that fired came from.
 */
function resolveTimeoutSource(
	taskValue: number | null | undefined,
	globalValue: number | null | undefined,
): TaskRunTimeoutSource {
	if (taskValue !== null && taskValue !== undefined) {
		return "role_override";
	}
	if (globalValue !== null && globalValue !== undefined) {
		return "global_config";
	}
	return "autonomous_default";
}

function resolveEffectiveTaskTimeoutSettings(input: {
	runtimeConfig: RuntimeConfigState;
	taskSettings?: {
		timeoutMode?: "normal" | "long" | "extended" | "unlimited";
		requestTimeoutMs?: number | null;
		streamTimeoutMs?: number | null;
		toolTimeoutMs?: number | null;
		agentTimeoutMs?: number | null;
		conversationTimeoutMs?: number | null;
	};
}): {
	timeoutMode: "normal" | "long" | "extended" | "unlimited";
	requestTimeoutMs: number | null;
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	agentTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	timeoutProfile: "cloud" | "local" | "custom";
	streamTimeoutSource: TaskRunTimeoutSource;
	toolTimeoutSource: TaskRunTimeoutSource;
	conversationTimeoutSource: TaskRunTimeoutSource;
} {
	const timeoutProfile = input.runtimeConfig.agentTimeoutProfile;
	const timeoutMode = input.taskSettings?.timeoutMode ?? input.runtimeConfig.agentTimeoutMode;
	const profileDefaults = getProfileTimeoutDefaults(timeoutProfile);
	const requestTimeoutMs =
		input.taskSettings?.requestTimeoutMs ?? input.runtimeConfig.requestTimeoutMs ?? profileDefaults.requestTimeoutMs;
	const streamTimeoutMs =
		input.taskSettings?.streamTimeoutMs ?? input.runtimeConfig.streamTimeoutMs ?? profileDefaults.streamTimeoutMs;
	const toolTimeoutMs =
		input.taskSettings?.toolTimeoutMs ?? input.runtimeConfig.toolTimeoutMs ?? profileDefaults.toolTimeoutMs;
	const agentTimeoutMs =
		input.taskSettings?.agentTimeoutMs ?? input.runtimeConfig.agentTimeoutMs ?? profileDefaults.agentTimeoutMs;
	const conversationTimeoutMs =
		input.taskSettings?.conversationTimeoutMs ??
		input.runtimeConfig.conversationTimeoutMs ??
		profileDefaults.conversationTimeoutMs;
	const streamTimeoutSource = resolveTimeoutSource(
		input.taskSettings?.streamTimeoutMs,
		input.runtimeConfig.streamTimeoutMs,
	);
	const toolTimeoutSource = resolveTimeoutSource(input.taskSettings?.toolTimeoutMs, input.runtimeConfig.toolTimeoutMs);
	const conversationTimeoutSource = resolveTimeoutSource(
		input.taskSettings?.conversationTimeoutMs,
		input.runtimeConfig.conversationTimeoutMs,
	);

	if (timeoutMode === "unlimited") {
		return {
			timeoutMode,
			timeoutProfile,
			requestTimeoutMs: null,
			streamTimeoutMs: null,
			toolTimeoutMs: null,
			agentTimeoutMs: null,
			conversationTimeoutMs: null,
			streamTimeoutSource,
			toolTimeoutSource,
			conversationTimeoutSource,
		};
	}

	const scale = timeoutMode === "extended" ? 6 : timeoutMode === "long" ? 3 : 1;
	return {
		timeoutMode,
		timeoutProfile,
		requestTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(requestTimeoutMs, scale)),
		streamTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(streamTimeoutMs, scale)),
		toolTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(toolTimeoutMs, scale)),
		agentTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(agentTimeoutMs, scale)),
		conversationTimeoutMs: enforceLocalNKleinTimeoutFloor(scaleTimeoutMs(conversationTimeoutMs, scale)),
		streamTimeoutSource,
		toolTimeoutSource,
		conversationTimeoutSource,
	};
}

function isActiveProjectTaskSession(summary: RuntimeTaskSessionSummary): boolean {
	return (
		!isHomeAgentSessionId(summary.taskId) &&
		summary.state !== "idle" &&
		(summary.state === "queued" || summary.state === "running" || summary.state === "awaiting_review")
	);
}

function countActiveProjectTaskSessions(summaries: RuntimeTaskSessionSummary[], startingTaskId: string): number {
	const activeTaskIds = new Set<string>();
	for (const summary of summaries) {
		if (summary.taskId === startingTaskId || !isActiveProjectTaskSession(summary)) {
			continue;
		}
		activeTaskIds.add(summary.taskId);
	}
	return activeTaskIds.size;
}

function createConcurrencyLimitStartError(maxConcurrentTasks: number): string {
	return `Maximum concurrent task limit reached (${maxConcurrentTasks}). Wait for a running task to finish, or stop an active task before starting another.`;
}

function findBoardCardById(cards: readonly RuntimeBoardCard[], taskId: string): RuntimeBoardCard | null {
	return cards.find((card) => card.id === taskId) ?? null;
}

function findBoardCardRecordById(
	board: { columns: readonly { id: string; cards: readonly RuntimeBoardCard[] }[] },
	taskId: string,
): { card: RuntimeBoardCard; columnId: string } | null {
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (card.id === taskId) {
				return { card, columnId: column.id };
			}
		}
	}
	return null;
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
	if (isHomeAgentSessionId(summary.taskId) || summary.state !== "running") {
		return;
	}
	try {
		await mutateWorkspaceState(workspaceScope.workspacePath, (state) => {
			const record = findBoardCardRecordById(state.board, summary.taskId);
			if (!record || record.columnId === "completed" || record.columnId === "trash") {
				return {
					board: state.board,
					save: false,
					value: null,
				};
			}
			const targetColumnId = record.card.startInPlanMode ? "planning" : "in_progress";
			if (record.columnId === targetColumnId) {
				return {
					board: state.board,
					save: false,
					value: null,
				};
			}
			const movement = moveTaskToColumn(state.board, summary.taskId, targetColumnId);
			return {
				board: movement.board,
				save: movement.moved,
				value: null,
			};
		});
	} catch {
		// Chat/input delivery is primary; lane reconciliation is best-effort for real persisted boards.
	}
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

function addConfiguredLocalModelRegistryEntries(input: {
	models: Record<string, NKleinModelRegistryEntry>;
	runtimeConfig: RuntimeConfigState | null;
	launchConfig: ResolvedNKleinLaunchConfig | null;
	providerSettings: RuntimeNKleinProviderSettings | null;
	now: number;
}): Record<string, NKleinModelRegistryEntry> {
	const nextModels = { ...input.models };
	const candidates: NKleinModelRegistryKeyInput[] = [];
	if (input.launchConfig?.providerId && input.launchConfig.modelId) {
		candidates.push({
			providerId: input.launchConfig.providerId,
			modelId: input.launchConfig.modelId,
			endpoint: input.launchConfig.baseUrl ?? null,
		});
	}
	if (input.providerSettings?.providerId && input.providerSettings.modelId) {
		candidates.push({
			providerId: input.providerSettings.providerId,
			modelId: input.providerSettings.modelId,
			endpoint: input.providerSettings.baseUrl ?? null,
		});
	}
	for (const settings of Object.values(input.runtimeConfig?.modelRoles ?? {})) {
		const providerId = settings.providerId?.trim();
		const modelId = settings.modelId?.trim();
		if (!providerId || !modelId) {
			continue;
		}
		candidates.push({ providerId, modelId, endpoint: null });
	}
	for (const candidate of candidates) {
		if (!isLocalProvider(candidate.providerId, candidate.endpoint)) {
			continue;
		}
		const key = buildNKleinModelRegistryKey(candidate);
		if (nextModels[key]) {
			continue;
		}
		nextModels[key] = createNKleinModelRegistryEntry(candidate, input.now);
	}
	return nextModels;
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
			return await readModelPerformanceStats({
				workspacePath: workspaceScope?.workspacePath ?? null,
			});
		},
		getKnowledgeToolUsageStats: async (workspaceScope) => {
			return await readKnowledgeToolUsageStats({
				workspacePath: workspaceScope?.workspacePath ?? null,
			});
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
					modelRoleSettings: runtimeConfig?.modelRoles,
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
		verifyTaskAcceptance: async (workspaceScope, input) => {
			const state = await loadWorkspaceState(workspaceScope.workspacePath);
			const taskRecord = findBoardCardRecordById(state.board, input.taskId);
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
					if (activeProjectTaskCount >= scopedRuntimeConfig.maxConcurrentTasks) {
						return {
							ok: false,
							summary: null,
							error: createConcurrencyLimitStartError(scopedRuntimeConfig.maxConcurrentTasks),
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
				for (const [role, settings] of Object.entries(scopedRuntimeConfig.modelRoles)) {
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
			const snapshot = await getDefaultNKleinModelRegistry().getSnapshot();
			const runtimeConfig = workspaceScope ? await deps.loadScopedRuntimeConfig(workspaceScope) : null;
			const launchConfig =
				runtimeConfig?.selectedAgentId === "nklein"
					? await nkleinProviderService.resolveLaunchConfig().catch(() => null)
					: null;
			const providerSettings =
				runtimeConfig?.selectedAgentId === "nklein" ? nkleinProviderService.getProviderSettingsSummary() : null;
			const models = addConfiguredLocalModelRegistryEntries({
				models: snapshot.models,
				runtimeConfig,
				launchConfig,
				providerSettings,
				now: Date.now(),
			});
			return {
				schemaVersion: snapshot.schemaVersion,
				updatedAt: snapshot.updatedAt,
				models: Object.values(models)
					.filter((entry) => isLocalProvider(entry.providerId, entry.endpoint))
					.sort((left, right) => {
						const updatedDelta = right.updatedAt - left.updatedAt;
						return updatedDelta !== 0 ? updatedDelta : left.key.localeCompare(right.key);
					}),
			};
		},
		removeNKleinModelRegistryEntry: async (_workspaceScope, input) => {
			const body = parseNKleinModelRegistryRemoveRequest(input);
			const snapshot = await getDefaultNKleinModelRegistry().getSnapshot();
			const entry = snapshot.models[body.key] ?? null;
			if (entry && !isLocalProvider(entry.providerId, entry.endpoint)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only local !Klein model telemetry can be removed.",
				});
			}
			const removed = await getDefaultNKleinModelRegistry().removeEntry(body.key);
			return { removed };
		},
		pruneNKleinModelRegistry: async (workspaceScope) => {
			const registry = getDefaultNKleinModelRegistry();
			const snapshot = await registry.getSnapshot();
			const runtimeConfig = workspaceScope ? await deps.loadScopedRuntimeConfig(workspaceScope) : null;
			const launchConfig =
				runtimeConfig?.selectedAgentId === "nklein"
					? await nkleinProviderService.resolveLaunchConfig().catch(() => null)
					: null;
			const providerSettings =
				runtimeConfig?.selectedAgentId === "nklein" ? nkleinProviderService.getProviderSettingsSummary() : null;
			const configuredModels = addConfiguredLocalModelRegistryEntries({
				models: {},
				runtimeConfig,
				launchConfig,
				providerSettings,
				now: Date.now(),
			});
			const keepKeys = new Set(Object.keys(configuredModels));
			const providerId = providerSettings?.providerId?.trim();
			const providerBaseUrl = providerSettings?.baseUrl ?? null;
			if (providerId && isLocalProvider(providerId, providerBaseUrl)) {
				const loadedModelsResponse = await nkleinProviderService.getProviderModels(providerId).catch(() => null);
				for (const model of loadedModelsResponse?.models ?? []) {
					keepKeys.add(
						buildNKleinModelRegistryKey({
							providerId,
							modelId: model.id,
							endpoint: providerBaseUrl,
						}),
					);
					for (const entry of Object.values(snapshot.models)) {
						if (entry.providerId === providerId && entry.modelId === model.id) {
							keepKeys.add(entry.key);
						}
					}
				}
			}
			const removeKeys = Object.values(snapshot.models)
				.filter((entry) => isLocalProvider(entry.providerId, entry.endpoint))
				.filter((entry) => !keepKeys.has(entry.key))
				.map((entry) => entry.key);
			const removed = await registry.removeEntries(removeKeys);
			return { removed };
		},
		saveNKleinModelContextWindowOverride: async (_workspaceScope, input) => {
			const body = parseNKleinModelContextWindowOverrideRequest(input);
			if (!isLocalProvider(body.providerId, body.endpoint)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Context window overrides are only available for local !Klein models.",
				});
			}
			if (body.contextWindow !== null) {
				assertNKleinContextWindowPolicy({
					providerId: body.providerId,
					modelId: body.modelId,
					contextWindow: body.contextWindow,
					label: "Context window override for",
				});
			}
			const model = await getDefaultNKleinModelRegistry().setContextWindowOverride({
				providerId: body.providerId,
				modelId: body.modelId,
				endpoint: body.endpoint,
				contextWindow: body.contextWindow,
			});
			return { model };
		},
		saveNKleinModelMaxConcurrentRequests: async (_workspaceScope, input) => {
			const body = parseNKleinModelMaxConcurrentRequestsRequest(input);
			if (!isLocalProvider(body.providerId, body.endpoint)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Per-model concurrency limits are only available for local !Klein models.",
				});
			}
			const model = await getDefaultNKleinModelRegistry().setMaxConcurrentRequests({
				providerId: body.providerId,
				modelId: body.modelId,
				endpoint: body.endpoint,
				maxConcurrentRequests: body.maxConcurrentRequests,
			});
			return { model };
		},
		getNKleinCodeIntelligenceStatus: async (workspaceScope) => {
			if (!workspaceScope) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A workspace is required to inspect code intelligence status.",
				});
			}
			const runtimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			const embeddingProvider = createNKleinCodeEmbeddingProviderFromSettings(
				runtimeConfig.effectiveCodeEmbeddingSettings,
			);
			const [repoMapResult, codeIndexResult] = await Promise.allSettled([
				buildNKleinRepoMap({ workspacePath: workspaceScope.workspacePath }),
				getNKleinCodeIndexStatus({
					workspacePath: workspaceScope.workspacePath,
					embeddingProvider,
				}),
			]);
			const repoMap =
				repoMapResult.status === "fulfilled"
					? {
							filesScanned: repoMapResult.value.filesScanned,
							symbols: repoMapResult.value.symbols.length,
							tokenCount: repoMapResult.value.tokenCount,
							truncated: repoMapResult.value.truncated,
							available: repoMapResult.value.symbols.length > 0,
							error: null,
						}
					: {
							filesScanned: 0,
							symbols: 0,
							tokenCount: 0,
							truncated: false,
							available: false,
							error:
								repoMapResult.reason instanceof Error
									? repoMapResult.reason.message
									: String(repoMapResult.reason),
						};
			const codeIndex =
				codeIndexResult.status === "fulfilled"
					? {
							...codeIndexResult.value,
							error: null,
						}
					: {
							cachePath: null,
							cacheExists: false,
							embeddingProvider: null,
							embeddingModel: null,
							updatedAt: null,
							totalFiles: 0,
							totalChunks: 0,
							indexedFiles: 0,
							indexedChunks: 0,
							staleFiles: 0,
							missingFiles: 0,
							searchAvailable: false,
							progress: {
								phase: "error" as const,
								startedAt: null,
								updatedAt: Date.now(),
								filesTotal: 0,
								filesProcessed: 0,
								chunksTotal: 0,
								chunksProcessed: 0,
								cacheHitCount: 0,
								cacheMissCount: 0,
								message:
									codeIndexResult.reason instanceof Error
										? codeIndexResult.reason.message
										: String(codeIndexResult.reason),
							},
							error:
								codeIndexResult.reason instanceof Error
									? codeIndexResult.reason.message
									: String(codeIndexResult.reason),
						};
			let embeddingModelFile: {
				modelId: string;
				label: string;
				installed: boolean;
				sizeBytes: number | null;
				coreEnabled: boolean;
			} | null = null;
			if (runtimeConfig.effectiveCodeEmbeddingSettings.provider === "local_gguf") {
				const manifest = DEFAULT_EMBEDDING_MODEL_MANIFEST;
				const installed = await isEmbeddingModelInstalled(manifest);
				const sizeBytes = installed
					? await stat(getEmbeddingModelPath(manifest))
							.then((info) => info.size)
							.catch(() => null)
					: null;
				embeddingModelFile = {
					modelId: manifest.id,
					label: manifest.label,
					installed,
					sizeBytes,
					coreEnabled: resolveKleinCorePyConfig().enabled,
				};
			}
			return {
				codeEmbeddingSettings: {
					globalDefaults: runtimeConfig.codeEmbeddingDefaults,
					projectOverride: runtimeConfig.codeEmbeddingOverride,
					effective: runtimeConfig.effectiveCodeEmbeddingSettings,
					source: runtimeConfig.codeEmbeddingOverride ? ("project" as const) : ("global" as const),
				},
				embeddingModelFile,
				repoMap,
				codeIndex,
			};
		},
		getKleinCorePyHealth: async () => {
			const config = resolveKleinCorePyConfig();
			if (!config.enabled) {
				return { enabled: false, reachable: false, sidecarUrl: config.sidecarUrl };
			}
			const health = await probeKleinCorePyHealth({ config });
			return { enabled: true, reachable: health.reachable, sidecarUrl: health.sidecarUrl };
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
			const result = await runNKleinDevSmokeEval({
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
			return deps.getUpdateStatus();
		},
		runUpdateNow: async () => {
			return await deps.runUpdateNow();
		},
	};
}
