/**
 * Defensive extraction of token USAGE from a raw OpenAI-/LM-Studio-style completion response. Every completion already
 * carries the raw response (`LocalLlmCompletion.raw`), and that response reports token counts — but the exact shape
 * varies by server/model (top-level `usage`, nested `completion_tokens_details.reasoning_tokens`, or absent entirely for
 * some local servers). This is the ONE tolerant parser other features build on (F4.12 truncation classification, token
 * budgets, per-turn telemetry) so none of them re-implement the shape-guessing.
 *
 * PURE + deterministic; never throws — an unparseable/absent shape yields all-null (the caller decides how to degrade).
 * `answerTokens = totalCompletionTokens − reasoningTokens` only when BOTH are known (a reasoning model that reports the
 * split); otherwise it's null, never a guess.
 */

export interface CompletionUsage {
	/** Input/prompt tokens, when reported. */
	readonly promptTokens: number | null;
	/** All output tokens (reasoning + answer), when reported. */
	readonly totalCompletionTokens: number | null;
	/** The reasoning-only subset, when the server reports it (`completion_tokens_details.reasoning_tokens`). */
	readonly reasoningTokens: number | null;
	/** Answer (non-reasoning) tokens — derived as total − reasoning ONLY when both are known; else null. */
	readonly answerTokens: number | null;
}

const EMPTY_USAGE: CompletionUsage = {
	promptTokens: null,
	totalCompletionTokens: null,
	reasoningTokens: null,
	answerTokens: null,
};

/** A finite non-negative integer from an unknown value, else null. */
function toCount(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return null;
	}
	return Math.trunc(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Extract token usage from a raw completion response. Reads `usage.prompt_tokens`, `usage.completion_tokens`, and the
 * OpenAI-style `usage.completion_tokens_details.reasoning_tokens` (falling back to a top-level `usage.reasoning_tokens`
 * some servers emit). Returns all-null when no usage is present.
 */
export function extractCompletionUsage(raw: unknown): CompletionUsage {
	const root = asRecord(raw);
	const usage = root && asRecord(root.usage);
	if (!usage) {
		return EMPTY_USAGE;
	}
	const promptTokens = toCount(usage.prompt_tokens);
	const totalCompletionTokens = toCount(usage.completion_tokens);
	const details = asRecord(usage.completion_tokens_details);
	const reasoningTokens = toCount(details?.reasoning_tokens) ?? toCount(usage.reasoning_tokens);
	const answerTokens =
		totalCompletionTokens !== null && reasoningTokens !== null
			? Math.max(0, totalCompletionTokens - reasoningTokens)
			: null;
	return { promptTokens, totalCompletionTokens, reasoningTokens, answerTokens };
}
