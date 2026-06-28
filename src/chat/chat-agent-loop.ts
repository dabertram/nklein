import { computeNKleinToolInputFingerprint } from "../nklein-agent/nklein-tool-call-fingerprint";
import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * Chat agent tool-call loop (todo §5.M — the tool-using multi-turn agent). The pure orchestration of "ask the
 * model → it may call tools → execute them → feed results back → repeat until it answers". The model call and the
 * tool execution are injected, so this is fully unit-testable; the live wiring supplies a tools-aware local-model
 * completion and an executor that applies the execution-mode policy gate + audit log before running each tool.
 *
 * Tool execution governance (the §5.M invariant — host access never default, always confirmed + logged) lives in
 * the injected `executeTool`; this loop only orchestrates and bounds the iterations so it always terminates.
 *
 * Small-model robustness (todo §5.O): weak local models routinely re-request the *same* tool call over and over
 * (observed live: a model re-reading one file 4× or re-issuing a write 6× until the iteration cap), which wastes
 * turns and ends in a forced, often-narrated answer. So the loop de-duplicates by the same full-input fingerprint
 * the NKlein agent uses: an identical call already made this turn is **not** re-executed — the model gets a short
 * "you already have that, answer now" nudge instead — and a response that is *only* repeats short-circuits straight
 * to the final answer. Genuinely new calls always run, so this never blocks a workflow that advances.
 */

/** Fingerprint a tool call by its name + full parsed arguments; two calls collide only when truly identical. */
function chatToolCallFingerprint(call: ChatToolCall): string {
	// `name` is always present, so this is never the empty-payload `null` case.
	return computeNKleinToolInputFingerprint({ name: call.name, arguments: call.arguments }) ?? call.name;
}

const REPEATED_CALL_NUDGE =
	"You already called this tool with the same arguments earlier this turn — reuse the result shown above. If you have what you need, answer the user now instead of calling it again.";

export interface ChatToolCall {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

export interface ChatToolResult {
	callId: string;
	content: string;
}

export interface ChatAgentModelResponse {
	/** The assistant's natural-language text (the final answer when there are no tool calls). */
	text: string;
	toolCalls: ChatToolCall[];
}

export interface ChatAgentStep {
	toolCall: ChatToolCall;
	result: ChatToolResult;
}

export interface ChatAgentLoopDeps {
	/** Call the model; `allowTools` is false on the final, forced answer turn so it stops requesting tools. `onToken`
	 *  is supplied only on the FINAL (no-tool) answer call: when present the model may stream the reply incrementally
	 *  (hybrid streaming, todo §5.M G3a) so a tool-routed turn that ends in plain text still emits token deltas. */
	complete: (
		messages: readonly ChatPromptMessage[],
		allowTools: boolean,
		onToken?: (delta: string) => void,
		/** Names of tools already executed this run — the §5.AA constrained rung excludes them when forcing a call, so a
		 *  weak model that stalls mid-chain is pushed to the NEXT step instead of re-forcing an already-done tool. */
		usedToolNames?: readonly string[],
	) => Promise<ChatAgentModelResponse>;
	/** Execute one tool call (after the policy gate + audit, in the live wiring); returns the result content. */
	executeTool: (call: ChatToolCall) => Promise<ChatToolResult>;
	/** Fold an assistant turn's tool calls + their results back into the message list for the next turn. */
	appendToolExchange: (
		messages: readonly ChatPromptMessage[],
		response: ChatAgentModelResponse,
		results: readonly ChatToolResult[],
	) => ChatPromptMessage[];
	/**
	 * OPTIONAL evidence-based completion gate (todo §5.AA finite-state controller). When provided, a turn that returns
	 * NO tool call (the model wants to answer) is only accepted as final if `assessCompletion(steps)` is true; otherwise
	 * the loop nudges "not done — keep going" and continues (still bounded by `maxIterations`). This stops a weak model
	 * from declaring a premature "done" with required steps unexecuted — the §5.Z e2e lesson. Absent ⇒ today's behavior
	 * (the first no-tool-call turn is the final answer), so existing callers are unchanged.
	 */
	assessCompletion?: (steps: readonly ChatAgentStep[]) => boolean;
}

const INCOMPLETE_NUDGE =
	"You have NOT yet completed all the required steps for this task. Do not stop or summarize — continue by calling the necessary tool(s) to finish the remaining work now.";

export interface ChatAgentLoopResult {
	finalText: string;
	steps: ChatAgentStep[];
	/** True when the loop was cut off at `maxIterations` and forced a final answer. */
	hitIterationLimit: boolean;
}

export async function runChatAgentLoop(
	input: {
		messages: readonly ChatPromptMessage[];
		maxIterations?: number;
		/** When set, the FINAL (no-tool) answer is streamed token-by-token through this callback (hybrid streaming,
		 *  todo §5.M G3a). Tool-discovery turns never stream — the model must still be free to request tools there. */
		onToken?: (delta: string) => void;
	},
	deps: ChatAgentLoopDeps,
): Promise<ChatAgentLoopResult> {
	const maxIterations = Math.max(1, input.maxIterations ?? 8);
	const onToken = input.onToken;
	let messages: readonly ChatPromptMessage[] = input.messages;
	const steps: ChatAgentStep[] = [];
	const executedFingerprints = new Set<string>();
	const usedToolNames = new Set<string>();

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		// Tool-discovery turn: never stream (the model must be free to request a tool instead of answering). Pass the
		// already-executed tool names so the §5.AA constrained rung, if it has to FORCE a call, steers to an un-done step.
		const response = await deps.complete(messages, true, undefined, [...usedToolNames]);
		if (response.toolCalls.length === 0) {
			// §5.AA controller evidence-gate: if a completion assessor is supplied and the run is NOT yet complete by
			// EVIDENCE, don't accept this premature "done" — nudge to keep going and continue (still bounded by
			// maxIterations). Skipped on the final iteration (no turn left to use the nudge). Absent assessor ⇒ unchanged.
			if (deps.assessCompletion && !deps.assessCompletion(steps) && iteration < maxIterations - 1) {
				messages = deps.appendToolExchange(messages, response, [
					{ callId: `incomplete-${iteration}`, content: INCOMPLETE_NUDGE },
				]);
				continue;
			}
			// The model chose to answer rather than call a tool — this is the final reply. With an `onToken` we re-issue
			// it as a streaming, tools-disabled call so the answer streams token-by-token (the discovery call can't both
			// offer tools and stream); without one we return the text we already have (no extra model call).
			if (onToken) {
				const streamed = await deps.complete(messages, false, onToken);
				return { finalText: streamed.text, steps, hitIterationLimit: false };
			}
			return { finalText: response.text, steps, hitIterationLimit: false };
		}
		const results: ChatToolResult[] = [];
		let executedNew = 0;
		for (const toolCall of response.toolCalls) {
			const fingerprint = chatToolCallFingerprint(toolCall);
			if (executedFingerprints.has(fingerprint)) {
				// Repeat of a call already made this turn — don't re-run it; nudge the model toward answering.
				results.push({ callId: toolCall.id, content: REPEATED_CALL_NUDGE });
				continue;
			}
			const result = await deps.executeTool(toolCall);
			results.push(result);
			steps.push({ toolCall, result });
			executedFingerprints.add(fingerprint);
			usedToolNames.add(toolCall.name);
			executedNew += 1;
		}
		messages = deps.appendToolExchange(messages, response, results);
		if (executedNew === 0) {
			// The whole response was repeats — the model is stuck. Force a final (streamed) answer now (not a cap hit).
			const finalResponse = await deps.complete(messages, false, onToken);
			return { finalText: finalResponse.text, steps, hitIterationLimit: false };
		}
	}

	// Out of tool iterations — force one final (streamed) answer turn with tools disabled so it must conclude.
	const finalResponse = await deps.complete(messages, false, onToken);
	return { finalText: finalResponse.text, steps, hitIterationLimit: true };
}
