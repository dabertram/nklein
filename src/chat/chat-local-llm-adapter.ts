import { deriveTruncationSignal } from "../core/completion-stop-reason";
import { isTruthyEnv } from "../core/env-flag";
import { applyThinkingDisable, isReasoningModel, supportsThinkingControl } from "../core/model-thinking-control";
import { stripReasoningChannel } from "../core/reasoning-channel-split";
import { raisedTokenBudget } from "../core/retry-policy";
import { MAX_ATTEMPT_SIMPLIFICATION_LEVEL, selectToolsForAttempt } from "../nklein-agent/nklein-attempt-simplification";
import { buildConstrainedToolCallSchema, parseConstrainedToolCall } from "../nklein-agent/nklein-constrained-tool-call";
import type {
	LocalLlmChatMessage,
	LocalLlmCompletion,
	LocalLlmSamplingOptions,
	LocalLlmStructuredFormat,
	LocalLlmToolCompletion,
	LocalLlmToolDefinition,
} from "../nklein-agent/nklein-local-llm-client";
import { buildPromptVariant, PROMPT_VARIANT_LADDER } from "../nklein-agent/nklein-prompt-variation";
import { detectResponseLoop } from "../nklein-agent/nklein-response-loop-detection";
import type { ChatAgentModelResponse, ChatToolResult } from "./chat-agent-loop";
import type { ChatMessage } from "./chat-transcript-store";
import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * Adapter wiring the chat runtime (todo §5.M) to a local LLM client ([nklein-local-llm-client.ts]
 * (../nklein-agent/nklein-local-llm-client.ts), which is fail-closed against cloud per invariant #1). It provides
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
	/** The resolved model id (§5.AL) — lets the chat service apply the capability gate when tools are in play. */
	modelId?: string;
}

/**
 * Strip inline `<think>…</think>` reasoning a model may leave in its content — via the §5.AN truncation-safe
 * `stripReasoningChannel` core. FIXES a latent leak: the old inline regex required the closing `</think>`, so a
 * truncated/unclosed `<think>` (a reasoning model cut off mid-thought — the §5.AA truncation case) leaked the ENTIRE
 * reasoning dump into the user-visible answer. The core treats an unterminated open marker as reasoning-to-end; a
 * well-formed `<think>…</think>` block strips identically (both trim).
 */
function stripReasoning(content: string): string {
	return stripReasoningChannel(content);
}

/**
 * Clean a raw model reply: strip inline reasoning, then collapse any runaway repeated-tail loop to its useful prefix
 * (§5.AA salvage — grounded in the §5.Z sweep where a model looped an identical final sentence). `detectResponseLoop`
 * returns the text unchanged when there's no loop, so this is always safe to apply.
 */
function cleanModelReply(content: string): string {
	return detectResponseLoop(stripReasoning(content)).salvagedText;
}

const DEFAULT_SAMPLING: LocalLlmSamplingOptions = { temperature: 0.3, maxTokens: 1024 };
// §5.AA: the ceiling for the escalating truncation-retry budget — a generous reasoning headroom that stays well within a
// typical local context window so the retry can't overshoot it.
const TRUNCATION_RETRY_BUDGET_CEILING = 8192;

export function createChatModelDeps(
	client: ChatCompletionClient,
	options: { sampling?: LocalLlmSamplingOptions; modelId?: string } = {},
): ChatModelDeps {
	const sampling = options.sampling ?? DEFAULT_SAMPLING;
	return {
		...(options.modelId ? { modelId: options.modelId } : {}),
		complete: async (prompt, onToken) => {
			const messages = prompt.map((message) => ({ role: message.role, content: message.content }));
			if (onToken && client.completeStream) {
				// Stream raw deltas to the caller (live view); persist the cleaned (reasoning-stripped + loop-salvaged) reply.
				const { content } = await client.completeStream({ messages, sampling }, onToken);
				return cleanModelReply(content);
			}
			const { content } = await client.complete({ messages, sampling });
			return cleanModelReply(content);
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
			return cleanModelReply(content);
		},
	};
}

export interface ChatAgentCompletionClient {
	completeWithTools(
		request: { messages: LocalLlmChatMessage[]; sampling?: LocalLlmSamplingOptions },
		tools: readonly LocalLlmToolDefinition[],
		/**
		 * Optional §5.AA/§5.AN native-forcing lever: `toolChoice:"required"` FORCES a tool call (the reasoning-safe path
		 * where json_schema dead-ends). Optional ⇒ existing impls satisfy this interface; when omitted the client defaults
		 * to `"auto"` (byte-identical to today).
		 */
		opts?: { toolChoice?: "auto" | "required" },
	): Promise<LocalLlmToolCompletion>;
	/**
	 * Optional plain completion with constrained decoding (`response_format: json_schema`) — the §5.AA
	 * constrained-tool-call rung uses it to FORCE a parseable tool call. `LocalLlmClient.complete` satisfies this; a
	 * client without it simply skips the rung.
	 */
	complete?(request: {
		messages: LocalLlmChatMessage[];
		sampling?: LocalLlmSamplingOptions;
		format?: LocalLlmStructuredFormat;
	}): Promise<{ content: string }>;
}

/**
 * Provides the agent loop's `complete(messages, allowTools)` from a tools-aware local client: it offers the tool
 * definitions only when `allowTools` is set (so the forced final turn can't request more), maps the prompt to the
 * client's messages, and returns the reasoning-stripped text + parsed tool calls.
 */
export function createChatAgentModel(
	client: ChatAgentCompletionClient,
	toolDefinitions: readonly LocalLlmToolDefinition[],
	options: { sampling?: LocalLlmSamplingOptions; modelId?: string } = {},
): (
	messages: readonly ChatPromptMessage[],
	allowTools: boolean,
	onToken?: (delta: string) => void,
	usedToolNames?: readonly string[],
	forceToolCall?: boolean,
) => Promise<ChatAgentModelResponse> {
	const sampling = options.sampling ?? DEFAULT_SAMPLING;
	return async (messages, allowTools, _onToken, usedToolNames, forceToolCall) => {
		const wire = messages.map((message) => ({ role: message.role, content: message.content }));
		const offered = allowTools ? toolDefinitions : [];
		let response = await client.completeWithTools({ messages: wire, sampling }, offered);
		// §5.AA truncation rung (the CHEAPEST first recovery): a reasoning model can burn its whole token budget on
		// reasoning_content and hit `finish:"length"` BEFORE emitting the tool call (live-confirmed: qwen3-8b spent 200
		// tokens reasoning on a trivial reply). That is a budget truncation, not a complexity failure — so before shrinking
		// the tool set or forcing a schema, just re-ask once with a larger budget. Fires on a no-call turn that EITHER hit
		// `finish:"length"` OR whose `reasoningTokens` (§5.AN signal) consumed ≥90% of the budget (robust to endpoints
		// that report the finish reason differently — reasoning still ate the budget before any call could land).
		const baseBudget = sampling.maxTokens ?? 1024;
		// §5.AN: dialect-robust truncation detection via the shared completion-stop-reason core (was the inline
		// `finishReason === "length" || reasoningTokens ≥ 90%·budget`). Byte-identical on /v1 ("length" ⇒ TruncatedTokens),
		// and now also catches a non-/v1 truncation stop reason; `shouldRetryLarger` = truncated-stop OR reasoning-starved.
		if (
			allowTools &&
			response.toolCalls.length === 0 &&
			deriveTruncationSignal({
				rawReason: response.finishReason,
				reasoningTokens: response.reasoningTokens,
				tokenBudget: baseBudget,
			}).shouldRetryLarger
		) {
			const bumped = { ...sampling, maxTokens: Math.max(baseBudget * 3, 3072) };
			// If the model has a thinking soft-switch (e.g. Qwen3 `/no_think`), DISABLE thinking on the retry — that removes
			// the reasoning_content that caused the truncation (the ROOT cause), which is cheaper + more reliable than just
			// enlarging the budget (live: qwen3 reasoning 965 → 2 chars, tool call still emitted). Else just re-ask bigger.
			const retryWire =
				options.modelId && supportsThinkingControl(options.modelId)
					? replaceLastUserText(wire, applyThinkingDisable(lastUserText(messages), options.modelId))
					: wire;
			response = await client.completeWithTools({ messages: retryWire, sampling: bumped }, offered);
			// §5.AA escalating truncation retry: if the single (x3) bump STILL truncated (a big reasoner needs more -- live:
			// the 27B truncated at 1024 and needed ~4096 across escalations), grow the budget ONCE more via the tested
			// raisedTokenBudget (ceiling-clamped so it can't overshoot the context window). Only fires on CONTINUED truncation,
			// so it never affects a turn the first bump already fixed.
			const stillTruncated =
				response.toolCalls.length === 0 &&
				deriveTruncationSignal({
					rawReason: response.finishReason,
					reasoningTokens: response.reasoningTokens,
					tokenBudget: bumped.maxTokens,
				}).shouldRetryLarger;
			if (stillTruncated) {
				const escalated = raisedTokenBudget({
					current: bumped.maxTokens,
					attempt: 1,
					ceiling: TRUNCATION_RETRY_BUDGET_CEILING,
				});
				if (escalated > bumped.maxTokens) {
					response = await client.completeWithTools(
						{ messages: retryWire, sampling: { ...sampling, maxTokens: escalated } },
						offered,
					);
				}
			}
		}
		// §5.AA task-complexity ladder: a model that returns NO tool call when several were offered AND the instruction
		// names a tool it didn't call is likely drowning in tool-set complexity (grounded: phi-4 emits a clean call with
		// 1 tool but fails with 6). Retry with a progressively narrowed set anchored on the instruction — shrink the ask
		// instead of re-prompting. Only fires when there is a named-but-uncalled tool to anchor on (else no extra calls).
		if (offered.length > 1 && response.toolCalls.length === 0) {
			const instruction = lastUserText(messages);
			for (let level = 1; level <= MAX_ATTEMPT_SIMPLIFICATION_LEVEL; level += 1) {
				const selection = selectToolsForAttempt(offered, instruction, level);
				if (!selection.reduced) {
					break;
				}
				response = await client.completeWithTools({ messages: wire, sampling }, selection.tools);
				if (response.toolCalls.length > 0) {
					break;
				}
			}
		}
		// NOTE: narrated-tool-call recovery for the chat path lives in the client (`completeWithTools` runs
		// `parseNarratedToolCalls` over content + reasoning_content when a tools-offered turn returns no structured call —
		// see nklein-local-llm-client.ts). So by here `response.toolCalls` already includes any recovered call.
		//
		// §5.AA prompt-variation rung — between tool-set reduction and the forced-schema last resort. A model that won't
		// act on one phrasing often acts on another (§5.Z), so re-FRAME the same instruction across the variant ladder
		// (imperative → explicit-format → example-led → reason-then-act) and re-ask via the NORMAL tool path with the
		// anchored tool set, giving the model a chance to emit a natural call before we force one. Same proven-safe anchor
		// (the instruction must NAME an offered tool), so a legit prose answer is never re-phrased into a forced action;
		// each family breaks on the first call. The instruction text is preserved verbatim — only the framing changes.
		if (allowTools && response.toolCalls.length === 0) {
			const instruction = lastUserText(messages);
			const anchored = selectToolsForAttempt(offered, instruction, 1);
			if (anchored.matchedNames.length > 0) {
				const toolName = anchored.matchedNames[0];
				for (const family of PROMPT_VARIANT_LADDER) {
					const variantText = buildPromptVariant(family, { instruction, toolName });
					const variantWire = replaceLastUserText(wire, variantText);
					const variantResponse = await client.completeWithTools(
						{ messages: variantWire, sampling },
						anchored.tools,
					);
					if (variantResponse.toolCalls.length > 0) {
						response = variantResponse;
						break;
					}
				}
			}
		}
		// §5.AA constrained-decoding rung — the LAST resort after tool-set reduction AND the client's narrated-recovery
		// both came up empty. Also the FORCE-ADVANCE path (§5.AB loop-spin fix): the loop passes `forceToolCall` when a
		// model is stuck RE-emitting an already-done tool (a repeated structured call the loop dedupes → no progress),
		// which is a real tool call — so gating only on `toolCalls.length === 0` left this rung unreachable and the chain
		// spun to the iteration cap. Fire when there is no call OR the loop asked us to force one.
		//
		// SAFETY: on the `toolCalls.length === 0` path we still require the instruction to NAME an offered tool (the
		// proven-safe anchor) so we never force a call on a legit prose answer to a non-tool question. On the
		// `forceToolCall` path the LOOP's evidence-gate is the safety (it only forces while REQUIRED, named tools remain
		// uncalled), so we may force an UNNAMED-but-offered tool to advance the chain — see the `forceTools` fallback.
		if (allowTools && (response.toolCalls.length === 0 || forceToolCall) && client.complete) {
			const anchored = selectToolsForAttempt(offered, lastUserText(messages), 1);
			// Steer a stalled chain to the NEXT step: drop tools already executed this run from the forced set so a weak
			// model can't re-pick a done tool (which the loop dedupes → no progress). Prefer the instruction-anchored
			// remaining tools; when those are exhausted, fall back to ANY offered-but-unused tool (the force-advance path
			// needs a next step to steer to even when the anchor is used up); only when everything is used do we fall back
			// to the anchored set (the no-op / genuinely-finished case, which the evidence-gate would already have ended).
			const used = new Set(usedToolNames ?? []);
			const anchoredRemaining = anchored.tools.filter((tool) => !used.has(tool.name));
			const offeredRemaining = offered.filter((tool) => !used.has(tool.name));
			const forceTools =
				anchoredRemaining.length > 0
					? anchoredRemaining
					: offeredRemaining.length > 0
						? offeredRemaining
						: anchored.tools;
			// Build the forced schema whenever we have a tool to force. On the plain no-call path the anchor still guards us
			// (an unanchored prose answer yields no forceTools worth forcing); on the force-advance path the evidence-gate is
			// the guard, so any non-empty forceTools is fair game.
			const schema = forceTools.length > 0 ? buildConstrainedToolCallSchema(forceTools) : null;
			const anchorGuardsForce = anchored.matchedNames.length > 0 || (forceToolCall && offeredRemaining.length > 0);
			if (schema && anchorGuardsForce) {
				// §5.AA/§5.AN native-forcing for REASONING models: their json_schema path silently dead-ends (empty content —
				// grammar vs the reasoning channel, live-probed 2026-07-01), but native `tool_choice:"required"` lands a valid
				// call in the separate tool_calls channel. On the §5.AB FORCE-ADVANCE path (`forceToolCall`) this runs BY
				// DEFAULT for reasoning models (no env flag) — it's a correctness fix for a proven-broken spin, and that path
				// only fires when the loop is already stuck on repeated calls with the run incomplete, so the happy path is
				// untouched. On the plain no-call path it stays behind NKLEIN_NATIVE_FORCE_TOOL_CALL (byte-identical with the
				// flag OFF). Either trigger still requires a reasoning model (native forcing is the reasoning-specific fix; on
				// a non-reasoning model the json_schema path works, so we don't divert it) — matching the flag's prior scope.
				const modelIsReasoning = Boolean(options.modelId) && isReasoningModel(options.modelId ?? "");
				const useNativeForce =
					modelIsReasoning && (Boolean(forceToolCall) || isTruthyEnv(process.env.NKLEIN_NATIVE_FORCE_TOOL_CALL));
				if (useNativeForce) {
					// On the FORCE-ADVANCE path offer the native call a SINGLE tool — the next undone step — not the whole
					// forceTools set. Live-probed 2026-07-01 (qwopus3.6-27b): `tool_choice:"required"` with ONE tool lands a
					// clean STRUCTURED call for exactly that tool even when the model is fixated (it kept narrating the already-
					// done read_file when offered several), whereas a MULTI-tool required call let it narrate the wrong (done)
					// tool → deduped → no progress. The plain no-call path (flag, not forceToolCall) keeps the full anchored set
					// so its existing behavior is unchanged. `forceTools` is non-empty here (schema was built), so [0] is safe.
					const nativeTools = forceToolCall ? [forceTools[0]] : forceTools;
					// On the force-advance path, drive the native call from a TRIMMED, isolated context — NOT the full running
					// transcript. Live root cause (qwopus3.6-27b, 2026-07-01): the accumulated `wire` is saturated with the
					// model's OWN repeated read_file turns + stacked "you already called this / not done yet" nudges, which so
					// reinforce the step-1 fixation that even `tool_choice:"required"` with ONLY run_command offered returns an
					// OFF-MENU structured read_file (the client then drops it → no advance → spin). The SAME instruction with a
					// clean context (original ask + the facts already gathered + an explicit "call <next> now" directive) lands
					// the intended structured call reliably (probe-verified). So for the force we reconstruct that clean context:
					// keep the system framing + the original user instruction + the tool-RESULT notes (the facts), drop the
					// model's narration turns and the nudge chatter, and append the explicit next-step directive.
					const forcedWire: LocalLlmChatMessage[] = forceToolCall
						? buildForceAdvanceContext(wire, [...used], nativeTools[0]?.name ?? "")
						: wire;
					const forced = await client.completeWithTools({ messages: forcedWire, sampling }, nativeTools, {
						toolChoice: "required",
					});
					if (forced.toolCalls.length > 0) {
						const call = forced.toolCalls[0];
						return { text: "", toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }] };
					}
				}
				const constrained = await client.complete({
					messages: [
						...wire,
						{
							role: "system",
							content:
								'Emit the required tool call now as a single JSON object {"tool":"<name>","arguments":{…}} and nothing else.',
						},
					],
					sampling,
					format: { jsonSchema: schema },
				});
				const parsed = parseConstrainedToolCall(constrained.content, forceTools);
				if (parsed) {
					return {
						text: "",
						toolCalls: [
							{ id: `constrained-${Date.now().toString(36)}`, name: parsed.name, arguments: parsed.arguments },
						],
					};
				}
			}
		}
		return {
			text: cleanModelReply(response.content),
			toolCalls: response.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
		};
	};
}

/** The most recent user-authored instruction in the rendered prompt — the anchor for §5.AA tool-set narrowing. */
function lastUserText(messages: readonly ChatPromptMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") {
			return messages[index].content;
		}
	}
	return "";
}

/**
 * Return a copy of the wire messages with the LAST user message's content replaced by `text` — the §5.AA
 * prompt-variation rung re-frames the instruction in place, leaving the surrounding context untouched. No-op (a shallow
 * copy) when there is no user message.
 */
function replaceLastUserText<TMessage extends { role: string; content: string }>(
	messages: readonly TMessage[],
	text: string,
): TMessage[] {
	const copy = messages.map((message) => ({ ...message }));
	for (let index = copy.length - 1; index >= 0; index -= 1) {
		if (copy[index].role === "user") {
			copy[index] = { ...copy[index], content: text };
			break;
		}
	}
	return copy;
}

/**
 * Build the TRIMMED, isolated context for a §5.AB force-advance native call.
 *
 * ROOT CAUSE (qwopus3.6-27b, live-probed 2026-07-01): the running transcript still contains the ORIGINAL NUMBERED
 * INSTRUCTION ("1. read_file … 2. run_command … 3. create_card …"). Under `tool_choice:"required"` this model RE-READS
 * that list from the top and restarts at step 1 — returning a structured `read_file` even when ONLY the next tool is
 * offered (the endpoint doesn't constrain `required` to the offered set). Isolated probes are decisive: force context
 * WITH the numbered list → returns the done step-1 tool; force context WITHOUT it (a single-step ask for just the next
 * tool) → returns that tool reliably. So the fix is to DROP the numbered instruction entirely and re-pose the force as a
 * single-step request for the one undone tool.
 *
 * The rebuilt context keeps: the leading system FRAMING (the rendered role/tools/goal prompt + any focus chain — the
 * system messages before the first user turn), the ORIGINAL instruction demoted to a SYSTEM REFERENCE note (so the model
 * can still read the NEXT step's exact arguments, e.g. a card title, from it — but as reference, not an active numbered
 * task the model re-executes from the top), the tool-RESULT facts already gathered (the `Tool result (…)` notes,
 * EXCLUDING the loop's `incomplete-…` nudge notes, which are fixating chatter not facts), and a single fresh USER ask to
 * call the next tool now. The instruction is NOT left as the user turn — probe-verified: as reference-in-system + a
 * single-step user ask, the model emits the next tool WITH its correct args and WITHOUT restarting at step 1.
 * Pure; leading order preserved.
 */
function buildForceAdvanceContext(
	wire: readonly LocalLlmChatMessage[],
	usedToolNames: readonly string[],
	nextToolName: string,
): LocalLlmChatMessage[] {
	const firstUserIndex = wire.findIndex((message) => message.role === "user");
	// Leading system framing (everything before the first user message) — the rendered prompt's role/tools/goal + focus
	// chain. When there's no user message (shouldn't happen on this path) fall back to the whole wire's system messages.
	const framing = wire.slice(0, firstUserIndex >= 0 ? firstUserIndex : wire.length).filter((m) => m.role === "system");
	const instruction = wire.find((message) => message.role === "user");
	// The original instruction, demoted to a REFERENCE note — carries the next step's exact args (title/prompt/command)
	// without being an active numbered task the model re-runs from step 1.
	const reference: LocalLlmChatMessage[] = instruction
		? [{ role: "system", content: `For reference, the overall task is: ${instruction.content}` }]
		: [];
	// Tool-RESULT facts: the folded `Tool result (callId):\n…` system notes (see appendChatToolExchange), EXCLUDING the
	// loop's `incomplete-…` nudge notes (their content is the fixating "not done, keep going" chatter, not a fact).
	const facts = wire.filter(
		(message) =>
			message.role === "system" &&
			message.content.startsWith("Tool result (") &&
			!message.content.startsWith("Tool result (incomplete-"),
	);
	const done = usedToolNames.length > 0 ? `${usedToolNames.join(", ")} ` : "";
	// A single-step ask for JUST the next tool — NO numbered list (which makes the model restart at step 1). It points the
	// model at the reference for that tool's exact arguments. Probe-verified to land the intended structured call (with the
	// correct args) on the fixation-prone reasoning model.
	const nextStep: LocalLlmChatMessage = {
		role: "user",
		content: `The previous step (${done}already completed) is done — its result is shown above. Your next and only action now is to call the ${nextToolName} tool, using the exact arguments specified for that step in the task reference above. Do not repeat any earlier step. Emit the ${nextToolName} tool call and nothing else.`,
	};
	return [...framing, ...reference, ...facts, nextStep];
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
