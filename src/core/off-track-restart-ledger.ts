/**
 * P18.4b — the per-card counter that makes the off-track restart cap actually bind.
 *
 * `decideOffTrackRemedy` parks a card once `restartsSoFar >= MAX_RESTATEMENT_RESTARTS`, and P18.4 named the
 * failure that cap exists to stop: unbounded restarting is "a loop that discards work while looking like
 * progress". The live wire currently cannot call the decider at all, because this number does not exist —
 * and the only available default, `0`, defeats the cap on every single call.
 *
 * ── WHY IT IS KEYED BY CARD AND NOT BY SESSION ──
 * The remedy's action IS restarting the card's session. A counter stored on the session would be destroyed by
 * the very event it counts, so it would read `0` forever and the cap would never bind — the bug wearing the
 * costume of a working feature. Keying by task id is what makes the count outlive the restart.
 *
 * ── WHY `0` MEANS SOMETHING HERE, UNLIKE THE OTHER PER-CARD REGISTRIES ──
 * `nklein-baseline-probe-registry` returns `null` for "no probe was run", because absence and a real result are
 * different facts there. Here they are the same fact: a card with no entry has had no restart performed by this
 * remedy, which is exactly what `0` says. Returning `null` would force every caller to convert it to `0`
 * anyway, and each conversion is a place to get the cap wrong.
 *
 * ── WHAT IT DELIBERATELY DOES NOT COUNT ──
 * Runtime restarts (`crash-recovery-matrix.restartCount`) are a different event with a different cause: the
 * process died, the card did not derail. Folding them in would park cards for crashes they did not cause, and
 * spend a budget meant for derailment on infrastructure noise.
 *
 * Process-scoped by construction: a runtime restart loses the counts, so a card's budget is per runtime
 * lifetime rather than for all time. That is the honest bound, and it is the right one — the budget exists to
 * stop a live restart LOOP, and a loop cannot outlive the process running it.
 */

const restartsByTaskId = new Map<string, number>();

/** Restarts this remedy has performed for the card. `0` for a card it has never restarted. */
export function getOffTrackRestartCount(taskId: string): number {
	return restartsByTaskId.get(taskId) ?? 0;
}

/**
 * Record a restart this remedy just performed, and return the new count.
 *
 * Returning the new count is deliberate: a caller that incremented and then separately read would race with
 * nothing here, but would still be free to act on a number it did not increment. One call, one truth.
 */
export function recordOffTrackRestart(taskId: string): number {
	const next = getOffTrackRestartCount(taskId) + 1;
	restartsByTaskId.set(taskId, next);
	return next;
}

/** Forget a card's restarts — card teardown, trash, or replay. A replayed card starts its budget over. */
export function forgetOffTrackRestarts(taskId: string): void {
	restartsByTaskId.delete(taskId);
}

/** Test/maintenance hook: clear every card's count. */
export function clearOffTrackRestartLedger(): void {
	restartsByTaskId.clear();
}
