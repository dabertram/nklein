// Translates raw SDK session events into !Klein summary and message mutations.
// Keep protocol-specific parsing here so the runtime and repository can stay
// focused on lifecycle, storage, and task-facing orchestration.
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import {
	readAgentEvent,
	readChunkEvent,
	readEndedEvent,
	readHookEvent,
	readStatusEvent,
} from "./nklein-event-adapter-readers";
import { extractAgentErrorMessage, readMessagePartText, readToolResult } from "./nklein-message-content-readers";
import { normalizePreviewText, toPreviewText } from "./nklein-preview-text";
import { isLikelySerializedAgentEventChunk } from "./nklein-serialized-event-chunk";
import {
	appendAssistantChunk,
	appendReasoningChunk,
	canReturnToRunning,
	clearActiveTurnState,
	createAssistantMessage,
	createMessage,
	createReasoningMessage,
	finishToolCallMessage,
	isCreditLimitError,
	isNKleinUserAttentionTool,
	latestAssistantMessageMatches,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
	now,
	setOrCreateAssistantMessage,
	setOrCreateReasoningMessage,
	startToolCallMessage,
	updateSummary,
} from "./nklein-session-state";
import { readSessionUsage } from "./nklein-session-usage-parser";
import { formatNKleinToolCallLabel, getNKleinToolCallDisplay } from "./nklein-tool-call-display";
import { computeNKleinToolInputFingerprint } from "./nklein-tool-call-fingerprint";
import { asRecord } from "./nklein-value-guards";

export interface ApplyNKleinSessionEventInput {
	event: unknown;
	taskId: string;
	entry: NKleinTaskSessionEntry;
	pendingTurnCancelTaskIds: Set<string>;
	isNKleinProvider: boolean;
	emitSummary: (summary: RuntimeTaskSessionSummary) => void;
	emitMessage: (taskId: string, message: NKleinTaskMessage) => void;
}

function getRetainedNKleinToolActivity(entry: NKleinTaskSessionEntry): {
	toolName: string | null;
	toolInputSummary: string | null;
} {
	const latestHookActivity = entry.summary.latestHookActivity;
	if (latestHookActivity?.source !== "nklein-sdk" || !latestHookActivity.toolName) {
		return {
			toolName: null,
			toolInputSummary: null,
		};
	}

	return {
		toolName: latestHookActivity.toolName,
		toolInputSummary: latestHookActivity.toolInputSummary ?? null,
	};
}

function isReviewableAbortedToolCompletion(entry: NKleinTaskSessionEntry): boolean {
	const latestHookActivity = entry.summary.latestHookActivity;
	if (latestHookActivity?.source !== "nklein-sdk" || latestHookActivity.hookEventName !== "tool_result") {
		return false;
	}
	const toolName = latestHookActivity.toolName?.trim().toLowerCase();
	if (!toolName || isNKleinUserAttentionTool(toolName)) {
		return false;
	}
	return new Set([
		"edit",
		"edit_file",
		"replace_in_file",
		"run_command",
		"run_commands",
		"write",
		"write_file",
		"write_files",
	]).has(toolName);
}

function emitAssistantTextSummary(input: ApplyNKleinSessionEventInput, text: string | null): void {
	const currentTime = now();
	const fullPreviewText = normalizePreviewText(text);
	const previewText = toPreviewText(fullPreviewText);
	const retainedToolActivity = getRetainedNKleinToolActivity(input.entry);
	emitSummary(input, {
		state: "running",
		lastOutputAt: currentTime,
		lastHookAt: currentTime,
		lastTokenAt: currentTime,
		lastHeartbeatAt: currentTime,
		heartbeatStatus: "healthy",
		latestHookActivity: {
			activityText: previewText ?? "Agent active",
			toolName: retainedToolActivity.toolName,
			toolInputSummary: retainedToolActivity.toolInputSummary,
			finalMessage: fullPreviewText,
			hookEventName: "assistant_delta",
			notificationType: null,
			source: "nklein-sdk",
		},
	});
}

function withHeartbeat(
	patch: Partial<RuntimeTaskSessionSummary>,
	options: { token?: boolean; status?: "healthy" | "stale" | "lost" } = {},
): Partial<RuntimeTaskSessionSummary> {
	const currentTime = now();
	return {
		...patch,
		lastHeartbeatAt: currentTime,
		heartbeatStatus: options.status ?? "healthy",
		...(options.token ? { lastTokenAt: currentTime } : {}),
	};
}

export function extractNKleinSessionId(event: unknown): string | null {
	const record = asRecord(event);
	if (!record) {
		return null;
	}
	const payload = asRecord(record.payload);
	return payload && typeof payload.sessionId === "string" ? payload.sessionId : null;
}

function isRecoverableToolCallFailure(message: string | null): boolean {
	return Boolean(message?.includes("tool call(s) failed:"));
}

// Translate raw SDK events into !Klein summary and chat mutations so the session service can stay focused on host ownership.
export function applyNKleinSessionEvent(input: ApplyNKleinSessionEventInput): void {
	const { entry, event, taskId } = input;
	const agentEvent = readAgentEvent(event);
	const chunkEvent = readChunkEvent(event);
	const hookEvent = readHookEvent(event);
	const endedEvent = readEndedEvent(event);
	const statusEvent = readStatusEvent(event);

	if (agentEvent?.type === "error") {
		const errorMessage = "error" in agentEvent ? extractAgentErrorMessage(agentEvent.error) : null;
		const eventRecord = asRecord(agentEvent);
		const rawMessage = typeof eventRecord?.message === "string" ? eventRecord.message.trim() || null : null;
		const creditLimitSource = errorMessage ?? rawMessage;
		const sdkRecoverable = typeof agentEvent.recoverable === "boolean" ? agentEvent.recoverable : false;
		const creditLimitError = input.isNKleinProvider && isCreditLimitError(creditLimitSource);
		const recoverable = sdkRecoverable && !creditLimitError;
		const retainedToolActivity = getRetainedNKleinToolActivity(entry);
		if (!recoverable) {
			clearActiveTurnState(entry);
		}
		if (recoverable && errorMessage && !isRecoverableToolCallFailure(errorMessage)) {
			const retryMsg = createMessage(taskId, "system", `Retrying: ${errorMessage}`);
			entry.messages.push(retryMsg);
			input.emitMessage(taskId, retryMsg);
		}
		emitSummary(
			input,
			withHeartbeat(
				{
					...(recoverable
						? {}
						: {
								state: "awaiting_review",
								reviewReason: "error",
								warningMessage: creditLimitError ? null : (errorMessage ?? "Unknown agent error"),
							}),
					lastOutputAt: now(),
					lastHookAt: now(),
					latestHookActivity: {
						activityText: recoverable
							? `Retrying after error: ${errorMessage ?? "Unknown agent error"}`
							: `Agent error: ${errorMessage ?? "Unknown agent error"}`,
						toolName: retainedToolActivity.toolName,
						toolInputSummary: retainedToolActivity.toolInputSummary,
						finalMessage: recoverable ? null : (errorMessage ?? "Unknown agent error"),
						hookEventName: "agent_error",
						notificationType: creditLimitError ? "credit_limit" : null,
						source: "nklein-sdk",
					},
				},
				{ status: recoverable ? "stale" : "lost" },
			),
		);
		return;
	}

	if (agentEvent?.type === "run-failed") {
		if (input.pendingTurnCancelTaskIds.has(taskId)) {
			emitTurnCanceled(input);
			return;
		}
		const errorMessage = "error" in agentEvent ? extractAgentErrorMessage(agentEvent.error) : null;
		const retainedToolActivity = getRetainedNKleinToolActivity(entry);
		clearActiveTurnState(entry);
		// B1 alignment: on a credit-limit run-failed, suppress the raw warning text (matching the error-event arm above and
		// the service arm in nklein-task-session-service) — the dedicated `credit_limit` notice + "Out of credits" card
		// state already convey it, so a raw "402 Insufficient balance" warning would be a redundant double-display.
		const creditLimitError = input.isNKleinProvider && isCreditLimitError(errorMessage);
		emitSummary(
			input,
			withHeartbeat(
				{
					state: "awaiting_review",
					reviewReason: "error",
					warningMessage: creditLimitError ? null : (errorMessage ?? "Unknown agent error"),
					lastOutputAt: now(),
					lastHookAt: now(),
					latestHookActivity: {
						activityText: `Agent error: ${errorMessage ?? "Unknown agent error"}`,
						toolName: retainedToolActivity.toolName,
						toolInputSummary: retainedToolActivity.toolInputSummary,
						finalMessage: errorMessage ?? "Unknown agent error",
						hookEventName: "agent_error",
						notificationType: creditLimitError ? "credit_limit" : null,
						source: "nklein-sdk",
					},
				},
				{ status: "lost" },
			),
		);
		return;
	}

	if (agentEvent?.type === "assistant-text-delta") {
		const accumulated = typeof agentEvent.accumulatedText === "string" ? agentEvent.accumulatedText : null;
		const text = typeof agentEvent.text === "string" ? agentEvent.text : null;
		if (typeof accumulated === "string") {
			const message =
				setOrCreateAssistantMessage(entry, taskId, accumulated) ??
				createAssistantMessage(entry, taskId, accumulated);
			input.emitMessage(taskId, message);
		} else if (typeof text === "string" && text.length > 0) {
			input.emitMessage(taskId, appendAssistantChunk(entry, taskId, text));
		}
		emitAssistantTextSummary(input, accumulated ?? text);
		return;
	}

	if (agentEvent?.type === "content_start" && agentEvent.contentType === "text") {
		const accumulated = typeof agentEvent.accumulated === "string" ? agentEvent.accumulated : null;
		const text = typeof agentEvent.text === "string" ? agentEvent.text : null;
		if (typeof accumulated === "string") {
			const message =
				setOrCreateAssistantMessage(entry, taskId, accumulated) ??
				createAssistantMessage(entry, taskId, accumulated);
			input.emitMessage(taskId, message);
		} else if (typeof text === "string" && text.length > 0) {
			input.emitMessage(taskId, appendAssistantChunk(entry, taskId, text));
		}
		emitAssistantTextSummary(input, accumulated ?? text);
		return;
	}

	if (agentEvent?.type === "notice") {
		const message = typeof agentEvent.message === "string" ? agentEvent.message.trim() : "";
		const noticeReason: string | null = typeof agentEvent.reason === "string" ? agentEvent.reason : null;
		const noticeType = typeof agentEvent.noticeType === "string" ? agentEvent.noticeType : null;
		if (
			input.isNKleinProvider &&
			isCreditLimitError(message) &&
			(noticeType === "recovery" || noticeReason === "recovery")
		) {
			return;
		}
		if (message) {
			const displayRole = typeof agentEvent.displayRole === "string" ? agentEvent.displayRole : "system";
			const reason = typeof agentEvent.reason === "string" ? agentEvent.reason : null;
			const normalizedRole = displayRole === "status" ? "status" : "system";
			const noticeMessage = createMessage(taskId, normalizedRole, message);
			noticeMessage.meta = {
				hookEventName: "agent_notice",
				messageKind: noticeType,
				displayRole,
				reason,
			};
			entry.messages.push(noticeMessage);
			input.emitMessage(taskId, noticeMessage);
		}
		return;
	}

	if (agentEvent?.type === "run-finished") {
		const result = asRecord(agentEvent.result);
		const finalText = typeof result?.outputText === "string" ? result.outputText.trim() : "";
		const latestUsage = readSessionUsage(result?.usage);
		if (finalText) {
			const message = setOrCreateAssistantMessage(entry, taskId, finalText);
			if (message) {
				input.emitMessage(taskId, message);
			} else if (!latestAssistantMessageMatches(entry, finalText)) {
				const assistantMessage = createMessage(taskId, "assistant", finalText);
				entry.messages.push(assistantMessage);
				input.emitMessage(taskId, assistantMessage);
			}
		}

		const status = typeof result?.status === "string" ? result.status : "completed";
		if (status === "aborted" && input.pendingTurnCancelTaskIds.has(taskId)) {
			emitTurnCanceled(input);
			return;
		}

		const previousHookActivity = entry.summary.latestHookActivity;
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			...(latestUsage ? { latestUsage } : {}),
			latestHookActivity: {
				activityText: finalText ? `Final: ${finalText}` : (previousHookActivity?.activityText ?? null),
				toolName: previousHookActivity?.toolName ?? null,
				toolInputSummary: previousHookActivity?.toolInputSummary ?? null,
				finalMessage: finalText || (previousHookActivity?.finalMessage ?? null),
				hookEventName: "agent_end",
				notificationType: previousHookActivity?.notificationType ?? null,
				source: "nklein-sdk",
			},
		};
		if (status === "aborted" && !finalText && !isReviewableAbortedToolCompletion(entry)) {
			summaryPatch.state = "interrupted";
			summaryPatch.reviewReason = "interrupted";
		} else if (status === "failed") {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "error";
		} else {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		}

		clearActiveTurnState(entry);
		emitSummary(input, withHeartbeat(summaryPatch, { status: "lost" }));
		return;
	}

	if (agentEvent?.type === "done") {
		const finalText = typeof agentEvent.text === "string" ? agentEvent.text.trim() : "";
		if (finalText) {
			const message = setOrCreateAssistantMessage(entry, taskId, finalText);
			if (message) {
				input.emitMessage(taskId, message);
			} else if (!latestAssistantMessageMatches(entry, finalText)) {
				const assistantMessage = createMessage(taskId, "assistant", finalText);
				entry.messages.push(assistantMessage);
				input.emitMessage(taskId, assistantMessage);
			}
		}

		const doneReason = typeof agentEvent.reason === "string" ? agentEvent.reason : "completed";
		const latestUsage = readSessionUsage(agentEvent.usage);
		if (doneReason === "aborted" && input.pendingTurnCancelTaskIds.has(taskId)) {
			emitTurnCanceled(input);
			return;
		}

		const previousHookActivity = entry.summary.latestHookActivity;
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			...(latestUsage ? { latestUsage } : {}),
			latestHookActivity: {
				activityText: finalText ? `Final: ${finalText}` : (previousHookActivity?.activityText ?? null),
				toolName: previousHookActivity?.toolName ?? null,
				toolInputSummary: previousHookActivity?.toolInputSummary ?? null,
				finalMessage: finalText || (previousHookActivity?.finalMessage ?? null),
				hookEventName: "agent_end",
				notificationType: previousHookActivity?.notificationType ?? null,
				source: "nklein-sdk",
			},
		};
		if (doneReason === "aborted" && !finalText && !isReviewableAbortedToolCompletion(entry)) {
			summaryPatch.state = "interrupted";
			summaryPatch.reviewReason = "interrupted";
		} else if (doneReason === "error") {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "error";
		} else {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		}

		clearActiveTurnState(entry);
		emitSummary(input, withHeartbeat(summaryPatch, { status: "lost" }));
		return;
	}

	if (agentEvent?.type === "assistant-reasoning-delta") {
		const reasoning = typeof agentEvent.text === "string" ? agentEvent.text : null;
		if (reasoning && reasoning.length > 0) {
			input.emitMessage(taskId, appendReasoningChunk(entry, taskId, reasoning));
			emitSummary(
				input,
				withHeartbeat(
					{
						state: "running",
						lastOutputAt: now(),
					},
					{ token: true },
				),
			);
		}
		return;
	}

	if (agentEvent?.type === "assistant-message") {
		const text = readMessagePartText(agentEvent.message, "text");
		if (text) {
			const message =
				setOrCreateAssistantMessage(entry, taskId, text) ?? createAssistantMessage(entry, taskId, text);
			input.emitMessage(taskId, message);
			entry.activeAssistantMessageId = null;
			emitAssistantTextSummary(input, text);
			return;
		}

		const reasoning = readMessagePartText(agentEvent.message, "reasoning");
		if (reasoning) {
			const message =
				setOrCreateReasoningMessage(entry, taskId, reasoning) ??
				createReasoningMessage(entry, taskId, reasoning, "reasoning_end");
			input.emitMessage(taskId, message);
			entry.activeReasoningMessageId = null;
			emitSummary(input, withHeartbeat({ lastOutputAt: now() }, { token: true }));
		}
		return;
	}

	if (agentEvent?.type === "content_start" && agentEvent.contentType === "reasoning") {
		const reasoning = typeof agentEvent.reasoning === "string" ? agentEvent.reasoning : null;
		if (reasoning && reasoning.length > 0) {
			input.emitMessage(taskId, appendReasoningChunk(entry, taskId, reasoning));
			emitSummary(
				input,
				withHeartbeat(
					{
						state: "running",
						lastOutputAt: now(),
					},
					{ token: true },
				),
			);
		}
		return;
	}

	if (agentEvent?.type === "content_end" && agentEvent.contentType === "reasoning") {
		const reasoning = typeof agentEvent.reasoning === "string" ? agentEvent.reasoning : null;
		if (reasoning) {
			const message =
				setOrCreateReasoningMessage(entry, taskId, reasoning) ??
				createReasoningMessage(entry, taskId, reasoning, "reasoning_end");
			input.emitMessage(taskId, message);
		}
		entry.activeReasoningMessageId = null;
		emitSummary(input, {
			lastOutputAt: now(),
		});
		return;
	}

	if (agentEvent?.type === "tool-started") {
		const toolCall = asRecord(agentEvent.toolCall);
		const toolName = typeof toolCall?.toolName === "string" ? toolCall.toolName : null;
		const toolCallId = typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : null;
		const toolInput = toolCall?.input;
		const toolDisplay = getNKleinToolCallDisplay(toolName, toolInput);
		const isUserAttentionTool = isNKleinUserAttentionTool(toolName);
		input.emitMessage(
			taskId,
			startToolCallMessage(entry, taskId, {
				toolName,
				toolCallId,
				input: toolInput,
			}),
		);
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: `Using ${formatNKleinToolCallLabel(toolDisplay.toolName, toolDisplay.inputSummary)}`,
				toolName: toolDisplay.toolName,
				toolInputSummary: toolDisplay.inputSummary,
				toolInputFingerprint: computeNKleinToolInputFingerprint(toolInput),
				finalMessage: null,
				hookEventName: "tool_call",
				notificationType: isUserAttentionTool ? "user_attention" : null,
				source: "nklein-sdk",
			},
		};
		if (isUserAttentionTool && (entry.summary.state === "running" || entry.summary.state === "idle")) {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		} else if (!isUserAttentionTool && canReturnToRunning(entry.summary.reviewReason)) {
			summaryPatch.state = "running";
			summaryPatch.reviewReason = null;
		}
		emitSummary(input, withHeartbeat(summaryPatch));
		return;
	}

	if (agentEvent?.type === "tool-finished") {
		const toolCall = asRecord(agentEvent.toolCall);
		const toolName = typeof toolCall?.toolName === "string" ? toolCall.toolName : null;
		const toolCallId = typeof toolCall?.toolCallId === "string" ? toolCall.toolCallId : null;
		const { output: toolOutput, error: toolError } = readToolResult(agentEvent.message);
		const toolInput = toolCallId ? entry.toolInputByToolCallId.get(toolCallId) : undefined;
		const toolDisplay = getNKleinToolCallDisplay(toolName, toolInput, toolOutput);
		const isUserAttentionTool = isNKleinUserAttentionTool(toolName);
		input.emitMessage(
			taskId,
			finishToolCallMessage(entry, taskId, {
				toolName,
				toolCallId,
				output: toolOutput,
				error: toolError,
				durationMs: null,
			}),
		);
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: `${toolError ? "Failed" : "Completed"} ${formatNKleinToolCallLabel(toolDisplay.toolName, toolDisplay.inputSummary)}`,
				toolName: toolDisplay.toolName,
				toolInputSummary: toolDisplay.inputSummary,
				finalMessage: null,
				hookEventName: "tool_result",
				notificationType: null,
				source: "nklein-sdk",
			},
		};
		if (isUserAttentionTool && canReturnToRunning(entry.summary.reviewReason)) {
			summaryPatch.state = "running";
			summaryPatch.reviewReason = null;
		}
		emitSummary(input, withHeartbeat(summaryPatch));
		return;
	}

	if (agentEvent?.type === "content_start" && agentEvent.contentType === "tool") {
		const toolName = typeof agentEvent.toolName === "string" ? agentEvent.toolName : null;
		const toolCallId = typeof agentEvent.toolCallId === "string" ? agentEvent.toolCallId : null;
		const toolInput = agentEvent.input;
		const toolDisplay = getNKleinToolCallDisplay(toolName, toolInput);
		const isUserAttentionTool = isNKleinUserAttentionTool(toolName);
		input.emitMessage(
			taskId,
			startToolCallMessage(entry, taskId, {
				toolName,
				toolCallId,
				input: toolInput,
			}),
		);
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: `Using ${formatNKleinToolCallLabel(toolDisplay.toolName, toolDisplay.inputSummary)}`,
				toolName: toolDisplay.toolName,
				toolInputSummary: toolDisplay.inputSummary,
				toolInputFingerprint: computeNKleinToolInputFingerprint(toolInput),
				finalMessage: null,
				hookEventName: "tool_call",
				notificationType: isUserAttentionTool ? "user_attention" : null,
				source: "nklein-sdk",
			},
		};
		if (isUserAttentionTool && (entry.summary.state === "running" || entry.summary.state === "idle")) {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		} else if (!isUserAttentionTool && canReturnToRunning(entry.summary.reviewReason)) {
			summaryPatch.state = "running";
			summaryPatch.reviewReason = null;
		}
		emitSummary(input, withHeartbeat(summaryPatch));
		return;
	}

	if (agentEvent?.type === "content_end" && agentEvent.contentType === "tool") {
		const toolName = typeof agentEvent.toolName === "string" ? agentEvent.toolName : null;
		const toolCallId = typeof agentEvent.toolCallId === "string" ? agentEvent.toolCallId : null;
		const toolOutput = agentEvent.output;
		const toolError = typeof agentEvent.error === "string" ? agentEvent.error : null;
		const durationMs = typeof agentEvent.durationMs === "number" ? agentEvent.durationMs : null;
		const toolInput = toolCallId ? entry.toolInputByToolCallId.get(toolCallId) : undefined;
		const toolDisplay = getNKleinToolCallDisplay(toolName, toolInput, toolOutput);
		const isUserAttentionTool = isNKleinUserAttentionTool(toolName);
		input.emitMessage(
			taskId,
			finishToolCallMessage(entry, taskId, {
				toolName,
				toolCallId,
				output: toolOutput,
				error: toolError,
				durationMs,
			}),
		);
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: `${toolError ? "Failed" : "Completed"} ${formatNKleinToolCallLabel(toolDisplay.toolName, toolDisplay.inputSummary)}`,
				toolName: toolDisplay.toolName,
				toolInputSummary: toolDisplay.inputSummary,
				finalMessage: null,
				hookEventName: "tool_result",
				notificationType: null,
				source: "nklein-sdk",
			},
		};
		if (isUserAttentionTool && canReturnToRunning(entry.summary.reviewReason)) {
			summaryPatch.state = "running";
			summaryPatch.reviewReason = null;
		}
		emitSummary(input, withHeartbeat(summaryPatch));
		return;
	}

	if (agentEvent?.type === "content_end" && agentEvent.contentType === "text") {
		const text = typeof agentEvent.text === "string" ? agentEvent.text : null;
		if (text) {
			const message =
				setOrCreateAssistantMessage(entry, taskId, text) ?? createAssistantMessage(entry, taskId, text);
			input.emitMessage(taskId, message);
			emitAssistantTextSummary(input, text);
		} else {
			emitSummary(input, withHeartbeat({ lastOutputAt: now() }, { token: true }));
		}
		entry.activeAssistantMessageId = null;
		return;
	}

	if (chunkEvent?.payload.stream === "agent") {
		const chunk = chunkEvent.payload.chunk;
		if (chunk.length === 0 || isLikelySerializedAgentEventChunk(chunk)) {
			return;
		}
		input.emitMessage(taskId, appendAssistantChunk(entry, taskId, chunk));
		const fullPreviewText = normalizePreviewText(chunk);
		const previewText = toPreviewText(fullPreviewText);
		const retainedToolActivity = getRetainedNKleinToolActivity(entry);
		emitSummary(
			input,
			withHeartbeat(
				{
					state: "running",
					lastOutputAt: now(),
					lastHookAt: now(),
					latestHookActivity: {
						activityText: previewText ?? "Agent active",
						toolName: retainedToolActivity.toolName,
						toolInputSummary: retainedToolActivity.toolInputSummary,
						finalMessage: fullPreviewText,
						hookEventName: "assistant_delta",
						notificationType: null,
						source: "nklein-sdk",
					},
				},
				{ token: true },
			),
		);
		return;
	}

	if (hookEvent) {
		const hookEventName =
			typeof hookEvent.payload.hookEventName === "string" ? hookEvent.payload.hookEventName : null;
		const toolName = typeof hookEvent.payload.toolName === "string" ? hookEvent.payload.toolName : null;
		const activityText = hookEventName && toolName ? `${hookEventName}: ${toolName}` : hookEventName;
		emitSummary(
			input,
			withHeartbeat({
				lastHookAt: now(),
				latestHookActivity: {
					activityText,
					toolName,
					toolInputSummary: null,
					finalMessage: null,
					hookEventName,
					notificationType: null,
					source: "nklein-sdk",
				},
			}),
		);
		return;
	}

	if (endedEvent) {
		const interrupted =
			endedEvent.payload.reason.includes("abort") || endedEvent.payload.reason.includes("interrupt");
		if (interrupted && input.pendingTurnCancelTaskIds.has(taskId)) {
			emitTurnCanceled(input);
			return;
		}
		clearActiveTurnState(entry);
		emitSummary(
			input,
			withHeartbeat(
				{
					state: interrupted ? "interrupted" : "awaiting_review",
					reviewReason: interrupted ? "interrupted" : "exit",
					lastOutputAt: now(),
				},
				{ status: "lost" },
			),
		);
		return;
	}

	if (statusEvent) {
		if (statusEvent.payload.status !== "running") {
			clearActiveTurnState(entry);
		}
		emitSummary(
			input,
			withHeartbeat(
				{
					state:
						statusEvent.payload.status === "running" &&
						!(entry.summary.state === "awaiting_review" && canReturnToRunning(entry.summary.reviewReason))
							? "running"
							: entry.summary.state,
					lastOutputAt: now(),
				},
				{ status: statusEvent.payload.status === "running" ? "healthy" : "stale" },
			),
		);
	}
}

function emitSummary(input: ApplyNKleinSessionEventInput, patch: Partial<RuntimeTaskSessionSummary>): void {
	input.emitSummary(updateSummary(input.entry, patch));
}

function emitTurnCanceled(input: ApplyNKleinSessionEventInput): void {
	input.pendingTurnCancelTaskIds.delete(input.taskId);
	clearActiveTurnState(input.entry);
	emitSummary(input, {
		state: "idle",
		reviewReason: null,
		lastOutputAt: now(),
		lastHookAt: now(),
		lastHeartbeatAt: now(),
		heartbeatStatus: "lost",
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
}
