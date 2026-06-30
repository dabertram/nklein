/**
 * Pure failure-backoff policy for NKlein task runs (extracted from `nklein-task-session-service.ts` — §5.U). Decides,
 * from the prior failure state + this error, the consecutive-failure count and whether to PARK the task (stop retrying
 * the same error to avoid retry storms). The service owns the per-task state Map; this module owns only the (now
 * independently testable) DECISION — no `this`, no I/O.
 */

/** Per-task failure-backoff state: the last error fingerprint, how many times it has repeated in a row, and whether parked. */
export interface NKleinTaskFailureBackoffState {
	fingerprint: string;
	count: number;
	parked: boolean;
}

/** Park after this many consecutive identical failures (the default retry-storm guard). */
export const NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD = 3;
// A crashed/unloaded local model won't recover by retrying the dead endpoint, so park after a single
// transient retry (instead of the generic 3) with reload guidance rather than storming a model that is gone.
export const NKLEIN_LOCAL_MODEL_UNAVAILABLE_PARK_THRESHOLD = 2;

export interface NKleinFailureBackoffDecision {
	/** `${context}:${errorMessage}` — identifies "the same failure repeating". */
	fingerprint: string;
	consecutiveFailures: number;
	/** True when this EXACT error already parked the task — the caller should no-op (avoid duplicate park handling). */
	alreadyParked: boolean;
	shouldPark: boolean;
	/** The state to persist for this task (only when `alreadyParked` is false). */
	nextState: NKleinTaskFailureBackoffState;
}

/**
 * Compute the failure-backoff decision for a task that just hit an error. A run of the SAME fingerprint increments the
 * count; a different error resets it to 1. The task parks once the count reaches the threshold (a lower one when the
 * failure is a local model that went unavailable, since retrying a dead endpoint won't help).
 */
export function computeNKleinFailureBackoff(input: {
	context: "start" | "send";
	errorMessage: string;
	previousFailure: NKleinTaskFailureBackoffState | undefined;
	localModelUnavailable: boolean;
}): NKleinFailureBackoffDecision {
	const fingerprint = `${input.context}:${input.errorMessage}`;
	const previous = input.previousFailure;
	const sameFingerprint = previous?.fingerprint === fingerprint;
	const consecutiveFailures = previous && sameFingerprint ? previous.count + 1 : 1;
	const alreadyParked = Boolean(previous && sameFingerprint && previous.parked);
	const parkThreshold = input.localModelUnavailable
		? NKLEIN_LOCAL_MODEL_UNAVAILABLE_PARK_THRESHOLD
		: NKLEIN_FAILURE_BACKOFF_PARK_THRESHOLD;
	const shouldPark = consecutiveFailures >= parkThreshold;
	return {
		fingerprint,
		consecutiveFailures,
		alreadyParked,
		shouldPark,
		nextState: { fingerprint, count: consecutiveFailures, parked: shouldPark },
	};
}
