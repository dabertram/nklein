/**
 * §dsh#31 slice A2 + F2.30(e) — the SDK-side SESSION WIRE TAP: an {@link AgentModel} decorator that records the
 * request it is handed AND the response the provider streams back ("i always want to be able to see all in and
 * out from the models", David 2026-09-02), then passes events through untouched.
 *
 * Placement is the whole point: it wraps `base` — the INNERMOST model, before any other decorator — inside the
 * runtime's `modelWrapper`, so what it sees is the FINAL request after every `beforeModel` hook, messageBuilder,
 * and outer decorator (context_shrink, retry notes, prompt variants) has run, and the RAW provider events before
 * any outer decorator buffers or rewrites them. That makes its records the wire truth for the whole SDK session
 * family. Recording modes (src/state/session-request-log-store.ts): bounded (DEFAULT — per-field caps here,
 * per-file cap in the store), full (`NKLEIN_SESSION_REQUEST_LOG=1`, verbatim), off (`=0`). Best-effort: the tap
 * must never delay, reorder, or break a turn — deltas are accumulated as they pass and written only at stream end.
 */

import { randomUUID } from "node:crypto";
import type { AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { buildSessionRequestRecord, type SessionRequestWireMessage } from "../core/session-request-log";
import {
	appendSessionRequestRecord,
	appendSessionResponseRecord,
	isSessionRequestLogEnabled,
	sessionRequestLogMode,
} from "../state/session-request-log-store";
import { agentMessageToEndpointText } from "./local-alternate-endpoint-model";

export interface SessionRequestLogScope {
	sessionId: string;
	modelId: string;
	purpose: string;
}

/** Bounded-mode caps (full mode records verbatim). Sized for a useful preview, not an archive. */
const BOUNDED_MESSAGE_CHARS = 4_096;
const BOUNDED_ACCUMULATOR_CHARS = 16_384;
const BOUNDED_TOOL_ARGS_CHARS = 2_048;

function cap(text: string, limit: number | null, onCut: () => void): string {
	if (limit === null || text.length <= limit) {
		return text;
	}
	onCut();
	return `${text.slice(0, limit)}…[+${text.length - limit} chars]`;
}

/** Flatten the SDK request to wire rows with the SAME flattener the local endpoint path uses. */
function toWireMessages(request: AgentModelRequest, messageCap: number | null): SessionRequestWireMessage[] {
	return request.messages.map((message) => ({
		role: message.role,
		content: cap(agentMessageToEndpointText(message), messageCap, () => undefined),
	}));
}

function recordRequestBestEffort(request: AgentModelRequest, scope: SessionRequestLogScope, turnId: string): void {
	try {
		if (!isSessionRequestLogEnabled()) {
			return;
		}
		const bounded = sessionRequestLogMode() === "bounded";
		const record = buildSessionRequestRecord({
			sessionId: scope.sessionId,
			source: "sdk_model_wrapper",
			purpose: scope.purpose,
			modelId: scope.modelId,
			recordedAt: new Date().toISOString(),
			...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
			messages: toWireMessages(request, bounded ? BOUNDED_MESSAGE_CHARS : null),
			toolNames: request.tools.map((tool) => tool.name),
			turnId,
		});
		void appendSessionRequestRecord(record);
	} catch {
		// The tap is observational; a failure to record must never fail the turn.
	}
}

interface ResponseAccumulator {
	text: string;
	reasoningText: string;
	toolCalls: Map<string, { toolName: string; argumentsText: string }>;
	finishReason: string | null;
	error: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	truncated: boolean;
	startedAt: number;
}

function accumulate(state: ResponseAccumulator, event: AgentModelEvent, bounded: boolean): void {
	const limit = bounded ? BOUNDED_ACCUMULATOR_CHARS : null;
	const markCut = (): void => {
		state.truncated = true;
	};
	if (event.type === "text-delta") {
		if (limit === null || state.text.length < limit) {
			state.text = cap(state.text + event.text, limit, markCut);
		} else {
			state.truncated = true;
		}
		return;
	}
	if (event.type === "reasoning-delta") {
		if (limit === null || state.reasoningText.length < limit) {
			state.reasoningText = cap(state.reasoningText + event.text, limit, markCut);
		} else {
			state.truncated = true;
		}
		return;
	}
	if (event.type === "tool-call-delta") {
		const key = event.toolCallId ?? `index:${event.index ?? 0}`;
		const entry = state.toolCalls.get(key) ?? { toolName: event.toolName ?? "", argumentsText: "" };
		if (event.toolName) {
			entry.toolName = event.toolName;
		}
		const delta = event.inputText ?? (event.input !== undefined ? JSON.stringify(event.input) : "");
		const argsLimit = bounded ? BOUNDED_TOOL_ARGS_CHARS : null;
		if (argsLimit === null || entry.argumentsText.length < argsLimit) {
			entry.argumentsText = cap(entry.argumentsText + delta, argsLimit, markCut);
		} else if (delta.length > 0) {
			state.truncated = true;
		}
		state.toolCalls.set(key, entry);
		return;
	}
	if (event.type === "usage") {
		if (typeof event.usage.inputTokens === "number" && Number.isFinite(event.usage.inputTokens)) {
			state.inputTokens = event.usage.inputTokens;
		}
		if (typeof event.usage.outputTokens === "number" && Number.isFinite(event.usage.outputTokens)) {
			state.outputTokens = event.usage.outputTokens;
		}
		return;
	}
	if (event.type === "finish") {
		state.finishReason = String(event.reason);
		state.error = event.error ?? null;
	}
}

function recordResponseBestEffort(state: ResponseAccumulator, scope: SessionRequestLogScope, turnId: string): void {
	try {
		if (!isSessionRequestLogEnabled()) {
			return;
		}
		void appendSessionResponseRecord({
			schemaVersion: 1,
			kind: "response",
			sessionId: scope.sessionId,
			turnId,
			purpose: scope.purpose,
			modelId: scope.modelId,
			recordedAt: new Date().toISOString(),
			text: state.text,
			reasoningText: state.reasoningText,
			toolCalls: [...state.toolCalls.values()].filter((call) => call.toolName.length > 0),
			finishReason: state.finishReason,
			error: state.error,
			inputTokens: state.inputTokens,
			outputTokens: state.outputTokens,
			durationMs: Math.max(0, Date.now() - state.startedAt),
			truncated: state.truncated,
		});
	} catch {
		// Observational only.
	}
}

/** Wrap `base` so every request AND response that crosses the provider seam is appended to the wire log. */
export function createSessionRequestLogModel(base: AgentModel, scope: SessionRequestLogScope): AgentModel {
	return {
		stream(request: AgentModelRequest) {
			const turnId = randomUUID();
			recordRequestBestEffort(request, scope, turnId);
			const upstream = base.stream(request);
			if (!isSessionRequestLogEnabled()) {
				return upstream; // zero-overhead passthrough while the gate is closed
			}
			const bounded = sessionRequestLogMode() === "bounded";
			const state: ResponseAccumulator = {
				text: "",
				reasoningText: "",
				toolCalls: new Map(),
				finishReason: null,
				error: null,
				inputTokens: null,
				outputTokens: null,
				truncated: false,
				startedAt: Date.now(),
			};
			return (async function* tee(): AsyncIterable<AgentModelEvent> {
				try {
					for await (const event of await upstream) {
						try {
							accumulate(state, event, bounded);
						} catch {
							// Accumulation must never break the stream.
						}
						yield event;
					}
				} catch (error) {
					state.error = state.error ?? (error instanceof Error ? error.message : String(error));
					recordResponseBestEffort(state, scope, turnId);
					throw error;
				}
				recordResponseBestEffort(state, scope, turnId);
			})();
		},
	};
}
