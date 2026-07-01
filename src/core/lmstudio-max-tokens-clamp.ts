/**
 * Per-request `max_tokens` CLAMP policy (todo §5.AN — "get more out of every model", the pre-flight output-budget guard).
 *
 * Every LM Studio request dialect shares one hard constraint: `promptTokens + generatedTokens ≤ contextWindow`. The
 * OpenAI `/v1/chat/completions` `max_tokens` field caps only the OUTPUT half — so if we send a request whose prompt
 * already fills most of a loaded window and pass an ambitious `max_tokens`, one of two silent failures happens: the
 * server either rejects the request (prompt + budget > window) or truncates generation the instant the window fills
 * (`finish_reason:"length"` / native `contextLengthReached`). The §5.AN sibling `completion-stop-reason.ts` REACTS to
 * that truncation AFTER the fact; this module PREVENTS it — it computes, offline and deterministically, the largest
 * SAFE `max_tokens` for a request whose prompt token count is already known, given the model's LOADED context window.
 *
 * This is the request-side complement of `load-context-plan.ts`: that planner sizes the window a model is LOADED at (the
 * `--context-length` / `/api/v1/models/load` knob, the #1 VRAM lever); THIS clamps the per-request OUTPUT budget against
 * whatever window ended up loaded, so a single request never overflows it at generation time. It is also the concrete
 * producer for the `reservedOutputTokens` field the runtime context-budget breakdown carries
 * (`task-session-api-contract.ts`) — nothing computed that number before.
 *
 * INJECT everything (prime directive #1): the caller passes the already-counted `promptTokens`, the loaded
 * `contextWindow`, and the `desiredMaxTokens` it WANTS. This module calls no tokenizer, no model, no clock, no I/O — it
 * is pure arithmetic over injected token counts and returns a verdict, never a request.
 *
 * The ≥32k floor (prime directive #3) is honored as a SANITY input, not a lie: the floor is the minimum window a model
 * is ever loaded at, so a well-formed `contextWindow` is ≥ the floor. When a caller passes a sub-floor window (a
 * misconfigured/rejected model that the §5.AB/§5.L suitability gate should have caught), the clamp still returns a
 * physically-safe budget for the window it was actually given — it never fabricates room the window doesn't have.
 *
 * Pure + deterministic. The verdict feeds the live request-assembly seam (set `max_tokens`) and the §5.AA truncation
 * rung (a prompt that leaves NO room routes to compaction, not a futile budget bump — mirroring the
 * `TruncatedContext` vs `TruncatedTokens` split `completion-stop-reason.ts` already draws).
 */

/** Why a request's output budget landed where it did — the actionable half of {@link MaxTokensClamp}. */
export type MaxTokensClampReason =
	/** The desired budget fit within the free window (minus reserve) as-is — no clamping was needed. */
	| "fits"
	/** The desired budget exceeded the free window; it was clamped DOWN to the largest budget that still fits. */
	| "clamped_to_window"
	/**
	 * The prompt (plus the safety reserve) already fills the window — there is (near) no room to generate. Raising
	 * `max_tokens` cannot help; the caller must COMPACT the prompt (or load a larger window). `maxTokens` is the small
	 * floor budget so a degenerate request still emits *something* rather than zero.
	 */
	| "prompt_exhausts_window";

/** The clamp verdict for one request: the safe `max_tokens` to send, plus why and the room the prompt left. */
export interface MaxTokensClamp {
	/** The `max_tokens` value that is SAFE to send: a positive integer with `promptTokens + maxTokens ≤ contextWindow`. */
	maxTokens: number;
	/** Whether the desired budget fit, was clamped down, or the prompt exhausted the window. */
	reason: MaxTokensClampReason;
	/**
	 * Tokens left in the window for OUTPUT after the prompt and the safety reserve (`contextWindow − promptTokens −
	 * reserve`), floored at 0 — the hard ceiling `maxTokens` was fit under. `0` means the prompt exhausted the window.
	 */
	availableOutputTokens: number;
	/** `true` exactly when {@link reason} is `"prompt_exhausts_window"` — the caller should COMPACT, not raise the budget. */
	shouldCompact: boolean;
}

/** The inputs to the clamp — all injected token counts (prime directive #1); no tokenizer/model/clock is called. */
export interface MaxTokensClampInput {
	/** Tokens already in the assembled request (system + tools + history + user) — the caller's counted prompt size. */
	promptTokens: number;
	/** The model's LOADED context window in tokens (what `load-context-plan.ts` sized; ≥ the ≥32k floor when well-formed). */
	contextWindow: number;
	/** The `max_tokens` the caller WANTS for this request (the ambitious/target output budget). */
	desiredMaxTokens: number;
	/**
	 * Tokens held back from the window as a safety margin for prompt-count drift + framing overhead the caller's
	 * `promptTokens` estimate may miss (chat template tokens, BOS/EOS, tool-schema rounding). Defaults to
	 * {@link DEFAULT_SAFETY_RESERVE_TOKENS}. Clamped to ≥ 0.
	 */
	safetyReserveTokens?: number;
	/**
	 * The smallest output budget to return even when the window is exhausted, so a degenerate request still generates
	 * *something* (and to avoid a zero/negative `max_tokens`, which servers reject). Defaults to
	 * {@link DEFAULT_MIN_OUTPUT_TOKENS}. Clamped to ≥ 1.
	 */
	minOutputTokens?: number;
}

/**
 * Default safety margin held back from the window (256 tokens) — covers chat-template + BOS/EOS + tool-schema rounding
 * that a caller's `promptTokens` estimate commonly under-counts, so the realized prompt still fits under the window.
 */
export const DEFAULT_SAFETY_RESERVE_TOKENS = 256;

/**
 * Default minimum output budget (16 tokens) — even when the prompt exhausts the window we return a small positive budget
 * so the request still emits something (an error sentence, a short tool call) rather than a server-rejected `max_tokens:0`.
 */
export const DEFAULT_MIN_OUTPUT_TOKENS = 16;

/** Coerce a value to a non-negative, finite integer (defaulting a non-finite/absent value to `fallback`). */
function nonNegativeInt(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.floor(value));
}

/**
 * Compute the largest SAFE `max_tokens` for a request whose prompt size is already known — the §5.AN pre-flight
 * output-budget clamp. Deterministic, offline, INJECT-only.
 *
 * Algorithm (all arithmetic; no I/O):
 *   1. Normalize inputs: `promptTokens`/`contextWindow`/`desiredMaxTokens`/`safetyReserveTokens` to non-negative
 *      integers; `minOutputTokens` to ≥ 1 (a zero/negative budget is not a valid request).
 *   2. `availableOutputTokens = max(0, contextWindow − promptTokens − safetyReserve)` — the hard output ceiling once
 *      the prompt and the safety margin are subtracted from the loaded window.
 *   3. If that ceiling is below `minOutputTokens`, the prompt has (near) exhausted the window: return the `minOutput`
 *      floor with reason `"prompt_exhausts_window"` + `shouldCompact:true`. Raising `max_tokens` cannot recover room;
 *      the fix is to compact the prompt (mirrors the `TruncatedContext` branch in `completion-stop-reason.ts`).
 *   4. Otherwise clamp the desired budget into `[minOutputTokens, availableOutputTokens]`:
 *        - `desired ≤ ceiling` → the desired budget `"fits"` unchanged;
 *        - `desired > ceiling` → `"clamped_to_window"` at the ceiling (the largest budget that still fits the window);
 *        - `desired < minOutput` (a tiny/zero desired budget) → raised to `minOutput`, still reported as `"fits"`.
 *
 * Postcondition (well-formed positive `contextWindow`): the returned `maxTokens` is a positive integer and
 * `promptTokens + maxTokens ≤ contextWindow` whenever the prompt itself fits the window; when the prompt alone already
 * meets/exceeds the window, `maxTokens` is the small `minOutput` floor (an intentional, flagged escape hatch so the
 * request is still valid — the caller is told to compact).
 */
export function clampMaxTokens(input: MaxTokensClampInput): MaxTokensClamp {
	const promptTokens = nonNegativeInt(input.promptTokens, 0);
	const contextWindow = nonNegativeInt(input.contextWindow, 0);
	const desiredMaxTokens = nonNegativeInt(input.desiredMaxTokens, 0);
	const safetyReserve = nonNegativeInt(input.safetyReserveTokens, DEFAULT_SAFETY_RESERVE_TOKENS);
	const minOutput = Math.max(1, nonNegativeInt(input.minOutputTokens, DEFAULT_MIN_OUTPUT_TOKENS));

	const availableOutputTokens = Math.max(0, contextWindow - promptTokens - safetyReserve);

	// The prompt (plus reserve) has (near) filled the window — no budget bump can create room; compact instead.
	if (availableOutputTokens < minOutput) {
		return {
			maxTokens: minOutput,
			reason: "prompt_exhausts_window",
			availableOutputTokens,
			shouldCompact: true,
		};
	}

	// There is room. Clamp the desired budget into [minOutput, availableOutputTokens].
	if (desiredMaxTokens > availableOutputTokens) {
		return {
			maxTokens: availableOutputTokens,
			reason: "clamped_to_window",
			availableOutputTokens,
			shouldCompact: false,
		};
	}

	const maxTokens = Math.max(minOutput, desiredMaxTokens);
	return {
		maxTokens,
		reason: "fits",
		availableOutputTokens,
		shouldCompact: false,
	};
}
