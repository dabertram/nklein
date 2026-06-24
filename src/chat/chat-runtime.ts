import type { ChatMemory } from "./chat-memory-store";
import type { ChatSession } from "./chat-session-store";
import type { ChatMessage } from "./chat-transcript-store";
import {
	type ChatPromptMessage,
	type ChatTurnContext,
	composeChatTurnContext,
	renderChatTurnPrompt,
} from "./chat-turn-context";

/**
 * Chat runtime turn loop (todo §5.M) — the orchestration that drives one chat turn end-to-end, tying the §5.M
 * foundations together: load the prior transcript + memories, compose the lean-window + recalled-memory context
 * (carrying the session goal), render the model prompt, call the model, and persist both the user message and the
 * assistant reply. All side effects (stores, model call, embedder, summarizer, token estimate) are injected, so
 * this stays pure-orchestration + unit-testable; the live wiring supplies the real transcript/memory stores and a
 * local-model completion. The tool-using multi-turn agent loop + streaming is the next, live-integration layer.
 */

export interface ChatRuntimeDeps {
	readTranscript: (sessionId: string) => Promise<ChatMessage[]>;
	readMemories: (sessionId: string) => Promise<ChatMemory[]>;
	appendMessage: (sessionId: string, input: { role: ChatMessage["role"]; content: string }) => Promise<ChatMessage>;
	/** The model call — the rendered prompt in, the assistant reply text out (a local model under invariant #1). */
	complete: (prompt: ChatPromptMessage[]) => Promise<string>;
	/** Summarize the lean-window overflow (a model call). */
	summarize: (overflow: readonly ChatMessage[]) => Promise<string>;
	/** Estimate a string's token cost for the lean-window budget. */
	estimateTokens: (text: string) => number;
	/** The in-process embedder for long-term recall; omit to use lexical recall. */
	embed?: (text: string) => Promise<number[] | null>;
}

export interface ChatTurnResult {
	userMessage: ChatMessage;
	assistantMessage: ChatMessage;
	context: ChatTurnContext;
	prompt: ChatPromptMessage[];
}

export async function runChatTurn(
	input: { session: ChatSession; userMessage: string; tokenBudget: number; memoryLimit?: number },
	deps: ChatRuntimeDeps,
): Promise<ChatTurnResult> {
	// Compose against the prior transcript so the new message is the query, not part of the window.
	const priorTranscript = await deps.readTranscript(input.session.id);
	const memories = await deps.readMemories(input.session.id);
	const context = await composeChatTurnContext(
		{
			sessionId: input.session.id,
			query: input.userMessage,
			goal: input.session.goal,
			transcript: priorTranscript,
			memories,
			tokenBudget: input.tokenBudget,
			estimateTokens: deps.estimateTokens,
			...(typeof input.memoryLimit === "number" ? { memoryLimit: input.memoryLimit } : {}),
		},
		{ summarize: deps.summarize, ...(deps.embed ? { embed: deps.embed } : {}) },
	);
	const prompt = renderChatTurnPrompt(context, input.userMessage);
	const reply = await deps.complete(prompt);
	const userMessage = await deps.appendMessage(input.session.id, { role: "user", content: input.userMessage });
	const assistantMessage = await deps.appendMessage(input.session.id, { role: "assistant", content: reply });
	return { userMessage, assistantMessage, context, prompt };
}
