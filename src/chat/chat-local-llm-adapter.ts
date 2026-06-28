import { MAX_ATTEMPT_SIMPLIFICATION_LEVEL, selectToolsForAttempt } from "../nklein-agent/nklein-attempt-simplification";
import { buildConstrainedToolCallSchema, parseConstrainedToolCall } from "../nklein-agent/nklein-constrained-tool-call";
import type {
	LocalLlmChatMessage,
	LocalLlmCompletion,
	LocalLlmSamplingOptions,
	LocalLlmStructuredFormat,
	LocalLlmToolCompletion,
	LocalLlmToolDefinition,
} from "../nklein-agent/nklein-local-llm-client";
import { detectResponseLoop } from "../nklein-agent/nklein-response-loop-detection";
import type { ChatAgentModelResponse, ChatToolResult } from "./chat-agent-loop";
import type { ChatMessage } from "./chat-transcript-store";
import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * Adapter wiring the chat runtime (todo §5.M) to a local LLM client ([nklein-local-llm-client.ts]
 * (../nklein-agent/nklein-local-llm-client.ts), which is fail-closed against cloud per invariant #1). It provides
 * the `complete` + `summarize` deps `runChatTurn` needs, mapping the rendered chat prompt to the client's
 * OpenAI-compatible messages and stripping any `<think>…</think>` a reasoning model leaves inline (observed live
 * with qwen3). The client is an interface so this is unit-testable with a fake; the live wiring passes a real
 * `LocalLlmClient` whose model is discovered from the loaded endpoint.
 */

export interface ChatCompletionClient {
	complete(request: {
		messages: LocalLlmChatMessage[];
		sampling?: LocalLlmSamplingOptions;
	}): Promise<LocalLlmCompletion>;
	/** Optional streaming variant; when present and an `onToken` is given, the reply is streamed. */
	completeStream?(
		request: { messages: LocalLlmChatMessage[]; sampling?: LocalLlmSamplingOptions },
		onChunk: (delta: string) => void,
	): Promise<LocalLlmCompletion>;
}

export interface ChatModelDeps {
	/** Completes the prompt; when `onToken` is given and the client streams, tokens arrive incrementally. */
	complete: (prompt: ChatPromptMessage[], onToken?: (delta: string) => void) => Promise<string>;
	summarize: (overflow: readonly ChatMessage[]) => Promise<string>;
}

/** Strip inline `<think>…</think>` reasoning blocks a model may leave in its content. */
function stripReasoning(content: string): string {
	return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * Clean a raw model reply: strip inline reasoning, then collapse any runaway repeated-tail loop to its useful prefix
 * (§5.AA salvage — grounded in the §5.Z sweep where a model looped an identical final sentence). `detectResponseLoop`
 * returns the text unchanged when there's no loop, so this is always safe to apply.
 */
function cleanModelReply(content: string): string {
	return detectResponseLoop(stripReasoning(content)).salvagedText;
}

const DEFAULT_SAMPLING: LocalLlmSamplingOptions = { temperature: 0.3, maxTokens: 1024 };

export function createChatModelDeps(
	client: ChatCompletionClient,
	options: { sampling?: LocalLlmSamplingOptions } = {},
): ChatModelDeps {
	const sampling = options.sampling ?? DEFAULT_SAMPLING;
	return {
		complete: async (prompt, onToken) => {
			const messages = prompt.map((message) => ({ role: message.role, content: message.content }));
			if (onToken && client.completeStream) {
				// Stream raw deltas to the caller (live view); persist the cleaned (reasoning-stripped + loop-salvaged) reply.
				const { content } = await client.completeStream({ messages, sampling }, onToken);
				return cleanModelReply(content);
			}
			const { content } = await client.complete({ messages, sampling });
			return cleanModelReply(content);
		},
		summarize: async (overflow) => {
			const transcript = overflow.map((message) => `${message.role}: ${message.content}`).join("\n");
			const { content } = await client.complete({
				messages: [
					{
						role: "system",
						content:
							"Summarize the earlier conversation below into a concise note that preserves decisions, facts, and open threads. Reply with only the summary.",
					},
					{ role: "user", content: transcript },
				],
				sampling,
			});
			return cleanModelReply(content);
		},
	};
}

export interface ChatAgentCompletionClient {
	completeWithTools(
		request: { messages: LocalLlmChatMessage[]; sampling?: LocalLlmSamplingOptions },
		tools: readonly LocalLlmToolDefinition[],
	): Promise<LocalLlmToolCompletion>;
	/**
	 * Optional plain completion with constrained decoding (`response_format: json_schema`) — the §5.AA
	 * constrained-tool-call rung uses it to FORCE a parseable tool call. `LocalLlmClient.complete` satisfies this; a
	 * client without it simply skips the rung.
	 */
	complete?(request: {
		messages: LocalLlmChatMessage[];
		sampling?: LocalLlmSamplingOptions;
		format?: LocalLlmStructuredFormat;
	}): Promise<{ content: string }>;
}

/**
 * Provides the agent loop's `complete(messages, allowTools)` from a tools-aware local client: it offers the tool
 * definitions only when `allowTools` is set (so the forced final turn can't request more), maps the prompt to the
 * client's messages, and returns the reasoning-stripped text + parsed tool calls.
 */
export function createChatAgentModel(
	client: ChatAgentCompletionClient,
	toolDefinitions: readonly LocalLlmToolDefinition[],
	options: { sampling?: LocalLlmSamplingOptions } = {},
): (messages: readonly ChatPromptMessage[], allowTools: boolean) => Promise<ChatAgentModelResponse> {
	const sampling = options.sampling ?? DEFAULT_SAMPLING;
	return async (messages, allowTools) => {
		const wire = messages.map((message) => ({ role: message.role, content: message.content }));
		const offered = allowTools ? toolDefinitions : [];
		let response = await client.completeWithTools({ messages: wire, sampling }, offered);
		// §5.AA task-complexity ladder: a model that returns NO tool call when several were offered AND the instruction
		// names a tool it didn't call is likely drowning in tool-set complexity (grounded: phi-4 emits a clean call with
		// 1 tool but fails with 6). Retry with a progressively narrowed set anchored on the instruction — shrink the ask
		// instead of re-prompting. Only fires when there is a named-but-uncalled tool to anchor on (else no extra calls).
		if (offered.length > 1 && response.toolCalls.length === 0) {
			const instruction = lastUserText(messages);
			for (let level = 1; level <= MAX_ATTEMPT_SIMPLIFICATION_LEVEL; level += 1) {
				const selection = selectToolsForAttempt(offered, instruction, level);
				if (!selection.reduced) {
					break;
				}
				response = await client.completeWithTools({ messages: wire, sampling }, selection.tools);
				if (response.toolCalls.length > 0) {
					break;
				}
			}
		}
		// NOTE: narrated-tool-call recovery for the chat path lives in the client (`completeWithTools` runs
		// `parseNarratedToolCalls` over content + reasoning_content when a tools-offered turn returns no structured call —
		// see nklein-local-llm-client.ts). So by here `response.toolCalls` already includes any recovered call.
		//
		// §5.AA constrained-decoding rung — the LAST resort after tool-set reduction AND the client's narrated-recovery
		// both came up empty. Only fires when the instruction NAMES an offered tool (the same proven-safe anchor as the
		// reduction rung) so we never FORCE a call on a legit prose answer to a non-tool question. Re-ask with
		// `response_format: json_schema` constraining output to `{tool, arguments}`, then parse it back into a call.
		if (allowTools && response.toolCalls.length === 0 && client.complete) {
			const anchored = selectToolsForAttempt(offered, lastUserText(messages), 1);
			const schema = anchored.matchedNames.length > 0 ? buildConstrainedToolCallSchema(anchored.tools) : null;
			if (schema) {
				const constrained = await client.complete({
					messages: [
						...wire,
						{
							role: "system",
							content:
								'Emit the required tool call now as a single JSON object {"tool":"<name>","arguments":{…}} and nothing else.',
						},
					],
					sampling,
					format: { jsonSchema: schema },
				});
				const parsed = parseConstrainedToolCall(constrained.content, anchored.tools);
				if (parsed) {
					return {
						text: "",
						toolCalls: [
							{ id: `constrained-${Date.now().toString(36)}`, name: parsed.name, arguments: parsed.arguments },
						],
					};
				}
			}
		}
		return {
			text: cleanModelReply(response.content),
			toolCalls: response.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
		};
	};
}

/** The most recent user-authored instruction in the rendered prompt — the anchor for §5.AA tool-set narrowing. */
function lastUserText(messages: readonly ChatPromptMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") {
			return messages[index].content;
		}
	}
	return "";
}

/**
 * Fold an assistant turn's text + its tool results back into the message list for the next agent turn. Rather
 * than the strict OpenAI assistant-tool_calls + tool-role protocol (which the simple prompt-message shape can't
 * carry), the results are appended as plain `system` notes — robust across local models, which then see what each
 * tool returned and continue.
 */
export function appendChatToolExchange(
	messages: readonly ChatPromptMessage[],
	response: ChatAgentModelResponse,
	results: readonly ChatToolResult[],
): ChatPromptMessage[] {
	const appended: ChatPromptMessage[] = [];
	if (response.text.trim().length > 0) {
		appended.push({ role: "assistant", content: response.text });
	}
	for (const result of results) {
		appended.push({ role: "system", content: `Tool result (${result.callId}):\n${result.content}` });
	}
	return [...messages, ...appended];
}
