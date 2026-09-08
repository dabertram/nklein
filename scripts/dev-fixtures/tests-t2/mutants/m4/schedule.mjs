import { DurationError, parseDuration } from "./parse-duration.mjs";

/**
 * Repeat-schedule arithmetic on top of `parse-duration.mjs`. Pure and clock-free: every instant is passed in.
 *
 * This module is CORRECT and FROZEN.
 */

/**
 * The first run STRICTLY AFTER `now` for a schedule that started at `startMs` and repeats every `intervalText`.
 * A schedule whose start is still ahead of `now` next runs at its start instant.
 */
export function nextRun(startMs, intervalText, now) {
	const interval = parseDuration(intervalText);
	if (interval <= 0) throw new RangeError("interval must be positive");
	if (now < startMs) return startMs;
	const periods = Math.floor((now - startMs) / interval);
	return startMs + periods * interval;
}

/** A one-line operator-facing summary of why a schedule could not be built. */
export function describeFailure(error) {
	if (error instanceof DurationError) return `bad duration ${JSON.stringify(error.input)}`;
	return `unexpected: ${error.message}`;
}
