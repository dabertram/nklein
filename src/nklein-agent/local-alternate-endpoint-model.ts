/** F3.10 — local native/Messages endpoint fallback adapted to the shared swarm AgentModel seam. */
import type { AgentMessage, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { iterateEndpointStrategies } from "../core/endpoint-iteration-loop";
import { callLocalAnthropicMessages, callLocalNativeChatStream } from "../core/local-endpoint-clients";
import type { LocalModelEndpointKind } from "../core/local-model-endpoint-strategy";
import { NativeChatSessionController, type NativeChatSessionPlan } from "../core/local-native-chat-session";
import type { NativeChatPluginIntegration, ParsedNativeChatResponse } from "../core/local-native-chat-shape";

/**
 * Explicit grant for an LM Studio-hosted MCP plugin. LM Studio executes these tools itself, outside !Klein's broker,
 * so task sessions pass none. A non-sandbox caller must attest that every allowed tool is replay-safe before enabling
 * stateful fallback (a stale response id may require one stateless replay).
 */
export interface NativeMcpIntegrationGrant {
	pluginId: string;
	allowedTools: readonly string[];
	replaySafe: true;
}

export interface NativeSessionObservation {
	type: "session_started" | "stateful_delta" | "stateless_fallback" | "invalidated" | "mcp_tools_executed";
	detail: string;
}

export interface LocalAlternateEndpointModelOptions {
	baseUrl: string;
	modelId: string;
	baseMaxTokens?: number | null;
	fetchImpl?: typeof fetch;
	headers?: Record<string, string>;
	preferredKind?: LocalModelEndpointKind | null;
	onWinningKind?: (kind: LocalModelEndpointKind) => void;
	nativeMcpIntegrations?: readonly NativeMcpIntegrationGrant[];
	onNativeSessionObservation?: (observation: NativeSessionObservation) => void;
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
	messages: readonly AgentMessage[] = request.messages,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
	const mapped = messages.map((message) => ({
		role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
		content: agentMessageToEndpointText(message),
	}));
	// COALESCE consecutive same-role wire messages. The domain legitimately holds [tool, user] sequences
	// (a tool result followed by e.g. the adaptive retry note), and the tool→user wire mapping above turns
	// them into consecutive user messages — which Mistral-family Jinja templates hard-500 ("Conversation
	// roles must alternate"; wire-proven 2026-07-17, and caught LIVE at this seam by N3's ministral
	// tripwire 2026-08-04: 4 fires per drain, every one a tool_result+retry-note pair). The wire builder
	// is where the adjacency is CREATED, so the wire builder owns alternation safety — for every source,
	// past and future, not just the retry note.
	const coalesced: Array<{ role: "user" | "assistant"; content: string }> = [];
	for (const message of mapped) {
		const previous = coalesced.at(-1);
		if (previous && previous.role === message.role) {
			previous.content = `${previous.content}\n\n${message.content}`;
			continue;
		}
		coalesced.push({ ...message });
	}
	return [
		...(request.systemPrompt?.trim() ? [{ role: "system" as const, content: request.systemPrompt }] : []),
		...coalesced,
	];
}

function isAdaptiveRetryInstruction(message: AgentMessage): boolean {
	return message.role === "user" && message.id.startsWith("nklein-retry-");
}

function maxTokens(request: AgentModelRequest, fallback: number | null | undefined): number {
	return typeof request.options?.maxTokens === "number" && request.options.maxTokens > 0
		? Math.trunc(request.options.maxTokens)
		: Math.max(1, Math.trunc(fallback ?? 1_024));
}

function nativeIntegrations(grants: readonly NativeMcpIntegrationGrant[] | undefined): NativeChatPluginIntegration[] {
	if (!grants) return [];
	const integrations: NativeChatPluginIntegration[] = [];
	const seen = new Set<string>();
	for (const grant of grants) {
		const id = grant.pluginId.trim();
		const allowedTools = [...new Set(grant.allowedTools.map((tool) => tool.trim()).filter(Boolean))].sort();
		if (!id || allowedTools.length === 0 || grant.replaySafe !== true || seen.has(id)) continue;
		seen.add(id);
		integrations.push({ type: "plugin", id, allowed_tools: allowedTools });
	}
	return integrations.sort((left, right) => left.id.localeCompare(right.id));
}

function observe(options: LocalAlternateEndpointModelOptions, observation: NativeSessionObservation): void {
	try {
		options.onNativeSessionObservation?.(observation);
	} catch {
		// Observability must never alter endpoint recovery.
	}
}

function nativePolicyKey(
	options: LocalAlternateEndpointModelOptions,
	integrations: readonly NativeChatPluginIntegration[],
): string {
	return JSON.stringify({ model: options.modelId, integrations });
}

function nativeEvents(response: ParsedNativeChatResponse, usable: boolean, error: string): AgentModelEvent[] {
	return [
		...(response.reasoning ? [{ type: "reasoning-delta" as const, text: response.reasoning }] : []),
		...(response.text ? [{ type: "text-delta" as const, text: response.text }] : []),
		usable
			? { type: "finish" as const, reason: "stop" as const }
			: { type: "finish" as const, reason: "error" as const, error },
	];
}

/**
 * Build a buffered local endpoint fallback. The endpoint sub-ladder is one `alternate_endpoint` policy rung; native
 * SSE is tried before Messages, transient retries are disabled, and only a complete usable result becomes visible.
 */
export function createLocalAlternateEndpointModel(options: LocalAlternateEndpointModelOptions): AgentModel {
	const urls = endpointUrls(options.baseUrl);
	const session = new NativeChatSessionController();
	const integrations = nativeIntegrations(options.nativeMcpIntegrations);
	const policyKey = nativePolicyKey(options, integrations);
	return {
		stream(request): AsyncIterable<AgentModelEvent> {
			return (async function* () {
				let winningEvents: AgentModelEvent[] | null = null;
				let lastEvents: AgentModelEvent[] = [];
				if (request.tools.length > 0) {
					if (session.invalidate()) {
						observe(options, {
							type: "invalidated",
							detail: "SDK tools require the brokered Messages endpoint.",
						});
					}
				}
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
							const canonicalMessages = neutralMessages(
								request,
								request.messages.filter((message) => !isAdaptiveRetryInstruction(message)),
							);
							const attemptMessages = neutralMessages(
								{ ...request, systemPrompt: undefined },
								request.messages.filter(isAdaptiveRetryInstruction),
							);
							const execute = async (plan: NativeChatSessionPlan): Promise<boolean> => {
								const streamed = await callLocalNativeChatStream({
									url: urls.native,
									model: options.modelId,
									messages: plan.messages,
									maxOutputTokens: maxTokens(request, options.baseMaxTokens),
									store: true,
									...(plan.previousResponseId ? { previousResponseId: plan.previousResponseId } : {}),
									...(integrations.length > 0 ? { integrations } : {}),
									...(typeof request.options?.temperature === "number"
										? { temperature: request.options.temperature }
										: {}),
									fetchImpl: options.fetchImpl,
									maxRetries: 0,
									signal: request.signal,
									headers: options.headers,
								});
								const response = streamed.result;
								const usable =
									streamed.termination !== "eof_without_chat_end" &&
									streamed.errors.length === 0 &&
									response.text.trim().length > 0;
								const error =
									streamed.errors.map((item) => item.message).join("; ") ||
									`Native stream ended as ${streamed.termination}.`;
								const events = nativeEvents(response, usable, error);
								lastEvents = events;
								if (response.toolCalls.length > 0) {
									observe(options, {
										type: "mcp_tools_executed",
										detail: response.toolCalls.map((call) => call.name).join(", "),
									});
								}
								if (usable) {
									winningEvents = events;
									const accepted = streamed.protocolErrors.length === 0 && session.accept(plan, response);
									if (accepted) {
										observe(options, {
											type: plan.mode === "stateful_delta" ? "stateful_delta" : "session_started",
											detail: plan.mode,
										});
									} else {
										const invalidated = session.invalidate();
										if (invalidated) {
											observe(options, {
												type: "invalidated",
												detail: "Native response did not provide a clean chainable response id.",
											});
										}
									}
								}
								return usable;
							};
							let plan = session.plan(canonicalMessages, policyKey, attemptMessages);
							if (plan.mode === "stateful_delta") {
								try {
									if (await execute(plan)) return true;
								} catch (error) {
									if (request.signal?.aborted) throw error;
								}
								session.invalidate();
								observe(options, {
									type: "stateless_fallback",
									detail:
										"Stateful native continuation failed; replaying the caller-owned full transcript once.",
								});
								plan = session.plan(canonicalMessages, policyKey, attemptMessages);
							}
							return await execute(plan);
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
						// §5.AN on the messages shape: a reasoning model may put its ENTIRE answer in `thinking`
						// blocks with no text block at all (N3's reasoning-only family cell caught this live,
						// 2026-08-04 — such turns parsed empty and the session errored). When prose was expected
						// and only reasoning arrived, the reasoning IS the answer; ordinary text keeps precedence.
						const visibleText = response.text.trim().length > 0 ? response.text : (response.reasoningText ?? "");
						const events: AgentModelEvent[] = [
							...(visibleText ? [{ type: "text-delta" as const, text: visibleText }] : []),
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
							request.tools.length > 0 ? response.toolCalls.length > 0 : visibleText.trim().length > 0;
						if (usable) winningEvents = events;
						if (usable) {
							if (session.invalidate()) {
								observe(options, { type: "invalidated", detail: "Messages endpoint won the recovery turn." });
							}
						}
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
