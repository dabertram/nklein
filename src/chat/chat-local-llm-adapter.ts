import type {
	LocalLlmChatMessage,
	LocalLlmCompletion,
	LocalLlmSamplingOptions,
} from "../nklein-sdk/nklein-local-llm-client";
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
