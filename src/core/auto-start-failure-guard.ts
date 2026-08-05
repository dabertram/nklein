/**
 * Auto-start failure guard — born from the F11 campaign forensics (2026-07-24): orphaned cards produced ~10,000
 * "Auto-start failed before a session was created" retries in one day, because every sweep trigger (watchdog
 * tick, completion event, deferred timer) re-attempts a failing start FOREVER. An autonomous system that cannot
 * start a card five times in a row does not need a sixth identical attempt — it needs to HOLD the card visibly
 * for the operator with the failure named, exactly like the repeated-feedback park guard holds a looping review.
 *
 * The count alone is NOT persistence evidence: the sweep triggers cluster (a completion burst fires several
 * sweeps within seconds), so five failures can be ONE bad moment sampled five times. The N15 soak (round 6,
 * 2026-08-05) proved it — a single poisoned residency window produced ~9 attempts per card in seconds and paused
 * 28 healthy cards. The pause therefore requires BOTH the count and a minimum wall-clock span from the first
 * failure of the climb: a condition that survives the span is real; a burst inside it keeps climbing unpaused
 * and is forgotten the moment one start is accepted.
 *
 * Pure counter core; the runtime wire pauses the card through the persisted pause set (the same hold the
 * operator's own pause uses, so resume-to-retry is the existing, familiar gesture).
 */

/** Consecutive auto-start failures before the card is paused-with-reason. */
export const AUTO_START_FAILURE_PAUSE_THRESHOLD = 5;

/** Minimum wall-clock span (first failure → pausing failure) — bursts inside it are one incident, not persistence. */
export const AUTO_START_FAILURE_MIN_SPAN_MS = 60_000;

export interface AutoStartFailureDecision {
	consecutiveFailures: number;
	/** True exactly once, on the failure that satisfies BOTH the count threshold and the minimum span. */
	shouldPause: boolean;
}

export interface AutoStartFailureGuard {
	/** Record one failed auto-start for the card; returns the updated count + pause decision. */
	recordFailure(key: string): AutoStartFailureDecision;
	/** Clear the card's counter (a successful or queued start proves the card is startable again). */
	reset(key: string): void;
	/** Current consecutive count (diagnostics/tests). */
	count(key: string): number;
}

export function createAutoStartFailureGuard(
	threshold: number = AUTO_START_FAILURE_PAUSE_THRESHOLD,
	minSpanMs: number = AUTO_START_FAILURE_MIN_SPAN_MS,
	now: () => number = Date.now,
): AutoStartFailureGuard {
	const climbByKey = new Map<string, { consecutiveFailures: number; firstFailureAt: number }>();
	return {
		recordFailure(key: string): AutoStartFailureDecision {
			const at = now();
			const climb = climbByKey.get(key) ?? { consecutiveFailures: 0, firstFailureAt: at };
			const consecutiveFailures = climb.consecutiveFailures + 1;
			// Fire the pause exactly once at the first failure meeting BOTH conditions; later failures (a resumed
			// card failing again) restart the climb from the reset the resume implies — the entry is cleared when
			// the pause is applied. A burst that crosses the count inside the span keeps the entry and keeps
			// climbing: if the condition is still failing after the span, the next failure pauses.
			if (consecutiveFailures >= threshold && at - climb.firstFailureAt >= minSpanMs) {
				climbByKey.delete(key);
				return { consecutiveFailures, shouldPause: true };
			}
			climbByKey.set(key, { consecutiveFailures, firstFailureAt: climb.firstFailureAt });
			return { consecutiveFailures, shouldPause: false };
		},
		reset(key: string): void {
			climbByKey.delete(key);
		},
		count(key: string): number {
			return climbByKey.get(key)?.consecutiveFailures ?? 0;
		},
	};
}

/** The operator-facing hold message (warn + observation share it, so the remedy is always named). */
export function formatAutoStartPauseMessage(input: {
	taskId: string;
	consecutiveFailures: number;
	lastErrorCode: string;
	lastError: string | null;
}): string {
	return (
		`Paused ${input.taskId} after ${input.consecutiveFailures} consecutive auto-start failures ` +
		`(${input.lastErrorCode}: ${input.lastError ?? "unknown error"}). ` +
		"Fix the named cause, then RESUME the card to retry — the sweep will not re-attempt a paused card."
	);
}
