import { readAgentResultText, readSdkAgentEvent, readSdkSessionEvent } from "./nklein-sdk-event-readers";
// Task-oriented facade for native NKlein sessions.
// runtime-api.ts uses this service to start sessions, send messages, load
// history, and subscribe to summaries and chat events without knowing SDK
// host, repository, or event-adapter details.

import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type {
	RuntimeContextBudgetBreakdown,
	RuntimeModelPerformanceRole,
	RuntimeNKleinReasoningEffort,
	RuntimeNKleinTeamProgressEvent,
	RuntimeSwarmGuardrails,
	RuntimeTaskAcceptanceResult,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import { DEFAULT_RUNTIME_SWARM_GUARDRAILS, normalizeRuntimeSwarmGuardrails } from "../core/api-contract";
import { applyFocusChainStepTiming, type FocusChain, summarizeFocusChain } from "../core/focus-chain";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { resolveHomeAgentAppendSystemPrompt } from "../prompts/append-system-prompt";
import {
	recordTaskRunSummary,
	type TaskRunTerminalState,
	type TaskRunTimeoutSource,
} from "../state/task-run-summary-store";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { isTaskPatchCaptureError, type TaskPatchCaptureError } from "../workspace/task-patch-capture-diagnostics";
import {
	applyTaskPatchToResultBranch,
	resolveTaskResultBranchCommit,
	type TaskResultBranch,
} from "../workspace/task-result-branches";
import { captureTaskTurnCheckpoint, deleteTaskTurnCheckpointRef } from "../workspace/turn-checkpoints";
import type { DecompositionStallNudgerCallbacks } from "./decomposition-stall-nudger";
import { DecompositionStallNudger, isChatOnlyDecompositionActivity } from "./decomposition-stall-nudger";
import { runNKleinAcceptanceGateInSandbox } from "./nklein-acceptance-gate";
import {
	AgentSandboxExecutionError,
	type AgentSandboxManager,
	type AgentSandboxPoolConfig,
	type AgentSandboxShellTarget,
	createAgentSandboxToolExecutors,
	resolveNKleinAgentPerceivedCwd,
} from "./nklein-agent-sandbox";
import { createAgentSandboxExtraTools } from "./nklein-agent-sandbox-extra-tools";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./nklein-context-budgets";
import {
	compactKanbanMessagesForContextTarget,
	countKanbanPersistedMessagesTokens,
} from "./nklein-context-focus-policy";
import {
	compactPersistedMessagesForContextOverflow,
	isContextOverflowError,
} from "./nklein-context-overflow-compaction";
import type { NKleinDecompositionAppliedHandler } from "./nklein-decomposition-tool";
import { applyNKleinSessionEvent } from "./nklein-event-adapter";
import { assertLocalProviderAllowed, isLocalProvider } from "./nklein-local-only-policy";
import {
	createInMemoryNKleinMessageRepository,
	createTaskEntryFromPersistedSession,
	type NKleinMessageRepository,
} from "./nklein-message-repository";
import { extractNKleinModelRegistryObservationFromEvent, getDefaultNKleinModelRegistry } from "./nklein-model-registry";
import { NKleinPauseController } from "./nklein-pause-controller";
import type { NKleinCardPromotedHandler } from "./nklein-promotion-tool";
import type { NKleinReviewResult, NKleinReviewSubmittedHandler } from "./nklein-review-tool";
import { createNKleinRuntimeSetup, type NKleinRuntimeSetup } from "./nklein-runtime-setup";
import {
	type CreateInMemoryNKleinSessionRuntimeOptions,
	createInMemoryNKleinSessionRuntime,
	type NKleinPersistedTaskSessionSnapshot,
	type NKleinSessionRuntime,
	readKanbanLaunchConfigFromSessionRecord,
} from "./nklein-session-runtime";
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
	isNKleinUserAttentionTool,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	setOrCreateAssistantMessage,
	updateSummary,
} from "./nklein-session-state";
import {
	isDecompositionPlanningPrompt,
	isExplicitDecompositionPrompt,
	parseAcceptanceCommand,
	parseRequestedMinimumTaskCount,
} from "./nklein-task-prompt-parsing";
import { projectNKleinTeamProgressEvent } from "./nklein-team-progress";
import {
	createNKleinWatcherRegistry,
	type NKleinRuntimeSetupLease,
	type NKleinWatcherRegistry,
} from "./nklein-watcher-registry";
import {
	listNKleinSdkWorkflowSlashCommands,
	type NKleinSdkPersistedMessage,
	type NKleinSdkSessionEvent,
	type NKleinSdkSlashCommand,
	type NKleinSdkStartSessionInput,
	type NKleinSdkTeamEvent,
	resolveNKleinSdkSystemPrompt,
} from "./sdk-runtime-boundary.js";

export type { KanbanContextPressurePolicy, KanbanContextSafetyBudgets } from "./nklein-context-budgets";
export { buildKanbanContextPressurePolicy, buildKanbanContextSafetyBudgets } from "./nklein-context-budgets";
export type { NKleinTaskMessage } from "./nklein-session-state";

const DEFAULT_NKLEIN_CONTEXT_WINDOW_TOKENS = 80_000;
/** Overall time budget for a second-opinion reviewer session (first turn + any nudges) before it is abandoned (todo §5.K). */
const DEFAULT_SECOND_OPINION_REVIEW_TIMEOUT_MS = 10 * 60 * 1000;
/** Re-prompt budget when a reviewer turn ends without calling `submit_review` (small models often forget). */
const MAX_SECOND_OPINION_REVIEW_NUDGES = 2;
const SECOND_OPINION_REVIEW_NUDGE_PROMPT =
	"You ended your turn without calling `submit_review`, so no review was recorded. Your verdict is delivered ONLY by that tool. Call `submit_review` now: `approve`, or `request_changes` with concrete, actionable feedback. Do not answer in prose.";
const CONTEXT_BUDGET_WARNING_RATIO = 0.8;
const CONTEXT_BUDGET_COMPACT_RATIO = 0.92;
const CONTEXT_BUDGET_SEND_RESERVE_TOKENS = 2_000;
const CONTEXT_BUDGET_IMAGE_OVERHEAD_TOKENS = 1_200;
const CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS = 1_200;
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;
const UNCONFIGURED_PROVIDER_ID = "unconfigured";
const UNCONFIGURED_MODEL_ID = "unconfigured";
type NKleinSdkContentBlock = Exclude<NKleinSdkPersistedMessage["content"], string>[number];
type NKleinSdkToolResultBlock = Extract<NKleinSdkContentBlock, { type: "tool_result" }>;
type NKleinTaskTimeoutKind = "stream" | "tool" | "conversation";

interface NKleinTaskTimeoutSettings {
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
	streamTimeoutSource: TaskRunTimeoutSource;
	toolTimeoutSource: TaskRunTimeoutSource;
	conversationTimeoutSource: TaskRunTimeoutSource;
}

interface ContextHistoryTokenSegments {
	userMessageTokens: number;
	includedFileContentTokens: number;
	otherHistoryTokens: number;
}

interface NKleinTaskFailureBackoffState {
	fingerprint: string;
	count: number;
	parked: boolean;
}

interface NKleinTaskNoDiffState {
	commit: string;
	count: number;
}

interface NKleinTaskRepeatedToolState {
	fingerprint: string;
	count: number;
	toolName: string;
	toolInputSummary: string | null;
}

interface NKleinTaskRepeatedFailureTargetState {
	fingerprint: string;
	count: number;
	targetSummary: string;
	toolNames: string[];
}

const NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD = 3;
// A crashed/unloaded local model won't recover by retrying the dead endpoint, so park after a single
// transient retry (instead of the generic 3) with reload guidance rather than storming a model that is gone.
const NKLEIN_LOCAL_MODEL_UNAVAILABLE_PARK_THRESHOLD = 2;
const NKLEIN_REPEATED_PLAN_ARTIFACT_FAILURE_THRESHOLD = 4;
const NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD = 6;

/**
 * Resolve a task's coarse launch role (todo §5.G/§5.U): reviewer for the synthetic `<taskId>::review` session,
 * architect for an explicit decomposition, worker otherwise. Single source for both the live summary stamp and
 * the terminal run-summary role attribution so they can't drift.
 */
function resolveNKleinTaskRole(taskId: string, isDecomposition: boolean): RuntimeModelPerformanceRole {
	if (taskId.endsWith("::review")) {
		return "reviewer";
	}
	return isDecomposition ? "architect" : "worker";
}

function getRepeatedToolCallLimit(toolName: string, baseLimit: number): number {
	const normalized = toolName.trim().toLowerCase();
	if (normalized === "read_files" || normalized === "run_commands") {
		// Read/search tools legitimately repeat more, so give them extra headroom — but never below the
		// operator-configured base limit (so raising the base also raises these).
		return Math.max(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD, baseLimit);
	}
	return baseLimit;
}

/**
 * Park message for the repeated-identical-tool-call guard. Repeated *empty* `decompose_project` calls are a
 * specific, common weak-local-model failure: the model reasons the whole plan in its thinking channel but emits
 * the tool call with no arguments (so nothing decomposes). Give that case a diagnostic message naming the cause
 * and the remedy, instead of the generic "same input" notice.
 */
export function formatRepeatedToolCallParkMessage(state: {
	toolName: string;
	count: number;
	toolInputSummary: string | null;
}): string {
	if (state.toolName.trim().toLowerCase() === "decompose_project" && !state.toolInputSummary) {
		return (
			`!Klein paused this task: the model called decompose_project ${state.count}× with empty arguments. ` +
			"It planned the decomposition in its reasoning but did not emit it as the tool's JSON arguments — a " +
			"common limitation of weaker local models. Switch the Architect/planning role to a more capable model " +
			"(or reduce the project scope), then resume."
		);
	}
	const toolInputText = state.toolInputSummary ? ` (${state.toolInputSummary})` : "";
	return `!Klein paused this task after ${state.count} repeated ${state.toolName} tool calls with the same input${toolInputText}. Review progress, then send a new instruction to continue.`;
}

/**
 * Repeated-tool-call guard candidate for a hook activity (its fingerprint), or `null` to skip the guard.
 *
 * The fingerprint keys on the **lossless full-input fingerprint** (`activity.toolInputFingerprint`, a hash of
 * the entire parsed tool input — see `computeNKleinToolInputFingerprint`) when present, falling back to the lossy
 * display summary only for back-compat with older persisted activities. This is what makes the guard immune **by
 * construction** for every tool — including future ones: two calls collide only when their inputs are genuinely
 * identical, so an advancing stateful workflow can never again be falsely paused for "the same input" just because
 * its human-facing *summary* happened to collapse (the read_large_file cursor / decompose_project question-resolution
 * regressions). `read_large_file` stays **explicitly excluded** as well — it is *designed* to be re-called with an
 * advancing cursor, the workflow rejects stale cursors itself, and the autonomy budget bounds any true loop.
 */
export function computeRepeatedToolCallCandidate(
	activity: RuntimeTaskSessionSummary["latestHookActivity"],
): Omit<NKleinTaskRepeatedToolState, "count"> | null {
	if (activity?.source !== "nklein-sdk") {
		return null;
	}
	const hookEventName = activity.hookEventName?.trim().toLowerCase();
	if (hookEventName !== "tool_call" && hookEventName !== "tool_call_start") {
		return null;
	}
	const toolName = activity.toolName?.trim();
	if (!toolName || isNKleinUserAttentionTool(toolName)) {
		return null;
	}
	if (toolName.toLowerCase() === "read_large_file") {
		return null;
	}
	const toolInputSummary = activity.toolInputSummary?.trim() || null;
	const fingerprintBasis = activity.toolInputFingerprint?.trim() || toolInputSummary || "";
	return {
		fingerprint: `${toolName.toLowerCase()}\n${fingerprintBasis}`,
		toolName,
		toolInputSummary,
	};
}

function normalizePlanArtifactFailureTarget(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	if (!normalized) {
		return null;
	}
	const pathMatch = normalized.match(
		/(?:^|\s)(["']?)(\/[^"'\s]*\.nklein\/nklein\/plans\/[^"'\s]+|\.nklein\/nklein\/plans\/[^"'\s]+)\1/u,
	);
	const rawPath = pathMatch?.[2]?.trim();
	if (!rawPath) {
		return null;
	}
	return rawPath.replace(/[),.;:]+$/u, "").replace(/\/+$/u, "");
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
}

export interface NKleinTaskLaunchConfigOverrides {
	providerId: string;
	modelId: string;
	workspaceRoot?: string | null;
	filesLikelyTouched?: readonly string[] | null;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
	contextWindow?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
}

interface NKleinTaskRestartLaunchConfig extends NKleinTaskLaunchConfigOverrides {
	maxAgentWritableFileLines?: number | null;
}

export function buildKanbanEfficiencyRules(options: {
	contextScope: "full" | "smart" | "minimal" | "custom";
	contextWindow?: number | null;
	timeoutMode: "normal" | "long" | "extended" | "unlimited";
	maxAgentWritableFileLines?: number | null;
}): string {
	const budgets = buildKanbanContextSafetyBudgets(options.contextWindow);
	const chunkTokenBudgetText = Math.round(budgets.fileChunkTokenBudget / 1000);
	const chunkContentTokenBudgetText = Math.round(budgets.fileChunkContentTokenBudget / 1000);
	const chunkCharBudgetText = Math.round(budgets.fileChunkCharBudget / 1000);
	const safeWorkingBudgetText = budgets.safeWorkingBudget
		? `${budgets.safeWorkingBudget.toLocaleString()} tokens (~${Math.round(budgets.safeWorkingBudget / 1000)}k)`
		: null;
	const promptOverheadReserveText = budgets.promptOverheadReserveTokens.toLocaleString();
	const maxAgentWritableFileLines = normalizeMaxAgentWritableFileLines(options.maxAgentWritableFileLines);
	return [
		"# !Klein Efficiency Rules",
		"",
		"## Response Length And Reasoning Discipline",
		"Keep every response short and to the point. Do not write long, exhaustive, or repetitive answers. Prefer the smallest reply that does the job: take the next tool action or give a brief result, not an essay.",
		"Do the work with tools instead of narrating it. Do not restate the task, pre-explain a long plan in prose, dump large excerpts back to the user, or re-summarize what you already said.",
		"If you are a reasoning model, keep your thinking brief and focused on the immediate next step. Do not produce long chains of thought; a few lines of reasoning are enough before you act. Long outputs and long reasoning waste the context budget and can crash a local model host under memory pressure.",
		"When you have enough to act, act. When a step is done, stop — a short confirmation beats a long recap.",
		"",
		"## Focus Chain (plan your steps and track them)",
		"At the very start of the task, call `update_focus_chain` once to lay out your plan: a handful of concrete, ordered steps for completing this task. Then, as you work, call it again to update the list — mark the current step `in_progress`, completed steps `done`, and re-send the FULL list each time (keep exactly one step in progress). This keeps you on-task and shows the user your progress. It is lightweight bookkeeping, not the work itself; keep the steps short.",
		"",
		"## Adaptive Prompt Selection",
		"Before acting, briefly decide which optional rule packs fit the user's task. Apply a pack only when its description matches the requested work; ignore packs that do not fit. Do not keyword-match mechanically: reason from the task intent, source shape, and expected output.",
		"Available optional pack: Requirements Extraction Rules. Use it when the task asks you to reconstruct, consolidate, summarize, or derive requirements/specifications/plans from discussions, prior drafts, logs, notes, or other evolving source material.",
		"",
		"## Requirements Extraction Rules",
		"When this pack applies, reconstruct the latest agreed requirements from the sources instead of creating an idealized new spec. Treat user corrections, answers, and refinements as higher authority than agent suggestions; agent-generated drafts become requirements only when accepted, corrected, or built on by the user.",
		"Maintain a compact requirements ledger while reading: explicit source facts, latest accepted requirements, superseded older requirements, open decisions or unresolved clarifications, and implementation inferences or recommendations.",
		"When later source material revises earlier details, merge into the latest requirement or mark the older detail superseded; do not duplicate both as active requirements. If conflict remains unresolved, preserve it as an open decision.",
		"Do not invent concrete details such as dates, versions, sample people, paths, records, thresholds, schemas, dependencies, timelines, or import formats. If a source leaves something undecided, label it open instead of silently choosing.",
		"Preserve important conceptual boundaries: immutable raw data versus editable interpretation, imported data versus manual input, accepted decisions versus uncertain or review states, current scope versus future or superseded ideas, and domain categories that use different rules.",
		"Before writing a synthesized spec or plan, self-audit for hallucinated details, unresolved decisions presented as final, duplicated superseded requirements, collapsed domain distinctions, and recommendations not labeled as recommendations.",
		"",
		"## Tool And Context Rules",
		`Scope: ${options.contextScope}. Timeout: ${options.timeoutMode}. Use targeted discovery and focused excerpts; avoid generated/lock files unless needed.`,
		"When the exact source file set is unclear, first use `list_files` or `find_files`, then `get_file_size` for candidate files before choosing `read_files` or `read_large_file`. Treat discovery output as metadata only, not source content.",
		`Hard output guard rail: never create or edit files above ${maxAgentWritableFileLines.toLocaleString()} total lines; split large outputs across files. Use \`write_file\` for one generated artifact and \`write_files\` for batches that fit this limit.`,
		"Every `write_file` and `write_files` request must include the destination path and the complete UTF-8 file content in the same tool-call JSON. Never call a write tool with only a path or as a placeholder before the content is ready.",
		"For ordinary code, small files, and focused excerpts, use `read_files` normally. Do not turn focused code inspection into a large-file workflow.",
		`Use \`read_large_file\` only when the file must be read completely and the whole file would not fit in the available context/read budget. A file being merely long by bytes or lines is not enough; if \`get_file_size\` recommends \`read_files\`, use \`read_files\` for the whole file or for focused excerpts instead.`,
		`When a full-file read is genuinely too large for context, use \`read_large_file\` with a workflow cursor. First call: {"path":"...","cursor":"start"}. Then reuse \`nextCursor\` from each result for the next call (cursor format includes a monotonic counter, e.g. \`read:<line>:<n>\` or \`stitch:<left>/<right>:<n>\`); never replay a stale cursor. Make exactly one \`read_large_file\` call per assistant response and wait for its result before making the next call; never call it in parallel. Do not include \`read_files\` in the same assistant response as \`read_large_file\`; finish the active large-file workflow first. It owns line-1-through-EOF coverage, batched stitching verification, and the final synthesis phase; continue until the final line is confirmed.`,
		`Choose initial read lines from bytes/line: target about 70% of the ${chunkCharBudgetText}k character budget, capped to remaining lines. Use reasonably large safe chunks to minimize chunk count and stitching areas; do not default to tiny 300-line starters when larger ranges measure safe.`,
		`Backend approval will tokenize the selected text and keep source content at or below about ${chunkContentTokenBudgetText}k tokens (${chunkTokenBudgetText}k total read budget including tool/result framing).`,
		"A rejected read covers zero lines: do not record it, advance past it, or call it successful. Retry one large file per call, shrinking by at least half or to the suggested line count.",
		"After a retry succeeds, set the next unread line to the successful `end_line + 1`. Never skip from a failed 1-N attempt to N+1 unless a later successful read reached N.",
		"Grow chunk sizes slowly from the last successful read, about 25% at a time unless measured token density clearly allows more.",
		"Chunk formula: floor(0.7 * chunk character budget / bytes per line), capped to remaining lines; shrink unusually long lines.",
		"When using `read_files` for a focused large-file excerpt, every chunk must use explicit inclusive `start_line` and `end_line` values.",
		"Prefer non-overlapping primary chunks, then explicitly inspect stitching areas around each chunk boundary before synthesizing; expand around split code blocks, tables, logs, diagrams, prose, functions, classes, types, and imports.",
		"Treat stitching reads as verification, not duplicated source material; deduplicate those lines when merging, summarizing, or deriving requirements.",
		"If tool output is truncated, clipped, summarized, or hits a limit, mark that chunk incomplete and redo it smaller before using it as evidence.",
		"Never summarize, infer a spec, or move on from a source file until the ledger shows the file has been read through EOF.",
		"every included file has EOF-confirmed coverage or an explicit exclusion reason.",
		"If a pass cannot finish now, resume from the last confirmed line. Treat an incomplete pass as incomplete work.",
		"The newest successful chunk remains verbatim for its immediate analysis request. Before reading the next chunk, distill its salient facts into durable running notes (or append them incrementally to the output file); once a newer chunk arrives, older raw chunk bodies are removed from request context.",
		"Do not restart a file you have already covered. When a !Klein context-focus brief or coverage ledger reports ranges read through line N, resume at N+1 and never re-read 1..N from line 1.",
		"To re-confirm continuity across a covered file, read only a small stitching window around the relevant chunk boundary, then synthesize from your running notes rather than re-reading the whole file.",
		budgets.contextWindow
			? `Model context window: ${budgets.contextWindow.toLocaleString()} tokens. Treat this as the authoritative upper bound for prompt planning and reserve about ${budgets.outputReserveTokens.toLocaleString()} tokens for reasoning/tool chatter/final answer.`
			: "If the model limit is unknown, keep conservative chunk sizes and leave a generous reserve for reasoning/output.",
		safeWorkingBudgetText
			? `Safe working budget after output reserve and prompt overhead reserve: ${safeWorkingBudgetText}; this is not a target to fill.`
			: "Work in the smallest practical slices when the budget is unknown.",
		`Keep about ${promptOverheadReserveText} tokens for prompt/history/tool overhead; summarize/compact before more reads if near the safe working budget.`,
		`Suggested file-read chunk size: about ${chunkTokenBudgetText}k tokens (~${chunkCharBudgetText}k characters). Prefer the smallest slice that fully answers the immediate question.`,
	].join("\n");
}

function toPersistedContentBlocks(message: NKleinSdkPersistedMessage): NKleinSdkContentBlock[] {
	return typeof message.content === "string" ? [] : message.content;
}

function stringifyToolResultContent(content: NKleinSdkToolResultBlock["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((item) => {
				if (typeof item === "string") {
					return item;
				}
				if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
					return item.text;
				}
				return JSON.stringify(item);
			})
			.join("\n");
	}
	return JSON.stringify(content);
}

function countContextBudgetTextTokens(text: string): number {
	return text.length > 0 ? countKanbanTextTokens(text) : 0;
}

function isFileReadToolName(toolName: string | undefined): boolean {
	return toolName === "read_files" || toolName === "read_large_file";
}

function classifyContextHistoryTokens(messages: readonly NKleinSdkPersistedMessage[]): ContextHistoryTokenSegments {
	const totalHistoryTokens = countKanbanPersistedMessagesTokens(messages);
	const toolNameByUseId = new Map<string, string>();
	let userMessageTokens = 0;
	let includedFileContentTokens = 0;

	for (const message of messages) {
		if (typeof message.content === "string") {
			if (message.role === "user") {
				userMessageTokens += countContextBudgetTextTokens(message.content);
			}
			continue;
		}
		for (const block of toPersistedContentBlocks(message)) {
			if (block.type === "tool_use") {
				toolNameByUseId.set(block.id, block.name);
				if (block.call_id) {
					toolNameByUseId.set(block.call_id, block.name);
				}
				continue;
			}
			if (block.type === "tool_result") {
				const toolName = toolNameByUseId.get(block.tool_use_id);
				if (isFileReadToolName(toolName)) {
					includedFileContentTokens += countContextBudgetTextTokens(stringifyToolResultContent(block.content));
				}
				continue;
			}
			if (message.role === "user" && block.type === "text") {
				userMessageTokens += countContextBudgetTextTokens(block.text);
			}
		}
	}

	return {
		userMessageTokens,
		includedFileContentTokens,
		otherHistoryTokens: Math.max(0, totalHistoryTokens - userMessageTokens - includedFileContentTokens),
	};
}

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
	listMessages(taskId: string): NKleinTaskMessage[];
	listSlashCommands(workspacePath: string): Promise<NKleinSdkSlashCommand[]>;
	loadTaskSessionMessages(taskId: string): Promise<NKleinTaskMessage[]>;
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	setBoardPaused(paused: boolean): void;
	setCardPaused(taskId: string, paused: boolean): void;
	/** Apply the operator-configurable autonomous-run guardrail limits (Settings → "Local swarm guardrails"). */
	setSwarmGuardrails(guardrails: RuntimeSwarmGuardrails): void;
	waitUntilTaskResumed(taskId: string): Promise<void>;
	verifyTaskAcceptanceInSandbox(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
		timeoutMs?: number;
	}): Promise<RuntimeTaskAcceptanceResult>;
	runSecondOpinionReviewSession(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		seedPrompt: string;
		reviewer?: { providerId: string; modelId: string } | null;
		timeoutMs?: number;
	}): Promise<NKleinReviewResult | null>;
	updateAgentSandboxPoolConfig(config: Partial<AgentSandboxPoolConfig>): Promise<void>;
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

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	return "Unknown error";
}

function isBenignSandboxPatchStagingTeardown(error: unknown): boolean {
	if (!(error instanceof AgentSandboxExecutionError)) {
		return false;
	}
	if (!error.message.startsWith("Could not stage sandbox workspace changes.")) {
		return false;
	}
	const output = `${error.result.stderr}\n${error.result.stdout}`.toLowerCase();
	return (
		output.includes("chdir to cwd") ||
		output.includes("unable to get current working directory") ||
		output.includes("no such file or directory") ||
		output.includes("not a git repository")
	);
}

function formatWallTimeDuration(durationMs: number): string {
	const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours === 0) {
		return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
	}
	if (minutes === 0) {
		return `${hours} hour${hours === 1 ? "" : "s"}`;
	}
	return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function formatStartWarnings(warnings: readonly string[] | undefined): string | null {
	if (!warnings) {
		return null;
	}
	const normalized = warnings.map((warning) => warning.trim()).filter((warning) => warning.length > 0);
	if (normalized.length === 0) {
		return null;
	}
	if (normalized.length === 1) {
		return normalized[0] ?? null;
	}
	return `${normalized[0]} (+${normalized.length - 1} more MCP warning${normalized.length === 2 ? "" : "s"})`;
}

interface NKleinStartPromptParts {
	userPrompt: string;
	systemPrompt: string | null;
	systemWorkflowCommand: string | null;
}

function buildNKleinPlanningSystemPrompt(prompt: string, startInPlanMode?: boolean): string | null {
	if (!startInPlanMode) {
		return null;
	}
	const trimmedPrompt = prompt.trim();
	const isDecompositionTask = isDecompositionPlanningPrompt(trimmedPrompt);
	const minimumTaskCount = parseRequestedMinimumTaskCount(trimmedPrompt);
	const acceptanceCommand = parseAcceptanceCommand(trimmedPrompt);
	// Decomposition / board / plan tools are trusted control-plane and remain available even under strict
	// Docker isolation (they touch only !Klein-owned state, never the user's working tree). The overridable
	// workflow is loaded separately; avoid surfacing slash-command syntax because local models may try to call
	// it as an unavailable tool.
	const decompositionInstruction =
		"!Klein decomposition workflow rules are applied by the runtime. Do not call workflow names or slash commands as tools. When the task should be split into dependent cards, call the `decompose_project` tool directly.";
	if (isDecompositionTask) {
		return [
			"Inspect the codebase only as needed for one focused planning pass, then call the `decompose_project` tool.",
			"Keep your thinking and any prose brief: a short focused pass, then the tool call. Do not write a long analysis, reasoning dump, or running commentary before calling `decompose_project` — long output wastes the context budget and can crash a local model host.",
			"Reasoning or thinking alone is not an answer and does not make progress. After your brief think, you MUST emit a tool call in your output — never end your turn with only reasoning and no tool call. The decomposition is delivered by calling `decompose_project`, not by describing it.",
			decompositionInstruction,
			minimumTaskCount !== null
				? `When calling decompose_project, pass \`minimumTaskCount: ${minimumTaskCount}\`.`
				: null,
			acceptanceCommand
				? `Use \`defaultAcceptanceCommand: "${acceptanceCommand}"\` unless a generated leaf needs a narrower objective check.`
				: null,
			"Do not answer with a chat-only markdown plan, current-codebase report, or domain analysis; put the summary, assumptions, plan, and task graph in the `decompose_project` tool arguments.",
			"If a duplicate read/list/size request is blocked because content is already available, do not retry that discovery step; continue directly to `decompose_project` from the existing context.",
			"Use workspace-relative paths such as `specification.md` and treat that file as the authoritative product specification.",
			"Do not invent replacement requirements or alternate input fields that are not in the specification or existing code.",
			"If a generated leaf uses `testFirst: true`, include a concrete `acceptanceTestPrompt`; otherwise set `testFirst: false`.",
			"Do not modify implementation files, do not use write tools outside !Klein planning artifacts, and do not implement product code yet.",
			"Continue autonomously through the planning workflow when the task can be completed with !Klein-managed tools.",
		]
			.filter((line): line is string => line !== null)
			.join("\n");
	}
	return [
		"First, inspect the codebase and produce a clear implementation plan only.",
		decompositionInstruction,
		"Do not modify implementation files, do not use write tools outside !Klein planning artifacts, and do not implement product code yet.",
		"Continue autonomously through the planning workflow when the task can be completed with !Klein-managed tools.",
		"If the task is unclear, ask the user what they want planned.",
	].join("\n");
}

/**
 * The work-card Planning/Refinement preamble (todo §5.B). A started WORK card (not a decompose/plan card, not a
 * home/chat session) lands in the Planning lane and runs a refinement pass BEFORE implementing: re-validate the card
 * against the current project state, pick the depth by what actually changed, then call `begin_implementation` to
 * advance to In Progress and build it (or `decompose_project` if it must be split). This keeps small models from
 * working an out-of-date plan; the explicit promotion tool is the robust transition against weak models.
 */
function buildNKleinRefinementSystemPrompt(): string {
	return [
		"This card is in the Planning / Refinement phase — its card sits in the Planning lane, not yet In Progress.",
		"Before writing any implementation, do a brief REFINEMENT pass: re-check this card against the CURRENT state of the project (what has been merged or changed since it was planned). Confirm the card's objective and its acceptance check still hold and are not already satisfied.",
		"Pick the refinement depth by what actually changed: if nothing relevant moved, a quick confirmation is enough; if the direction or merged work shifted, adjust your approach; if the card is badly out of date or too large to do as one card, call `decompose_project` to split it into smaller cards instead of building it.",
		"When the card is confirmed (or you have updated the plan) and ready to build, call the `begin_implementation` tool — that moves the card from Planning to In Progress. THEN implement it: make the changes the card calls for, run its acceptance check, and finish per the workflow.",
		"Do not edit implementation files before calling `begin_implementation`; you are still refining until then. Keep the refinement brief — do not dump a long analysis before acting.",
	].join("\n");
}

export function buildNKleinStartPromptParts(
	prompt: string,
	startInPlanMode?: boolean,
	isRefinableWorkCard?: boolean,
): NKleinStartPromptParts {
	return {
		userPrompt: prompt,
		systemPrompt: startInPlanMode
			? buildNKleinPlanningSystemPrompt(prompt, startInPlanMode)
			: isRefinableWorkCard
				? buildNKleinRefinementSystemPrompt()
				: null,
		systemWorkflowCommand: startInPlanMode ? "/kanban-decompose" : null,
	};
}

function appendSystemPrompt(baseSystemPrompt: string, systemPrompt: string | null): string {
	const trimmed = systemPrompt?.trim();
	return trimmed ? `${baseSystemPrompt}\n\n${trimmed}` : baseSystemPrompt;
}

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

function estimateKanbanToolSchemaTokens(toolPolicies?: NKleinSdkStartSessionInput["toolPolicies"]): number {
	if (!toolPolicies) {
		return 0;
	}
	const enabledToolNames = Object.entries(toolPolicies)
		.filter(([, policy]) => policy?.enabled !== false)
		.map(([toolName]) => toolName)
		.sort();
	if (enabledToolNames.length === 0) {
		return 0;
	}
	return countKanbanTextTokens(
		JSON.stringify({
			nativeSdkToolsEnabled: true,
			kanbanToolPolicies: enabledToolNames,
		}),
	);
}

export class InMemoryNKleinTaskSessionService implements NKleinTaskSessionService {
	private readonly pendingTurnCancelTaskIds = new Set<string>();
	private readonly providerIdByTaskId = new Map<string, string>();
	private readonly modelIdByTaskId = new Map<string, string>();
	private readonly endpointByTaskId = new Map<string, string | null>();
	private readonly contextWindowByTaskId = new Map<string, number | null>();
	private readonly systemPromptByTaskId = new Map<string, string>();
	private readonly toolSchemaTokensByTaskId = new Map<string, number>();
	private readonly launchConfigByTaskId = new Map<string, NKleinTaskRestartLaunchConfig>();
	private readonly modelRequestStartedAtByTaskId = new Map<string, number>();
	private readonly failureBackoffByTaskId = new Map<string, NKleinTaskFailureBackoffState>();
	/** Last terminal state already persisted to the durable run-summary store, to dedupe repeated emits. */
	private readonly lastRecordedRunStateByTaskId = new Map<string, TaskRunTerminalState>();
	/** Structured timeout reason for the next terminal run summary, set when a task is aborted on timeout. */
	private readonly pendingTimeoutReasonByTaskId = new Map<string, string>();
	private readonly pendingTimeoutSourceByTaskId = new Map<string, TaskRunTimeoutSource>();
	private readonly noDiffCheckpointByTaskId = new Map<string, NKleinTaskNoDiffState>();
	private readonly repeatedToolCallByTaskId = new Map<string, NKleinTaskRepeatedToolState>();
	private readonly repeatedFailureTargetByTaskId = new Map<string, NKleinTaskRepeatedFailureTargetState>();
	private readonly timeoutSettingsByTaskId = new Map<string, NKleinTaskTimeoutSettings>();
	private readonly timeoutHandlesByTaskId = new Map<string, Map<NKleinTaskTimeoutKind, NodeJS.Timeout>>();
	private readonly explicitDecompositionTaskIds = new Set<string>();
	private readonly decompositionStallNudger: DecompositionStallNudger;
	private readonly activeToolTaskIds = new Set<string>();
	private readonly sandboxRepoPathByTaskId = new Map<string, string>();
	private readonly sandboxBaseRefByTaskId = new Map<string, string>();
	private readonly finalizingSandboxReviewTaskIds = new Set<string>();
	private readonly taskResultBranchByTaskId = new Map<string, TaskResultBranch>();
	private readonly sessionRuntime: NKleinSessionRuntime;
	private readonly messageRepository: NKleinMessageRepository;
	private readonly watcherRegistry: NKleinWatcherRegistry;
	private readonly agentSandboxManager: AgentSandboxManager | null;
	private readonly pauseController: NKleinPauseController;
	private readonly onDecompositionApplied: NKleinDecompositionAppliedHandler | undefined;
	private readonly onCardPromoted: NKleinCardPromotedHandler | undefined;
	private readonly onFocusChainUpdated: ((taskId: string, chain: FocusChain) => void | Promise<void>) | undefined;
	private swarmGuardrails: RuntimeSwarmGuardrails;
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
		this.decompositionStallNudger = new DecompositionStallNudger(this.buildNudgerCallbacks());
	}

	private buildNudgerCallbacks(): DecompositionStallNudgerCallbacks {
		return {
			isExplicitDecompositionTask: (taskId) => this.explicitDecompositionTaskIds.has(taskId),
			getTaskSummary: (taskId) => this.messageRepository.getTaskEntry(taskId)?.summary ?? null,
			resolveProviderId: (taskId) => this.resolveProviderIdForTask(taskId),
			resolveModelId: (taskId) => this.modelIdByTaskId.get(taskId) ?? UNCONFIGURED_MODEL_ID,
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
		this.sandboxRepoPathByTaskId.set(request.taskId, projectRepoPath);
		this.sandboxBaseRefByTaskId.set(request.taskId, baseRef?.trim() || "HEAD");
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
		const cached = this.providerIdByTaskId.get(taskId);
		if (cached) {
			return cached;
		}
		// Fall back to the runtime's last-start-request for tasks rebound from persistence.
		const fromRuntime = this.sessionRuntime.getTaskProviderId(taskId);
		if (fromRuntime) {
			this.providerIdByTaskId.set(taskId, fromRuntime);
			return fromRuntime;
		}
		return UNCONFIGURED_PROVIDER_ID;
	}

	private cacheLaunchConfig(
		taskId: string,
		launchConfig: NKleinTaskRestartLaunchConfig,
	): NKleinTaskRestartLaunchConfig {
		const normalized: NKleinTaskRestartLaunchConfig = {
			providerId: launchConfig.providerId.trim().toLowerCase(),
			modelId: launchConfig.modelId.trim(),
			...(Object.hasOwn(launchConfig, "workspaceRoot")
				? { workspaceRoot: launchConfig.workspaceRoot?.trim() || null }
				: {}),
			...(Object.hasOwn(launchConfig, "filesLikelyTouched")
				? { filesLikelyTouched: launchConfig.filesLikelyTouched ?? null }
				: {}),
			...(Object.hasOwn(launchConfig, "apiKey") ? { apiKey: launchConfig.apiKey } : {}),
			...(Object.hasOwn(launchConfig, "baseUrl") ? { baseUrl: launchConfig.baseUrl?.trim() || null } : {}),
			...(Object.hasOwn(launchConfig, "reasoningEffort") ? { reasoningEffort: launchConfig.reasoningEffort } : {}),
			...(Object.hasOwn(launchConfig, "contextWindow") ? { contextWindow: launchConfig.contextWindow } : {}),
			...(Object.hasOwn(launchConfig, "maxAgentWritableFileLines")
				? { maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines }
				: {}),
			...(Object.hasOwn(launchConfig, "apiTimeoutMs") ? { apiTimeoutMs: launchConfig.apiTimeoutMs } : {}),
			...(Object.hasOwn(launchConfig, "turnTimeoutMs") ? { turnTimeoutMs: launchConfig.turnTimeoutMs } : {}),
		};
		this.launchConfigByTaskId.set(taskId, normalized);
		this.providerIdByTaskId.set(taskId, normalized.providerId);
		this.modelIdByTaskId.set(taskId, normalized.modelId);
		this.endpointByTaskId.set(taskId, normalized.baseUrl ?? null);
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

	private async startRuntimeTaskSessionFromLaunchConfig(input: {
		taskId: string;
		cwd: string;
		workspaceRoot?: string | null;
		prompt: string;
		initialMessages?: NKleinSdkPersistedMessage[];
		images?: RuntimeTaskImage[];
		mode?: RuntimeTaskSessionMode;
		launchConfig: NKleinTaskRestartLaunchConfig;
		systemPrompt?: string | null;
		contextScope?: "full" | "smart" | "minimal" | "custom";
		timeoutMode?: "normal" | "long" | "extended" | "unlimited";
		codeEmbeddingProvider?: NKleinCodeEmbeddingProvider;
		onReviewSubmitted?: NKleinReviewSubmittedHandler;
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
		let systemPrompt =
			input.systemPrompt?.trim() ||
			(await resolveNKleinSdkSystemPrompt({
				// Sandbox-aware working directory for the `<env>` block; never the host mount (AGENTS.md).
				cwd: resolveNKleinAgentPerceivedCwd(input.taskId, agentPerceivedCwd),
				providerId: launchConfig.providerId,
				rules: runtimeSetup.loadRules(),
			}));
		const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(input.taskId);
		if (appendedSystemPrompt) {
			systemPrompt = `${systemPrompt}\n\n${appendedSystemPrompt}`;
		}
		systemPrompt = `${systemPrompt}\n\n${buildKanbanEfficiencyRules({
			contextScope: input.contextScope ?? "smart",
			contextWindow: requestContextWindow,
			timeoutMode: input.timeoutMode ?? "normal",
			maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines ?? null,
		})}`;

		await this.waitUntilTaskResumed(input.taskId);
		this.markModelRequestStarted(input.taskId);
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
		const startResult = await this.sessionRuntime
			.startTaskSession({
				taskId: input.taskId,
				cwd: agentPerceivedCwd,
				workspaceRoot: input.workspaceRoot ?? launchConfig.workspaceRoot,
				prompt: input.prompt,
				initialMessages: input.initialMessages,
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
				...(sandboxExtraTools ? { extraTools: sandboxExtraTools } : {}),
				userInstructionService: runtimeSetup.userInstructionService,
				requestToolApproval: runtimeSetup.createToolApproval({
					taskId: input.taskId,
					contextWindow: requestContextWindow,
					maxAgentWritableFileLines: launchConfig.maxAgentWritableFileLines ?? null,
					filesLikelyTouched: launchConfig.filesLikelyTouched ?? null,
				}),
				toolPolicies: runtimeSetup.toolPolicies,
				onDecompositionApplied: this.onDecompositionApplied,
				onCardPromoted: isHomeAgentSessionId(input.taskId) ? undefined : this.onCardPromoted,
				onReviewSubmitted: input.onReviewSubmitted,
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
		const modelId = this.modelIdByTaskId.get(taskId) ?? UNCONFIGURED_MODEL_ID;
		const endpoint = this.endpointByTaskId.get(taskId) ?? null;
		// A local model host (LM Studio/Ollama) that crashed or unloaded its model won't recover by retrying the
		// dead endpoint; classify it so the task parks fast with reload guidance instead of storming a gone model.
		const localModelUnavailable =
			!creditLimitError &&
			isLocalProvider(providerId, endpoint) &&
			isLocalModelRuntimeUnavailableError(errorMessage);
		const failureFingerprint = `${context}:${errorMessage}`;
		const previousFailure = this.failureBackoffByTaskId.get(taskId);
		const consecutiveFailures = previousFailure?.fingerprint === failureFingerprint ? previousFailure.count + 1 : 1;
		const alreadyParked = previousFailure?.fingerprint === failureFingerprint && previousFailure.parked;
		if (alreadyParked) {
			return;
		}
		const parkThreshold = localModelUnavailable
			? NKLEIN_LOCAL_MODEL_UNAVAILABLE_PARK_THRESHOLD
			: NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD;
		const shouldPark = consecutiveFailures >= parkThreshold;
		const localModelUnavailableGuidance = localModelUnavailable
			? `Local model "${modelId}" on ${endpoint ?? "its endpoint"} became unavailable mid-run (crashed or unloaded — local hosts like LM Studio drop a model under memory pressure, which a reasoning model at a large context window on limited hardware can trigger). Reload the model in your local host, or pick a smaller / non-reasoning model or a smaller context window, then resume this task.`
			: null;
		this.failureBackoffByTaskId.set(taskId, {
			fingerprint: failureFingerprint,
			count: consecutiveFailures,
			parked: shouldPark,
		});
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
		recordSelfObservation({
			signal: "runtime_error",
			severity: "warning",
			message: `NKlein session recovery failed during ${input.operation}: ${errorMessage}`,
			taskId: input.taskId,
			providerId: this.resolveProviderIdForTask(input.taskId),
			modelId: this.modelIdByTaskId.get(input.taskId) ?? UNCONFIGURED_MODEL_ID,
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
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message:
				input.transition === "rebound_for_review"
					? "Lost session rebound for review."
					: "Lost session marked interrupted.",
			taskId: input.taskId,
			workspacePath: input.workspacePath ?? null,
			providerId: this.resolveProviderIdForTask(input.taskId),
			modelId: this.modelIdByTaskId.get(input.taskId) ?? UNCONFIGURED_MODEL_ID,
			metadata: {
				operation: "lost_session_recovery",
				transition: input.transition,
			},
		});
	}

	private clearTaskTimeout(taskId: string, kind: NKleinTaskTimeoutKind): void {
		const handles = this.timeoutHandlesByTaskId.get(taskId);
		const handle = handles?.get(kind);
		if (handle) {
			clearTimeout(handle);
			handles?.delete(kind);
		}
		if (handles?.size === 0) {
			this.timeoutHandlesByTaskId.delete(taskId);
		}
	}

	private clearTaskTimeouts(taskId: string): void {
		const handles = this.timeoutHandlesByTaskId.get(taskId);
		if (handles) {
			for (const handle of handles.values()) {
				clearTimeout(handle);
			}
		}
		this.timeoutHandlesByTaskId.delete(taskId);
		this.activeToolTaskIds.delete(taskId);
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
		this.clearTaskTimeout(taskId, kind);
		if (timeoutMs === null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			return;
		}
		const deadline = Date.now() + timeoutMs;
		const scheduleRemaining = (): void => {
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				void this.handleTaskTimeout(taskId, kind, timeoutMs);
				return;
			}
			const handle = setTimeout(scheduleRemaining, Math.min(remainingMs, MAX_NODE_TIMER_DELAY_MS));
			handle.unref();
			const handles = this.timeoutHandlesByTaskId.get(taskId) ?? new Map<NKleinTaskTimeoutKind, NodeJS.Timeout>();
			handles.set(kind, handle);
			this.timeoutHandlesByTaskId.set(taskId, handles);
		};
		scheduleRemaining();
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
		const timeoutLabel =
			kind === "stream" ? "stream inactivity" : kind === "tool" ? "tool execution" : "conversation";
		this.pendingTimeoutReasonByTaskId.set(taskId, `${timeoutLabel} timeout after ${Math.round(timeoutMs / 1000)}s`);
		const timeoutSettings = this.timeoutSettingsByTaskId.get(taskId);
		const timeoutSource =
			kind === "stream"
				? timeoutSettings?.streamTimeoutSource
				: kind === "tool"
					? timeoutSettings?.toolTimeoutSource
					: timeoutSettings?.conversationTimeoutSource;
		this.pendingTimeoutSourceByTaskId.set(taskId, timeoutSource ?? null);
		// follow-up-6 §3.5: a stream/tool inactivity timeout should leave a structured note on the card —
		// what the model was last doing, the last tool, whether any work was captured, and whether resuming is
		// safe — so a review caused by a stall is diagnosable instead of just "timeout after N seconds".
		const lastActivity = entry.summary.latestHookActivity?.activityText ?? null;
		const lastTool = entry.summary.latestHookActivity?.toolName ?? null;
		const changesCaptured = Boolean(entry.summary.latestTurnCheckpoint);
		const restartSafe = this.sessionRuntime.canRestartTaskSession(taskId);
		recordSelfObservation({
			signal: "budget_wall",
			severity: "warning",
			message: `!Klein ${timeoutLabel} timeout after ${Math.round(timeoutMs / 1000)} seconds`,
			taskId,
			workspacePath: entry.summary.workspacePath ?? null,
			providerId: this.resolveProviderIdForTask(taskId),
			modelId: this.modelIdByTaskId.get(taskId) ?? UNCONFIGURED_MODEL_ID,
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
				`!Klein ${timeoutLabel} timeout after ${Math.round(timeoutMs / 1000)} seconds` +
					` (last activity: ${lastActivity ?? "unknown"}${lastTool ? `, last tool: ${lastTool}` : ""};` +
					` workspace changes captured: ${changesCaptured ? "yes" : "no"};` +
					` resume safe: ${restartSafe ? "yes" : "no"})`,
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
			this.markModelRequestStarted(input.taskId);
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
				this.markModelRequestStarted(input.taskId);
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
			this.markModelRequestStarted(input.taskId);
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
		recordSelfObservation({
			signal: "context_overflow",
			severity: "warning",
			message: toErrorMessage(input.error),
			taskId: input.taskId,
			providerId: this.resolveProviderIdForTask(input.taskId),
			modelId: this.modelIdByTaskId.get(input.taskId) ?? UNCONFIGURED_MODEL_ID,
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
			this.markModelRequestStarted(input.taskId);
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

	private estimateNextPromptTokens(prompt: string, images?: RuntimeTaskImage[]): number {
		const promptTokens = countKanbanTextTokens(prompt.trim());
		const imageTokens = (images?.length ?? 0) * CONTEXT_BUDGET_IMAGE_OVERHEAD_TOKENS;
		return Math.max(
			CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS,
			promptTokens + imageTokens + CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS,
		);
	}

	private buildContextBudgetBreakdown(input: {
		systemPrompt?: string | null;
		toolSchemaTokens?: number | null;
		messages?: NKleinSdkPersistedMessage[] | null;
		prompt: string;
		images?: RuntimeTaskImage[];
		contextWindow: number;
	}): RuntimeContextBudgetBreakdown {
		const budgets = buildKanbanContextSafetyBudgets(input.contextWindow);
		const messages = input.messages ?? [];
		const systemPromptTokens = input.systemPrompt ? countKanbanTextTokens(input.systemPrompt) : 0;
		const toolSchemaTokens =
			typeof input.toolSchemaTokens === "number" && Number.isFinite(input.toolSchemaTokens)
				? Math.max(0, Math.trunc(input.toolSchemaTokens))
				: 0;
		const taskPromptTokens = this.estimateNextPromptTokens(input.prompt, input.images);
		const historySegments = classifyContextHistoryTokens(messages);
		const projectedTokens =
			systemPromptTokens +
			toolSchemaTokens +
			taskPromptTokens +
			historySegments.userMessageTokens +
			historySegments.includedFileContentTokens +
			historySegments.otherHistoryTokens +
			budgets.promptOverheadReserveTokens +
			budgets.outputReserveTokens;
		const usedWorkingTokens = Math.max(0, projectedTokens - budgets.outputReserveTokens);
		return {
			systemPromptTokens,
			toolSchemaTokens,
			taskPromptTokens,
			userMessageTokens: historySegments.userMessageTokens,
			includedFileContentTokens: historySegments.includedFileContentTokens,
			otherHistoryTokens: historySegments.otherHistoryTokens,
			reservedPromptOverheadTokens: budgets.promptOverheadReserveTokens,
			reservedOutputTokens: budgets.outputReserveTokens,
			usedWorkingTokens,
			freeWorkingTokens: Math.max(0, input.contextWindow - projectedTokens),
			effectiveContextWindow: input.contextWindow,
			projectedTokens,
		};
	}

	private normalizeEffectiveContextWindow(contextWindow: number): number {
		return Math.trunc(contextWindow);
	}

	private resolveContextWindowForTask(taskId: string, launchContextWindow?: number | null): number | null {
		if (typeof launchContextWindow === "number" && Number.isFinite(launchContextWindow) && launchContextWindow > 0) {
			const normalized = this.normalizeEffectiveContextWindow(launchContextWindow);
			this.contextWindowByTaskId.set(taskId, normalized);
			return normalized;
		}
		return this.contextWindowByTaskId.get(taskId) ?? null;
	}

	private resolveKnownContextWindowForTask(taskId: string, launchContextWindow?: number | null): number {
		const contextWindow =
			this.resolveContextWindowForTask(taskId, launchContextWindow) ?? DEFAULT_NKLEIN_CONTEXT_WINDOW_TOKENS;
		return this.normalizeEffectiveContextWindow(contextWindow);
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
		recordSelfObservation({
			signal: "context_overflow",
			severity: input.action === "blocked" ? "error" : "warning",
			message:
				input.action === "blocked"
					? `Pre-send context guard blocked an oversized prompt before provider dispatch (~${input.projectedTokens.toLocaleString()} projected tokens for ${input.contextWindow.toLocaleString()} available).`
					: `Pre-send context guard compacted history before provider dispatch (~${input.originalProjectedTokens.toLocaleString()} → ~${input.projectedTokens.toLocaleString()} projected tokens).`,
			taskId: input.taskId,
			providerId: this.resolveProviderIdForTask(input.taskId),
			modelId: this.modelIdByTaskId.get(input.taskId) ?? UNCONFIGURED_MODEL_ID,
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
		const messages = input.messages ?? [];
		const nextPromptTokens = this.estimateNextPromptTokens(input.prompt, input.images);
		const originalHistoryTokens = countKanbanPersistedMessagesTokens(messages);
		const originalProjectedTokens = originalHistoryTokens + nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
		const budgets = buildKanbanContextSafetyBudgets(input.contextWindow);
		const historyTargetTokens = Math.max(
			1,
			Math.min(
				budgets.safeWorkingBudget ?? input.contextWindow,
				input.contextWindow - nextPromptTokens - CONTEXT_BUDGET_SEND_RESERVE_TOKENS,
			),
		);
		const compactedMessages =
			messages.length > 0
				? (compactKanbanMessagesForContextTarget(messages, historyTargetTokens) ?? messages)
				: messages;
		const compactedHistoryTokens = countKanbanPersistedMessagesTokens(compactedMessages);
		const projectedTokens = compactedHistoryTokens + nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
		if (projectedTokens > input.contextWindow) {
			const promptOnlyProjectedTokens = nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
			const promptAloneOverflows = promptOnlyProjectedTokens > input.contextWindow;
			this.recordContextBudgetGuard({
				taskId: input.taskId,
				action: "blocked",
				contextWindow: input.contextWindow,
				originalProjectedTokens,
				projectedTokens,
				originalHistoryTokens,
				compactedHistoryTokens,
				nextPromptTokens,
			});
			if (promptAloneOverflows) {
				throw new Error(
					`Your message (~${nextPromptTokens.toLocaleString()} tokens) is larger than this model's ~${input.contextWindow.toLocaleString()} token working budget after reserving ${CONTEXT_BUDGET_SEND_RESERVE_TOKENS.toLocaleString()} tokens for the response. Shorten the message, ask !Klein to summarize pasted content first, or pick a larger-window local model.`,
				);
			}
			throw new Error(
				`Context would overflow the known ${input.contextWindow.toLocaleString()} token window after !Klein compaction (~${projectedTokens.toLocaleString()} projected tokens). Old read_files tool output was omitted; clear or summarize the task history before sending more input.`,
			);
		}
		if (compactedMessages !== messages || originalProjectedTokens > input.contextWindow) {
			this.recordContextBudgetGuard({
				taskId: input.taskId,
				action: "compacted",
				contextWindow: input.contextWindow,
				originalProjectedTokens,
				projectedTokens,
				originalHistoryTokens,
				compactedHistoryTokens,
				nextPromptTokens,
			});
		}
		return compactedMessages.length > 0 ? compactedMessages : undefined;
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
		const nextPromptTokens = this.estimateNextPromptTokens(input.prompt, input.images);
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
			this.markModelRequestStarted(input.taskId);
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
		this.providerIdByTaskId.set(request.taskId, providerId);
		this.noDiffCheckpointByTaskId.delete(request.taskId);
		this.repeatedToolCallByTaskId.delete(request.taskId);
		this.decompositionStallNudger.resetTask(request.taskId);
		if (request.startInPlanMode && isExplicitDecompositionPrompt(request.prompt)) {
			this.explicitDecompositionTaskIds.add(request.taskId);
		} else {
			this.explicitDecompositionTaskIds.delete(request.taskId);
		}
		const requestContextWindow = this.resolveKnownContextWindowForTask(request.taskId, request.contextWindow ?? null);
		const modelId = request.modelId?.trim() || UNCONFIGURED_MODEL_ID;
		this.modelIdByTaskId.set(request.taskId, modelId);
		const endpoint = request.baseUrl?.trim() || null;
		const sharedEndpointId = this.resolveSharedEndpointId({ providerId, modelId, endpoint });
		this.endpointByTaskId.set(request.taskId, endpoint);
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
				let systemPrompt =
					request.systemPrompt?.trim() ||
					(await resolveNKleinSdkSystemPrompt({
						// The system prompt's `<env>` "Working Directory" must match the agent's actual (sandbox) cwd,
						// never the host mount — agents must never see host details (AGENTS.md). Same helper as the
						// agent-core `config.cwd`, so the two can't drift (the bug that leaked the host path here).
						cwd: resolveNKleinAgentPerceivedCwd(request.taskId, request.cwd),
						providerId,
						rules: runtimeSetup.loadRules(),
					}));
				const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(request.taskId);
				if (appendedSystemPrompt) {
					systemPrompt = `${systemPrompt}\n\n${appendedSystemPrompt}`;
				}
				systemPrompt = appendSystemPrompt(systemPrompt, planningSystemPrompt);
				systemPrompt = `${systemPrompt}\n\n${buildKanbanEfficiencyRules({
					contextScope: request.contextScope ?? "smart",
					contextWindow: requestContextWindow,
					timeoutMode: request.timeoutMode ?? "normal",
					maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
				})}`;
				const toolSchemaTokens = estimateKanbanToolSchemaTokens(runtimeSetup.toolPolicies);
				this.systemPromptByTaskId.set(request.taskId, systemPrompt);
				this.toolSchemaTokensByTaskId.set(request.taskId, toolSchemaTokens);

				const initialMessages = this.prepareMessagesForKnownContextWindow({
					taskId: request.taskId,
					messages: persistedResumeSnapshot?.messages ?? request.initialMessages,
					prompt: runtimePrompt,
					images: request.images,
					contextWindow: requestContextWindow,
				});
				this.emitSummary(
					updateSummary(entry, {
						contextBudgetBreakdown: this.buildContextBudgetBreakdown({
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
				}
				await this.waitUntilTaskResumed(request.taskId);
				this.markModelRequestStarted(request.taskId);
				const startResult = await this.sessionRuntime.startTaskSession({
					taskId: request.taskId,
					cwd: agentPerceivedCwd,
					// Always hand the runtime a host workspace root so the trusted control-plane decomposition
					// tools resolve plan artifacts + board mutations to the host owning workspace, never to the
					// container workdir (agentPerceivedCwd points inside the sandbox volume when isolation is active).
					workspaceRoot: request.workspaceRoot ?? request.cwd,
					prompt: runtimePrompt,
					taskTitle: request.taskTitle,
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
					extraTools: sandboxWorkspace
						? createAgentSandboxExtraTools(sandboxWorkspace.manager, request.taskId, {
								sessionId: createSessionId(request.taskId),
								contextWindow: requestContextWindow,
								maxFileLines: request.maxAgentWritableFileLines ?? null,
							})
						: undefined,
					toolPolicies: runtimeSetup.toolPolicies,
					onDecompositionApplied: this.onDecompositionApplied,
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
				this.failureBackoffByTaskId.delete(request.taskId);
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
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.contextWindowByTaskId.delete(taskId);
		this.modelIdByTaskId.delete(taskId);
		this.endpointByTaskId.delete(taskId);
		this.launchConfigByTaskId.delete(taskId);
		this.modelRequestStartedAtByTaskId.delete(taskId);
		this.failureBackoffByTaskId.delete(taskId);
		this.noDiffCheckpointByTaskId.delete(taskId);
		this.repeatedToolCallByTaskId.delete(taskId);
		this.pauseController.abortTaskWaiters(taskId);
		this.pauseController.clearTaskParked(taskId);
		this.pauseController.setCardPaused(taskId, false);
		this.clearTaskTimeouts(taskId);
		this.decompositionStallNudger.resetTask(taskId);
		this.explicitDecompositionTaskIds.delete(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
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
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.contextWindowByTaskId.delete(taskId);
		this.modelIdByTaskId.delete(taskId);
		this.endpointByTaskId.delete(taskId);
		this.launchConfigByTaskId.delete(taskId);
		this.modelRequestStartedAtByTaskId.delete(taskId);
		this.failureBackoffByTaskId.delete(taskId);
		this.noDiffCheckpointByTaskId.delete(taskId);
		this.repeatedToolCallByTaskId.delete(taskId);
		this.pauseController.abortTaskWaiters(taskId);
		this.pauseController.clearTaskParked(taskId);
		this.pauseController.setCardPaused(taskId, false);
		this.clearTaskTimeouts(taskId);
		this.decompositionStallNudger.resetTask(taskId);
		this.explicitDecompositionTaskIds.delete(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
		await this.sessionRuntime.stopTaskSession(taskId).catch(() => null);
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
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.contextWindowByTaskId.delete(taskId);
		this.modelIdByTaskId.delete(taskId);
		this.endpointByTaskId.delete(taskId);
		this.modelRequestStartedAtByTaskId.delete(taskId);
		this.failureBackoffByTaskId.delete(taskId);
		this.noDiffCheckpointByTaskId.delete(taskId);
		this.repeatedToolCallByTaskId.delete(taskId);
		this.pauseController.abortTaskWaiters(taskId);
		this.pauseController.clearTaskParked(taskId);
		this.pauseController.setCardPaused(taskId, false);
		this.clearTaskTimeouts(taskId);
		this.decompositionStallNudger.resetTask(taskId);
		this.explicitDecompositionTaskIds.delete(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
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
		this.failureBackoffByTaskId.delete(taskId);
		this.repeatedToolCallByTaskId.delete(taskId);
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
			const runtimeSetupWorkspacePath =
				this.sandboxRepoPathByTaskId.get(taskId) ?? entry.summary.workspacePath ?? "";
			void this.ensureRuntimeSetup(runtimeSetupWorkspacePath)
				.then(async (runtimeSetup) => {
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
								contextBudgetBreakdown: this.buildContextBudgetBreakdown({
									systemPrompt: this.systemPromptByTaskId.get(taskId) ?? null,
									toolSchemaTokens: this.toolSchemaTokensByTaskId.get(taskId) ?? 0,
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
					const warningMessage = formatStartWarnings(warnings);
					this.failureBackoffByTaskId.delete(taskId);
					if (warningMessage) {
						this.emitSummary(
							updateSummary(entry, {
								warningMessage,
							}),
						);
					}
					const agentText = readAgentResultText(result);
					if (agentText) {
						const assistantCountAfterSend = entry.messages.filter(
							(message) => message.role === "assistant",
						).length;
						if (assistantCountAfterSend > assistantCountBeforeSend) {
							return;
						}
						const agentMessage =
							setOrCreateAssistantMessage(entry, taskId, agentText) ??
							createAssistantMessage(entry, taskId, agentText);
						this.emitMessage(taskId, agentMessage);
					}
				})
				.catch((error: unknown) => {
					this.emitTaskFailure(taskId, entry, "send", error);
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
			const failureFingerprint = `start:${toErrorMessage(error)}`;
			const previousFailure = this.failureBackoffByTaskId.get(taskId);
			if (!(previousFailure?.fingerprint === failureFingerprint && previousFailure.parked)) {
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

	async clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const existingEntry = this.messageRepository.getTaskEntry(taskId);
		this.pendingTurnCancelTaskIds.delete(taskId);
		this.providerIdByTaskId.delete(taskId);
		this.contextWindowByTaskId.delete(taskId);
		this.modelIdByTaskId.delete(taskId);
		this.endpointByTaskId.delete(taskId);
		this.launchConfigByTaskId.delete(taskId);
		this.modelRequestStartedAtByTaskId.delete(taskId);
		this.failureBackoffByTaskId.delete(taskId);
		this.noDiffCheckpointByTaskId.delete(taskId);
		this.repeatedToolCallByTaskId.delete(taskId);
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
			providerId: this.providerIdByTaskId.get(summary.taskId) ?? UNCONFIGURED_PROVIDER_ID,
			modelId: this.modelIdByTaskId.get(summary.taskId) ?? UNCONFIGURED_MODEL_ID,
			endpoint: this.endpointByTaskId.get(summary.taskId) ?? null,
		}));
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

	async waitUntilTaskResumed(taskId: string): Promise<void> {
		await this.pauseController.waitUntilResumed(taskId);
	}

	async verifyTaskAcceptanceInSandbox(input: {
		taskId: string;
		projectRepoPath: string;
		baseRef: string;
		taskPrompt: string;
		timeoutMs?: number;
	}): Promise<RuntimeTaskAcceptanceResult> {
		if (!this.agentSandboxManager) {
			throw new Error("!Klein acceptance verification requires the configured agent sandbox manager.");
		}
		return await runNKleinAcceptanceGateInSandbox({
			taskId: input.taskId,
			projectRepoPath: input.projectRepoPath,
			baseRef: input.baseRef,
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
		const workerLaunch = this.launchConfigByTaskId.get(input.taskId) ?? null;
		const providerId = (input.reviewer?.providerId ?? workerLaunch?.providerId ?? "").trim();
		const modelId = (input.reviewer?.modelId ?? workerLaunch?.modelId ?? "").trim();
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
		});
		this.sandboxRepoPathByTaskId.set(reviewTaskId, input.projectRepoPath);
		this.sandboxBaseRefByTaskId.set(reviewTaskId, (resultCommit ?? input.baseRef)?.trim() || "HEAD");
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
			this.providerIdByTaskId.delete(reviewTaskId);
			this.modelIdByTaskId.delete(reviewTaskId);
			this.endpointByTaskId.delete(reviewTaskId);
			this.sandboxRepoPathByTaskId.delete(reviewTaskId);
			this.sandboxBaseRefByTaskId.delete(reviewTaskId);
		}
	}

	async updateAgentSandboxPoolConfig(config: Partial<AgentSandboxPoolConfig>): Promise<void> {
		await this.agentSandboxManager?.updatePoolConfig(config);
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
		if (isHomeAgentSessionId(taskId)) {
			return null;
		}
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry || entry.summary.reviewReason === "attention") {
			return null;
		}
		if (this.pauseController.isPaused(taskId)) {
			return this.parkTaskForPause({
				taskId,
				entry,
				message: "Paused — will resume when the board/card is resumed.",
				metadata: {
					guardrail: "operator_pause",
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}
		if (checkpoint.turn >= this.swarmGuardrails.maxAutonomousTurnsPerTask) {
			return this.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${checkpoint.turn} autonomous turns so the swarm cannot run indefinitely. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "max_autonomous_turns",
					turn: checkpoint.turn,
					limit: this.swarmGuardrails.maxAutonomousTurnsPerTask,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}
		const noDiffState = this.recordNoDiffCheckpoint(taskId, checkpoint);
		if (noDiffState.count >= this.swarmGuardrails.maxRepeatedNoDiffCheckpoints) {
			return this.parkTaskForAutonomyBudget({
				taskId,
				entry,
				message: `!Klein paused this task after ${noDiffState.count} consecutive checkpoints produced no new diff commit. Review progress, then send a new instruction to continue.`,
				metadata: {
					guardrail: "repeated_no_diff_checkpoints",
					count: noDiffState.count,
					limit: this.swarmGuardrails.maxRepeatedNoDiffCheckpoints,
					turn: checkpoint.turn,
					checkpointRef: checkpoint.ref,
					checkpointCommit: checkpoint.commit,
				},
			});
		}
		const startedAt = entry.summary.startedAt;
		const elapsedMs =
			typeof startedAt === "number" && Number.isFinite(startedAt) && startedAt > 0 ? now() - startedAt : null;
		if (elapsedMs === null || elapsedMs < this.swarmGuardrails.maxAutonomousWallTimeMs) {
			return null;
		}
		return this.parkTaskForAutonomyBudget({
			taskId,
			entry,
			message: `!Klein paused this task after ${formatWallTimeDuration(elapsedMs)} of autonomous wall time so the swarm cannot run indefinitely. Review progress, then send a new instruction to continue.`,
			metadata: {
				guardrail: "max_autonomous_wall_time",
				elapsedMs,
				limitMs: this.swarmGuardrails.maxAutonomousWallTimeMs,
				turn: checkpoint.turn,
				checkpointRef: checkpoint.ref,
				checkpointCommit: checkpoint.commit,
			},
		});
	}

	private recordNoDiffCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): NKleinTaskNoDiffState {
		const commit = checkpoint.commit.trim();
		if (!commit) {
			this.noDiffCheckpointByTaskId.delete(taskId);
			return { commit: "", count: 0 };
		}
		const previous = this.noDiffCheckpointByTaskId.get(taskId);
		const nextState = previous?.commit === commit ? { commit, count: previous.count + 1 } : { commit, count: 1 };
		this.noDiffCheckpointByTaskId.set(taskId, nextState);
		return nextState;
	}

	private enforceRepeatedToolCallGuard(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary | null {
		if (isHomeAgentSessionId(summary.taskId) || summary.state !== "running") {
			return null;
		}
		const toolCall = this.readRepeatedToolCallCandidate(summary);
		if (!toolCall) {
			return null;
		}
		const previous = this.repeatedToolCallByTaskId.get(summary.taskId);
		const nextState: NKleinTaskRepeatedToolState =
			previous?.fingerprint === toolCall.fingerprint
				? {
						...toolCall,
						count: previous.count + 1,
					}
				: {
						...toolCall,
						count: 1,
					};
		this.repeatedToolCallByTaskId.set(summary.taskId, nextState);
		const repeatedToolCallLimit = getRepeatedToolCallLimit(
			nextState.toolName,
			this.swarmGuardrails.maxRepeatedToolCallsPerTask,
		);
		if (nextState.count < repeatedToolCallLimit) {
			return null;
		}
		const entry = this.messageRepository.getTaskEntry(summary.taskId);
		if (!entry || entry.summary.reviewReason === "attention") {
			return null;
		}
		return this.parkTaskForAutonomyBudget({
			taskId: summary.taskId,
			entry,
			message: formatRepeatedToolCallParkMessage(nextState),
			metadata: {
				guardrail: "repeated_tool_calls",
				count: nextState.count,
				limit: repeatedToolCallLimit,
				toolName: nextState.toolName,
				toolInputSummary: nextState.toolInputSummary,
			},
		});
	}

	private enforceRepeatedFailureTargetGuard(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary | null {
		if (isHomeAgentSessionId(summary.taskId) || summary.state !== "running") {
			return null;
		}
		const target = this.readRepeatedFailureTargetCandidate(summary);
		if (!target) {
			return null;
		}
		const previous = this.repeatedFailureTargetByTaskId.get(summary.taskId);
		const toolNames = Array.from(new Set([...(previous?.toolNames ?? []), target.toolName]));
		const nextState: NKleinTaskRepeatedFailureTargetState =
			previous?.fingerprint === target.fingerprint
				? {
						fingerprint: target.fingerprint,
						count: previous.count + 1,
						targetSummary: target.targetSummary,
						toolNames,
					}
				: {
						fingerprint: target.fingerprint,
						count: 1,
						targetSummary: target.targetSummary,
						toolNames: [target.toolName],
					};
		this.repeatedFailureTargetByTaskId.set(summary.taskId, nextState);
		if (nextState.count < NKLEIN_REPEATED_PLAN_ARTIFACT_FAILURE_THRESHOLD) {
			return null;
		}
		const entry = this.messageRepository.getTaskEntry(summary.taskId);
		if (!entry || entry.summary.reviewReason === "attention") {
			return null;
		}
		const toolNamesText = nextState.toolNames.join(", ");
		const isDecomposition = target.kind === "decomposition";
		const message = isDecomposition
			? `!Klein paused this task after ${nextState.count} decomposition attempts that kept failing graph validation. Open the proposed plan graph and the validation errors in the chat, then send a corrected instruction (or split the work into smaller cards) instead of re-running decompose_project.`
			: `!Klein paused this task after ${nextState.count} failed attempts to inspect the same plan artifact path (${nextState.targetSummary}) with ${toolNamesText}. Plan artifacts are trusted control-plane state; review progress, then continue from the generated cards instead of retrying sandbox file reads.`;
		return this.parkTaskForAutonomyBudget({
			taskId: summary.taskId,
			entry,
			message,
			metadata: {
				guardrail: isDecomposition ? "repeated_decomposition_failures" : "repeated_plan_artifact_failures",
				count: nextState.count,
				limit: NKLEIN_REPEATED_PLAN_ARTIFACT_FAILURE_THRESHOLD,
				targetSummary: nextState.targetSummary,
				toolNames: nextState.toolNames,
			},
		});
	}

	private readRepeatedToolCallCandidate(
		summary: RuntimeTaskSessionSummary,
	): Omit<NKleinTaskRepeatedToolState, "count"> | null {
		return computeRepeatedToolCallCandidate(summary.latestHookActivity);
	}

	private readRepeatedFailureTargetCandidate(summary: RuntimeTaskSessionSummary): {
		fingerprint: string;
		targetSummary: string;
		toolName: string;
		kind: "plan-artifact" | "decomposition";
	} | null {
		const activity = summary.latestHookActivity;
		if (activity?.source !== "nklein-sdk") {
			return null;
		}
		if (activity.hookEventName?.trim().toLowerCase() !== "tool_result") {
			return null;
		}
		if (!activity.activityText?.toLowerCase().startsWith("failed ")) {
			return null;
		}
		const toolName = activity.toolName?.trim();
		if (!toolName || isNKleinUserAttentionTool(toolName)) {
			return null;
		}
		const planArtifactTarget = normalizePlanArtifactFailureTarget(activity.toolInputSummary);
		if (planArtifactTarget) {
			return {
				fingerprint: `plan-artifact\n${planArtifactTarget}`,
				targetSummary: planArtifactTarget,
				toolName,
				kind: "plan-artifact",
			};
		}
		// A `decompose_project` that keeps failing graph validation: small models re-submit a slightly-varied graph
		// that fails the same coherence check, so the identical-full-input repeated-call guard never fires and the
		// task loops until it stalls (evidence: the DAW-foundation run). Fingerprint by the tool itself so the
		// consecutive validation failures accumulate and park the task for review — independent of the input churn.
		if (toolName === "decompose_project") {
			return {
				fingerprint: "decomposition\ndecompose_project",
				targetSummary: "the proposed decomposition graph",
				toolName,
				kind: "decomposition",
			};
		}
		return null;
	}

	private parkTaskForPause(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary {
		this.clearTaskTimeouts(input.taskId);
		this.noDiffCheckpointByTaskId.delete(input.taskId);
		this.repeatedToolCallByTaskId.delete(input.taskId);
		this.pauseController.markTaskParked(input.taskId);
		void this.sessionRuntime.abortTaskSession(input.taskId).catch(() => undefined);
		recordSelfObservation({
			signal: "custom",
			severity: "info",
			message: input.message,
			taskId: input.taskId,
			providerId: this.resolveProviderIdForTask(input.taskId),
			modelId: this.modelIdByTaskId.get(input.taskId) ?? UNCONFIGURED_MODEL_ID,
			metadata: input.metadata,
		});
		const systemMessage = createMessage(input.taskId, "system", input.message);
		input.entry.messages.push(systemMessage);
		this.emitMessage(input.taskId, systemMessage);
		clearActiveTurnState(input.entry);
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
		this.clearTaskTimeouts(input.taskId);
		this.noDiffCheckpointByTaskId.delete(input.taskId);
		this.repeatedToolCallByTaskId.delete(input.taskId);
		void this.sessionRuntime.abortTaskSession(input.taskId).catch(() => undefined);
		recordSelfObservation({
			signal: "budget_wall",
			severity: "warning",
			message: input.message,
			taskId: input.taskId,
			providerId: this.resolveProviderIdForTask(input.taskId),
			modelId: this.modelIdByTaskId.get(input.taskId) ?? UNCONFIGURED_MODEL_ID,
			metadata: input.metadata,
		});
		const systemMessage = createMessage(input.taskId, "system", input.message);
		input.entry.messages.push(systemMessage);
		this.emitMessage(input.taskId, systemMessage);
		clearActiveTurnState(input.entry);
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
		for (const taskId of this.timeoutHandlesByTaskId.keys()) {
			this.clearTaskTimeouts(taskId);
		}
		this.decompositionStallNudger.dispose();
		this.timeoutSettingsByTaskId.clear();
		await this.sessionRuntime.dispose();
		this.pendingTurnCancelTaskIds.clear();
		this.providerIdByTaskId.clear();
		this.contextWindowByTaskId.clear();
		this.modelIdByTaskId.clear();
		this.endpointByTaskId.clear();
		this.modelRequestStartedAtByTaskId.clear();
		this.noDiffCheckpointByTaskId.clear();
		this.repeatedToolCallByTaskId.clear();
		this.repeatedFailureTargetByTaskId.clear();
		this.explicitDecompositionTaskIds.clear();
		this.sandboxRepoPathByTaskId.clear();
		this.sandboxBaseRefByTaskId.clear();
		this.finalizingSandboxReviewTaskIds.clear();
		this.taskResultBranchByTaskId.clear();
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
		const guardedSummary =
			this.enforceRepeatedToolCallGuard(summary) ?? this.enforceRepeatedFailureTargetGuard(summary) ?? summary;
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
		const usage = summary.latestUsage ?? null;
		const promptTokens = usage?.inputTokens ?? null;
		const completionTokens = usage?.outputTokens ?? null;
		const timeoutReason = this.pendingTimeoutReasonByTaskId.get(taskId) ?? null;
		this.pendingTimeoutReasonByTaskId.delete(taskId);
		const timeoutSource = this.pendingTimeoutSourceByTaskId.get(taskId) ?? null;
		this.pendingTimeoutSourceByTaskId.delete(taskId);
		// Coarse role attribution (todo §5.C) for by-role timeout breakdowns — same resolution as the live summary
		// stamp (resolveNKleinTaskRole), so the run summary and the session summary agree.
		const role = resolveNKleinTaskRole(taskId, this.explicitDecompositionTaskIds.has(taskId));
		// Dev-test runs seed tasks as `devtest-<scenarioId>-<timestamp>` (see `nklein dev test-project`), so the
		// scenario is parseable from the id for by-scenario timeout breakdowns (§5.C/§5.O). Null for ordinary runs.
		const scenario = /^devtest-(.+)-\d+$/.exec(taskId)?.[1] ?? null;
		void recordTaskRunSummary({
			taskId,
			workspacePath: summary.workspacePath ?? null,
			state,
			reviewReason: summary.reviewReason ?? null,
			providerId: summary.providerId ?? this.resolveProviderIdForTask(taskId),
			modelId: summary.modelId ?? this.modelIdByTaskId.get(taskId) ?? null,
			endpoint: summary.endpoint ?? this.endpointByTaskId.get(taskId) ?? null,
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
		});
	}

	private forgetSandboxTask(taskId: string): void {
		this.sandboxRepoPathByTaskId.delete(taskId);
		this.sandboxBaseRefByTaskId.delete(taskId);
		this.finalizingSandboxReviewTaskIds.delete(taskId);
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

	private shouldCaptureReviewCheckpoint(
		previousSummary: RuntimeTaskSessionSummary,
		nextSummary: RuntimeTaskSessionSummary | null,
	): nextSummary is RuntimeTaskSessionSummary {
		if (!nextSummary) {
			return false;
		}
		if (isHomeAgentSessionId(nextSummary.taskId) || !nextSummary.workspacePath) {
			return false;
		}
		return previousSummary.state !== "awaiting_review" && nextSummary.state === "awaiting_review";
	}

	private shouldFinalizeSandboxReview(
		previousSummary: RuntimeTaskSessionSummary,
		nextSummary: RuntimeTaskSessionSummary | null,
	): nextSummary is RuntimeTaskSessionSummary {
		if (!nextSummary || previousSummary.state === "awaiting_review" || nextSummary.state !== "awaiting_review") {
			return false;
		}
		if (isHomeAgentSessionId(nextSummary.taskId) || this.finalizingSandboxReviewTaskIds.has(nextSummary.taskId)) {
			return false;
		}
		return Boolean(
			this.agentSandboxManager &&
				this.sandboxRepoPathByTaskId.has(nextSummary.taskId) &&
				this.sandboxBaseRefByTaskId.has(nextSummary.taskId),
		);
	}

	private finalizeSandboxReview(taskId: string): void {
		const manager = this.agentSandboxManager;
		const repoPath = this.sandboxRepoPathByTaskId.get(taskId);
		const baseRef = this.sandboxBaseRefByTaskId.get(taskId);
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!manager || !repoPath || !baseRef || !entry || this.finalizingSandboxReviewTaskIds.has(taskId)) {
			return;
		}
		this.finalizingSandboxReviewTaskIds.add(taskId);
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
					this.taskResultBranchByTaskId.set(taskId, branch);
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
				}
				await manager.disposeWorkspace(taskId);
				this.forgetSandboxTask(taskId);
			} catch (error) {
				this.finalizingSandboxReviewTaskIds.delete(taskId);
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
					if (hasWorkspace) {
						await manager.disposeWorkspace(taskId).catch(() => null);
					}
					this.forgetSandboxTask(taskId);
					return;
				}
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
		} else if (this.shouldCaptureReviewCheckpoint(previousSummary, latestSummary)) {
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
				providerId: this.resolveProviderIdForTask(taskId),
				modelId: this.modelIdByTaskId.get(taskId) ?? UNCONFIGURED_MODEL_ID,
				endpoint: this.endpointByTaskId.get(taskId) ?? null,
				contextWindow: this.resolveKnownContextWindowForTask(taskId, null),
			},
			observedAt,
			this.resolveModelRequestWallTimeMs(taskId, observedAt),
		);
		if (!observation) {
			return;
		}
		this.modelRequestStartedAtByTaskId.delete(taskId);
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

	private resolveSharedEndpointId(input: {
		providerId: string;
		modelId: string;
		endpoint: string | null;
	}): string | null {
		if (!isLocalProvider(input.providerId, input.endpoint)) {
			return null;
		}
		const endpoint = input.endpoint ?? `${input.providerId}:default`;
		const modelId = input.modelId.trim();
		return modelId.length > 0 ? `${endpoint}#${modelId}` : endpoint;
	}

	private markModelRequestStarted(taskId: string): void {
		this.modelRequestStartedAtByTaskId.set(taskId, now());
	}

	private resolveModelRequestWallTimeMs(taskId: string, observedAt: number): number | null {
		const startedAt = this.modelRequestStartedAtByTaskId.get(taskId);
		if (typeof startedAt !== "number") {
			return null;
		}
		const elapsed = observedAt - startedAt;
		return elapsed > 0 ? elapsed : null;
	}

	private recordSdkEventObservation(taskId: string, event: unknown): void {
		const agentEvent = readSdkAgentEvent(event);
		if (!agentEvent || (agentEvent.type !== "error" && agentEvent.type !== "run-failed")) {
			return;
		}
		const rawMessage = typeof agentEvent.message === "string" ? agentEvent.message : null;
		const errorMessage = toErrorMessage(agentEvent.error ?? rawMessage);
		recordSelfObservation({
			signal:
				this.isNKleinProviderForTask(taskId) && isCreditLimitError(errorMessage)
					? "provider_error"
					: "runtime_error",
			severity: "error",
			message: errorMessage,
			taskId,
			providerId: this.resolveProviderIdForTask(taskId),
			modelId: this.modelIdByTaskId.get(taskId) ?? UNCONFIGURED_MODEL_ID,
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
