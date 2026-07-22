/** F3.10 — local native/Messages endpoint fallback adapted to the shared swarm AgentModel seam. */
import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { iterateEndpointStrategies } from "../core/endpoint-iteration-loop";
import { callLocalAnthropicMessages, callLocalNativeChatStream } from "../core/local-endpoint-clients";
import type { LocalModelEndpointKind } from "../core/local-model-endpoint-strategy";

export interface LocalAlternateEndpointModelOptions {
	baseUrl: string;
	modelId: string;
	baseMaxTokens?: number | null;
	fetchImpl?: typeof fetch;
	headers?: Record<string, string>;
	preferredKind?: LocalModelEndpointKind | null;
	onWinningKind?: (kind: LocalModelEndpointKind) => void;
}

function endpointUrls(baseUrl: string): { native: string; messages: string } {
	const parsed = new URL(baseUrl);
	const path = parsed.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "");
	const root = `${parsed.origin}${path}`;
	return { native: `${root}/api/v1/chat`, messages: `${root}/v1/messages` };
}

function stringify(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/** Losslessly retain action/result identity when crossing into a text-only endpoint message shape. */
export function agentMessageToEndpointText(message: AgentMessage): string {
	return message.content
		.map((part) => {
			if (part.type === "text") return part.text;
			if (part.type === "reasoning") return `[reasoning]\n${part.text}`;
			if (part.type === "file") return `[file ${part.path}]\n${part.content}`;
			if (part.type === "image")
				return `[image ${part.mediaType ?? "unknown media type"} retained in original turn]`;
			if (part.type === "tool-call") {
				return `[tool_call id=${part.toolCallId} name=${part.toolName}]\n${stringify(part.input)}`;
			}
			return `[tool_result id=${part.toolCallId} name=${part.toolName} is_error=${part.isError === true}]\n${stringify(part.output)}`;
		})
		.join("\n");
}

function neutralMessages(
	request: AgentModelRequest,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
	return [
		...(request.systemPrompt?.trim() ? [{ role: "system" as const, content: request.systemPrompt }] : []),
		...request.messages.map((message) => ({
			role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
			content: agentMessageToEndpointText(message),
		})),
	];
}

function maxTokens(request: AgentModelRequest, fallback: number | null | undefined): number {
	return typeof request.options?.maxTokens === "number" && request.options.maxTokens > 0
		? Math.trunc(request.options.maxTokens)
		: Math.max(1, Math.trunc(fallback ?? 1_024));
}

/**
 * Build a non-streaming local endpoint fallback. The endpoint sub-ladder is one `alternate_endpoint` policy rung;
 * native is tried before Messages, transient retries are disabled, and only a usable result wins.
 */
export function createLocalAlternateEndpointModel(options: LocalAlternateEndpointModelOptions): AgentModel {
	const urls = endpointUrls(options.baseUrl);
	return {
		stream(request): AsyncIterable<AgentModelEvent> {
			return (async function* () {
				let winningEvents: AgentModelEvent[] | null = null;
				let lastEvents: AgentModelEvent[] = [];
				const result = await iterateEndpointStrategies({
					// Native chat can execute configured MCP integrations, but it still has no arbitrary custom-tool schema
					// field. !Klein's SDK tools therefore stay on Messages for a tool-required recovery turn.
					availableKinds:
						request.tools.length > 0 ? ["anthropic_messages"] : ["native_v1_chat", "anthropic_messages"],
					preferredKind: options.preferredKind,
					attempt: async (kind) => {
						if (request.signal?.aborted) throw request.signal.reason ?? new Error("request aborted");
						const messages = neutralMessages(request);
						if (kind === "native_v1_chat") {
							const streamed = await callLocalNativeChatStream({
								url: urls.native,
								model: options.modelId,
								messages,
								maxOutputTokens: maxTokens(request, options.baseMaxTokens),
								store: false,
								...(typeof request.options?.temperature === "number"
									? { temperature: request.options.temperature }
									: {}),
								fetchImpl: options.fetchImpl,
								maxRetries: 0,
								signal: request.signal,
								headers: options.headers,
							});
							const response = streamed.result;
							const events: AgentModelEvent[] = [
								...(response.reasoning ? [{ type: "reasoning-delta" as const, text: response.reasoning }] : []),
								...(response.text ? [{ type: "text-delta" as const, text: response.text }] : []),
								...response.toolCalls.map((call, index) => ({
									type: "tool-call-delta" as const,
									toolCallId: call.id || `native-${index + 1}`,
									toolName: call.name,
									inputText: JSON.stringify(call.args),
								})),
								streamed.termination !== "eof_without_chat_end" && streamed.errors.length === 0
									? { type: "finish" as const, reason: response.toolCalls.length > 0 ? "tool-calls" : "stop" }
									: {
											type: "finish" as const,
											reason: "error" as const,
											error:
												streamed.errors.map((error) => error.message).join("; ") ||
												`Native stream ended as ${streamed.termination}.`,
										},
							];
							lastEvents = events;
							const usable =
								streamed.termination !== "eof_without_chat_end" &&
								streamed.errors.length === 0 &&
								(request.tools.length > 0 ? response.toolCalls.length > 0 : response.text.trim().length > 0);
							if (usable) winningEvents = events;
							return usable;
						}
						const response = await callLocalAnthropicMessages({
							url: urls.messages,
							model: options.modelId,
							messages,
							maxTokens: maxTokens(request, options.baseMaxTokens),
							tools: request.tools,
							forceToolUse: request.tools.length > 0,
							...(typeof request.options?.temperature === "number"
								? { temperature: request.options.temperature }
								: {}),
							fetchImpl: options.fetchImpl,
							maxRetries: 0,
							signal: request.signal,
							headers: options.headers,
						});
						const reason =
							response.toolCalls.length > 0
								? "tool-calls"
								: response.stopReason === "max_tokens"
									? "max-tokens"
									: "stop";
						const events: AgentModelEvent[] = [
							...(response.text ? [{ type: "text-delta" as const, text: response.text }] : []),
							...response.toolCalls.map((call, index) => ({
								type: "tool-call-delta" as const,
								toolCallId: call.id || `messages-${index + 1}`,
								toolName: call.name,
								inputText: JSON.stringify(call.args),
							})),
							{ type: "finish" as const, reason },
						];
						lastEvents = events;
						const usable =
							request.tools.length > 0 ? response.toolCalls.length > 0 : response.text.trim().length > 0;
						if (usable) winningEvents = events;
						return usable;
					},
				});
				if (request.signal?.aborted) {
					throw request.signal.reason ?? new Error("request aborted");
				}
				if (result.winningKind) {
					try {
						options.onWinningKind?.(result.winningKind);
					} catch {
						// Observability must never alter endpoint recovery.
					}
				}
				const events = winningEvents ?? lastEvents;
				if (events.length > 0) {
					for (const event of events) yield event;
					return;
				}
				yield {
					type: "finish",
					reason: "error",
					error: `All local alternate endpoints failed: ${result.attempts.map((attempt) => `${attempt.kind}:${attempt.error ?? "unusable"}`).join(", ")}`,
				};
			})();
		},
	};
}
