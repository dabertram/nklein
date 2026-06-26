import { type FocusChain, formatFocusChainForPrompt } from "../core/focus-chain";
import { isTemporalContextRelevant } from "../core/temporal-awareness";
import { stripNarratedToolCallMarkup } from "../nklein-agent/nklein-narrated-tool-call";
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
	/** Load the session's focus chain (todo §5.M G4) so it's re-anchored into the turn; omit for no focus chain. */
	readFocusChain?: (sessionId: string) => Promise<FocusChain | null>;
	appendMessage: (sessionId: string, input: { role: ChatMessage["role"]; content: string }) => Promise<ChatMessage>;
	summarize: (overflow: readonly ChatMessage[]) => Promise<string>;
	estimateTokens: (text: string) => number;
	embed?: (text: string) => Promise<number[] | null>;
	/** The agent model: prompt + whether tools are offered → text + requested tool calls. `onToken` is passed only on
	 *  the final (no-tool) answer call (hybrid streaming, todo §5.M G3a) — the model streams the reply when it can. */
	model: (
		messages: readonly ChatPromptMessage[],
		allowTools: boolean,
		onToken?: (delta: string) => void,
	) => Promise<ChatAgentModelResponse>;
	/** Executes one tool call (the policy-gated + audited executor in the live wiring). */
	executeTool: (call: ChatToolCall) => Promise<ChatToolResult>;
	appendToolExchange: (
		messages: readonly ChatPromptMessage[],
		response: ChatAgentModelResponse,
		results: readonly ChatToolResult[],
	) => ChatPromptMessage[];
	/** The clock for the temporal-awareness lighthouse (§5.AC); injected for determinism, defaults to `new Date()`. */
	now?: () => Date;
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
		/** Streams the final reply token-by-token (hybrid streaming, todo §5.M G3a); server-side only — callbacks
		 *  can't cross the tRPC wire. Persisted reply is still the cleaned/stripped text. */
		onToken?: (delta: string) => void;
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
	// The §5.AC date is relevance-gated (§5.AE JIT composition): inject only when the turn is temporal/freshness-relevant.
	const now = isTemporalContextRelevant({ text: input.userMessage }) ? (deps.now ?? (() => new Date()))() : undefined;
	const prompt = renderChatTurnPrompt(context, input.userMessage, now ? { now } : {});
	// Re-anchor the agent's focus chain (todo §5.M G4): lead the turn with its current checklist so a small model
	// stays on-plan, and offer `update_focus_chain` (wired into the tool set) to keep it current.
	const focusChain = deps.readFocusChain ? await deps.readFocusChain(input.session.id) : null;
	const messages: ChatPromptMessage[] = focusChain
		? [
				{
					role: "system",
					content: `Your current focus chain (update it with the update_focus_chain tool as you make progress):\n${formatFocusChainForPrompt(focusChain)}`,
				},
				...prompt,
			]
		: prompt;
	const loop = await runChatAgentLoop(
		{
			messages,
			...(typeof input.maxIterations === "number" ? { maxIterations: input.maxIterations } : {}),
			...(input.onToken ? { onToken: input.onToken } : {}),
		},
		{ complete: deps.model, executeTool: deps.executeTool, appendToolExchange: deps.appendToolExchange },
	);
	// §5.O: weak models sometimes narrate a tool call as text in their final answer instead of confirming what they
	// did. Strip that markup from the user-facing reply; if nothing readable remains but tools ran, confirm briefly.
	const cleaned = stripNarratedToolCallMarkup(loop.finalText);
	const finalText =
		cleaned.length > 0
			? cleaned
			: loop.steps.length > 0
				? `Done. (used: ${summarizeToolsUsed(loop.steps)})`
				: loop.finalText;
	const userMessage = await deps.appendMessage(input.session.id, { role: "user", content: input.userMessage });
	const assistantMessage = await deps.appendMessage(input.session.id, { role: "assistant", content: finalText });
	return { userMessage, assistantMessage, steps: loop.steps, context, hitIterationLimit: loop.hitIterationLimit };
}

/** Distinct tool names used across the turn's steps, in first-seen order — for the narration-fallback confirmation. */
function summarizeToolsUsed(steps: readonly ChatAgentStep[]): string {
	return [...new Set(steps.map((step) => step.toolCall.name))].join(", ");
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
