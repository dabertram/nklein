import {
	type ChatAgentModelResponse,
	type ChatAgentStep,
	type ChatToolCall,
	type ChatToolResult,
	runChatAgentLoop,
} from "./chat-agent-loop";
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
 * One tool-using chat turn (todo §5.M) — the tool-enabled analog of `runChatTurn`. It composes the turn context
 * (lean window + recalled memory + goal), renders the prompt, then drives the agent loop (model → tool calls →
 * gated execution → repeat) to a final answer, and persists the user message + the assistant's final reply. All
 * side effects (stores, the agent model, the gated tool executor, the message-fold) are injected, so it's
 * fully unit-testable; the live wiring supplies the local model + the policy-gated executor.
 */

export interface ChatAgentTurnDeps {
	readTranscript: (sessionId: string) => Promise<ChatMessage[]>;
	readMemories: (sessionId: string) => Promise<ChatMemory[]>;
	appendMessage: (sessionId: string, input: { role: ChatMessage["role"]; content: string }) => Promise<ChatMessage>;
	summarize: (overflow: readonly ChatMessage[]) => Promise<string>;
	estimateTokens: (text: string) => number;
	embed?: (text: string) => Promise<number[] | null>;
	/** The agent model: prompt + whether tools are offered → text + requested tool calls. */
	model: (messages: readonly ChatPromptMessage[], allowTools: boolean) => Promise<ChatAgentModelResponse>;
	/** Executes one tool call (the policy-gated + audited executor in the live wiring). */
	executeTool: (call: ChatToolCall) => Promise<ChatToolResult>;
	appendToolExchange: (
		messages: readonly ChatPromptMessage[],
		response: ChatAgentModelResponse,
		results: readonly ChatToolResult[],
	) => ChatPromptMessage[];
}

export interface ChatAgentTurnResult {
	userMessage: ChatMessage;
	assistantMessage: ChatMessage;
	steps: ChatAgentStep[];
	context: ChatTurnContext;
	hitIterationLimit: boolean;
}

export async function runChatAgentTurn(
	input: {
		session: ChatSession;
		userMessage: string;
		tokenBudget: number;
		memoryLimit?: number;
		maxIterations?: number;
	},
	deps: ChatAgentTurnDeps,
): Promise<ChatAgentTurnResult> {
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
	const loop = await runChatAgentLoop(
		{ messages: prompt, ...(typeof input.maxIterations === "number" ? { maxIterations: input.maxIterations } : {}) },
		{ complete: deps.model, executeTool: deps.executeTool, appendToolExchange: deps.appendToolExchange },
	);
	const userMessage = await deps.appendMessage(input.session.id, { role: "user", content: input.userMessage });
	const assistantMessage = await deps.appendMessage(input.session.id, { role: "assistant", content: loop.finalText });
	return { userMessage, assistantMessage, steps: loop.steps, context, hitIterationLimit: loop.hitIterationLimit };
}

export interface ChatAgentConversationDeps extends ChatAgentTurnDeps {
	/** Read the next user line; resolve null at end-of-input (EOF / closed stream). */
	readLine: () => Promise<string | null>;
	/** Emit assistant replies (+ any per-turn notes, e.g. which tools ran). */
	write: (text: string) => void;
}

/**
 * Interactive tool-using conversation (the agent-loop analog of `runChatConversation`): read a line, run a full
 * tool-using turn against the session, surface which tools ran, emit the final reply, repeat until EOF or `/exit`.
 * Blank lines are skipped. Returns the number of turns taken. I/O is injected so it's unit-testable; the CLI wires
 * stdin/stdout.
 */
export async function runChatAgentConversation(
	input: { session: ChatSession; tokenBudget: number; memoryLimit?: number; maxIterations?: number },
	deps: ChatAgentConversationDeps,
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
		const result = await runChatAgentTurn(
			{
				session: input.session,
				userMessage,
				tokenBudget: input.tokenBudget,
				...(typeof input.memoryLimit === "number" ? { memoryLimit: input.memoryLimit } : {}),
				...(typeof input.maxIterations === "number" ? { maxIterations: input.maxIterations } : {}),
			},
			deps,
		);
		if (result.steps.length > 0) {
			const toolNames = result.steps.map((step) => step.toolCall.name).join(", ");
			deps.write(`  (used: ${toolNames})\n`);
		}
		deps.write(`${result.assistantMessage.content}\n`);
		turns += 1;
	}
	return turns;
}
