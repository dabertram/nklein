/**
 * Auto-start failure guard — born from the F11 campaign forensics (2026-07-24): orphaned cards produced ~10,000
 * "Auto-start failed before a session was created" retries in one day, because every sweep trigger (watchdog
 * tick, completion event, deferred timer) re-attempts a failing start FOREVER. An autonomous system that cannot
 * start a card five times in a row does not need a sixth identical attempt — it needs to HOLD the card visibly
 * for the operator with the failure named, exactly like the repeated-feedback park guard holds a looping review.
 *
 * Pure counter core; the runtime wire pauses the card through the persisted pause set (the same hold the
 * operator's own pause uses, so resume-to-retry is the existing, familiar gesture).
 */

/** Consecutive auto-start failures before the card is paused-with-reason. */
export const AUTO_START_FAILURE_PAUSE_THRESHOLD = 5;

export interface AutoStartFailureDecision {
	consecutiveFailures: number;
	/** True exactly once, on the failure that crosses the threshold. */
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
): AutoStartFailureGuard {
	const consecutiveByKey = new Map<string, number>();
	return {
		recordFailure(key: string): AutoStartFailureDecision {
			const consecutiveFailures = (consecutiveByKey.get(key) ?? 0) + 1;
			consecutiveByKey.set(key, consecutiveFailures);
			// Fire the pause exactly once at the crossing; later failures (a resumed card failing again) restart
			// the climb from the reset the resume implies — the map is cleared when the pause is applied.
			if (consecutiveFailures >= threshold) {
				consecutiveByKey.delete(key);
				return { consecutiveFailures, shouldPause: true };
			}
			return { consecutiveFailures, shouldPause: false };
		},
		reset(key: string): void {
			consecutiveByKey.delete(key);
		},
		count(key: string): number {
			return consecutiveByKey.get(key) ?? 0;
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
