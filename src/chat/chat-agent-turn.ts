import { isTruthyEnv } from "../core/env-flag";
import { type FocusChain, formatFocusChainForPrompt } from "../core/focus-chain";
import { decideFocusChainNudge } from "../core/focus-chain-nudge";
import { selectToolsForAttempt } from "../nklein-agent/nklein-attempt-simplification";
import { stripNarratedToolCallMarkup } from "../nklein-agent/nklein-narrated-tool-call";
import { buildAcceptanceCompletionGate, extractAcceptanceCommand } from "./chat-acceptance-completion";
import {
	type ChatAgentModelResponse,
	type ChatAgentStep,
	type ChatToolCall,
	type ChatToolResult,
	runChatAgentLoop,
} from "./chat-agent-loop";
import type { ChatMemory } from "./chat-memory-store";
import type { ChatSession } from "./chat-session-store";
import type { ChatSteeringMessage } from "./chat-steering";
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
	/** §5.AD opt-in enforced-reasoning hookup: given the turn's task + final draft, return the (possibly bounced)
	 *  final answer. Absent ⇒ the draft is used as-is (byte-identical). Must be fail-soft (never throw the turn). */
	enforceReasoning?: (input: { task: string; draft: string }) => Promise<string>;
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
	/**
	 * The §5.AC "knows today" feature switch — OFF BY DEFAULT. When omitted, the env flag `NKLEIN_KNOWS_TODAY` decides
	 * (off unless truthy); tests set it explicitly. Even when enabled, the block is still relevance-gated + end-placed.
	 */
	knowsTodayEnabled?: boolean;
	/** Names of the tools offered this turn — feeds the §5.AA controller evidence-gate (don't accept a premature "done"
	 *  while a tool the instruction explicitly named is still uncalled). Omit to disable the gate (today's behavior). */
	offeredToolNames?: readonly string[];
	/**
	 * §5.M/§5.N focus-chain nudge switch — OFF BY DEFAULT. When omitted, the env flag `NKLEIN_FOCUS_CHAIN_NUDGE` decides.
	 * When on AND the session has NO focus chain AND this is a multi-tool turn, the turn leads with a note nudging the
	 * agent to draft its plan first with `update_focus_chain`. Off ⇒ byte-identical to today.
	 */
	focusChainNudgeEnabled?: boolean;
	/** Drain steering messages accepted during this active turn; folded into the next model-loop call. */
	pollSteeringMessages?: () => Promise<ChatSteeringMessage[]>;
	/** Close the active steering window before the final model call starts. */
	closeSteering?: () => void;
}

export interface ChatAgentTurnResult {
	userMessage: ChatMessage;
	assistantMessage: ChatMessage;
	steps: ChatAgentStep[];
	context: ChatTurnContext;
	hitIterationLimit: boolean;
	/** §5.M: total tokens this turn consumed (summed across the loop's model calls). */
	totalTokens: number;
	/** §5.AF: the §5.AA recovery rungs that fired across the turn's model calls, in order (deduped). */
	promptStrategies: string[];
}

/** Neutral user-facing reply when the model produced only (empty-after-strip) narrated markup and ran no tools. */
const NARRATION_ONLY_FALLBACK = "I wasn't able to produce a response.";

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
		/** §5.AU: the resolved message-target note (card/stream/answer/clarify) leading the turn; null/absent = goal. */
		targetNote?: string | null;
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
			// §5.M: an all_projects-scoped session recalls memory across all sessions (durable working memory).
			...(input.session.scope === "all_projects" ? { allProjects: true } : {}),
		},
		{ summarize: deps.summarize, ...(deps.embed ? { embed: deps.embed } : {}) },
	);
	// The §5.AC "knows today" block is OFF BY DEFAULT (env NKLEIN_KNOWS_TODAY; deps override for tests), relevance-gated
	// + end-placed by the renderer's decision core (§5.AE / §5.AQ). We always hand it the clock and let the core decide.
	const knowsTodayEnabled = deps.knowsTodayEnabled ?? isTruthyEnv(process.env.NKLEIN_KNOWS_TODAY);
	const now = (deps.now ?? (() => new Date()))();
	const prompt = renderChatTurnPrompt(context, input.userMessage, { now, enabled: knowsTodayEnabled });
	// Re-anchor the agent's focus chain (todo §5.M G4): lead the turn with its current checklist so a small model
	// stays on-plan, and offer `update_focus_chain` (wired into the tool set) to keep it current.
	const focusChain = deps.readFocusChain ? await deps.readFocusChain(input.session.id) : null;
	// §5.M/§5.N focus-chain NUDGE (OFF BY DEFAULT via NKLEIN_FOCUS_CHAIN_NUDGE / deps override): when there's no chain
	// yet AND this is a multi-tool turn, lead with a note to draft one first. Off ⇒ nudge=false ⇒ byte-identical.
	const focusChainNudge =
		(deps.focusChainNudgeEnabled ?? isTruthyEnv(process.env.NKLEIN_FOCUS_CHAIN_NUDGE)) && !focusChain
			? decideFocusChainNudge({ hasFocusChain: false, toolsOffered: deps.offeredToolNames?.length ?? 0 })
			: { nudge: false, reason: "" };
	// §5.AU: the resolved message-target note (when the message addresses a card/stream/answer) leads the turn,
	// before the focus chain — the addressing decision frames everything else. Goal-targeted turns add nothing.
	const messages: ChatPromptMessage[] = [
		...(input.targetNote ? [{ role: "system" as const, content: input.targetNote }] : []),
		...(focusChain
			? [
					{
						role: "system" as const,
						content: `Your current focus chain (update it with the update_focus_chain tool as you make progress):\n${formatFocusChainForPrompt(focusChain)}`,
					},
				]
			: focusChainNudge.nudge
				? [
						{
							role: "system" as const,
							content:
								"You have no focus chain yet. Before doing multi-step work, draft your plan as an ordered checklist with the update_focus_chain tool, then work through it.",
						},
					]
				: []),
		...prompt,
	];
	// §5.AA controller evidence-gate: when the instruction explicitly names ≥2 offered tools (a clear multi-tool task,
	// e.g. the e2e capstone), don't let the loop accept a premature "done" until every named tool has actually run —
	// the fix for the ≤4B "I've completed all steps" prose-done-after-one-tool failure. Single-/no-named-tool turns
	// (ordinary questions) get no gate, so this can't force a fabricated call on a normal chat.
	const namedTools =
		deps.offeredToolNames && deps.offeredToolNames.length > 0
			? selectToolsForAttempt(
					deps.offeredToolNames.map((name) => ({ name })),
					input.userMessage,
					1,
				).matchedNames
			: [];
	const requiredTools = namedTools.length >= 2 ? namedTools : [];
	// §5.AA acceptance flavor: an instruction carrying the card convention `Acceptance check: <command>` supplies a
	// REAL completion oracle — the turn is done only when that command actually RAN and exited 0 (evidence from the
	// executed steps, never the model's self-report). Composes with the named-tools gate when both apply.
	const acceptanceCommand = extractAcceptanceCommand(input.userMessage);
	const acceptanceGate = acceptanceCommand ? buildAcceptanceCompletionGate(acceptanceCommand) : null;
	const namedToolsGate =
		requiredTools.length > 0
			? (steps: readonly ChatAgentStep[]): boolean => {
					const used = new Set(steps.map((step) => step.toolCall.name));
					return requiredTools.every((tool) => used.has(tool));
				}
			: null;
	const completionGates = [namedToolsGate, acceptanceGate].filter(
		(gate): gate is (steps: readonly ChatAgentStep[]) => boolean => gate !== null,
	);
	const assessCompletion =
		completionGates.length > 0
			? (steps: readonly ChatAgentStep[]): boolean => completionGates.every((gate) => gate(steps))
			: undefined;
	// W3.1: persist the user message BEFORE the loop (not paired with the assistant at the end) so per-tool
	// transcript rows appended DURING the loop (the service's executeTool wrapper) land between user and reply —
	// the order the transcript reader renders. The turn context was composed above, so this append never feeds
	// back into this turn's own prompt.
	const userMessage = await deps.appendMessage(input.session.id, { role: "user", content: input.userMessage });
	const loop = await runChatAgentLoop(
		{
			messages,
			...(typeof input.maxIterations === "number" ? { maxIterations: input.maxIterations } : {}),
			...(input.onToken ? { onToken: input.onToken } : {}),
			...(deps.pollSteeringMessages ? { pollSteeringMessages: deps.pollSteeringMessages } : {}),
			...(deps.closeSteering ? { closeSteering: deps.closeSteering } : {}),
		},
		{
			complete: deps.model,
			executeTool: deps.executeTool,
			appendToolExchange: deps.appendToolExchange,
			...(assessCompletion ? { assessCompletion } : {}),
		},
	);
	// §5.O: weak models sometimes narrate a tool call as text in their final answer instead of confirming what they
	// did. Strip that markup from the user-facing reply; if nothing readable remains but tools ran, confirm briefly.
	const cleaned = stripNarratedToolCallMarkup(loop.finalText);
	// When the whole reply was narrated tool-call markup, `cleaned` is empty. If tools actually ran, confirm
	// them; otherwise fall back to a neutral note — NEVER `loop.finalText`, which is the raw markup this strip
	// exists to keep away from the user (a weak model can emit only a malformed narrated call as its answer).
	const draftText =
		cleaned.length > 0
			? cleaned
			: loop.steps.length > 0
				? `Done. (used: ${summarizeToolsUsed(loop.steps)})`
				: NARRATION_ONLY_FALLBACK;
	// §5.AD: the opt-in enforced-reasoning bounce over the final draft (absent dep / flag off ⇒ draftText as-is).
	const finalText = deps.enforceReasoning
		? await deps.enforceReasoning({ task: input.userMessage, draft: draftText }).catch(() => draftText)
		: draftText;
	const assistantMessage = await deps.appendMessage(input.session.id, { role: "assistant", content: finalText });
	return {
		userMessage,
		assistantMessage,
		steps: loop.steps,
		context,
		hitIterationLimit: loop.hitIterationLimit,
		promptStrategies: loop.promptStrategies,
		totalTokens: loop.totalTokens,
	};
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
