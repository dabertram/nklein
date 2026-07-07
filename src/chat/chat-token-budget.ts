import { MIN_CONTEXT_WINDOW_TOKENS } from "../core/lms-model-control";

/**
 * §5.M — resolve the chat lean-window token budget from the model's effective context window, honoring the ≥32k
 * context floor (prime directive #3). The lean window is the recent transcript kept VERBATIM before older turns roll
 * into the rolling summary + long-term memory, so it's a FRACTION of the window (the rest is reserved for the system
 * prefix — goal/summary/recalled-memories — and the response), not the whole thing.
 *
 * The floor makes the previous hardcoded default explicit + correct: an unknown/small window resolves to the ≥32k
 * floor, so the budget is `32_000 × fraction = 8_000` (byte-identical to the old constant) — while a larger model
 * (e.g. 128k) scales its verbatim window up proportionally instead of being pinned at 8k. Pure + deterministic.
 */
export const CHAT_LEAN_WINDOW_FRACTION = 0.25;

/** The ≥32k-floor-derived minimum lean-window budget (`MIN_CONTEXT_WINDOW_TOKENS × CHAT_LEAN_WINDOW_FRACTION`). */
export const MIN_CHAT_TOKEN_BUDGET = Math.round(MIN_CONTEXT_WINDOW_TOKENS * CHAT_LEAN_WINDOW_FRACTION);

export function resolveChatTokenBudget(contextWindowTokens: number | null | undefined): number {
	// Floor the window to the ≥32k minimum FIRST (a null/tiny window is treated as the floor), then take the fraction.
	const flooredWindow = Math.max(MIN_CONTEXT_WINDOW_TOKENS, Math.trunc(contextWindowTokens ?? 0) || 0);
	return Math.max(MIN_CHAT_TOKEN_BUDGET, Math.round(flooredWindow * CHAT_LEAN_WINDOW_FRACTION));
}
