/**
 * §5.U — the PURE decision helpers of `InMemoryNKleinTaskSessionService.maybeAdaptiveBudgetRetry` (which stays as the
 * stateful orchestrator: read env/state, fetch observation events, re-send the turn with a raised budget). Two pure steps
 * — the retry-eligibility gate and the "did a stall happen this run?" evidence check — are lifted here so the adaptive
 * budget-retry policy is independently testable apart from the IO.
 */

import { decideNextRetryStrategy } from "../core/retry-policy";

/** The DEFAULT adaptive budget-retry cap when no learned per-model budget is supplied (§5.AA `learnedRetryBudget`). */
export const ADAPTIVE_RETRY_MAX_ATTEMPTS = 2;

/**
 * Whether an adaptive budget retry is even eligible: the feature is on, the card is awaiting review, a concrete
 * provider+model is known, it's not the home-agent session, and the §5.AA retry engine has not PARKED the task.
 *
 * §5.AA engine adoption (2026-07-07): the continue-vs-park decision now flows through `decideNextRetryStrategy` instead
 * of a hard `attempt < 2` cap. A stalled no-output turn is an `aborted` outcome; the engine returns a non-park rung
 * (`raise_token_budget`, the rung this controller fires) while the retry budget has room, and `park` once it's spent.
 * `retryBudget` is the LEARNED per-model budget (from the ledger); absent, it defaults to {@link ADAPTIVE_RETRY_MAX_ATTEMPTS}
 * so the decision is byte-identical to the previous constant cap.
 */
export function shouldAttemptAdaptiveBudgetRetry(input: {
	adaptiveRetryEnabled: boolean;
	summaryState: string;
	providerId: string | null;
	modelId: string | null;
	isHomeAgentSession: boolean;
	attempt: number;
	/** The learned per-model retry budget (clamped ≥1). Falls back to {@link ADAPTIVE_RETRY_MAX_ATTEMPTS} when unknown. */
	retryBudget?: number;
	/** @deprecated legacy alias for {@link retryBudget}; kept so existing callers stay byte-identical. */
	maxAttempts?: number;
}): boolean {
	if (!input.adaptiveRetryEnabled || input.summaryState !== "awaiting_review") {
		return false;
	}
	if (!input.providerId || !input.modelId || input.isHomeAgentSession) {
		return false;
	}
	const budget = input.retryBudget ?? input.maxAttempts ?? ADAPTIVE_RETRY_MAX_ATTEMPTS;
	// The engine parks once `attemptsSoFar >= budget`; a non-park rung means "keep going". With an empty tried-set and
	// an `aborted` outcome this is exactly `attempt < budget` — so the default preserves the old constant-cap behavior.
	return (
		decideNextRetryStrategy({
			lastOutcome: "aborted",
			attemptsSoFar: input.attempt,
			retryBudget: budget,
			triedStrategies: [],
		}).strategy !== "park"
	);
}

/**
 * Whether a `model_stalled` observation was recorded during THIS run (at/after `sinceMs`) — the evidence that the last
 * turn stalled (likely truncated mid-reasoning) rather than legitimately finishing.
 */
export function hasStallEvidence(
	events: readonly { createdAt: number; signal?: string; metadata?: { category?: string } | null }[],
	sinceMs: number,
): boolean {
	return events.some(
		(event) =>
			event.createdAt >= sinceMs &&
			(event.signal === "model_stalled" || event.metadata?.category === "model_stalled"),
	);
}
