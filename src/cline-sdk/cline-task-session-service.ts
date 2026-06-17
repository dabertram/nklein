// Task-oriented facade for native Cline sessions.
// runtime-api.ts uses this service to start sessions, send messages, load
// history, and subscribe to summaries and chat events without knowing SDK
// host, repository, or event-adapter details.

import { normalizeMaxAgentWritableFileLines } from "../core/agent-write-guard";
import type {
	RuntimeClineReasoningEffort,
	RuntimeTaskImage,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { resolveHomeAgentAppendSystemPrompt } from "../prompts/append-system-prompt";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import { captureTaskTurnCheckpoint, deleteTaskTurnCheckpointRef } from "../workspace/turn-checkpoints";
import { buildKanbanContextSafetyBudgets, countKanbanTextTokens } from "./cline-context-budgets";
import {
	compactKanbanMessagesForContextTarget,
	countKanbanPersistedMessagesTokens,
} from "./cline-context-focus-policy";
import {
	compactPersistedMessagesForContextOverflow,
	isContextOverflowError,
} from "./cline-context-overflow-compaction";
import { applyClineSessionEvent } from "./cline-event-adapter";
import {
	type ClineMessageRepository,
	createInMemoryClineMessageRepository,
	createTaskEntryFromPersistedSession,
} from "./cline-message-repository";
import { extractClineModelRegistryObservationFromEvent, getDefaultClineModelRegistry } from "./cline-model-registry";
import { type ClineRuntimeSetup, createClineRuntimeSetup } from "./cline-runtime-setup";
import {
	type ClineSessionRuntime,
	type CreateInMemoryClineSessionRuntimeOptions,
	createInMemoryClineSessionRuntime,
} from "./cline-session-runtime";
import {
	type ClineTaskMessage,
	type ClineTaskSessionEntry,
	clearActiveTurnState,
	cloneSummary,
	createAssistantMessage,
	createDefaultSummary,
	createMessage,
	isCreditLimitError,
	now,
	setOrCreateAssistantMessage,
	updateSummary,
} from "./cline-session-state";
import {
	type ClineRuntimeSetupLease,
	type ClineWatcherRegistry,
	createClineWatcherRegistry,
} from "./cline-watcher-registry";
import { SDK_DEFAULT_MODEL_ID, SDK_DEFAULT_PROVIDER_ID } from "./sdk-provider-boundary";
import {
	type ClineSdkPersistedMessage,
	type ClineSdkSlashCommand,
	listClineSdkWorkflowSlashCommands,
	resolveClineSdkSystemPrompt,
} from "./sdk-runtime-boundary.js";

export type { KanbanContextSafetyBudgets } from "./cline-context-budgets";
export { buildKanbanContextSafetyBudgets } from "./cline-context-budgets";
export type { ClineTaskMessage } from "./cline-session-state";

const DEFAULT_CLINE_CONTEXT_WINDOW_TOKENS = 80_000;
const CONTEXT_BUDGET_WARNING_RATIO = 0.8;
const CONTEXT_BUDGET_COMPACT_RATIO = 0.92;
const CONTEXT_BUDGET_SEND_RESERVE_TOKENS = 2_000;
const CONTEXT_BUDGET_IMAGE_OVERHEAD_TOKENS = 1_200;
const CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS = 1_200;
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;
type ClineTaskTimeoutKind = "stream" | "tool" | "conversation";

interface ClineTaskTimeoutSettings {
	streamTimeoutMs: number | null;
	toolTimeoutMs: number | null;
	conversationTimeoutMs: number | null;
}

export interface StartClineTaskSessionRequest {
	taskId: string;
	cwd: string;
	prompt: string;
	startInPlanMode?: boolean;
	/** Normalized Kanban task title; written to SDK session metadata (best-effort). */
	taskTitle?: string;
	initialMessages?: ClineSdkPersistedMessage[];
	images?: RuntimeTaskImage[];
	resumeFromTrash?: boolean;
	resumeFromPersistence?: boolean;
	providerId?: string | null;
	modelId?: string | null;
	mode?: RuntimeTaskSessionMode;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeClineReasoningEffort | null;
	contextScope?: "full" | "smart" | "minimal" | "custom";
	contextWindow?: number | null;
	timeoutMode?: "normal" | "long" | "extended" | "unlimited";
	requestTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
	streamTimeoutMs?: number | null;
	toolTimeoutMs?: number | null;
	conversationTimeoutMs?: number | null;
	maxAgentWritableFileLines?: number | null;
	systemPrompt?: string | null;
}

export interface ClineTaskLaunchConfigOverrides {
	providerId: string;
	modelId: string;
	apiKey?: string | null;
	baseUrl?: string | null;
	reasoningEffort?: RuntimeClineReasoningEffort | null;
	contextWindow?: number | null;
	apiTimeoutMs?: number | null;
	turnTimeoutMs?: number | null;
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
		"# Kanban Efficiency Rules",
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
		"Do not restart a file you have already covered. When a Kanban context-focus brief or coverage ledger reports ranges read through line N, resume at N+1 and never re-read 1..N from line 1.",
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

export interface ClineTaskSessionService {
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void;
	onMessage(listener: (taskId: string, message: ClineTaskMessage) => void): () => void;
	startTaskSession(request: StartClineTaskSessionRequest): Promise<RuntimeTaskSessionSummary>;
	stopTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	abortTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	cancelTaskTurn(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	sendTaskSessionInput(
		taskId: string,
		text: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		launchConfigOverrides?: ClineTaskLaunchConfigOverrides,
	): Promise<RuntimeTaskSessionSummary | null>;
	reloadTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	rebindPersistedTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	getSummary(taskId: string): RuntimeTaskSessionSummary | null;
	listSummaries(): RuntimeTaskSessionSummary[];
	listMessages(taskId: string): ClineTaskMessage[];
	listSlashCommands(workspacePath: string): Promise<ClineSdkSlashCommand[]>;
	loadTaskSessionMessages(taskId: string): Promise<ClineTaskMessage[]>;
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	dispose(): Promise<void>;
}

export interface CreateInMemoryClineTaskSessionServiceOptions {
	createSessionRuntime?: (options: CreateInMemoryClineSessionRuntimeOptions) => ClineSessionRuntime;
	createMessageRepository?: () => ClineMessageRepository;
	createRuntimeSetup?: (workspacePath: string) => Promise<ClineRuntimeSetup>;
	watcherRegistry?: ClineWatcherRegistry;
}

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

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readSdkAgentEvent(event: unknown): Record<string, unknown> | null {
	const record = asRecord(event);
	if (record?.type !== "agent_event") {
		return null;
	}
	const payload = asRecord(record.payload);
	return asRecord(payload?.event);
}

function readAgentResultText(result: unknown): string | null {
	if (!result || typeof result !== "object") {
		return null;
	}
	if (!("text" in result)) {
		return null;
	}
	const text = result.text;
	if (typeof text !== "string") {
		return null;
	}
	const normalized = text.trim();
	return normalized.length > 0 ? normalized : null;
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

function buildClineStartPrompt(prompt: string, startInPlanMode?: boolean): string {
	if (!startInPlanMode) {
		return prompt;
	}
	const trimmedPrompt = prompt.trim();
	return [
		"First, inspect the codebase and produce a clear implementation plan only.",
		"Do not modify files, do not use write tools, and do not implement anything yet.",
		"After you present the plan, ask for approval before making changes.",
		trimmedPrompt ? `\n\nTask:\n${trimmedPrompt}` : " Ask the user what they want planned if the task is unclear.",
	].join(" ");
}
export class InMemoryClineTaskSessionService implements ClineTaskSessionService {
	private readonly pendingTurnCancelTaskIds = new Set<string>();
	private readonly providerIdByTaskId = new Map<string, string>();
	private readonly modelIdByTaskId = new Map<string, string>();
	private readonly endpointByTaskId = new Map<string, string | null>();
	private readonly contextWindowByTaskId = new Map<string, number | null>();
	private readonly timeoutSettingsByTaskId = new Map<string, ClineTaskTimeoutSettings>();
	private readonly timeoutHandlesByTaskId = new Map<string, Map<ClineTaskTimeoutKind, NodeJS.Timeout>>();
	private readonly activeToolTaskIds = new Set<string>();
	private readonly sessionRuntime: ClineSessionRuntime;
	private readonly messageRepository: ClineMessageRepository;
	private readonly watcherRegistry: ClineWatcherRegistry;
	private readonly runtimeSetupLeaseByWorkspacePath = new Map<string, Promise<ClineRuntimeSetupLease>>();

	constructor(options: CreateInMemoryClineTaskSessionServiceOptions = {}) {
		const createSessionRuntime = options.createSessionRuntime ?? createInMemoryClineSessionRuntime;
		const createMessageRepository = options.createMessageRepository ?? createInMemoryClineMessageRepository;
		this.watcherRegistry =
			options.watcherRegistry ??
			createClineWatcherRegistry({
				createRuntimeSetup: options.createRuntimeSetup ?? createClineRuntimeSetup,
			});
		this.sessionRuntime = createSessionRuntime({
			onTaskEvent: (taskId: string, event: unknown) => {
				this.handleTaskEvent(taskId, event);
			},
		});
		this.messageRepository = createMessageRepository();
	}

	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		return this.messageRepository.onSummary(listener);
	}

	onMessage(listener: (taskId: string, message: ClineTaskMessage) => void): () => void {
		return this.messageRepository.onMessage(listener);
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
		return SDK_DEFAULT_PROVIDER_ID;
	}

	private isClineProviderForTask(taskId: string): boolean {
		return this.resolveProviderIdForTask(taskId) === "cline";
	}

	private emitTaskFailure(
		taskId: string,
		entry: ClineTaskSessionEntry,
		context: "start" | "send",
		error: unknown,
	): void {
		this.clearTaskTimeout(taskId, "stream");
		this.clearTaskTimeout(taskId, "tool");
		this.clearTaskTimeout(taskId, "conversation");
		this.activeToolTaskIds.delete(taskId);
		const errorMessage = toErrorMessage(error);
		const creditLimitError = this.isClineProviderForTask(taskId) && isCreditLimitError(errorMessage);
		recordSelfObservation({
			signal: creditLimitError ? "provider_error" : "runtime_error",
			severity: "error",
			message: `Cline SDK ${context} failed: ${errorMessage}`,
			taskId,
			providerId: this.resolveProviderIdForTask(taskId),
			modelId: this.modelIdByTaskId.get(taskId) ?? SDK_DEFAULT_MODEL_ID,
			metadata: {
				context,
				creditLimitError,
			},
		});
		if (!creditLimitError) {
			const systemMessage = createMessage(
				taskId,
				"system",
				`Cline SDK ${context} failed: ${errorMessage}. You can send another message to continue the conversation.`,
			);
			entry.messages.push(systemMessage);
			this.emitMessage(taskId, systemMessage);
		}
		clearActiveTurnState(entry);
		const errorSummary = updateSummary(entry, {
			state: "awaiting_review",
			reviewReason: "error",
			lastOutputAt: now(),
			lastHookAt: now(),
			warningMessage: creditLimitError ? null : errorMessage,
			latestHookActivity: {
				activityText: `${context === "start" ? "Start" : "Send"} failed: ${errorMessage}`,
				toolName: null,
				toolInputSummary: null,
				finalMessage: errorMessage,
				hookEventName: "agent_error",
				notificationType: creditLimitError ? "credit_limit" : null,
				source: "cline-sdk",
			},
		});
		this.emitSummary(errorSummary);
	}

	private clearTaskTimeout(taskId: string, kind: ClineTaskTimeoutKind): void {
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

	private scheduleTaskTimeout(taskId: string, kind: ClineTaskTimeoutKind, timeoutMs: number | null): void {
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
			const handles = this.timeoutHandlesByTaskId.get(taskId) ?? new Map<ClineTaskTimeoutKind, NodeJS.Timeout>();
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

	private async handleTaskTimeout(taskId: string, kind: ClineTaskTimeoutKind, timeoutMs: number): Promise<void> {
		this.clearTaskTimeout(taskId, kind);
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (entry?.summary.state !== "running") {
			return;
		}
		this.clearTaskTimeouts(taskId);
		await this.sessionRuntime.abortTaskSession(taskId).catch(() => undefined);
		const timeoutLabel =
			kind === "stream" ? "stream inactivity" : kind === "tool" ? "tool execution" : "conversation";
		this.emitTaskFailure(
			taskId,
			entry,
			"send",
			new Error(`Cline ${timeoutLabel} timeout after ${Math.round(timeoutMs / 1000)} seconds`),
		);
	}

	private async dispatchResolvedTaskInput(input: {
		taskId: string;
		prompt: string;
		mode?: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		delivery?: "queue" | "steer";
		launchConfigOverrides?: ClineTaskLaunchConfigOverrides;
	}): Promise<{
		result: unknown;
		warnings?: string[];
	}> {
		if (
			this.sessionRuntime.getTaskSessionId(input.taskId) &&
			!this.sessionRuntime.requiresTaskSessionRestart(input.taskId, input.mode, input.launchConfigOverrides)
		) {
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
			const contextWindow = this.resolveKnownContextWindowForTask(
				input.taskId,
				input.launchConfigOverrides?.contextWindow,
			);
			const initialMessages = this.prepareMessagesForKnownContextWindow({
				messages: persistedSnapshot?.messages,
				prompt: input.prompt,
				images: input.images,
				contextWindow,
			});
			await this.sessionRuntime.stopTaskSession(input.taskId);
			const restartedSession = await this.sessionRuntime.restartTaskSession({
				taskId: input.taskId,
				prompt: input.prompt,
				mode: input.mode,
				images: input.images,
				initialMessages,
				launchConfigOverrides: input.launchConfigOverrides,
			});
			if (input.launchConfigOverrides) {
				this.providerIdByTaskId.set(input.taskId, input.launchConfigOverrides.providerId.trim().toLowerCase());
			}
			return {
				result: restartedSession.result,
				warnings: restartedSession.warnings,
			};
		}

		if (isHomeAgentSessionId(input.taskId) && !this.sessionRuntime.canRestartTaskSession(input.taskId)) {
			throw new Error(`No previous Cline session config is available for task ${input.taskId}.`);
		}

		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId);
		const contextWindow = this.resolveKnownContextWindowForTask(
			input.taskId,
			input.launchConfigOverrides?.contextWindow,
		);
		const initialMessages = this.prepareMessagesForKnownContextWindow({
			messages: persistedSnapshot?.messages,
			prompt: input.prompt,
			images: input.images,
			contextWindow,
		});
		const restartedSession = await this.sessionRuntime.restartTaskSession({
			taskId: input.taskId,
			prompt: input.prompt,
			mode: input.mode,
			images: input.images,
			initialMessages,
			launchConfigOverrides: input.launchConfigOverrides,
		});
		return {
			result: restartedSession.result,
			warnings: restartedSession.warnings,
		};
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
			modelId: this.modelIdByTaskId.get(input.taskId) ?? SDK_DEFAULT_MODEL_ID,
			metadata: {
				mode: input.mode,
			},
		});

		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId).catch(() => null);
		const compactedMessages = compactPersistedMessagesForContextOverflow(persistedSnapshot?.messages ?? []);
		if (!compactedMessages) {
			return null;
		}

		await this.sessionRuntime.stopTaskSession(input.taskId).catch(() => null);
		const restartedSession = await this.sessionRuntime.restartTaskSession({
			taskId: input.taskId,
			prompt: input.prompt,
			mode: input.mode,
			images: input.images,
			initialMessages: compactedMessages,
		});
		return {
			result: restartedSession.result,
			warnings: restartedSession.warnings,
		};
	}

	private estimateNextPromptTokens(prompt: string, images?: RuntimeTaskImage[]): number {
		const promptTokens = countKanbanTextTokens(prompt.trim());
		const imageTokens = (images?.length ?? 0) * CONTEXT_BUDGET_IMAGE_OVERHEAD_TOKENS;
		return Math.max(
			CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS,
			promptTokens + imageTokens + CONTEXT_BUDGET_PROMPT_OVERHEAD_TOKENS,
		);
	}

	private resolveContextWindowForTask(taskId: string, launchContextWindow?: number | null): number | null {
		if (typeof launchContextWindow === "number" && Number.isFinite(launchContextWindow) && launchContextWindow > 0) {
			const normalized = Math.trunc(launchContextWindow);
			this.contextWindowByTaskId.set(taskId, normalized);
			return normalized;
		}
		return this.contextWindowByTaskId.get(taskId) ?? null;
	}

	private resolveKnownContextWindowForTask(taskId: string, launchContextWindow?: number | null): number {
		return this.resolveContextWindowForTask(taskId, launchContextWindow) ?? DEFAULT_CLINE_CONTEXT_WINDOW_TOKENS;
	}

	private prepareMessagesForKnownContextWindow(input: {
		messages?: ClineSdkPersistedMessage[] | null;
		prompt: string;
		images?: RuntimeTaskImage[];
		contextWindow: number;
	}): ClineSdkPersistedMessage[] | undefined {
		const messages = input.messages ?? [];
		if (messages.length === 0) {
			return undefined;
		}

		const nextPromptTokens = this.estimateNextPromptTokens(input.prompt, input.images);
		const budgets = buildKanbanContextSafetyBudgets(input.contextWindow);
		const historyTargetTokens = Math.max(
			1,
			Math.min(
				budgets.safeWorkingBudget ?? input.contextWindow,
				input.contextWindow - nextPromptTokens - CONTEXT_BUDGET_SEND_RESERVE_TOKENS,
			),
		);
		const compactedMessages = compactKanbanMessagesForContextTarget(messages, historyTargetTokens) ?? messages;
		const projectedTokens =
			countKanbanPersistedMessagesTokens(compactedMessages) + nextPromptTokens + CONTEXT_BUDGET_SEND_RESERVE_TOKENS;
		if (projectedTokens > input.contextWindow) {
			throw new Error(
				`Context would overflow the known ${input.contextWindow.toLocaleString()} token window after Kanban compaction (~${projectedTokens.toLocaleString()} projected tokens). Old read_files tool output was omitted; clear or summarize the task history before sending more input.`,
			);
		}
		return compactedMessages;
	}

	private async maybeCompactBeforeContextOverflow(input: {
		taskId: string;
		entry: ClineTaskSessionEntry;
		prompt: string;
		mode: RuntimeTaskSessionMode;
		images?: RuntimeTaskImage[];
		launchConfigOverrides?: ClineTaskLaunchConfigOverrides;
		contextWindow: number;
	}): Promise<{ result: unknown; warnings?: string[] } | null> {
		const nextPromptTokens = this.estimateNextPromptTokens(input.prompt, input.images);
		const persistedSnapshot = await this.sessionRuntime.readPersistedTaskSession(input.taskId).catch(() => null);
		const compactedMessages = this.prepareMessagesForKnownContextWindow({
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
		const restartedSession = await this.sessionRuntime.restartTaskSession({
			taskId: input.taskId,
			prompt: input.prompt,
			mode: input.mode,
			images: input.images,
			initialMessages: compactedMessages,
			launchConfigOverrides: input.launchConfigOverrides,
		});
		return {
			result: restartedSession.result,
			warnings: restartedSession.warnings,
		};
	}

	async startTaskSession(request: StartClineTaskSessionRequest): Promise<RuntimeTaskSessionSummary> {
		const existing = this.messageRepository.getTaskEntry(request.taskId);
		if (
			!request.resumeFromTrash &&
			!request.resumeFromPersistence &&
			existing &&
			(existing.summary.state === "running" || existing.summary.state === "awaiting_review")
		) {
			return cloneSummary(existing.summary);
		}

		const providerId = request.providerId?.trim().toLowerCase() || SDK_DEFAULT_PROVIDER_ID;
		this.providerIdByTaskId.set(request.taskId, providerId);
		const requestContextWindow = this.resolveKnownContextWindowForTask(request.taskId, request.contextWindow ?? null);
		const modelId = request.modelId?.trim() || SDK_DEFAULT_MODEL_ID;
		this.modelIdByTaskId.set(request.taskId, modelId);
		this.endpointByTaskId.set(request.taskId, request.baseUrl?.trim() || null);
		const resolvedMode: RuntimeTaskSessionMode = request.startInPlanMode ? "act" : (request.mode ?? "act");
		const normalizedPrompt = request.prompt.trim();
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
						startedAt: now(),
						lastOutputAt: now(),
						reviewReason: initialReviewReason,
					},
					messages: [],
					activeAssistantMessageId: null,
					activeReasoningMessageId: null,
					toolMessageIdByToolCallId: new Map<string, string>(),
					toolInputByToolCallId: new Map<string, unknown>(),
				} satisfies ClineTaskSessionEntry);
		this.messageRepository.setTaskEntry(request.taskId, entry);
		this.pendingTurnCancelTaskIds.delete(request.taskId);
		this.clearTaskTimeouts(request.taskId);
		this.timeoutSettingsByTaskId.set(request.taskId, {
			streamTimeoutMs: request.streamTimeoutMs ?? null,
			toolTimeoutMs: request.toolTimeoutMs ?? null,
			conversationTimeoutMs: request.conversationTimeoutMs ?? null,
		});

		if (!request.resumeFromTrash && (normalizedPrompt.length > 0 || hasRequestImages)) {
			const message = createMessage(request.taskId, "user", normalizedPrompt, request.images);
			entry.messages.push(message);
			this.emitMessage(request.taskId, message);
			const runningSummary = updateSummary(entry, {
				state: "running",
				reviewReason: null,
				lastOutputAt: now(),
				lastHookAt: now(),
				lastTokenAt: null,
				latestHookActivity: {
					activityText: "Agent active",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "turn_start",
					notificationType: null,
					source: "cline-sdk",
				},
			});
			this.emitSummary(runningSummary);
		}
		this.emitSummary(entry.summary);

		void (async () => {
			const assistantCountBeforeStart = entry.messages.filter((message) => message.role === "assistant").length;
			try {
				const runtimeSetup = await this.ensureRuntimeSetup(request.cwd);
				const runtimePrompt = runtimeSetup.resolvePrompt(
					buildClineStartPrompt(request.prompt, request.startInPlanMode),
				);
				let systemPrompt =
					request.systemPrompt?.trim() ||
					(await resolveClineSdkSystemPrompt({
						cwd: request.cwd,
						providerId,
						rules: runtimeSetup.loadRules(),
					}));
				const appendedSystemPrompt = resolveHomeAgentAppendSystemPrompt(request.taskId);
				if (appendedSystemPrompt) {
					systemPrompt = `${systemPrompt}\n\n${appendedSystemPrompt}`;
				}
				systemPrompt = `${systemPrompt}\n\n${buildKanbanEfficiencyRules({
					contextScope: request.contextScope ?? "smart",
					contextWindow: request.contextWindow ?? null,
					timeoutMode: request.timeoutMode ?? "normal",
					maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
				})}`;

				const initialMessages = this.prepareMessagesForKnownContextWindow({
					messages: persistedResumeSnapshot?.messages ?? request.initialMessages,
					prompt: runtimePrompt,
					images: request.images,
					contextWindow: requestContextWindow,
				});
				if (entry.summary.state === "running") {
					this.scheduleStreamTimeout(request.taskId);
					this.scheduleConversationTimeout(request.taskId);
				}
				const startResult = await this.sessionRuntime.startTaskSession({
					taskId: request.taskId,
					cwd: request.cwd,
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
					contextWindow: request.contextWindow,
					apiTimeoutMs: request.requestTimeoutMs,
					turnTimeoutMs: request.turnTimeoutMs,
					systemPrompt,
					userInstructionService: runtimeSetup.userInstructionService,
					requestToolApproval: runtimeSetup.createToolApproval({
						contextWindow: request.contextWindow ?? null,
						maxAgentWritableFileLines: request.maxAgentWritableFileLines ?? null,
					}),
					toolPolicies: runtimeSetup.toolPolicies,
				});
				const warningMessage = formatStartWarnings(startResult.warnings);
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
		this.clearTaskTimeouts(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
		await this.sessionRuntime.stopTaskSession(taskId).catch(() => null);
		if (entry.summary.state === "idle") {
			return cloneSummary(entry.summary);
		}
		const summary = updateSummary(entry, {
			state: "interrupted",
			reviewReason: "interrupted",
			exitCode: null,
			lastOutputAt: now(),
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
		this.clearTaskTimeouts(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
		await this.sessionRuntime.abortTaskSession(taskId).catch(() => null);
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
				source: "cline-sdk",
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
		launchConfigOverrides?: ClineTaskLaunchConfigOverrides,
	): Promise<RuntimeTaskSessionSummary | null> {
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return null;
		}
		if (
			entry.summary.state !== "running" &&
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
				"Finish or cancel the active Cline turn before changing its mode, provider, endpoint, reasoning, context, or timeout settings.",
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
				latestHookActivity: {
					activityText: "Agent active",
					toolName: null,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName: "turn_start",
					notificationType: null,
					source: "cline-sdk",
				},
			});
			this.emitSummary(waitingSummary);
			this.scheduleStreamTimeout(taskId);
			this.scheduleConversationTimeout(taskId);
			const assistantCountBeforeSend = entry.messages.filter((message) => message.role === "assistant").length;
			void this.ensureRuntimeSetup(entry.summary.workspacePath ?? "")
				.then(async (runtimeSetup) => {
					const resolvedPrompt = runtimeSetup.resolvePrompt(normalized);
					const resolvedContextWindow = this.resolveKnownContextWindowForTask(
						taskId,
						launchConfigOverrides?.contextWindow,
					);
					try {
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
		this.clearTaskTimeouts(taskId);
		this.timeoutSettingsByTaskId.delete(taskId);
		await this.sessionRuntime.clearTaskSessions(taskId).catch(() => undefined);
		this.messageRepository.clearHydratedTaskMessages(taskId);
		if (!existingEntry) {
			return null;
		}

		const clearedEntry: ClineTaskSessionEntry = {
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
		const startedAt = Date.parse(snapshot.record.startedAt);
		const updatedAt = Date.parse(snapshot.record.updatedAt || snapshot.record.startedAt);
		const persistedCwd = typeof snapshot.record.cwd === "string" ? snapshot.record.cwd.trim() : "";
		const persistedWorkspaceRoot =
			typeof snapshot.record.workspaceRoot === "string" ? snapshot.record.workspaceRoot.trim() : "";
		const reboundState = existingEntry?.summary.state === "failed" ? "failed" : "awaiting_review";
		const reboundReviewReason = existingEntry?.summary.state === "failed" ? "error" : "attention";
		const entry = createTaskEntryFromPersistedSession(taskId, snapshot.messages, {
			agentId: "cline",
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
		return cloneSummary(entry.summary);
	}

	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		return this.messageRepository.getSummary(taskId);
	}

	listSummaries(): RuntimeTaskSessionSummary[] {
		return this.messageRepository.listSummaries();
	}

	listMessages(taskId: string): ClineTaskMessage[] {
		return this.messageRepository.listMessages(taskId);
	}

	async listSlashCommands(workspacePath: string): Promise<ClineSdkSlashCommand[]> {
		const runtimeSetup = await this.ensureRuntimeSetup(workspacePath);
		await Promise.all([
			runtimeSetup.userInstructionService.refreshType("skill"),
			runtimeSetup.userInstructionService.refreshType("workflow"),
		]);
		return listClineSdkWorkflowSlashCommands(runtimeSetup.userInstructionService);
	}

	async loadTaskSessionMessages(taskId: string): Promise<ClineTaskMessage[]> {
		return await this.messageRepository.hydrateTaskMessages(taskId, async () => {
			return await this.sessionRuntime.readPersistedTaskSession(taskId);
		});
	}

	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null {
		const summary = this.messageRepository.applyTurnCheckpoint(taskId, checkpoint);
		if (!summary) {
			return null;
		}
		this.emitSummary(summary);
		return summary;
	}

	async dispose(): Promise<void> {
		for (const taskId of this.timeoutHandlesByTaskId.keys()) {
			this.clearTaskTimeouts(taskId);
		}
		this.timeoutSettingsByTaskId.clear();
		await this.sessionRuntime.dispose();
		this.pendingTurnCancelTaskIds.clear();
		this.providerIdByTaskId.clear();
		this.contextWindowByTaskId.clear();
		this.modelIdByTaskId.clear();
		this.endpointByTaskId.clear();
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
		this.messageRepository.emitSummary(summary);
	}

	private emitMessage(taskId: string, message: ClineTaskMessage): void {
		this.messageRepository.emitMessage(taskId, message);
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

	private async ensureRuntimeSetup(workspacePath: string): Promise<ClineRuntimeSetup> {
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
		this.recordModelRegistryObservation(taskId, event);
		this.recordSdkEventObservation(taskId, event);
		const entry = this.messageRepository.getTaskEntry(taskId);
		if (!entry) {
			return;
		}
		const previousSummary = cloneSummary(entry.summary);
		let latestSummary: RuntimeTaskSessionSummary | null = null;
		applyClineSessionEvent({
			event,
			taskId,
			entry,
			pendingTurnCancelTaskIds: this.pendingTurnCancelTaskIds,
			isClineProvider: this.isClineProviderForTask(taskId),
			emitSummary: (summary: RuntimeTaskSessionSummary) => {
				latestSummary = summary;
				this.emitSummary(summary);
			},
			emitMessage: (taskIdFromEvent: string, message: ClineTaskMessage) => {
				this.emitMessage(taskIdFromEvent, message);
			},
		});
		const shouldAbortForCreditLimit =
			entry.summary.latestHookActivity?.notificationType === "credit_limit" &&
			previousSummary?.latestHookActivity?.notificationType !== "credit_limit";
		if (this.shouldCaptureReviewCheckpoint(previousSummary, latestSummary)) {
			this.captureReviewCheckpoint(taskId, latestSummary);
		}
		const hookEventName = entry.summary.latestHookActivity?.hookEventName;
		if (entry.summary.state !== "running") {
			this.clearTaskTimeout(taskId, "stream");
			this.clearTaskTimeout(taskId, "tool");
			this.clearTaskTimeout(taskId, "conversation");
			this.activeToolTaskIds.delete(taskId);
		} else if (hookEventName === "tool_call" && !this.activeToolTaskIds.has(taskId)) {
			this.activeToolTaskIds.add(taskId);
			this.clearTaskTimeout(taskId, "stream");
			this.scheduleTaskTimeout(taskId, "tool", this.timeoutSettingsByTaskId.get(taskId)?.toolTimeoutMs ?? null);
		} else if (hookEventName === "tool_result") {
			this.activeToolTaskIds.delete(taskId);
			this.clearTaskTimeout(taskId, "tool");
			this.scheduleStreamTimeout(taskId);
		} else if (entry.summary.state === "running" && !this.activeToolTaskIds.has(taskId)) {
			this.scheduleStreamTimeout(taskId);
		}
		if (shouldAbortForCreditLimit) {
			void this.sessionRuntime.abortTaskSession(taskId).catch(() => undefined);
		}
	}

	private recordModelRegistryObservation(taskId: string, event: unknown): void {
		const observation = extractClineModelRegistryObservationFromEvent(
			event,
			{
				providerId: this.resolveProviderIdForTask(taskId),
				modelId: this.modelIdByTaskId.get(taskId) ?? SDK_DEFAULT_MODEL_ID,
				endpoint: this.endpointByTaskId.get(taskId) ?? null,
				contextWindow: this.resolveKnownContextWindowForTask(taskId, null),
			},
			now(),
		);
		if (!observation) {
			return;
		}
		void getDefaultClineModelRegistry()
			.recordRequest(observation)
			.catch(() => undefined);
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
				this.isClineProviderForTask(taskId) && isCreditLimitError(errorMessage)
					? "provider_error"
					: "runtime_error",
			severity: "error",
			message: errorMessage,
			taskId,
			providerId: this.resolveProviderIdForTask(taskId),
			modelId: this.modelIdByTaskId.get(taskId) ?? SDK_DEFAULT_MODEL_ID,
			metadata: {
				eventType: agentEvent.type,
			},
		});
	}
}

export function createInMemoryClineTaskSessionService(
	options: CreateInMemoryClineTaskSessionServiceOptions = {},
): ClineTaskSessionService {
	return new InMemoryClineTaskSessionService(options);
}
