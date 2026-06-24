import type {
	LocalLlmChatMessage,
	LocalLlmCompletion,
	LocalLlmSamplingOptions,
	LocalLlmToolCompletion,
	LocalLlmToolDefinition,
} from "../nklein-sdk/nklein-local-llm-client";
import type { ChatAgentModelResponse, ChatToolResult } from "./chat-agent-loop";
import type { ChatMessage } from "./chat-transcript-store";
import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * Adapter wiring the chat runtime (todo §5.M) to a local LLM client ([nklein-local-llm-client.ts]
 * (../nklein-sdk/nklein-local-llm-client.ts), which is fail-closed against cloud per invariant #1). It provides
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
				// Stream raw deltas to the caller (live view); persist the reasoning-stripped reply.
				const { content } = await client.completeStream({ messages, sampling }, onToken);
				return stripReasoning(content);
			}
			const { content } = await client.complete({ messages, sampling });
			return stripReasoning(content);
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
			return stripReasoning(content);
		},
	};
}

export interface ChatAgentCompletionClient {
	completeWithTools(
		request: { messages: LocalLlmChatMessage[]; sampling?: LocalLlmSamplingOptions },
		tools: readonly LocalLlmToolDefinition[],
	): Promise<LocalLlmToolCompletion>;
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
		const { content, toolCalls } = await client.completeWithTools(
			{ messages: messages.map((message) => ({ role: message.role, content: message.content })), sampling },
			allowTools ? toolDefinitions : [],
		);
		return {
			text: stripReasoning(content),
			toolCalls: toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
		};
	};
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
