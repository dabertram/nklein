/**
 * §5.U — the PURE decision helpers of `InMemoryNKleinTaskSessionService.maybeAdaptiveBudgetRetry` (which stays as the
 * stateful orchestrator: read env/state, fetch observation events, re-send the turn with a raised budget). Two pure steps
 * — the retry-eligibility gate and the "did a stall happen this run?" evidence check — are lifted here so the adaptive
 * budget-retry policy is independently testable apart from the IO.
 */

/** The most adaptive budget-retries !Klein will attempt for a single card before leaving it in Review. */
export const ADAPTIVE_RETRY_MAX_ATTEMPTS = 2;

/**
 * Whether an adaptive budget retry is even eligible: the feature is on, the card is awaiting review, a concrete
 * provider+model is known, it's not the home-agent session, and we haven't exhausted the attempt budget.
 */
export function shouldAttemptAdaptiveBudgetRetry(input: {
	adaptiveRetryEnabled: boolean;
	summaryState: string;
	providerId: string | null;
	modelId: string | null;
	isHomeAgentSession: boolean;
	attempt: number;
	maxAttempts?: number;
}): boolean {
	if (!input.adaptiveRetryEnabled || input.summaryState !== "awaiting_review") {
		return false;
	}
	if (!input.providerId || !input.modelId || input.isHomeAgentSession) {
		return false;
	}
	return input.attempt < (input.maxAttempts ?? ADAPTIVE_RETRY_MAX_ATTEMPTS);
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
