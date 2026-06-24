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
	/** The model call — the rendered prompt in, the assistant reply text out (a local model under invariant #1).
	 *  When `onToken` is supplied and the model streams, tokens arrive incrementally before the reply resolves. */
	complete: (prompt: ChatPromptMessage[], onToken?: (delta: string) => void) => Promise<string>;
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
	input: {
		session: ChatSession;
		userMessage: string;
		tokenBudget: number;
		memoryLimit?: number;
		/** Receives reply tokens as they stream (when the model + deps support it). */
		onToken?: (delta: string) => void;
	},
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
	const reply = await deps.complete(prompt, input.onToken);
	const userMessage = await deps.appendMessage(input.session.id, { role: "user", content: input.userMessage });
	const assistantMessage = await deps.appendMessage(input.session.id, { role: "assistant", content: reply });
	return { userMessage, assistantMessage, context, prompt };
}

export interface ChatConversationDeps extends ChatRuntimeDeps {
	/** Read the next user line; resolve null at end-of-input (EOF / closed stream). */
	readLine: () => Promise<string | null>;
	/** Emit the assistant reply (+ any prompts). */
	write: (text: string) => void;
}

/**
 * Run an interactive multi-turn conversation: read a line, run a turn against the session (each turn re-loads the
 * transcript + recalls memory + re-anchors the goal), emit the reply, repeat until EOF or `/exit`. Blank lines are
 * skipped. Returns the number of turns taken. I/O is injected so the loop is unit-testable; the CLI wires stdin.
 */
export async function runChatConversation(
	input: { session: ChatSession; tokenBudget: number; memoryLimit?: number },
	deps: ChatConversationDeps,
): Promise<number> {
	let turns = 0;
	while (true) {
		const line = await deps.readLine();
		if (line === null) {
			break;
		}
		const userMessage = line.trim();
		if (userMessage.length === 0) {
			continue;
		}
		if (userMessage === "/exit" || userMessage === "/quit") {
			break;
		}
		let streamed = false;
		const result = await runChatTurn(
			{
				session: input.session,
				userMessage,
				tokenBudget: input.tokenBudget,
				...(typeof input.memoryLimit === "number" ? { memoryLimit: input.memoryLimit } : {}),
				onToken: (delta) => {
					streamed = true;
					deps.write(delta);
				},
			},
			deps,
		);
		// When the reply streamed, the tokens were already written — just end the line; otherwise print it whole.
		deps.write(streamed ? "\n" : `${result.assistantMessage.content}\n`);
		turns += 1;
	}
	return turns;
}
