// Coordinates the runtime-side TRPC handlers used by the browser.
// This is the main backend entrypoint for sessions, settings, git, and
// workspace actions, but detailed Cline, terminal, and config behavior
// should stay in focused services instead of accumulating here.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import { runClineAcceptanceGateInSandbox } from "../cline-sdk/cline-acceptance-gate";
import { buildClineAdvisorRequest } from "../cline-sdk/cline-advisor";
import { AgentSandboxManager } from "../cline-sdk/cline-agent-sandbox";
import { createClineCodeEmbeddingProviderFromSettings } from "../cline-sdk/cline-code-embeddings";
import { getClineCodeIndexStatus } from "../cline-sdk/cline-code-index";
import {
	assertClineContextWindowPolicy,
	isClineContextWindowPolicyError,
} from "../cline-sdk/cline-context-window-policy";
import { applyClinePlanTaskGraphToBoard } from "../cline-sdk/cline-decomposition-tool";
import { writeClineDogfoodBacklog } from "../cline-sdk/cline-dogfood-engine";
import { scheduleClineEndpointStart } from "../cline-sdk/cline-endpoint-scheduler";
import { runClineDevSmokeEval } from "../cline-sdk/cline-eval-harness";
import {
	assertLocalProviderAllowed,
	isCloudProviderDisabledError,
	isLocalProvider,
} from "../cline-sdk/cline-local-only-policy";
import { createClineMcpRuntimeService } from "../cline-sdk/cline-mcp-runtime-service";
import { createClineMcpSettingsService } from "../cline-sdk/cline-mcp-settings-service";
import {
	buildClineModelRegistryKey,
	type ClineModelRegistryEntry,
	type ClineModelRegistryKeyInput,
	createClineModelRegistryEntry,
	getDefaultClineModelRegistry,
} from "../cline-sdk/cline-model-registry";
import { buildClineModelFreshnessAdvisorRequest } from "../cline-sdk/cline-model-research";
import {
	type ClinePlanArtifactSummary,
	listClinePlanArtifactsForSourceTask,
	readClinePlanArtifactsByArtifactId,
	summarizeClinePlanArtifacts,
	updateClinePlanArtifactApplicationStatus,
} from "../cline-sdk/cline-plan-artifacts";
import { createClineProviderService } from "../cline-sdk/cline-provider-service";
import { buildClineRepoMap } from "../cline-sdk/cline-repo-map";
import { setClineLostHeartbeatPolicy } from "../cline-sdk/cline-session-state";
import { isClineClearSlashCommand } from "../cline-sdk/cline-slash-commands";
import { routeClineTask } from "../cline-sdk/cline-task-router";
import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import {
	buildClineSandboxStartBlock,
	buildClineStartGuardCandidate,
	type ClineStartGuardCandidate,
	estimateClineStartDifficulty,
	estimateClineStartFitBudgetTokens,
	estimateClineStartPromptTokens,
	formatClineTaskRoutingBlockMessage,
} from "../cline-sdk/cline-task-start-guard";
import { applyMcsrAwareLocalTimeoutScaling } from "../cline-sdk/cline-timeout-scaling";
import type { RuntimeConfigState } from "../config/runtime-config";
import { updateGlobalRuntimeConfig, updateRuntimeConfig } from "../config/runtime-config";
import type {
	RuntimeAgentSandboxStatus,
	RuntimeBoardCard,
	RuntimeClineProviderSettings,
	RuntimeCommandRunResponse,
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
	parseClineAccountSwitchRequest,
	parseClineAddProviderRequest,
	parseClineAdvisorBuildRequest,
	parseClineAdvisorSendRequest,
	parseClineDeviceAuthCompleteRequest,
	parseClineDogfoodBacklogRequest,
	parseClineEndpointModelDiscoveryRequest,
	parseClineMcpOAuthRequest,
	parseClineMcpSettingsSaveRequest,
	parseClineModelContextWindowOverrideRequest,
	parseClineModelRegistryRemoveRequest,
	parseClineOauthLoginRequest,
	parseClineProviderModelsRequest,
	parseClineProviderSettingsSaveRequest,
	parseClineUpdateProviderRequest,
	parseCommandRunRequest,
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
import { clearSwarmStop, readSwarmStopSignal, requestSwarmStop } from "../core/swarm-guardrails";
import {
	formatGitHubContextLabel,
	type GitHubIssueView,
	parseGitHubContextTarget,
	renderGitHubIssueContext,
} from "../core/task-context-import";
import { resolveTaskTitle } from "../core/task-title.js";
import { openInBrowser } from "../server/browser";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import { createEvidenceBundle } from "../telemetry/evidence-bundle";
import { readSelfObservationEvents, recordSelfObservation } from "../telemetry/self-observation-sink";
import { buildRuntimeConfigResponse, resolveAgentCommand } from "../terminal/agent-registry";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { getWorkspaceChanges, getWorkspaceChangesBetweenRefs } from "../workspace/get-workspace-changes";
import { resolveTaskResultBranchCommit } from "../workspace/task-result-branches";
import { resolveTaskCwd } from "../workspace/task-worktree";
import {
	mergeTaskWorktreesInDependencyOrder,
	type TaskWorktreeAutoMergeStep,
} from "../workspace/task-worktree-auto-merge";
import { captureTaskTurnCheckpoint } from "../workspace/turn-checkpoints";
import type { RuntimeTrpcContext, RuntimeTrpcWorkspaceScope } from "./app-router";
import type { RuntimeTaskStartQueue } from "./runtime-task-start-queue";

type ResolvedClineLaunchConfig = Awaited<
	ReturnType<ReturnType<typeof createClineProviderService>["resolveLaunchConfig"]>
>;

const execFileAsync = promisify(execFile);
const GITHUB_CONTEXT_IMPORT_TIMEOUT_MS = 20_000;
const GITHUB_CONTEXT_IMPORT_MAX_BUFFER_BYTES = 512_000;

interface AdvisorChatCompletionInput {
	launchConfig: ResolvedClineLaunchConfig;
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

function resolveAdvisorOpenAiBaseUrl(launchConfig: ResolvedClineLaunchConfig): string {
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

function resolveAdvisorOllamaBaseUrl(launchConfig: ResolvedClineLaunchConfig): string {
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
	getScopedClineTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<ClineTaskSessionService>;
	getLoadedScopedClineTaskSessionService?: (scope: RuntimeTrpcWorkspaceScope) => ClineTaskSessionService | null;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	broadcastClineMcpAuthStatusesUpdated?: (
		statuses: Awaited<ReturnType<ReturnType<typeof createClineMcpRuntimeService>["getAuthStatuses"]>>,
	) => void;
	broadcastTaskChatCleared?: (workspaceId: string, taskId: string) => void;
	bumpClineSessionContextVersion?: () => void;
	prepareForStateReset?: () => Promise<void>;
	taskStartQueue?: RuntimeTaskStartQueue;
	getDogfoodTelemetryRoot?: () => string;
	getEvidenceBundleRoot?: () => string;
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
	getAgentSandboxStatus?: () => RuntimeAgentSandboxStatus;
	refreshAgentSandboxStatus?: () => Promise<RuntimeAgentSandboxStatus>;
}

async function resolveExistingTaskCwdOrEnsure(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<string> {
	try {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: false,
		});
	} catch {
		return await resolveTaskCwd({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: options.baseRef,
			ensure: true,
		});
	}
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
		`Task worktree: ${input.taskCwd}`,
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

const MIN_POSITIVE_CLINE_TIMEOUT_MS = 60 * 1000;

function enforceLocalClineTimeoutFloor(value: number | null): number | null {
	if (value === null || value === 0) {
		return value;
	}
	return Math.max(MIN_POSITIVE_CLINE_TIMEOUT_MS, value);
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

	if (timeoutMode === "unlimited") {
		return {
			timeoutMode,
			timeoutProfile,
			requestTimeoutMs: null,
			streamTimeoutMs: null,
			toolTimeoutMs: null,
			agentTimeoutMs: null,
			conversationTimeoutMs: null,
		};
	}

	const scale = timeoutMode === "extended" ? 6 : timeoutMode === "long" ? 3 : 1;
	return {
		timeoutMode,
		timeoutProfile,
		requestTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(requestTimeoutMs, scale)),
		streamTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(streamTimeoutMs, scale)),
		toolTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(toolTimeoutMs, scale)),
		agentTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(agentTimeoutMs, scale)),
		conversationTimeoutMs: enforceLocalClineTimeoutFloor(scaleTimeoutMs(conversationTimeoutMs, scale)),
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

function toRuntimePlanArtifactSummary(summary: ClinePlanArtifactSummary): ClinePlanArtifactSummary {
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
				? `Task worktree merged: ${step.taskId}`
				: step.type === "skipped"
					? `Task worktree merge skipped: ${step.taskId}`
					: step.type === "conflict"
						? `Task worktree merge conflict: ${step.taskId}`
						: `Task worktree merge blocked: ${step.reason}`;
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
	return `Merged ${input.mergedTaskIds.length} task worktrees; skipped ${input.skippedTaskIds.length}.`;
}

function addConfiguredLocalModelRegistryEntries(input: {
	models: Record<string, ClineModelRegistryEntry>;
	runtimeConfig: RuntimeConfigState | null;
	launchConfig: ResolvedClineLaunchConfig | null;
	providerSettings: RuntimeClineProviderSettings | null;
	now: number;
}): Record<string, ClineModelRegistryEntry> {
	const nextModels = { ...input.models };
	const candidates: ClineModelRegistryKeyInput[] = [];
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
		const key = buildClineModelRegistryKey(candidate);
		if (nextModels[key]) {
			continue;
		}
		nextModels[key] = createClineModelRegistryEntry(candidate, input.now);
	}
	return nextModels;
}

function applyCandidateEffectiveContextWindow<TLaunchConfig extends ResolvedClineLaunchConfig>(
	launchConfig: TLaunchConfig,
	candidate: ClineStartGuardCandidate<TLaunchConfig>,
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
	const clineProviderService = createClineProviderService();
	const clineMcpSettingsService = createClineMcpSettingsService();
	const clineMcpRuntimeService = createClineMcpRuntimeService({
		onAuthStatusesChanged: (statuses) => {
			deps.broadcastClineMcpAuthStatusesUpdated?.(statuses);
		},
	});
	const debugResetTargetPaths = [
		join(homedir(), ".cline", "data"),
		join(homedir(), ".cline", "nklein"),
		join(homedir(), ".cline", "worktrees"),
	] as const;

	const buildConfigResponse = (runtimeConfig: RuntimeConfigState) =>
		buildRuntimeConfigResponse(
			runtimeConfig,
			clineProviderService.getProviderSettingsSummary(),
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
			setClineLostHeartbeatPolicy(scopedRuntimeConfig.lostHeartbeatPolicy);
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
			setClineLostHeartbeatPolicy(nextRuntimeConfig.lostHeartbeatPolicy);
			return buildConfigResponse(nextRuntimeConfig);
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
			deps.getLoadedScopedClineTaskSessionService?.(workspaceScope)?.setBoardPaused(true);
			return {
				ok: true,
				signal,
			};
		},
		clearSwarmStop: async (workspaceScope) => {
			await clearSwarmStop(workspaceScope.workspacePath);
			const clineTaskSessionService = deps.getLoadedScopedClineTaskSessionService?.(workspaceScope) ?? null;
			clineTaskSessionService?.setBoardPaused(false);
			await clineTaskSessionService?.resumePausedTasks();
			return {
				ok: true,
				signal: null,
			};
		},
		getTaskDiagnostics: async (_workspaceScope, input) => {
			return {
				ok: true,
				events: await readSelfObservationEvents({
					taskId: input.taskId,
					limit: input.limit ?? 25,
				}),
			};
		},
		listClinePlanArtifacts: async (workspaceScope, input) => {
			const artifacts = await listClinePlanArtifactsForSourceTask({
				workspacePath: workspaceScope.workspacePath,
				sourceTaskId: input.taskId,
				applicationStatus: "pending",
			});
			return {
				artifacts: artifacts.map(toRuntimePlanArtifactSummary),
			};
		},
		applyClinePlanArtifact: async (workspaceScope, input) => {
			const artifacts = await readClinePlanArtifactsByArtifactId({
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
				const applied = applyClinePlanTaskGraphToBoard({
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
			await updateClinePlanArtifactApplicationStatus({
				workspacePath: workspaceScope.workspacePath,
				slug: artifacts.taskGraph.slug,
				applicationStatus: "applied",
			});
			const updatedArtifacts = await readClinePlanArtifactsByArtifactId({
				workspacePath: workspaceScope.workspacePath,
				artifactId: input.artifactId,
			});
			return {
				ok: true,
				artifact: summarizeClinePlanArtifacts(updatedArtifacts),
				createdTaskCount: mutation.value.createdTaskCount,
				createdDependencyCount: mutation.value.createdDependencyCount,
				message: `Applied ${artifacts.taskGraph.title}: created ${mutation.value.createdTaskCount} cards and ${mutation.value.createdDependencyCount} dependencies.`,
				workspaceState: mutation.state,
			};
		},
		rejectClinePlanArtifact: async (workspaceScope, input) => {
			const artifacts = await readClinePlanArtifactsByArtifactId({
				workspacePath: workspaceScope.workspacePath,
				artifactId: input.artifactId,
			});
			if (artifacts.metadata.applicationStatus === "applied") {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Applied plan artifacts cannot be rejected.",
				});
			}
			await updateClinePlanArtifactApplicationStatus({
				workspacePath: workspaceScope.workspacePath,
				slug: artifacts.taskGraph.slug,
				applicationStatus: "rejected",
			});
			const updatedArtifacts = await readClinePlanArtifactsByArtifactId({
				workspacePath: workspaceScope.workspacePath,
				artifactId: input.artifactId,
			});
			return {
				ok: true,
				artifact: summarizeClinePlanArtifacts(updatedArtifacts),
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
			const sandboxManager = new AgentSandboxManager();
			const acceptance = await runClineAcceptanceGateInSandbox({
				taskId: input.taskId,
				projectRepoPath: workspaceScope.workspacePath,
				baseRef: taskRecord.card.baseRef,
				taskPrompt: taskRecord.card.prompt,
				timeoutMs: input.timeoutMs,
				sandboxManager,
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
		saveClineProviderSettings: async (_workspaceScope, input) => {
			const body = parseClineProviderSettingsSaveRequest(input);
			const response = await clineProviderService.saveProviderSettings(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		addClineProvider: async (_workspaceScope, input) => {
			const body = parseClineAddProviderRequest(input);
			const response = await clineProviderService.addCustomProvider(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		updateClineProvider: async (_workspaceScope, input) => {
			const body = parseClineUpdateProviderRequest(input);
			const response = await clineProviderService.updateCustomProvider(body);
			deps.bumpClineSessionContextVersion?.();
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
				const requestedClineTaskMode = body.mode ?? "act";
				const scopedRuntimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
				const effectiveTimeouts = resolveEffectiveTaskTimeoutSettings({
					runtimeConfig: scopedRuntimeConfig,
					taskSettings: body.clineSettings,
				});
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				if (!isHomeAgentSessionId(body.taskId)) {
					const loadedClineTaskSessionService =
						deps.getLoadedScopedClineTaskSessionService?.(workspaceScope) ?? null;
					const activeProjectTaskCount = countActiveProjectTaskSessions(
						[...terminalManager.listSummaries(), ...(loadedClineTaskSessionService?.listSummaries() ?? [])],
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
				const isHomeSession = isHomeAgentSessionId(body.taskId);

				// Per-task config source-of-truth precedence:
				//
				// agentId resolution (which agent runtime to use):
				//   1. previousTerminalAgentId — persisted in the terminal session summary from
				//      the last run; ensures trash-restore resumes with the same agent runtime.
				//   2. body.agentId — the card's current per-task agent override.
				//   3. scopedRuntimeConfig.selectedAgentId — the workspace-level default.
				//
				// clineSettings (which LLM model and reasoning profile the Cline agent uses):
				//   Always taken from the card's current override object. There is no
				//   session-level persistence for these;
				//   if the user changes the model on the card, the next session launch
				//   (including trash-restore) uses the updated values.
				const previousTerminalAgentId = body.resumeFromTrash
					? (terminalManager.getSummary(body.taskId)?.agentId ?? null)
					: null;
				const effectiveAgentId = previousTerminalAgentId ?? body.agentId ?? scopedRuntimeConfig.selectedAgentId;
				let useClinePath = effectiveAgentId === "cline";
				const shouldProbePersistedClineSession =
					body.resumeFromTrash && !useClinePath && previousTerminalAgentId === null;
				if (shouldProbePersistedClineSession) {
					// If the terminal summary already has a concrete non-Cline agentId,
					// skip Cline persisted-session probing. That probe can cold-start the
					// Cline session host and adds multi-second latency to Codex restores.
					const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
					const persistedSession = await clineTaskSessionService
						.rebindPersistedTaskSession(body.taskId)
						.catch(() => null);
					if (persistedSession) {
						useClinePath = true;
					}
				}

				if (useClinePath) {
					const sandboxStatus = deps.refreshAgentSandboxStatus
						? await deps.refreshAgentSandboxStatus()
						: deps.getAgentSandboxStatus?.();
					const sandboxStartBlock = buildClineSandboxStartBlock(sandboxStatus);
					if (sandboxStartBlock) {
						return {
							ok: false,
							summary: null,
							error: sandboxStartBlock.error,
							errorCode: sandboxStartBlock.errorCode,
						};
					}
					const hasTaskLevelClineSettingsOverride = body.clineSettings !== undefined;
					let clineLaunchConfig = await clineProviderService.resolveLaunchConfig({
						providerIdOverride: body.clineSettings?.providerId ?? undefined,
						modelIdOverride: body.clineSettings?.modelId ?? undefined,
						...(hasTaskLevelClineSettingsOverride
							? {
									reasoningEffortOverride: body.clineSettings?.reasoningEffort ?? null,
								}
							: {}),
					});
					const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
					const modelRegistrySnapshot = await Promise.resolve(getDefaultClineModelRegistry().getSnapshot()).catch(
						() => ({
							schemaVersion: 1,
							updatedAt: 0,
							models: {},
						}),
					);
					const guardCandidates = new Map<string, ClineStartGuardCandidate<ResolvedClineLaunchConfig>>();
					const selectedCandidate = buildClineStartGuardCandidate({
						launchConfig: clineLaunchConfig,
						role: null,
						modelRegistry: modelRegistrySnapshot,
					});
					clineLaunchConfig = applyCandidateEffectiveContextWindow(clineLaunchConfig, selectedCandidate);
					guardCandidates.set(selectedCandidate.entry.key, selectedCandidate);
					for (const [role, settings] of Object.entries(scopedRuntimeConfig.modelRoles)) {
						if (!settings.providerId && !settings.modelId) {
							continue;
						}
						try {
							const roleLaunchConfig = await clineProviderService.resolveLaunchConfig({
								providerIdOverride: settings.providerId ?? undefined,
								modelIdOverride: settings.modelId ?? undefined,
								reasoningEffortOverride: settings.reasoningEffort ?? null,
							});
							const roleCandidate = buildClineStartGuardCandidate({
								launchConfig: roleLaunchConfig,
								role,
								modelRegistry: modelRegistrySnapshot,
							});
							guardCandidates.set(roleCandidate.entry.key, roleCandidate);
						} catch (error) {
							if (isClineContextWindowPolicyError(error)) {
								return {
									ok: false,
									summary: null,
									error: error.message,
									errorCode: "routing_escalation",
								};
							}
							// Ignore roles that are not currently runnable; the configured default still participates.
						}
					}
					const promptTokens = estimateClineStartPromptTokens({
						prompt: body.prompt,
						taskTitle: body.taskTitle,
						images: body.images,
					});
					const largestContextWindow =
						[...guardCandidates.values()]
							.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
							.filter((contextWindow) => contextWindow > 0)
							.sort((left, right) => right - left)[0] ?? null;
					const routingDecision = routeClineTask({
						difficulty: estimateClineStartDifficulty(promptTokens),
						fitBudgetTokens: estimateClineStartFitBudgetTokens(promptTokens, largestContextWindow),
						promptTokens,
						outputTokens: 1_000,
						preferredModelKey: selectedCandidate.entry.key,
						candidates: [...guardCandidates.values()].map((candidate) => ({
							entry: candidate.entry,
							role: candidate.role,
						})),
					});
					if (routingDecision.type === "decompose" || routingDecision.type === "escalate") {
						return {
							ok: false,
							summary: null,
							error: formatClineTaskRoutingBlockMessage(routingDecision),
							errorCode: routingDecision.type === "decompose" ? "needs_decomposition" : "routing_escalation",
						};
					}
					const routedCandidate = guardCandidates.get(routingDecision.modelKey) ?? null;
					if (routedCandidate) {
						clineLaunchConfig = applyCandidateEffectiveContextWindow(
							routedCandidate.launchConfig,
							routedCandidate,
						);
					}
					assertLocalProviderAllowed({
						providerId: clineLaunchConfig.providerId,
						baseUrl: clineLaunchConfig.baseUrl,
					});
					const mcsrAwareTimeouts = applyMcsrAwareLocalTimeoutScaling({
						timeouts: effectiveTimeouts,
						launchConfig: clineLaunchConfig,
						modelRegistry: modelRegistrySnapshot,
						promptTokens,
					});
					const codeEmbeddingProvider = createClineCodeEmbeddingProviderFromSettings(
						scopedRuntimeConfig.effectiveCodeEmbeddingSettings,
					);
					const endpointDecision = scheduleClineEndpointStart({
						taskId: body.taskId,
						providerId: clineLaunchConfig.providerId,
						modelId: clineLaunchConfig.modelId ?? "",
						endpoint: clineLaunchConfig.baseUrl ?? null,
						runningSessions: clineTaskSessionService.listModelEndpointSessions(),
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
					const resolvedClineTitle = resolveTaskTitle(body.taskTitle?.trim(), body.prompt);
					const summary = await clineTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: workspaceScope.workspacePath,
						workspaceRoot: workspaceScope.workspacePath,
						baseRef: body.baseRef,
						prompt: body.prompt,
						taskTitle: resolvedClineTitle.length > 0 ? resolvedClineTitle : undefined,
						images: body.images,
						resumeFromTrash: body.resumeFromTrash,
						providerId: clineLaunchConfig.providerId,
						modelId: clineLaunchConfig.modelId,
						mode: requestedClineTaskMode,
						startInPlanMode: body.startInPlanMode,
						apiKey: clineLaunchConfig.apiKey,
						baseUrl: clineLaunchConfig.baseUrl,
						reasoningEffort: clineLaunchConfig.reasoningEffort,
						contextScope: body.clineSettings?.contextScope,
						contextWindow: clineLaunchConfig.contextWindow ?? null,
						timeoutMode: mcsrAwareTimeouts.timeoutMode,
						requestTimeoutMs: mcsrAwareTimeouts.requestTimeoutMs,
						turnTimeoutMs: mcsrAwareTimeouts.agentTimeoutMs,
						streamTimeoutMs: mcsrAwareTimeouts.streamTimeoutMs,
						toolTimeoutMs: mcsrAwareTimeouts.toolTimeoutMs,
						conversationTimeoutMs: mcsrAwareTimeouts.conversationTimeoutMs,
						maxAgentWritableFileLines: scopedRuntimeConfig.maxAgentWritableFileLines,
						codeEmbeddingProvider,
					});

					return {
						ok: true,
						summary,
					};
				}

				const resolvedConfig =
					effectiveAgentId !== scopedRuntimeConfig.selectedAgentId
						? { ...scopedRuntimeConfig, selectedAgentId: effectiveAgentId }
						: scopedRuntimeConfig;
				const resolved = resolveAgentCommand(resolvedConfig);
				if (!resolved) {
					return {
						ok: false,
						summary: null,
						error: "No runnable agent command is configured. Open Settings, install a supported CLI, and select it.",
					};
				}
				const taskCwd = isHomeSession
					? workspaceScope.workspacePath
					: await resolveExistingTaskCwdOrEnsure({
							cwd: workspaceScope.workspacePath,
							taskId: body.taskId,
							baseRef: body.baseRef,
						});
				const summary = await terminalManager.startTaskSession({
					taskId: body.taskId,
					agentId: resolved.agentId,
					binary: resolved.binary,
					args: resolved.args,
					autonomousModeEnabled: scopedRuntimeConfig.agentAutonomousModeEnabled,
					cwd: taskCwd,
					prompt: body.prompt,
					images: body.images,
					startInPlanMode: body.startInPlanMode,
					resumeFromTrash: body.resumeFromTrash,
					cols: body.cols,
					rows: body.rows,
					workspaceId: workspaceScope.workspaceId,
				});

				let nextSummary = summary;
				if (!body.resumeFromTrash && !isHomeSession) {
					try {
						const nextTurn = (summary.latestTurnCheckpoint?.turn ?? 0) + 1;
						const checkpoint = await captureTaskTurnCheckpoint({
							cwd: taskCwd,
							taskId: body.taskId,
							turn: nextTurn,
						});
						nextSummary = terminalManager.applyTurnCheckpoint(body.taskId, checkpoint) ?? summary;
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						recordSelfObservation({
							signal: "runtime_error",
							severity: "warning",
							message: `Task checkpoint capture failed: ${message}`,
							taskId: body.taskId,
							workspacePath: workspaceScope.workspacePath,
							metadata: {
								operation: "capture_task_turn_checkpoint",
								agentId: resolved.agentId,
							},
						});
					}
				}
				return {
					ok: true,
					summary: nextSummary,
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
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.stopTaskSession(body.taskId);
				const pausedTaskIds = await setCardPaused({
					workspacePath: workspaceScope.workspacePath,
					taskId: body.taskId,
					paused: false,
				});
				if (clineSummary) {
					return {
						ok: true,
						summary: withTaskPausedState(clineSummary, pausedTaskIds),
					};
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.stopTaskSession(body.taskId);
				return {
					ok: Boolean(summary),
					summary: withTaskPausedState(summary, pausedTaskIds),
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
				const clineTaskSessionService = deps.getLoadedScopedClineTaskSessionService?.(workspaceScope) ?? null;
				clineTaskSessionService?.setCardPaused(body.taskId, true);
				const summary = withTaskPausedState(
					clineTaskSessionService?.getSummary(body.taskId) ?? null,
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
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				clineTaskSessionService.setCardPaused(body.taskId, false);
				const resumedSummaries = await clineTaskSessionService.resumePausedTasks();
				let resumedSummary = resumedSummaries.find((summary) => summary.taskId === body.taskId) ?? null;
				let fallbackSummary = clineTaskSessionService.getSummary(body.taskId);
				if (!resumedSummary && !fallbackSummary && wasTaskPaused) {
					fallbackSummary = await clineTaskSessionService
						.rebindPersistedTaskSession(body.taskId)
						.catch(() => null);
				}
				if (
					!resumedSummary &&
					wasTaskPaused &&
					(fallbackSummary?.state === "paused" || fallbackSummary?.state === "awaiting_review")
				) {
					resumedSummary = await clineTaskSessionService.sendTaskSessionInput(
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
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const clineSummary = await clineTaskSessionService.sendTaskSessionInput(body.taskId, payloadText);
				if (clineSummary) {
					return {
						ok: true,
						summary: clineSummary,
					};
				}
				const terminalManager = await deps.getScopedTerminalManager(workspaceScope);
				const summary = terminalManager.writeInput(body.taskId, Buffer.from(payloadText, "utf8"));
				if (!summary) {
					return {
						ok: false,
						summary: null,
						error: "Task session is not running.",
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
		getTaskChatMessages: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatMessagesRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = clineTaskSessionService.getSummary(body.taskId);
				const messages = await clineTaskSessionService.loadTaskSessionMessages(body.taskId);
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
		getClineSlashCommands: async (workspaceScope) => {
			if (!workspaceScope) {
				return {
					commands: [],
				};
			}
			const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
			return {
				commands: await clineTaskSessionService.listSlashCommands(workspaceScope.workspacePath),
			};
		},
		reloadTaskChatSession: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatReloadRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				let summary = await clineTaskSessionService.reloadTaskSession(body.taskId);
				if (!summary && isHomeAgentSessionId(body.taskId)) {
					const clineLaunchConfig = await clineProviderService.resolveLaunchConfig();
					summary = await clineTaskSessionService.startTaskSession({
						taskId: body.taskId,
						cwd: workspaceScope.workspacePath,
						workspaceRoot: workspaceScope.workspacePath,
						prompt: "",
						resumeFromPersistence: true,
						providerId: clineLaunchConfig.providerId,
						modelId: clineLaunchConfig.modelId,
						apiKey: clineLaunchConfig.apiKey,
						baseUrl: clineLaunchConfig.baseUrl,
						reasoningEffort: clineLaunchConfig.reasoningEffort,
						contextWindow: clineLaunchConfig.contextWindow ?? null,
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
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = await clineTaskSessionService.abortTaskSession(body.taskId);
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
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const summary = await clineTaskSessionService.cancelTaskTurn(body.taskId);
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
		getClineProviderCatalog: async (_workspaceScope) => {
			return await clineProviderService.getProviderCatalog();
		},
		getClineAccountProfile: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountProfile();
		},
		getClineKanbanAccess: async (_workspaceScope) => {
			return await clineProviderService.getClineKanbanAccess();
		},
		getFeaturebaseToken: async (_workspaceScope) => {
			return await clineProviderService.getFeaturebaseToken();
		},
		getClineAccountBalance: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountBalance();
		},
		getClineAccountOrganizations: async (_workspaceScope) => {
			return await clineProviderService.getClineAccountOrganizations();
		},
		switchClineAccount: async (_workspaceScope, input) => {
			const body = parseClineAccountSwitchRequest(input);
			return await clineProviderService.switchClineAccount(body.organizationId);
		},
		getClineProviderModels: async (_workspaceScope, input) => {
			const body = parseClineProviderModelsRequest(input);
			return await clineProviderService.getProviderModels(body.providerId);
		},
		discoverClineEndpointModels: async (_workspaceScope, input) => {
			const body = parseClineEndpointModelDiscoveryRequest(input);
			return await clineProviderService.discoverEndpointModels(body);
		},
		getClineModelRegistry: async (workspaceScope) => {
			const snapshot = await getDefaultClineModelRegistry().getSnapshot();
			const runtimeConfig = workspaceScope ? await deps.loadScopedRuntimeConfig(workspaceScope) : null;
			const launchConfig =
				runtimeConfig?.selectedAgentId === "cline"
					? await clineProviderService.resolveLaunchConfig().catch(() => null)
					: null;
			const providerSettings =
				runtimeConfig?.selectedAgentId === "cline" ? clineProviderService.getProviderSettingsSummary() : null;
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
		removeClineModelRegistryEntry: async (_workspaceScope, input) => {
			const body = parseClineModelRegistryRemoveRequest(input);
			const snapshot = await getDefaultClineModelRegistry().getSnapshot();
			const entry = snapshot.models[body.key] ?? null;
			if (entry && !isLocalProvider(entry.providerId, entry.endpoint)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Only local Cline model telemetry can be removed.",
				});
			}
			const removed = await getDefaultClineModelRegistry().removeEntry(body.key);
			return { removed };
		},
		pruneClineModelRegistry: async (workspaceScope) => {
			const registry = getDefaultClineModelRegistry();
			const snapshot = await registry.getSnapshot();
			const runtimeConfig = workspaceScope ? await deps.loadScopedRuntimeConfig(workspaceScope) : null;
			const launchConfig =
				runtimeConfig?.selectedAgentId === "cline"
					? await clineProviderService.resolveLaunchConfig().catch(() => null)
					: null;
			const providerSettings =
				runtimeConfig?.selectedAgentId === "cline" ? clineProviderService.getProviderSettingsSummary() : null;
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
				const loadedModelsResponse = await clineProviderService.getProviderModels(providerId).catch(() => null);
				for (const model of loadedModelsResponse?.models ?? []) {
					keepKeys.add(
						buildClineModelRegistryKey({
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
		saveClineModelContextWindowOverride: async (_workspaceScope, input) => {
			const body = parseClineModelContextWindowOverrideRequest(input);
			if (!isLocalProvider(body.providerId, body.endpoint)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Context window overrides are only available for local Cline models.",
				});
			}
			if (body.contextWindow !== null) {
				assertClineContextWindowPolicy({
					providerId: body.providerId,
					modelId: body.modelId,
					contextWindow: body.contextWindow,
					label: "Context window override for",
				});
			}
			const model = await getDefaultClineModelRegistry().setContextWindowOverride({
				providerId: body.providerId,
				modelId: body.modelId,
				endpoint: body.endpoint,
				contextWindow: body.contextWindow,
			});
			return { model };
		},
		getClineCodeIntelligenceStatus: async (workspaceScope) => {
			if (!workspaceScope) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A workspace is required to inspect code intelligence status.",
				});
			}
			const runtimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope);
			const embeddingProvider = createClineCodeEmbeddingProviderFromSettings(
				runtimeConfig.effectiveCodeEmbeddingSettings,
			);
			const [repoMapResult, codeIndexResult] = await Promise.allSettled([
				buildClineRepoMap({ workspacePath: workspaceScope.workspacePath }),
				getClineCodeIndexStatus({
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
			return {
				codeEmbeddingSettings: {
					globalDefaults: runtimeConfig.codeEmbeddingDefaults,
					projectOverride: runtimeConfig.codeEmbeddingOverride,
					effective: runtimeConfig.effectiveCodeEmbeddingSettings,
					source: runtimeConfig.codeEmbeddingOverride ? ("project" as const) : ("global" as const),
				},
				repoMap,
				codeIndex,
			};
		},
		buildClineModelFreshnessAdvisor: async (_workspaceScope) => {
			return await buildClineModelFreshnessAdvisorRequest();
		},
		buildClineAdvisor: async (workspaceScope, input) => {
			const body = parseClineAdvisorBuildRequest(input);
			if (body.kind === "model_freshness") {
				return await buildClineModelFreshnessAdvisorRequest();
			}
			return buildClineAdvisorRequest(body.kind, {
				workspacePath: workspaceScope?.workspacePath,
				repoSummary: body.repoSummary,
				modelRegistrySummary: body.modelRegistrySummary,
				runtimeConfigSummary: body.runtimeConfigSummary,
				telemetrySummary: body.telemetrySummary,
				taskSummary: body.taskSummary,
				userQuestion: body.userQuestion,
			});
		},
		sendClineAdvisor: async (_workspaceScope, input) => {
			const body = parseClineAdvisorSendRequest(input);
			const sentAt = Date.now();
			const launchConfig = await clineProviderService.resolveLaunchConfig({
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
		writeClineDogfoodBacklog: async (workspaceScope, input) => {
			if (!workspaceScope) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "A workspace is required to write dogfood backlog artifacts.",
				});
			}
			const body = parseClineDogfoodBacklogRequest(input);
			const artifacts = await writeClineDogfoodBacklog({
				workspacePath: workspaceScope.workspacePath,
				telemetryRootDir: deps.getDogfoodTelemetryRoot?.() ?? join(homedir(), ".cline", "nklein", "telemetry"),
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
		runClineSmokeEval: async (_workspaceScope) => {
			const launchConfig = await clineProviderService.resolveLaunchConfig();
			const modelId = launchConfig.modelId?.trim() || "unknown";
			const result = await runClineDevSmokeEval({
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
			const taskCwd = taskResultCommit
				? workspaceScope.workspacePath
				: await resolveExistingTaskCwdOrEnsure({
						cwd: workspaceScope.workspacePath,
						taskId: task.id,
						baseRef: task.baseRef,
					}).catch(() => workspaceScope.workspacePath);
			const [clineTaskSessionService, runtimeConfig, baseCommit, changesResult] = await Promise.all([
				deps.getScopedClineTaskSessionService(workspaceScope),
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
			const messages = clineTaskSessionService.listMessages(task.id);
			const diffPatch = renderWorkspaceChangesEvidence(changesResult);
			const title = task.title?.trim() || task.id;
			const summaryText = [
				`Task: ${title} (${task.id})`,
				`Workspace: ${workspaceScope.workspacePath}`,
				`Task worktree: ${taskCwd}`,
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
					task.clineSettings?.providerId && task.clineSettings?.modelId
						? `${task.clineSettings.providerId}/${task.clineSettings.modelId}`
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
		getClineMcpAuthStatuses: async (_workspaceScope) => {
			const statuses = await clineMcpRuntimeService.getAuthStatuses();
			return {
				statuses,
			};
		},
		runClineMcpServerOAuth: async (_workspaceScope, input) => {
			const body = parseClineMcpOAuthRequest(input);
			const response = await clineMcpRuntimeService.authorizeServer({
				serverName: body.serverName,
				onAuthorizationUrl: (url: string) => {
					openInBrowser(url);
				},
			});
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		getClineMcpSettings: async (_workspaceScope) => {
			return clineMcpSettingsService.loadSettings();
		},
		saveClineMcpSettings: async (_workspaceScope, input) => {
			const body = parseClineMcpSettingsSaveRequest(input);
			const response = await clineMcpSettingsService.saveSettings(body);
			deps.bumpClineSessionContextVersion?.();
			return response;
		},
		runClineProviderOAuthLogin: async (_workspaceScope, input) => {
			const body = parseClineOauthLoginRequest(input);
			const response = await clineProviderService.runOauthLogin({
				providerId: body.provider,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpClineSessionContextVersion?.();
			}
			return response;
		},
		startClineDeviceAuth: async () => {
			return await clineProviderService.startDeviceAuth();
		},
		completeClineDeviceAuth: async (_workspaceScope, input) => {
			const body = parseClineDeviceAuthCompleteRequest(input);
			const response = await clineProviderService.completeDeviceAuth({
				deviceCode: body.deviceCode,
				expiresInSeconds: body.expiresInSeconds,
				pollIntervalSeconds: body.pollIntervalSeconds,
				baseUrl: body.baseUrl,
			});
			if (response.ok) {
				deps.bumpClineSessionContextVersion?.();
			}
			return response;
		},
		sendTaskChatMessage: async (workspaceScope, input) => {
			try {
				const body = parseTaskChatSendRequest(input);
				const clineTaskSessionService = await deps.getScopedClineTaskSessionService(workspaceScope);
				const providerIdOverride = body.providerId?.trim() || undefined;
				const modelIdOverride = body.modelId?.trim() || undefined;
				const hasReasoningEffortOverride = Object.hasOwn(body, "reasoningEffort");
				const launchConfigOverrides =
					providerIdOverride || modelIdOverride || hasReasoningEffortOverride
						? await clineProviderService.resolveLaunchConfig({
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
				if (isClineClearSlashCommand(body.text)) {
					const summary = await clineTaskSessionService.clearTaskSession(body.taskId);
					deps.broadcastTaskChatCleared?.(workspaceScope.workspaceId, body.taskId);
					return {
						ok: true,
						summary,
						message: null,
					};
				}
				const requestedMode = body.mode;
				let summary = sessionLaunchConfigOverrides
					? await clineTaskSessionService.sendTaskSessionInput(
							body.taskId,
							body.text,
							requestedMode,
							body.images,
							sessionLaunchConfigOverrides,
						)
					: await clineTaskSessionService.sendTaskSessionInput(body.taskId, body.text, requestedMode, body.images);
				if (!summary) {
					if (!isHomeAgentSessionId(body.taskId)) {
						const reboundSummary = await clineTaskSessionService.rebindPersistedTaskSession(body.taskId);
						if (reboundSummary) {
							const clineLaunchConfig =
								launchConfigOverrides ?? (await clineProviderService.resolveLaunchConfig());
							summary = await clineTaskSessionService.startTaskSession({
								taskId: body.taskId,
								cwd: reboundSummary.workspacePath ?? workspaceScope.workspacePath,
								workspaceRoot: workspaceScope.workspacePath,
								prompt: body.text,
								images: body.images,
								resumeFromPersistence: true,
								providerId: clineLaunchConfig.providerId,
								modelId: clineLaunchConfig.modelId,
								mode: requestedMode,
								apiKey: clineLaunchConfig.apiKey,
								baseUrl: clineLaunchConfig.baseUrl,
								reasoningEffort: clineLaunchConfig.reasoningEffort,
								contextWindow: clineLaunchConfig.contextWindow ?? null,
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
						const clineLaunchConfig = launchConfigOverrides ?? (await clineProviderService.resolveLaunchConfig());
						summary = await clineTaskSessionService.startTaskSession({
							taskId: body.taskId,
							cwd: workspaceScope.workspacePath,
							workspaceRoot: workspaceScope.workspacePath,
							prompt: body.text,
							images: body.images,
							resumeFromPersistence: true,
							providerId: clineLaunchConfig.providerId,
							modelId: clineLaunchConfig.modelId,
							mode: requestedMode,
							apiKey: clineLaunchConfig.apiKey,
							baseUrl: clineLaunchConfig.baseUrl,
							reasoningEffort: clineLaunchConfig.reasoningEffort,
							contextWindow: clineLaunchConfig.contextWindow ?? null,
						});
					}
				}
				const latestMessage = clineTaskSessionService.listMessages(body.taskId).at(-1) ?? null;
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
				const shellCwd = body.workspaceTaskId
					? await resolveTaskCwd({
							cwd: workspaceScope.workspacePath,
							taskId: body.workspaceTaskId,
							baseRef: body.baseRef,
							ensure: true,
						})
					: workspaceScope.workspacePath;
				const summary = await terminalManager.startShellSession({
					taskId: body.taskId,
					cwd: shellCwd,
					cols: body.cols,
					rows: body.rows,
					binary: shell.binary,
					args: shell.args,
				});
				return {
					ok: true,
					summary,
					shellBinary: shell.binary,
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
