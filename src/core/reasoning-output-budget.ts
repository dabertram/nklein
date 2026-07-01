/**
 * Reasoning-aware OUTPUT-BUDGET sizing (todo §5.AN — "get more out of every model", the PRE-FLIGHT complement to the
 * post-hoc reasoning-starvation signal).
 *
 * WHAT: `max_tokens` caps the WHOLE generation, but a reasoning model spends a large, model-family-dependent slice of it on
 * the `reasoning_content` channel BEFORE it emits a single ANSWER token. So a budget that is generous for a non-reasoning
 * model can STARVE the answer on a reasoning model — the request hits the token wall mid-thought and the answer never
 * lands. This module computes, offline + deterministically, the TOTAL `max_tokens` to request so that a desired ANSWER
 * budget survives the reasoning burn: `total ≈ reasoningReserve + answerBudget`.
 *
 * WHY (§5.AN / §4A live findings, 2026-07-01, probed on 127.0.0.1:1234): reasoning models "burn 500–850 reasoning tok
 * first" and then produce a small answer — a `max_tokens` of 200/800/2000 alike dead-ends because the reasoning channel
 * eats the budget before any content. The §5.AN sibling `completion-stop-reason.ts` already detects this AFTER the fact:
 * `deriveTruncationSignal` raises `reasoningStarvedBudget` when `reasoningTokens ≥ 0.9 × tokenBudget`. This module is the
 * mirror-image PRE-flight producer — it SIZES the budget so that starvation does not happen in the first place, instead of
 * reacting to it on the next attempt. Feeding a starvation-proof budget in cuts the wasted first attempt.
 *
 * COMPOSITION (no duplicated model knowledge): when the caller passes a `modelId`, whether the model reasons is decided by
 * the single-source-of-truth predicate {@link isReasoningModel} (`model-thinking-control.ts`, §5.AN) — the SAME predicate
 * `structured-output-strategy.ts` branches on. A caller that already knows can pass an explicit `isReasoning` override
 * instead. For a NON-reasoning model the reasoning reserve is ZERO, so the total equals the answer budget — this module
 * never inflates a budget it doesn't need to.
 *
 * PIPELINE POSITION: this is the SIZING step; it produces the `desiredMaxTokens` that the §5.AN window-clamp
 * (`clampMaxTokens`, `lmstudio-max-tokens-clamp.ts`) then bounds against the LOADED context window. Sequence per request:
 *   planReasoningOutputBudget(...) → totalMaxTokens   (reserve room for the reasoning burn — THIS module)
 *   clampMaxTokens({ desiredMaxTokens: totalMaxTokens, promptTokens, contextWindow }) → safe max_tokens   (fit the window)
 * The two are orthogonal: this one asks "how big does the budget need to be so the answer survives the thinking?"; the
 * clamp asks "how big is the budget ALLOWED to be given the window?". A reasoning model on a nearly-full window can still
 * end up window-clamped — that is the clamp's `prompt_exhausts_window` → compact verdict, not this module's concern.
 *
 * INJECT everything (prime directive #1): the caller passes the desired answer budget and (optionally) the estimated
 * reasoning overhead + a headroom multiplier. This module calls no tokenizer, no model, no clock, no I/O — it is pure
 * arithmetic over injected counts plus the composed `isReasoningModel` string predicate, and returns a plan, never a request.
 *
 * Pure + total. Non-finite / out-of-range inputs are coerced to safe defaults; the returned `totalMaxTokens` is always a
 * strictly-positive integer ≥ the (clamped) answer budget.
 */

import { isReasoningModel } from "./model-thinking-control";

/**
 * Default estimated reasoning-channel overhead for a reasoning model, in tokens (768). Sits inside the live-observed
 * 500–850-token "burns reasoning first" band (§5.AN / §4A, 2026-07-01) — deliberately toward the high end so the ANSWER
 * budget is reserved on TOP of a realistic-to-pessimistic thinking burn rather than a lucky-short one. A caller with a
 * measured per-model figure (e.g. from `usage.completion_tokens_details.reasoning_tokens` or the §5.AL catalog) should
 * inject it via {@link ReasoningOutputBudgetInput.estimatedReasoningTokens}.
 */
export const DEFAULT_REASONING_OVERHEAD_TOKENS = 768;

/**
 * Default headroom multiplier applied to the reasoning reserve (1.25) — a 25% cushion over the point estimate to absorb
 * the run-to-run VARIANCE in how much a reasoning model thinks (the same prompt can burn noticeably more on a hard turn).
 * Applied ONLY to the reasoning reserve, never to the answer budget (the answer size is the caller's explicit intent).
 * Clamped to ≥ 1 (a multiplier below 1 would shrink the reserve, defeating the purpose).
 */
export const DEFAULT_REASONING_HEADROOM_MULTIPLIER = 1.25;

/** The smallest answer budget this module will plan for (8 tokens) — a request cannot meaningfully ask for `max_tokens:0`. */
export const MIN_ANSWER_BUDGET_TOKENS = 8;

/** Why the planned budget landed where it did — the actionable half of {@link ReasoningOutputBudget}. */
export type ReasoningOutputBudgetReason =
	/** The model does NOT reason (or reasoning was explicitly disabled): no reserve added; total == the answer budget. */
	| "no_reasoning_reserve"
	/** The model reasons: a headroom-scaled reasoning reserve was added on top of the answer budget. */
	| "reasoning_reserve_added";

/** The budget plan for one request: the total `max_tokens` to request, split into the reserved reasoning burn + the answer. */
export interface ReasoningOutputBudget {
	/**
	 * The total `max_tokens` to send: `reasoningReserveTokens + answerBudgetTokens`, a strictly-positive integer. Feed
	 * THIS as `desiredMaxTokens` into `clampMaxTokens` so it is then bounded against the loaded context window.
	 */
	totalMaxTokens: number;
	/** The portion of {@link totalMaxTokens} reserved for the reasoning channel before any answer (0 for a non-reasoning model). */
	reasoningReserveTokens: number;
	/** The portion of {@link totalMaxTokens} protected for the actual ANSWER (the caller's desired answer budget, floored). */
	answerBudgetTokens: number;
	/** Whether a reasoning reserve was added (the model reasons) or the total is just the answer budget. */
	reason: ReasoningOutputBudgetReason;
	/** `true` exactly when a reasoning reserve was added — i.e. {@link reason} is `"reasoning_reserve_added"`. */
	reservedForReasoning: boolean;
}

/** The inputs to the budget plan — all injected (prime directive #1); no tokenizer/model/clock is called. */
export interface ReasoningOutputBudgetInput {
	/**
	 * The `max_tokens` the caller wants available for the actual ANSWER (excluding any reasoning burn). Coerced to a
	 * non-negative integer and floored at {@link MIN_ANSWER_BUDGET_TOKENS} so the request can always emit something.
	 */
	answerBudgetTokens: number;
	/**
	 * The model identifier — used to decide whether the model reasons via the composed {@link isReasoningModel} predicate
	 * (the single source of truth, §5.AN). Ignored when {@link isReasoning} is given explicitly. Absent + no `isReasoning`
	 * ⇒ treated as non-reasoning (no reserve), the safe non-inflating default.
	 */
	modelId?: string;
	/**
	 * Explicit override for "does this model reason?" — takes precedence over `modelId`. Use when the caller already knows
	 * (e.g. reasoning was soft-disabled via `/no_think`, so even a reasoning-family model will NOT burn reasoning this turn
	 * ⇒ pass `false` to avoid over-reserving; or a model outside the recognized families that the caller knows reasons).
	 */
	isReasoning?: boolean;
	/**
	 * Estimated reasoning-channel overhead for THIS model, in tokens, when it reasons. Defaults to
	 * {@link DEFAULT_REASONING_OVERHEAD_TOKENS}. Coerced to a non-negative integer. Applied only when the model reasons.
	 */
	estimatedReasoningTokens?: number;
	/**
	 * Multiplier applied to the reasoning overhead for variance headroom. Defaults to
	 * {@link DEFAULT_REASONING_HEADROOM_MULTIPLIER}. Clamped to ≥ 1 (never shrinks the reserve).
	 */
	reasoningHeadroomMultiplier?: number;
}

/** Coerce to a non-negative finite integer, defaulting a non-finite/absent value to `fallback`. */
function nonNegativeInt(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.floor(value));
}

/**
 * Resolve whether the model reasons: the explicit `isReasoning` override wins; otherwise derive it from `modelId` via the
 * composed {@link isReasoningModel} predicate; with neither, default to `false` (no reserve — never inflate blindly).
 */
function resolveIsReasoning(input: ReasoningOutputBudgetInput): boolean {
	if (typeof input.isReasoning === "boolean") {
		return input.isReasoning;
	}
	if (typeof input.modelId === "string" && input.modelId.length > 0) {
		return isReasoningModel(input.modelId);
	}
	return false;
}

/**
 * Plan the output budget for one request so a reasoning model's ANSWER survives its reasoning burn — the §5.AN pre-flight
 * budget sizer. Deterministic, offline, INJECT-only.
 *
 * Algorithm (all arithmetic + the composed reasoning predicate; no I/O):
 *   1. Floor the desired `answerBudgetTokens` to a non-negative integer, then to ≥ {@link MIN_ANSWER_BUDGET_TOKENS}.
 *   2. Decide whether the model reasons ({@link resolveIsReasoning}: explicit override → `modelId` predicate → false).
 *   3. NON-reasoning ⇒ reserve 0; `total = answerBudget`; reason `"no_reasoning_reserve"` (no inflation).
 *   4. REASONING ⇒ `reserve = ceil(estimatedReasoningTokens × headroomMultiplier)`; `total = reserve + answerBudget`;
 *      reason `"reasoning_reserve_added"`. The answer budget is protected ON TOP of the reserve, so even after the model
 *      spends the whole reserve thinking, the requested answer budget remains.
 *
 * Postcondition: `totalMaxTokens` is a strictly-positive integer, `totalMaxTokens == reasoningReserveTokens +
 * answerBudgetTokens`, and `totalMaxTokens ≥ answerBudgetTokens` (equal iff the model does not reason).
 *
 * @param input the injected counts + model signal; see {@link ReasoningOutputBudgetInput}.
 */
export function planReasoningOutputBudget(input: ReasoningOutputBudgetInput): ReasoningOutputBudget {
	const answerBudgetTokens = Math.max(MIN_ANSWER_BUDGET_TOKENS, nonNegativeInt(input.answerBudgetTokens, 0));

	if (!resolveIsReasoning(input)) {
		return {
			totalMaxTokens: answerBudgetTokens,
			reasoningReserveTokens: 0,
			answerBudgetTokens,
			reason: "no_reasoning_reserve",
			reservedForReasoning: false,
		};
	}

	const estimatedReasoningTokens = nonNegativeInt(input.estimatedReasoningTokens, DEFAULT_REASONING_OVERHEAD_TOKENS);
	const rawMultiplier = input.reasoningHeadroomMultiplier;
	const headroomMultiplier =
		typeof rawMultiplier === "number" && Number.isFinite(rawMultiplier)
			? Math.max(1, rawMultiplier)
			: DEFAULT_REASONING_HEADROOM_MULTIPLIER;

	const reasoningReserveTokens = Math.ceil(estimatedReasoningTokens * headroomMultiplier);

	return {
		totalMaxTokens: reasoningReserveTokens + answerBudgetTokens,
		reasoningReserveTokens,
		answerBudgetTokens,
		reason: "reasoning_reserve_added",
		reservedForReasoning: true,
	};
}
