import { computeNKleinToolInputFingerprint } from "../nklein-agent/nklein-tool-call-fingerprint";
import { appendChatSteeringMessages, type ChatSteeringMessage } from "./chat-steering";
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
	/** §5.M: total tokens this model call consumed (`usage.total_tokens`), or null when the endpoint didn't report it. */
	totalTokens?: number | null;
	/** §5.AF: the §5.AA recovery rung that produced this response (e.g. `prompt_variant:example_led`,
	 *  `constrained_schema`, `native_tool_choice_required`), or null/absent when the plain path answered. */
	promptStrategy?: string | null;
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
		/** §5.AB loop-spin fix: when true, FORCE a tool call even if the model returned one — the model is stuck RE-emitting
		 *  an already-done tool (deduped → no progress), so the adapter's forcing rung must engage to steer to the next
		 *  undone step. Set only by the stuck-branch below, and only while the run is incomplete by evidence. */
		forceToolCall?: boolean,
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
	/** §5.M: total tokens the whole turn consumed (summed across every model call in the loop). */
	totalTokens: number;
	/** §5.AF: the §5.AA recovery rungs that fired across the turn's model calls, in order (deduped). */
	promptStrategies: string[];
}

export async function runChatAgentLoop(
	input: {
		messages: readonly ChatPromptMessage[];
		maxIterations?: number;
		/** When set, the FINAL (no-tool) answer is streamed token-by-token through this callback (hybrid streaming,
		 *  todo §5.M G3a). Tool-discovery turns never stream — the model must still be free to request tools there. */
		onToken?: (delta: string) => void;
		/** Drain user steering updates accepted while this turn is running. Drained messages are folded into the next
		 *  model call; the caller closes the active steering window before the final model call starts. */
		pollSteeringMessages?: () => Promise<ChatSteeringMessage[]>;
		closeSteering?: () => void;
	},
	deps: ChatAgentLoopDeps,
): Promise<ChatAgentLoopResult> {
	const maxIterations = Math.max(1, input.maxIterations ?? 8);
	const onToken = input.onToken;
	let messages: readonly ChatPromptMessage[] = input.messages;
	const steps: ChatAgentStep[] = [];
	const executedFingerprints = new Set<string>();
	const usedToolNames = new Set<string>();
	// §5.M: sum the usage of EVERY model call this turn (discovery + force + final streamed answer) so the caller can
	// persist a running per-session token total. Wraps deps.complete so no call site can forget to count.
	let totalTokens = 0;
	const promptStrategies: string[] = [];
	const callModel: ChatAgentLoopDeps["complete"] = async (...args) => {
		const response = await deps.complete(...args);
		totalTokens += response.totalTokens ?? 0;
		if (response.promptStrategy && !promptStrategies.includes(response.promptStrategy)) {
			promptStrategies.push(response.promptStrategy);
		}
		return response;
	};
	const applySteeringMessages = async (): Promise<number> => {
		const steeringMessages = input.pollSteeringMessages ? await input.pollSteeringMessages() : [];
		if (steeringMessages.length === 0) {
			return 0;
		}
		messages = appendChatSteeringMessages(messages, steeringMessages);
		return steeringMessages.length;
	};
	const closeSteering = (): void => {
		input.closeSteering?.();
	};

	// Execute a model response's tool calls with the same-turn de-dup: run each genuinely-new call, replace an
	// already-made identical call with the §5.O nudge (don't re-run it). Mutates `steps`/`executedFingerprints`/
	// `usedToolNames`, folds the results into `messages`, and reports how many NEW calls actually ran. Shared by the
	// normal discovery turn and the §5.AB force-advance turn so both dedup + record identically.
	const applyResponse = async (response: ChatAgentModelResponse): Promise<number> => {
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
		return executedNew;
	};
	// The run is NOT complete by evidence and there's still an iteration left to make progress — the precondition for
	// both the §5.AA "keep going" nudge and the §5.AB force-advance. Absent an assessor this is always false (a turn
	// with no assessor accepts the model's own stop / final answer, exactly as before).
	const canStillMakeProgress = (iteration: number): boolean =>
		Boolean(deps.assessCompletion) && !deps.assessCompletion?.(steps) && iteration < maxIterations - 1;

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		// Tool-discovery turn: never stream (the model must be free to request a tool instead of answering). Pass the
		// already-executed tool names so the §5.AA constrained rung, if it has to FORCE a call, steers to an un-done step.
		await applySteeringMessages();
		const response = await callModel(messages, true, undefined, [...usedToolNames]);
		if (response.toolCalls.length === 0) {
			// §5.AA controller evidence-gate: if a completion assessor is supplied and the run is NOT yet complete by
			// EVIDENCE, don't accept this premature "done" — nudge to keep going and continue (still bounded by
			// maxIterations). Skipped on the final iteration (no turn left to use the nudge). Absent assessor ⇒ unchanged.
			if (canStillMakeProgress(iteration)) {
				messages = deps.appendToolExchange(messages, response, [
					{ callId: `incomplete-${iteration}`, content: INCOMPLETE_NUDGE },
				]);
				continue;
			}
			// The model chose to answer rather than call a tool — this is the final reply. With an `onToken` we re-issue
			// it as a streaming, tools-disabled call so the answer streams token-by-token (the discovery call can't both
			// offer tools and stream); without one we return the text we already have (no extra model call).
			const steeredBeforeFinal = await applySteeringMessages();
			closeSteering();
			if (onToken) {
				const streamed = await callModel(messages, false, onToken);
				return { finalText: streamed.text, steps, hitIterationLimit: false, totalTokens, promptStrategies };
			}
			if (steeredBeforeFinal > 0) {
				const finalResponse = await callModel(messages, false);
				return {
					finalText: finalResponse.text,
					steps,
					hitIterationLimit: false,
					totalTokens,
					promptStrategies,
				};
			}
			return { finalText: response.text, steps, hitIterationLimit: false, totalTokens, promptStrategies };
		}
		const executedNew = await applyResponse(response);
		if (executedNew === 0) {
			// The whole response was repeats — the model is stuck RE-emitting an already-done tool. §5.AB: rather than only
			// nudge (which a stuck model ignores → it spins to the cap), FORCE the next UNDONE tool this same iteration.
			// Only while the run is incomplete by evidence and an iteration remains (the guardrail — a genuinely-finished
			// task falls through to the normal final answer, no infinite forcing). The adapter's forcing rung (native
			// tool_choice:"required" for reasoning models, else constrained json_schema) steers to an unused tool because
			// we pass the executed names; if it lands a NEW call we've advanced, else we nudge and continue as before.
			if (canStillMakeProgress(iteration)) {
				const forced = await callModel(messages, true, undefined, [...usedToolNames], true);
				const forcedNew = forced.toolCalls.length > 0 ? await applyResponse(forced) : 0;
				if (forcedNew === 0) {
					// The force couldn't produce a new call either — fall back to the §5.AA nudge and keep going.
					messages = deps.appendToolExchange(messages, { text: "", toolCalls: [] }, [
						{ callId: `incomplete-${iteration}`, content: INCOMPLETE_NUDGE },
					]);
				}
				continue;
			}
			// The model is stuck (all repeats) and the run is complete / out of runway — force a final (streamed) answer.
			await applySteeringMessages();
			closeSteering();
			const finalResponse = await callModel(messages, false, onToken);
			return { finalText: finalResponse.text, steps, hitIterationLimit: false, totalTokens, promptStrategies };
		}
	}

	// Out of tool iterations — force one final (streamed) answer turn with tools disabled so it must conclude.
	await applySteeringMessages();
	closeSteering();
	const finalResponse = await callModel(messages, false, onToken);
	return { finalText: finalResponse.text, steps, hitIterationLimit: true, totalTokens, promptStrategies };
}
