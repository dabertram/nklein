/**
 * §5.AN: normalize a completion's STOP-REASON across LM Studio's three request dialects into ONE actionable outcome (pure).
 *
 * WHAT: the same "why did generation end?" fact comes back under a DIFFERENT vocabulary depending on which endpoint served
 * the turn — and today each caller re-checks the raw string ad-hoc (`chat-local-llm-adapter.ts` hard-codes
 * `finishReason === "length"`), so a turn truncated on a NON-OpenAI dialect is missed. The three vocabularies (all
 * observed on the local server, §5.AN endpoint map):
 *   - OpenAI-compat `/v1` `finish_reason`:      `stop` · `length` · `tool_calls` · `content_filter` · `function_call`
 *   - Anthropic-compat `/v1/messages` `stop_reason`: `end_turn` · `max_tokens` · `tool_use` · `stop_sequence` · `refusal`
 *   - Native `/api/v0` `stats.stop_reason`:      `eosFound` · `stopStringFound` · `maxPredictedTokensReached` ·
 *                                                `maxTokensReached` · `contextLengthReached` · `toolCalls` · `userStopped` · `failed`
 *
 * WHY: the two TRUNCATION outcomes ({@link CompletionOutcome.TruncatedTokens} / {@link CompletionOutcome.TruncatedContext})
 * are exactly the §5.AA truncation-recovery trigger — a turn that hit the token/context wall was CUT OFF (not done), so
 * before shrinking the tool set or forcing a schema the caller should re-ask with a bigger budget. Distinguishing the two
 * matters: a `maxTokens` truncation is fixed by raising `max_tokens`; a `contextLength` truncation means the WINDOW is
 * full (raising `max_tokens` won't help — compact instead). A single normalized outcome lets every path ("get more out of
 * every model") share one classifier instead of drifting per-dialect string checks.
 *
 * Pure + defensive: unknown / missing strings map to {@link CompletionOutcome.Unknown} (never throws); matching is
 * case-insensitive + underscore/space tolerant so a dialect spelling variant still classifies.
 */

/** The normalized "why did this completion stop?" outcome, unified across the OpenAI / Anthropic / native dialects. */
export enum CompletionOutcome {
	/** The model stopped on its own — EOS token, an `end_turn`, or a configured stop string. A COMPLETE turn. */
	NaturalStop = "natural_stop",
	/** Stopped because the generation-token budget (`max_tokens`) was reached — TRUNCATED; a bigger budget may finish it. */
	TruncatedTokens = "truncated_tokens",
	/** Stopped because the CONTEXT WINDOW filled — TRUNCATED; raising `max_tokens` won't help (compact the history). */
	TruncatedContext = "truncated_context",
	/** Stopped to emit a tool/function call (`tool_calls` / `tool_use` / `toolCalls`). A structured, non-truncated stop. */
	ToolCall = "tool_call",
	/** Stopped by a content filter / safety refusal. */
	ContentFiltered = "content_filtered",
	/** Stopped because the caller/user aborted the stream (`userStopped`). */
	UserStopped = "user_stopped",
	/** The server reported an internal generation failure (`failed`). */
	Failed = "failed",
	/** No stop reason, or an unrecognized dialect spelling — classify conservatively as unknown (do NOT assume complete). */
	Unknown = "unknown",
}

/** Normalize a raw reason to a lowercase, punctuation-stripped comparison key (`"maxTokensReached"` → `"maxtokensreached"`). */
function normalizeKey(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/gu, "");
}

// Exact-key → outcome table (already normalized). Covers every spelling the three dialects emit; the substring pass below
// catches variant/compound spellings (e.g. a server that returns `"stop:length"`). Order in the substring pass is
// significant — context truncation is checked before the generic token truncation so `contextLengthReached` isn't
// mis-bucketed as a token truncation.
const EXACT: ReadonlyMap<string, CompletionOutcome> = new Map([
	// natural stops
	["stop", CompletionOutcome.NaturalStop],
	["endturn", CompletionOutcome.NaturalStop],
	["eosfound", CompletionOutcome.NaturalStop],
	["stopstringfound", CompletionOutcome.NaturalStop],
	["stopsequence", CompletionOutcome.NaturalStop],
	["eos", CompletionOutcome.NaturalStop],
	["complete", CompletionOutcome.NaturalStop],
	// token-budget truncation
	["length", CompletionOutcome.TruncatedTokens],
	["maxtokens", CompletionOutcome.TruncatedTokens],
	["maxtokensreached", CompletionOutcome.TruncatedTokens],
	["maxpredictedtokensreached", CompletionOutcome.TruncatedTokens],
	["maxoutputtokens", CompletionOutcome.TruncatedTokens],
	// context-window truncation
	["contextlengthreached", CompletionOutcome.TruncatedContext],
	["maxcontextlengthreached", CompletionOutcome.TruncatedContext],
	["contextoverflow", CompletionOutcome.TruncatedContext],
	// tool call
	["toolcalls", CompletionOutcome.ToolCall],
	["tooluse", CompletionOutcome.ToolCall],
	["functioncall", CompletionOutcome.ToolCall],
	// filtered / refusal
	["contentfilter", CompletionOutcome.ContentFiltered],
	["contentfiltered", CompletionOutcome.ContentFiltered],
	["refusal", CompletionOutcome.ContentFiltered],
	["safety", CompletionOutcome.ContentFiltered],
	// aborted
	["userstopped", CompletionOutcome.UserStopped],
	["cancelled", CompletionOutcome.UserStopped],
	["aborted", CompletionOutcome.UserStopped],
	// server error
	["failed", CompletionOutcome.Failed],
	["error", CompletionOutcome.Failed],
]);

// Substring fallbacks, tried IN ORDER after an exact miss (first hit wins). Context before tokens (see EXACT note).
const SUBSTRING: readonly (readonly [string, CompletionOutcome])[] = [
	["contextlength", CompletionOutcome.TruncatedContext],
	["contextoverflow", CompletionOutcome.TruncatedContext],
	["maxtoken", CompletionOutcome.TruncatedTokens],
	["outputtoken", CompletionOutcome.TruncatedTokens],
	["maxpredicted", CompletionOutcome.TruncatedTokens],
	["length", CompletionOutcome.TruncatedTokens],
	["tooluse", CompletionOutcome.ToolCall],
	["toolcall", CompletionOutcome.ToolCall],
	["functioncall", CompletionOutcome.ToolCall],
	["contentfilter", CompletionOutcome.ContentFiltered],
	["refus", CompletionOutcome.ContentFiltered],
	["userstop", CompletionOutcome.UserStopped],
	["abort", CompletionOutcome.UserStopped],
	["cancel", CompletionOutcome.UserStopped],
	["fail", CompletionOutcome.Failed],
	["stop", CompletionOutcome.NaturalStop],
	["endturn", CompletionOutcome.NaturalStop],
	["eos", CompletionOutcome.NaturalStop],
];

/**
 * Classify a raw stop-reason string from ANY of the three dialects into a normalized {@link CompletionOutcome} (pure).
 * `null` / `undefined` / empty / unrecognized ⇒ {@link CompletionOutcome.Unknown} (conservative — an unknown stop is NOT
 * assumed complete, so a truncation-recovery caller won't wrongly treat it as a finished turn).
 */
export function classifyCompletionOutcome(rawReason: string | null | undefined): CompletionOutcome {
	if (typeof rawReason !== "string") {
		return CompletionOutcome.Unknown;
	}
	const key = normalizeKey(rawReason);
	if (key.length === 0) {
		return CompletionOutcome.Unknown;
	}
	const exact = EXACT.get(key);
	if (exact !== undefined) {
		return exact;
	}
	for (const [needle, outcome] of SUBSTRING) {
		if (key.includes(needle)) {
			return outcome;
		}
	}
	return CompletionOutcome.Unknown;
}

/** Whether an outcome is a truncation (token OR context) — the §5.AA "the turn was cut off, retry bigger" predicate. */
export function isTruncatedOutcome(outcome: CompletionOutcome): boolean {
	return outcome === CompletionOutcome.TruncatedTokens || outcome === CompletionOutcome.TruncatedContext;
}

/** Options for {@link deriveTruncationSignal} — the reasoning-budget starvation check that complements the stop reason. */
export interface TruncationSignalInput {
	/** The raw stop reason from whichever dialect served the turn (may be null when the endpoint omits it). */
	rawReason?: string | null;
	/** `reasoning_tokens` this turn consumed (the §5.AN over-rumination signal), when the endpoint reported it. */
	reasoningTokens?: number | null;
	/** The generation-token budget (`max_tokens`) the turn was given, used to detect reasoning starving the budget. */
	tokenBudget?: number | null;
	/** Fraction of the budget that reasoning must consume to count as "starved" even without a length stop (default 0.9). */
	reasoningStarvedFraction?: number;
}

/** The unified truncation verdict: the normalized outcome PLUS whether reasoning starved the budget before any output. */
export interface TruncationSignal {
	/** The normalized stop outcome. */
	outcome: CompletionOutcome;
	/** True when the stop reason itself is a truncation ({@link isTruncatedOutcome}). */
	truncatedByStopReason: boolean;
	/** True when `reasoningTokens ≥ fraction × tokenBudget` — reasoning ate the budget (a truncation even if the stop reason lied). */
	reasoningStarvedBudget: boolean;
	/** True when EITHER signal fired — the §5.AA "re-ask with a bigger budget" trigger, robust across endpoints. */
	shouldRetryLarger: boolean;
}

/**
 * Derive the unified §5.AA truncation verdict from a turn's stop reason + reasoning budget (pure). Centralizes the exact
 * check `chat-local-llm-adapter.ts` inlines today (`finishReason === "length"` OR `reasoningTokens ≥ 90% of budget`) but
 * generalized to ALL three dialects via {@link classifyCompletionOutcome}. The reasoning-starvation half is robust to an
 * endpoint that reports the finish reason differently (or not at all): reasoning still ate the budget before any call
 * could land. Missing `reasoningTokens` / `tokenBudget` ⇒ the starvation half is simply false (never a false positive).
 */
export function deriveTruncationSignal(input: TruncationSignalInput): TruncationSignal {
	const outcome = classifyCompletionOutcome(input.rawReason);
	const truncatedByStopReason = isTruncatedOutcome(outcome);
	const fraction =
		typeof input.reasoningStarvedFraction === "number" && Number.isFinite(input.reasoningStarvedFraction)
			? input.reasoningStarvedFraction
			: 0.9;
	const reasoningTokens =
		typeof input.reasoningTokens === "number" && Number.isFinite(input.reasoningTokens)
			? input.reasoningTokens
			: null;
	const tokenBudget =
		typeof input.tokenBudget === "number" && Number.isFinite(input.tokenBudget) && input.tokenBudget > 0
			? input.tokenBudget
			: null;
	const reasoningStarvedBudget =
		reasoningTokens !== null && tokenBudget !== null && reasoningTokens >= fraction * tokenBudget;
	return {
		outcome,
		truncatedByStopReason,
		reasoningStarvedBudget,
		shouldRetryLarger: truncatedByStopReason || reasoningStarvedBudget,
	};
}
