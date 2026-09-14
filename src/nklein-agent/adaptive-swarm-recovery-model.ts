/** F3.10 — shared-policy adaptive recovery at the swarm AgentModel seam. */
import type { AgentMessage, AgentMessagePart, AgentModel, AgentModelEvent, AgentModelRequest } from "@cline/shared";
import { runAdaptiveAttemptLoop } from "../core/adaptive-attempt-loop";
import { classifyFailureSignature, type FailureSignatureKind } from "../core/failure-signature";
import {
	emptyModelBehaviorProfile,
	type ModelBehaviorProfile,
	type ModelOutcomeKind,
} from "../core/model-behavior-profile";
import {
	applyThinkingDisable,
	getThinkingRequestControl,
	supportsThinkingControl,
} from "../core/model-thinking-control";
import { REASONING_BUDGET_BREACH_NUDGE } from "../core/reasoning-budget-breach";
import { type RetryStrategy, raisedTokenBudget } from "../core/retry-policy";
import type { StrategyEffectivenessLedger } from "../core/strategy-effectiveness-ledger";
import { describeUnusableToolCall, triageStreamedToolCalls } from "../core/tool-call-argument-triage";
import {
	CONSTRAINED_TOOL_CALL_CONTEXT_KEY,
	type ConstrainedToolCallContext,
	ConstrainedToolCallNoCallError,
} from "./constrained-tool-call-model";
import { planSwarmPromptVariation, type SwarmPromptVariationRole } from "./prompt-variation-model";
import { ReasoningBudgetBreachError } from "./reasoning-breach-model";
import { type BufferedRecoveryTurn, collectBufferedModelTurn, type RecoveryTurnSignal } from "./recovery-ladder-model";
import { RunawayGenerationInterruptError } from "./runaway-interrupt-model";

const DEFAULT_BASE_OUTPUT_TOKENS = 1_024;
const DEFAULT_MIN_RETRY_BUDGET = 2;
const COMPACTED_BLOCK_CHARS = 1_200;

export interface AdaptiveSwarmRecoveryAttempt {
	strategy: RetryStrategy | null;
	triggerOutcome: ModelOutcomeKind | null;
	strategyLabel: string | null;
	outcome: ModelOutcomeKind;
	availableStrategies: readonly RetryStrategy[];
	recovered: boolean;
	finishReason: RecoveryTurnSignal["finishReason"];
	evidence: string;
	promptFamily: string | null;
	toolName: string | null;
	durationMs: number;
	inputTokens: number | null;
	outputTokens: number | null;
}

export interface AdaptiveSwarmRecoveryModelOptions {
	modelId: string;
	role?: SwarmPromptVariationRole;
	profile?: ModelBehaviorProfile;
	strategyEffectivenessLedger?: StrategyEffectivenessLedger;
	baseMaxTokens?: number | null;
	minRetryBudget?: number;
	maxRetryBudget?: number;
	promptVariationEnabled?: boolean;
	alternateEndpointModel?: AgentModel;
	/**
	 * P23.5 (2): the `constrained_schema` rung — forces the call the model emitted WITHOUT usable arguments (native
	 * `tool_choice: required`, then a per-tool json_schema). Built over the direct local client in the session runtime.
	 */
	constrainedToolCallModel?: AgentModel;
	crossModel?: AgentModel;
	onBufferedToken?: () => void;
	onAttempt?: (attempt: AdaptiveSwarmRecoveryAttempt) => void;
	onStrategyApplied?: (strategy: string) => void;
}

interface ClassifiedTurn {
	outcome: ModelOutcomeKind;
	availableStrategies: RetryStrategy[];
	evidence: string;
	whyFailed: string;
	/** The turn's events after a lossless argument repair (P23.5 (2)); absent when nothing was rewritten. */
	events?: readonly AgentModelEvent[];
	/** The call that carried no usable arguments — what the `constrained_schema` rung re-asks for. */
	malformedCall?: ConstrainedToolCallContext;
}

interface AttemptPayload {
	buffered: BufferedRecoveryTurn;
	request: AgentModelRequest;
	strategy: RetryStrategy | null;
	strategyLabel: string | null;
}

function uniqueStrategies(strategies: readonly (RetryStrategy | null | false)[]): RetryStrategy[] {
	return [...new Set(strategies.filter((strategy): strategy is RetryStrategy => Boolean(strategy)))];
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return error === null || error === undefined ? "" : String(error);
}

function bufferedText(events: readonly AgentModelEvent[]): string {
	return events.flatMap((event) => (event.type === "text-delta" ? [event.text] : [])).join("");
}

function bufferedUsage(events: readonly AgentModelEvent[]): {
	inputTokens: number | null;
	outputTokens: number | null;
} {
	let inputTokens: number | null = null;
	let outputTokens: number | null = null;
	for (const event of events) {
		if (event.type !== "usage") continue;
		if (typeof event.usage.inputTokens === "number" && Number.isFinite(event.usage.inputTokens)) {
			inputTokens = Math.max(0, event.usage.inputTokens);
		}
		if (typeof event.usage.outputTokens === "number" && Number.isFinite(event.usage.outputTokens)) {
			outputTokens = Math.max(0, event.usage.outputTokens);
		}
	}
	return { inputTokens, outputTokens };
}

function requestHasImage(request: AgentModelRequest): boolean {
	return request.messages.some((message) => message.content.some((part) => part.type === "image"));
}

function endpointAndCarry(options: AdaptiveSwarmRecoveryModelOptions, request: AgentModelRequest): RetryStrategy[] {
	const hasImage = requestHasImage(request);
	return uniqueStrategies([
		options.alternateEndpointModel && !hasImage ? "alternate_endpoint" : null,
		options.crossModel ? "cross_model_carry" : null,
	]);
}

/** The constrained rung rides the text-only direct wire — never offered for a turn that carries an image. */
function constrainedRung(options: AdaptiveSwarmRecoveryModelOptions, request: AgentModelRequest): RetryStrategy | null {
	return options.constrainedToolCallModel && !requestHasImage(request) ? "constrained_schema" : null;
}

/** `prompt_variant` when a variation plan exists for the turn and the strategy is not disabled. */
function promptVariantRung(
	options: AdaptiveSwarmRecoveryModelOptions,
	request: AgentModelRequest,
): RetryStrategy | null {
	if (options.promptVariationEnabled === false) return null;
	return planSwarmPromptVariation(request, options.role ?? "unknown") ? "prompt_variant" : null;
}

function strategiesForSignature(
	signature: FailureSignatureKind,
	request: AgentModelRequest,
	options: AdaptiveSwarmRecoveryModelOptions,
): RetryStrategy[] {
	const plan =
		options.promptVariationEnabled === false ? null : planSwarmPromptVariation(request, options.role ?? "unknown");
	const external = endpointAndCarry(options, request);
	const thinking = hasThinkingSwitch(options.modelId) ? "thinking_disable" : null;
	switch (signature) {
		case "context_overflow":
			// The alternate endpoint re-sends the SAME transcript on a text wire — it cannot make an over-window
			// prompt fit, and one such turn taught a live architect the "[tool_call …]" pseudo-syntax (2026-08-30).
			// Shrink first; only a different model (cross-model carry) is a further remedy.
			return uniqueStrategies(["context_shrink", options.crossModel ? "cross_model_carry" : null]);
		case "token_budget":
			return uniqueStrategies(["raise_token_budget", thinking, "context_shrink", ...external]);
		case "stream_timeout":
		case "rate_limited":
			return uniqueStrategies(["same_model_retry", ...external]);
		case "malformed_output":
			return uniqueStrategies([constrainedRung(options, request), plan ? "prompt_variant" : null, ...external]);
		case "response_loop":
			return uniqueStrategies(["context_shrink", ...external]);
		case "model_unavailable":
			return external;
		case "unknown_error":
			return uniqueStrategies(["same_model_retry", ...external]);
		case "aborted_request":
		case "content_filtered":
			return [];
	}
}

function classifyTurn(
	turn: BufferedRecoveryTurn,
	request: AgentModelRequest,
	options: AdaptiveSwarmRecoveryModelOptions,
	/**
	 * The turn's ORIGINAL request. A rung may narrow the attempt request (constrained_schema offers one tool), but the
	 * ladder's next rung is always shaped from the baseline — so what is available next is judged against it.
	 */
	baseline: AgentModelRequest = request,
): ClassifiedTurn {
	const { signal } = turn;
	// A tool call PLUS finish reason max-tokens is the truncated-emission signature: the arguments were cut
	// mid-payload and the salvage layer hands the tool `{}` (live 20260810-222735 — six consecutive empty
	// write_file calls on a types card). Calling that turn a success re-ran the same oversized emission at the
	// same budget forever, because the raise_token_budget ladder below was unreachable behind this branch. A
	// COMPLETED call ends its turn with a tool/stop finish, never max-tokens — so max-tokens takes precedence.
	if (signal.hadToolCall && signal.finishReason !== "max-tokens") {
		// P23.5 (2): "a tool call happened" is not "an action landed". The campaign's wall was a worker emitting
		// EMPTY write_file calls on clean stops — the SDK salvaged `{}`, the tool refused, and the same empty call
		// came back. Judge the ARGUMENTS the SDK would dispatch: an unusable call is a malformed turn, and the
		// constrained rung (the strongest model-side lever) answers it. A lossless local repair is applied in the
		// buffered events instead; a mixed batch keeps its good calls (a single-call re-force would lose them).
		const triage = triageStreamedToolCalls(turn.events, request.tools);
		if (triage.verdict === "malformed" && triage.firstUnusable) {
			const unusable = triage.firstUnusable;
			return {
				outcome: "malformed",
				availableStrategies: uniqueStrategies([
					constrainedRung(options, baseline),
					promptVariantRung(options, baseline),
					...endpointAndCarry(options, baseline),
				]),
				evidence: `tool call with no usable arguments — ${describeUnusableToolCall(unusable)}`,
				whyFailed: `the model called ${unusable.call.toolName ?? "a tool"} without usable arguments; the tool would refuse it`,
				malformedCall: {
					toolName: unusable.call.toolName ?? "",
					fieldsToReask: unusable.assessment.fieldsToReask,
					reason: unusable.assessment.reason,
				},
			};
		}
		return {
			outcome: "success",
			availableStrategies: [],
			evidence:
				triage.verdict === "repaired"
					? "structured tool call emitted (arguments locally repaired)"
					: "structured tool call emitted",
			whyFailed: "",
			...(triage.verdict === "repaired" || triage.verdict === "mixed" ? { events: triage.events } : {}),
		};
	}
	if (signal.callerAborted) {
		return {
			outcome: "other_failure",
			availableStrategies: [],
			evidence: "outer request signal aborted",
			whyFailed: "caller/session cancellation is authoritative and must never be retried",
		};
	}
	if (signal.thrownError instanceof ReasoningBudgetBreachError) {
		// F3.36 (b): the reasoning budget was cut mid-stream. The turn is ABORTED (no action landed), and the rung
		// that answers it is thinking-off — first, ahead of a bigger budget, which would only buy more reasoning.
		// The remedy for a breach IS thinking-off: offering a bigger budget beside it would let the brain's usual
		// aborted-turn preference buy more reasoning instead. A model without any switch keeps the ordinary
		// aborted-turn ladder (the wrapper is not armed for such models, so this arm is a safety net).
		const thinking = hasThinkingSwitch(options.modelId) ? "thinking_disable" : null;
		return {
			outcome: "aborted",
			availableStrategies: thinking
				? [thinking]
				: uniqueStrategies([
						"raise_token_budget",
						"same_model_retry",
						"context_shrink",
						...endpointAndCarry(options, request),
					]),
			evidence: errorText(signal.thrownError),
			whyFailed: "the reasoning budget was breached mid-stream before any action landed",
		};
	}
	if (signal.thrownError instanceof ConstrainedToolCallNoCallError) {
		// The constrained rung got NO call from either forcing step: still a malformed turn (the previous attempt's
		// classification stands), and the ladder continues down the malformed list without that rung.
		return {
			outcome: "malformed",
			availableStrategies: uniqueStrategies([
				promptVariantRung(options, baseline),
				...endpointAndCarry(options, baseline),
			]),
			evidence: errorText(signal.thrownError),
			whyFailed: "the constrained rung produced no tool call at all",
		};
	}
	if (signal.thrownError instanceof RunawayGenerationInterruptError) {
		return {
			outcome: "loop",
			availableStrategies: strategiesForSignature("response_loop", request, options),
			evidence: errorText(signal.thrownError),
			whyFailed: "runaway-generation detector interrupted a degenerate turn",
		};
	}
	const rawFailure = signal.thrownError ?? signal.finishError;
	if (rawFailure !== null) {
		const failure = classifyFailureSignature(rawFailure);
		const availableStrategies =
			failure.signature === "model_unavailable"
				? endpointAndCarry(options, request)
				: failure.remediable
					? strategiesForSignature(failure.signature, request, options)
					: [];
		return {
			outcome: failure.outcome,
			availableStrategies,
			evidence: errorText(rawFailure).slice(0, 500) || failure.signature,
			whyFailed: failure.reason,
		};
	}
	if (signal.finishReason === "max-tokens") {
		return {
			outcome: "aborted",
			availableStrategies: strategiesForSignature("token_budget", request, options),
			evidence: signal.hadToolCall
				? "finish reason=max-tokens; a tool call was cut mid-emission (salvaged with empty input)"
				: "finish reason=max-tokens; no tool call",
			whyFailed: "the output budget ended before the required action landed",
		};
	}
	if (signal.finishReason === "aborted" || signal.finishReason === null) {
		const thinking = hasThinkingSwitch(options.modelId) ? "thinking_disable" : null;
		return {
			outcome: "aborted",
			availableStrategies: uniqueStrategies([
				"raise_token_budget",
				thinking,
				"same_model_retry",
				"context_shrink",
				...endpointAndCarry(options, request),
			]),
			evidence: `finish reason=${signal.finishReason ?? "missing"}; no tool call`,
			whyFailed: "the provider turn ended before producing an action",
		};
	}
	if (signal.finishReason === "error") {
		return {
			outcome: "other_failure",
			availableStrategies: uniqueStrategies(["same_model_retry", ...endpointAndCarry(options, request)]),
			evidence: "finish reason=error without an error body",
			whyFailed: "the provider reported an unclassified terminal error",
		};
	}
	const plan = planSwarmPromptVariation(request, options.role ?? "unknown");
	if (plan) {
		return {
			outcome: "no_tool_call",
			availableStrategies: uniqueStrategies([
				request.tools.length > 1 ? "reduced_tool_set" : null,
				options.promptVariationEnabled === false ? null : "prompt_variant",
				...endpointAndCarry(options, request),
			]),
			evidence: `clean stop with no call to required tool ${plan.toolName}; text=${bufferedText(turn.events).slice(0, 300) || "(empty)"}`,
			whyFailed: `the model stopped without calling ${plan.toolName}`,
		};
	}
	return {
		outcome: "success",
		availableStrategies: [],
		evidence: "legitimate prose turn or no action anchor",
		whyFailed: "",
	};
}

function stringifyCompact(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function compactText(text: string, label: string): string {
	if (text.length <= COMPACTED_BLOCK_CHARS) return text;
	return `[!Klein ${label} compacted for retry; original ${text.length} chars] ${text.slice(0, COMPACTED_BLOCK_CHARS)}`;
}

/**
 * Shrink bulky prior content without deleting any tool-call/tool-result block or breaking their ids. Completed work
 * remains explicit; only large payloads and old prose/reasoning are summarized.
 */
export function compactAgentMessagesPreservingToolWork(messages: readonly AgentMessage[]): AgentMessage[] {
	const recentStart = Math.max(0, messages.length - 2);
	return messages.map((message, messageIndex) => ({
		...message,
		content: message.content.map((part): AgentMessagePart => {
			if (part.type === "tool-call") return { ...part };
			if (part.type === "tool-result") {
				const output = stringifyCompact(part.output);
				return output.length <= COMPACTED_BLOCK_CHARS
					? { ...part }
					: { ...part, output: compactText(output, `prior ${part.toolName} result`) };
			}
			if (part.type === "reasoning" && messageIndex < recentStart) {
				return { ...part, text: compactText(part.text, "prior reasoning") };
			}
			if (part.type === "file" && messageIndex < recentStart) {
				return { ...part, content: compactText(part.content, `prior file ${part.path}`) };
			}
			if (part.type === "text" && messageIndex < recentStart) {
				return { ...part, text: compactText(part.text, "prior message") };
			}
			return { ...part };
		}),
	}));
}

function appendRetryNote(request: AgentModelRequest, note: string): AgentModelRequest {
	if (!note.trim()) return request;
	const last = request.messages.at(-1);
	// Mistral-family Jinja templates hard-500 on consecutive same-role messages (wire-proven 2026-07-17), and
	// on a retry the trailing message is ALWAYS the tool_result USER turn — so appending the note as its own
	// user message made every retry a [user, user] pair. N3's ministral tripwire caught this site live on its
	// first cell (2026-08-04, 4 fires in one drain). Merge the note into the trailing user turn instead: same
	// delivered text, alternation-safe for every family.
	if (last?.role === "user") {
		const merged = { ...last, content: [...last.content, { type: "text" as const, text: note }] };
		return { ...request, messages: [...request.messages.slice(0, -1), merged] };
	}
	const createdAt = (last?.createdAt ?? 0) + 1;
	return {
		...request,
		messages: [
			...request.messages,
			{
				id: `nklein-retry-${createdAt}`,
				role: "user",
				createdAt,
				content: [{ type: "text", text: note }],
			},
		],
	};
}

/**
 * F3.36 (b): a thinking soft switch is either a MESSAGE token (`/no_think` families) or a REQUEST parameter
 * (`reasoning_effort:"none"` on the qwen3.8 line, live-verified) — both are verified switches the ladder may drive.
 */
function hasThinkingSwitch(modelId: string): boolean {
	return supportsThinkingControl(modelId) || getThinkingRequestControl(modelId) !== null;
}

function applyThinkingOff(request: AgentModelRequest, modelId: string): AgentModelRequest {
	for (let index = request.messages.length - 1; index >= 0; index -= 1) {
		const message = request.messages[index];
		if (message?.role !== "user") continue;
		const partIndex = message.content.findIndex((part) => part.type === "text" && part.text.trim().length > 0);
		if (partIndex < 0) continue;
		const content = [...message.content];
		const part = content[partIndex];
		if (part?.type !== "text") continue;
		content[partIndex] = { ...part, text: applyThinkingDisable(part.text, modelId) };
		const messages = [...request.messages];
		messages[index] = { ...message, content };
		return {
			...request,
			messages,
			options: { ...request.options, thinking: false, ...thinkingOffRequestOptions(modelId) },
		};
	}
	return { ...request, options: { ...request.options, thinking: false, ...thinkingOffRequestOptions(modelId) } };
}

/**
 * The request-parameter half of thinking-off: for a param-switch model the message token is a no-op, so the rung
 * must ride the request (`reasoning_effort:"none"`); the local endpoint model forwards `options.reasoningEffort`.
 */
function thinkingOffRequestOptions(modelId: string): { reasoningEffort?: string } {
	const control = getThinkingRequestControl(modelId);
	return control ? { reasoningEffort: control.disableValue } : {};
}

function requestForStrategy(
	baseline: AgentModelRequest,
	strategy: RetryStrategy,
	note: string,
	options: AdaptiveSwarmRecoveryModelOptions,
	malformedCall: ConstrainedToolCallContext | null = null,
): { request: AgentModelRequest; label: string } {
	let request = baseline;
	let label: string = strategy;
	if (strategy === "raise_token_budget") {
		const current =
			typeof baseline.options?.maxTokens === "number"
				? baseline.options.maxTokens
				: (options.baseMaxTokens ?? DEFAULT_BASE_OUTPUT_TOKENS);
		request = {
			...baseline,
			options: { ...baseline.options, maxTokens: raisedTokenBudget({ current, attempt: 1 }) },
		};
	} else if (strategy === "thinking_disable") {
		request = applyThinkingOff(baseline, options.modelId);
	} else if (strategy === "reduced_tool_set") {
		const plan = planSwarmPromptVariation(baseline, options.role ?? "unknown");
		const tool = plan ? baseline.tools.find((candidate) => candidate.name === plan.toolName) : undefined;
		if (tool) request = { ...baseline, tools: [tool] };
	} else if (strategy === "prompt_variant") {
		const plan = planSwarmPromptVariation(baseline, options.role ?? "unknown");
		if (plan) {
			request = plan.request;
			label = `prompt_variant:${plan.family}`;
		}
	} else if (strategy === "context_shrink") {
		request = { ...baseline, messages: compactAgentMessagesPreservingToolWork(baseline.messages) };
	} else if (strategy === "constrained_schema") {
		// Narrow to the tool the model failed to fill and name the failure on the request, so the constrained model
		// forces THAT call and its re-ask can list the missing fields.
		const tool = malformedCall
			? baseline.tools.find((candidate) => candidate.name === malformedCall.toolName)
			: undefined;
		request = {
			...baseline,
			...(tool ? { tools: [tool] } : {}),
			options: {
				...baseline.options,
				metadata: {
					...((baseline.options?.metadata as Record<string, unknown> | undefined) ?? {}),
					...(malformedCall ? { [CONSTRAINED_TOOL_CALL_CONTEXT_KEY]: malformedCall } : {}),
				},
			},
		};
	}
	return { request: appendRetryNote(request, note), label };
}

function modelForStrategy(
	base: AgentModel,
	strategy: RetryStrategy | null,
	options: AdaptiveSwarmRecoveryModelOptions,
) {
	if (strategy === "alternate_endpoint" && options.alternateEndpointModel) return options.alternateEndpointModel;
	if (strategy === "constrained_schema" && options.constrainedToolCallModel) return options.constrainedToolCallModel;
	if (strategy === "cross_model_carry" && options.crossModel) return options.crossModel;
	return base;
}

/**
 * Buffer one swarm turn, classify concrete finish/error evidence, and let `runAdaptiveAttemptLoop` select only rungs
 * this provider seam can execute. Any turn that emitted a tool call WITH usable arguments is terminal-success and is
 * never replayed; a call without them is a malformed turn (P23.5 (2)).
 */
export function createAdaptiveSwarmRecoveryModel(
	base: AgentModel,
	options: AdaptiveSwarmRecoveryModelOptions,
): AgentModel {
	return {
		stream(request): AsyncIterable<AgentModelEvent> {
			return (async function* () {
				const profile = options.profile ?? emptyModelBehaviorProfile(options.modelId, 0);
				// F3.36 (b): when the previous attempt was cut for a reasoning-budget breach, the thinking-off retry
				// also carries little-coder's nudge — commit to an implementation instead of reasoning further.
				let breachPending = false;
				// P23.5 (2): the call the last attempt emitted without usable arguments — the constrained rung's target.
				let malformedCall: ConstrainedToolCallContext | null = null;
				const outcome = await runAdaptiveAttemptLoop<AttemptPayload>({
					profile,
					strategyEffectivenessLedger: options.strategyEffectivenessLedger,
					supportsThinkingControl: hasThinkingSwitch(options.modelId),
					retryBudgetOptions: {
						minBudget: options.minRetryBudget ?? DEFAULT_MIN_RETRY_BUDGET,
						maxBudget: options.maxRetryBudget ?? 6,
					},
					runAttempt: async (strategy, note, attemptContext) => {
						const startedAt = Date.now();
						const promptPlan =
							strategy === "prompt_variant"
								? planSwarmPromptVariation(request, options.role ?? "unknown")
								: null;
						const retryNote =
							strategy === "thinking_disable" && breachPending
								? [note, REASONING_BUDGET_BREACH_NUDGE].filter((part) => part.trim()).join("\n\n")
								: note;
						const planned = strategy
							? requestForStrategy(request, strategy, retryNote, options, malformedCall)
							: { request, label: "baseline" };
						const selected = modelForStrategy(base, strategy, options);
						const providerRequest: AgentModelRequest = {
							...planned.request,
							options: {
								...planned.request.options,
								metadata: {
									...((planned.request.options?.metadata as Record<string, unknown> | undefined) ?? {}),
									nkleinProviderMaxRetries: 0,
								},
							},
						};
						const buffered = await collectBufferedModelTurn(selected, providerRequest, (event) => {
							if ((event.type === "text-delta" || event.type === "reasoning-delta") && event.text.length > 0) {
								options.onBufferedToken?.();
							}
						});
						const classified = classifyTurn(buffered, planned.request, options, request);
						breachPending = buffered.signal.thrownError instanceof ReasoningBudgetBreachError;
						if (classified.malformedCall) malformedCall = classified.malformedCall;
						const repaired = classified.events ? { ...buffered, events: [...classified.events] } : buffered;
						const durationMs = Math.max(0, Date.now() - startedAt);
						const usage = bufferedUsage(buffered.events);
						const recovered = strategy !== null && classified.outcome === "success";
						try {
							options.onAttempt?.({
								strategy,
								triggerOutcome: attemptContext.triggerOutcome,
								strategyLabel: strategy === null ? null : planned.label,
								outcome: classified.outcome,
								availableStrategies: classified.availableStrategies,
								recovered,
								finishReason: buffered.signal.finishReason,
								evidence: classified.evidence,
								promptFamily: promptPlan?.family ?? null,
								toolName: promptPlan?.toolName ?? null,
								durationMs,
								inputTokens: usage.inputTokens,
								outputTokens: usage.outputTokens,
							});
						} catch {
							// Observability must never alter recovery semantics.
						}
						if (recovered) options.onStrategyApplied?.(planned.label);
						return {
							result: { buffered: repaired, request: providerRequest, strategy, strategyLabel: planned.label },
							outcome: classified.outcome,
							availableStrategies: classified.availableStrategies,
							evidence: classified.evidence,
							whyFailed: classified.whyFailed,
						};
					},
				});
				for (const event of outcome.result.buffered.events) yield event;
				if (outcome.result.buffered.signal.thrownError !== null) {
					throw outcome.result.buffered.signal.thrownError;
				}
			})();
		},
	};
}
