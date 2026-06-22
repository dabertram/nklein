// Pure state helpers for native NKlein sessions.
// This module owns the in-memory summary and message shape plus the low-level
// mutations shared by the event adapter and the message repository.
import type { RuntimeLostHeartbeatPolicy, RuntimeTaskImage, RuntimeTaskSessionSummary } from "../core/api-contract";

const NKLEIN_USER_ATTENTION_TOOL_NAMES = new Set(["ask_followup_question", "plan_mode_respond"]);
const LOST_HEARTBEAT_RECOVERY_MESSAGE =
	"!Klein session heartbeat was lost. Review the latest transcript, then resume the card or mark it interrupted.";
let lostHeartbeatPolicy: RuntimeLostHeartbeatPolicy = "park";

export function setNKleinLostHeartbeatPolicy(policy: RuntimeLostHeartbeatPolicy): void {
	lostHeartbeatPolicy = policy;
}

export function getNKleinLostHeartbeatPolicy(): RuntimeLostHeartbeatPolicy {
	return lostHeartbeatPolicy;
}

/**
 * Detect credit-limit / insufficient-balance errors from an error message string.
 * Shared by the event adapter (for SDK agent events) and the session service (for
 * start/send failures) so the detection logic stays in one place.
 *
 * NOTE: This relies on string matching because the SDK does not yet expose a
 * structured error code for credit exhaustion. If the SDK adds one, prefer
 * checking that code and keep this as a fallback for older SDK versions.
 */
const CREDIT_LIMIT_PATTERNS = [
	"insufficient balance",
	"insufficient_credits",
	"insufficient credits",
	"credit limit",
	"credit_limit_exceeded",
	"credits exhausted",
	"out of credits",
	"no remaining credits",
	"402 payment required",
] as const;

export function isCreditLimitError(errorMessage: string | null): boolean {
	if (!errorMessage) {
		return false;
	}
	const normalized = errorMessage.toLowerCase();
	if (CREDIT_LIMIT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
		return true;
	}
	return normalized.includes("402") && (normalized.includes("balance") || normalized.includes("credit"));
}

/**
 * Detect that a *local* model host (LM Studio / Ollama) became unavailable mid-run — either the loaded model
 * crashed/unloaded (a real failure mode under memory pressure: a reasoning model at a large context window on
 * limited hardware), or the connection to the local server dropped. The caller must already know the provider
 * is local; these patterns also appear for unrelated network blips, so they are only actionable for a local
 * endpoint. Used to park the task with reload guidance instead of retry-storming a dead model.
 *
 * String matching is used because neither the SDK nor the OpenAI-compatible local servers expose a structured
 * "model unloaded" code; prefer a structured signal if one is ever added and keep this as the fallback.
 */
const LOCAL_MODEL_UNAVAILABLE_PATTERNS = [
	// Model is no longer loaded on the host (LM Studio unloads a model after a crash).
	"model not found",
	"model_not_found",
	"no models loaded",
	"no model loaded",
	"no model is loaded",
	"model is not loaded",
	"failed to load model",
	"model has crashed",
	"model unloaded",
	// The local server connection dropped (process died mid-stream, or the server is down).
	"econnreset",
	"econnrefused",
	"socket hang up",
	"fetch failed",
	"premature close",
	"terminated",
	"connection refused",
	"connection reset",
	"network error",
] as const;

export function isLocalModelRuntimeUnavailableError(errorMessage: string | null): boolean {
	if (!errorMessage) {
		return false;
	}
	const normalized = errorMessage.toLowerCase();
	return LOCAL_MODEL_UNAVAILABLE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

const WINDOWS_INVALID_SESSION_ID_CHARS = /[<>:"/\\|?*]/g;

export interface NKleinTaskSessionEntry {
	summary: RuntimeTaskSessionSummary;
	messages: NKleinTaskMessage[];
	activeAssistantMessageId: string | null;
	activeReasoningMessageId: string | null;
	toolMessageIdByToolCallId: Map<string, string>;
	toolInputByToolCallId: Map<string, unknown>;
}

export interface NKleinTaskMessage {
	id: string;
	role: "user" | "assistant" | "system" | "tool" | "reasoning" | "status";
	content: string;
	images?: RuntimeTaskImage[];
	createdAt: number;
	meta?: {
		toolName?: string | null;
		hookEventName?: string | null;
		toolCallId?: string | null;
		streamType?: string | null;
		messageKind?: string | null;
		displayRole?: string | null;
		reason?: string | null;
	} | null;
}

export function now(): number {
	return Date.now();
}

export function cloneSummary(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary {
	return {
		...summary,
		latestHookActivity: summary.latestHookActivity ? { ...summary.latestHookActivity } : null,
		latestTurnCheckpoint: summary.latestTurnCheckpoint ? { ...summary.latestTurnCheckpoint } : null,
		previousTurnCheckpoint: summary.previousTurnCheckpoint ? { ...summary.previousTurnCheckpoint } : null,
	};
}

export function cloneMessage(message: NKleinTaskMessage): NKleinTaskMessage {
	return {
		...message,
		images: message.images ? message.images.map((image) => ({ ...image })) : message.images,
		meta: message.meta ? { ...message.meta } : message.meta,
	};
}

export function createDefaultSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		mode: null,
		agentId: "nklein",
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: now(),
		lastOutputAt: null,
		lastTokenAt: null,
		lastHeartbeatAt: null,
		heartbeatStatus: null,
		providerId: null,
		modelId: null,
		endpoint: null,
		sharedEndpointId: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestUsage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

export function updateSummary(
	entry: NKleinTaskSessionEntry,
	patch: Partial<RuntimeTaskSessionSummary>,
): RuntimeTaskSessionSummary {
	const nextSummary: RuntimeTaskSessionSummary = {
		...entry.summary,
		...patch,
		updatedAt: now(),
	};
	if (
		lostHeartbeatPolicy === "park" &&
		patch.state === undefined &&
		nextSummary.state === "running" &&
		nextSummary.heartbeatStatus === "lost"
	) {
		entry.summary = {
			...nextSummary,
			state: "awaiting_review",
			reviewReason: "error",
			warningMessage: nextSummary.warningMessage ?? LOST_HEARTBEAT_RECOVERY_MESSAGE,
		};
		return cloneSummary(entry.summary);
	}
	entry.summary = nextSummary;
	return cloneSummary(entry.summary);
}

export function createMessage(
	taskId: string,
	role: NKleinTaskMessage["role"],
	content: string,
	images?: RuntimeTaskImage[],
): NKleinTaskMessage {
	return {
		id: `${taskId}-${now()}-${Math.random().toString(36).slice(2, 8)}`,
		role,
		content,
		images: images && images.length > 0 ? images.map((image) => ({ ...image })) : undefined,
		createdAt: now(),
	};
}

export function createMessageWithMeta(
	taskId: string,
	role: NKleinTaskMessage["role"],
	content: string,
	meta: NKleinTaskMessage["meta"],
	images?: RuntimeTaskImage[],
): NKleinTaskMessage {
	return {
		...createMessage(taskId, role, content, images),
		meta,
	};
}

export function createSessionId(taskId: string): string {
	return `${toSessionIdTaskPrefix(taskId)}-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSessionIdPrefix(taskId: string): string {
	return `${toSessionIdTaskPrefix(taskId)}-`;
}

function toSessionIdTaskPrefix(taskId: string): string {
	const normalized = taskId.replace(WINDOWS_INVALID_SESSION_ID_CHARS, "_").trim();
	return normalized.length > 0 ? normalized : "session";
}

export function isNKleinUserAttentionTool(toolName: string | null): boolean {
	if (!toolName) {
		return false;
	}
	return NKLEIN_USER_ATTENTION_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

export function canReturnToRunning(reviewReason: RuntimeTaskSessionSummary["reviewReason"]): boolean {
	return reviewReason === "attention" || reviewReason === "hook" || reviewReason === "error";
}

export function latestAssistantMessageMatches(entry: NKleinTaskSessionEntry, content: string): boolean {
	const latestAssistant = getLatestAssistantMessage(entry);
	if (!latestAssistant) {
		return false;
	}
	return latestAssistant.content.trim() === content.trim();
}

export function clearActiveTurnState(entry: NKleinTaskSessionEntry): void {
	entry.activeAssistantMessageId = null;
	entry.activeReasoningMessageId = null;
	entry.toolMessageIdByToolCallId.clear();
	entry.toolInputByToolCallId.clear();
}

export function appendAssistantChunk(entry: NKleinTaskSessionEntry, taskId: string, chunk: string): NKleinTaskMessage {
	const existingMessageId = entry.activeAssistantMessageId;
	if (existingMessageId) {
		const updatedMessage = updateMessageInEntry(entry, existingMessageId, (currentMessage) => ({
			...currentMessage,
			content: `${currentMessage.content}${chunk}`,
		}));
		if (updatedMessage) {
			return updatedMessage;
		}
	}
	return createAssistantMessage(entry, taskId, chunk);
}

export function setOrCreateAssistantMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	content: string,
): NKleinTaskMessage | null {
	if (!entry.activeAssistantMessageId) {
		return null;
	}
	const updatedMessage = updateMessageInEntry(entry, entry.activeAssistantMessageId, (currentMessage) => ({
		...currentMessage,
		content,
	}));
	if (updatedMessage) {
		return updatedMessage;
	}
	return createAssistantMessage(entry, taskId, content);
}

export function appendReasoningChunk(entry: NKleinTaskSessionEntry, taskId: string, chunk: string): NKleinTaskMessage {
	const existingMessageId = entry.activeReasoningMessageId;
	if (existingMessageId) {
		const updatedMessage = updateMessageInEntry(entry, existingMessageId, (currentMessage) => ({
			...currentMessage,
			content: `${currentMessage.content}${chunk}`,
			meta: {
				...(currentMessage.meta ?? {}),
				hookEventName: "reasoning_delta",
				streamType: "reasoning",
			},
		}));
		if (updatedMessage) {
			return updatedMessage;
		}
	}
	return createReasoningMessage(entry, taskId, chunk, "reasoning_delta");
}

export function setOrCreateReasoningMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	content: string,
): NKleinTaskMessage | null {
	if (!entry.activeReasoningMessageId) {
		return null;
	}
	const updatedMessage = updateMessageInEntry(entry, entry.activeReasoningMessageId, (currentMessage) => ({
		...currentMessage,
		content,
		meta: {
			...(currentMessage.meta ?? {}),
			hookEventName: "reasoning_end",
			streamType: "reasoning",
		},
	}));
	if (updatedMessage) {
		return updatedMessage;
	}
	return createReasoningMessage(entry, taskId, content, "reasoning_end");
}

export function createAssistantMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	content: string,
): NKleinTaskMessage {
	const message = createMessage(taskId, "assistant", content);
	entry.messages.push(message);
	entry.activeAssistantMessageId = message.id;
	return message;
}

export function createReasoningMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	content: string,
	hookEventName: string,
): NKleinTaskMessage {
	const message = createMessageWithMeta(taskId, "reasoning", content, {
		hookEventName,
		streamType: "reasoning",
	});
	entry.messages.push(message);
	entry.activeReasoningMessageId = message.id;
	return message;
}

export function startToolCallMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	input: {
		toolName: string | null;
		toolCallId: string | null;
		input: unknown;
	},
): NKleinTaskMessage {
	const toolContent = buildToolCallContent({
		toolName: input.toolName,
		input: input.input,
	});
	const message = createMessageWithMeta(taskId, "tool", toolContent, {
		toolName: input.toolName,
		hookEventName: "tool_call_start",
		toolCallId: input.toolCallId,
		streamType: "tool",
	});
	entry.messages.push(message);
	if (input.toolCallId) {
		entry.toolMessageIdByToolCallId.set(input.toolCallId, message.id);
		entry.toolInputByToolCallId.set(input.toolCallId, input.input);
	}
	return message;
}

export function finishToolCallMessage(
	entry: NKleinTaskSessionEntry,
	taskId: string,
	input: {
		toolName: string | null;
		toolCallId: string | null;
		output: unknown;
		error: string | null;
		durationMs: number | null;
	},
): NKleinTaskMessage {
	const existingMessageId = input.toolCallId ? (entry.toolMessageIdByToolCallId.get(input.toolCallId) ?? null) : null;
	const toolInput = input.toolCallId ? entry.toolInputByToolCallId.get(input.toolCallId) : undefined;
	const content = buildToolCallContent({
		toolName: input.toolName,
		input: toolInput,
		output: input.output,
		error: input.error,
		durationMs: input.durationMs,
	});
	if (existingMessageId) {
		const updatedMessage = updateMessageInEntry(entry, existingMessageId, (currentMessage) => ({
			...currentMessage,
			content,
			meta: {
				...(currentMessage.meta ?? {}),
				toolName: input.toolName,
				hookEventName: "tool_call_end",
				toolCallId: input.toolCallId,
				streamType: "tool",
			},
		}));
		if (updatedMessage) {
			if (input.toolCallId) {
				entry.toolMessageIdByToolCallId.delete(input.toolCallId);
				entry.toolInputByToolCallId.delete(input.toolCallId);
			}
			return updatedMessage;
		}
	}
	const message = createMessageWithMeta(taskId, "tool", content, {
		toolName: input.toolName,
		hookEventName: "tool_call_end",
		toolCallId: input.toolCallId,
		streamType: "tool",
	});
	if (input.toolCallId) {
		entry.toolMessageIdByToolCallId.delete(input.toolCallId);
		entry.toolInputByToolCallId.delete(input.toolCallId);
	}
	entry.messages.push(message);
	return message;
}

const MAX_TOOL_INPUT_CHARS = 4_000;
const MAX_TOOL_OUTPUT_CHARS = 12_000;
const MAX_TOOL_ERROR_CHARS = 4_000;

function truncateToolText(value: string, maxChars: number, label: string): string {
	const normalized = value.trimEnd();
	if (normalized.length <= maxChars) {
		return normalized;
	}
	return `${normalized.slice(0, maxChars).trimEnd()}\n[${label} truncated after ${maxChars.toLocaleString()} characters; rerun the tool with a narrower query/range if more detail is needed.]`;
}

function summarizeToolError(error: string): string {
	const lines = error
		.replaceAll("\r\n", "\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.trim().length > 0);
	const actionableLines = lines.filter(
		(line) =>
			!/^\s*at\s+/u.test(line) &&
			!/^\s*at\s+[A-Za-z0-9_$.[\]<>]+\s+\(/u.test(line) &&
			!/^\s*\(?node:(internal|events|stream|timers|fs|child_process)\b/u.test(line),
	);
	const selectedLines = (actionableLines.length > 0 ? actionableLines : lines).slice(0, 12);
	const summary = truncateToolText(selectedLines.join("\n"), MAX_TOOL_ERROR_CHARS, "tool error");
	if (/\bNext step:/i.test(summary)) {
		return summary;
	}
	return summary
		? `${summary}\nNext step: adjust the tool input or inspect the referenced file/command, then retry with a smaller focused request.`
		: "Tool failed without a message. Next step: retry with a smaller focused request.";
}

function stringifyPayload(payload: unknown, maxChars: number, label: string): string {
	if (payload === undefined || payload === null) {
		return "";
	}
	if (typeof payload === "string") {
		return truncateToolText(payload, maxChars, label);
	}
	try {
		return truncateToolText(JSON.stringify(payload, null, 2), maxChars, label);
	} catch {
		return truncateToolText(String(payload), maxChars, label);
	}
}

function buildToolCallContent(input: {
	toolName: string | null;
	input: unknown;
	output?: unknown;
	error?: string | null;
	durationMs?: number | null;
}): string {
	const lines: string[] = [];
	lines.push(`Tool: ${input.toolName ?? "unknown"}`);
	const inputText = stringifyPayload(input.input, MAX_TOOL_INPUT_CHARS, "tool input");
	if (inputText) {
		lines.push("Input:");
		lines.push(inputText);
	}
	if (input.error) {
		lines.push("Error:");
		lines.push(summarizeToolError(input.error));
	} else if (input.output !== undefined) {
		const outputText = stringifyPayload(input.output, MAX_TOOL_OUTPUT_CHARS, "tool output");
		if (outputText) {
			lines.push("Output:");
			lines.push(outputText);
		}
	}
	if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs)) {
		lines.push(`Duration: ${Math.max(0, Math.round(input.durationMs))}ms`);
	}
	return lines.join("\n");
}

function updateMessageInEntry(
	entry: NKleinTaskSessionEntry,
	messageId: string,
	updater: (currentMessage: NKleinTaskMessage) => NKleinTaskMessage,
): NKleinTaskMessage | null {
	const messageIndex = entry.messages.findIndex((message) => message.id === messageId);
	if (messageIndex < 0) {
		return null;
	}
	const currentMessage = entry.messages[messageIndex];
	if (!currentMessage) {
		return null;
	}
	const nextMessage = updater(currentMessage);
	entry.messages[messageIndex] = nextMessage;
	return nextMessage;
}

function getLatestAssistantMessage(entry: NKleinTaskSessionEntry): NKleinTaskMessage | null {
	for (let index = entry.messages.length - 1; index >= 0; index -= 1) {
		const message = entry.messages[index];
		if (message?.role === "assistant") {
			return message;
		}
	}
	return null;
}
