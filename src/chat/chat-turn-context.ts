import { consolidateChatContextWindow, splitChatContextWindow } from "./chat-context-window";
import { type ChatMemory, type ChatMemoryRecall, recallChatMemories } from "./chat-memory-store";
import type { ChatMessage } from "./chat-transcript-store";

/**
 * Compose one chat turn's context (todo §5.M) — the pure heart of the chat agent runtime's memory management.
 * It ties the §5.M foundations together: the short-term lean window ([chat-context-window.ts](./chat-context-window.ts))
 * keeps the recent transcript verbatim and rolls the overflow into a summary, while long-term recall
 * ([chat-memory-store.ts](./chat-memory-store.ts)) "wakes up" the memories most associated with the new message.
 *
 * The model calls (summarize, embed) are injected, so this stays pure + fully unit-testable; the runtime supplies
 * the real token estimator + summarizer + the in-process embedder (degrading to lexical recall when it's the
 * lexical fallback). The result is a structured context the runtime renders into its model's message format.
 */

export interface ChatTurnContext {
	/** The session's standing objective, re-anchored into every turn so it stays in focus (todo §5.M). */
	goal: string | null;
	/** A rolled-up summary of the overflow beyond the lean window, or null when nothing overflowed. */
	summary: string | null;
	/** Long-term memories semantically recalled for this turn (highest score first). */
	recalledMemories: ChatMemoryRecall[];
	/** The most recent transcript messages kept verbatim within the token budget. */
	recentMessages: ChatMessage[];
}

export async function composeChatTurnContext(
	input: {
		sessionId: string;
		/** The incoming user message text — drives long-term recall. */
		query: string;
		/** The session's standing objective, carried into the turn context unchanged. */
		goal?: string | null;
		transcript: readonly ChatMessage[];
		memories: readonly ChatMemory[];
		tokenBudget: number;
		estimateTokens: (text: string) => number;
		memoryLimit?: number;
	},
	deps: {
		embed?: (text: string) => Promise<number[] | null>;
		summarize: (overflow: readonly ChatMessage[]) => Promise<string>;
	},
): Promise<ChatTurnContext> {
	const window = splitChatContextWindow({
		messages: input.transcript,
		tokenBudget: input.tokenBudget,
		estimateTokens: input.estimateTokens,
	});
	const { summary } = await consolidateChatContextWindow(window, deps.summarize);
	const recalledMemories = await recallChatMemories(
		{
			query: input.query,
			sessionId: input.sessionId,
			memories: input.memories,
			limit: input.memoryLimit ?? 5,
		},
		{ embed: deps.embed },
	);
	return { goal: input.goal ?? null, summary, recalledMemories, recentMessages: window.recent };
}
