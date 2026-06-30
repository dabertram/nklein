import type { NKleinTaskFailureBackoffState } from "./nklein-failure-backoff";

/**
 * Per-task failure-backoff state, extracted from InMemoryNKleinTaskSessionService.
 *
 * Holds the running backoff state (consecutive-failure fingerprint + park status) that
 * `computeNKleinFailureBackoff` reads as its `previousFailure` and returns an updated `nextState`
 * for — pairing the state with its already-extracted pure decision logic. The service computes the
 * decision inline (the result drives an early return / observation), so this owns only the storage:
 * {@link getPrevious} feeds the compute, {@link record} stashes the next state, {@link forget}
 * clears a finished/restarted task.
 *
 * Behavior-preserving: each method mirrors the inline map op one-for-one. (Like before, there is no
 * dispose-time bulk clear — entries are dropped per task on the terminal/restart paths.)
 */
export class TaskFailureBackoffTracker {
	private readonly byTaskId = new Map<string, NKleinTaskFailureBackoffState>();

	/** The task's current backoff state (undefined if it has no recorded failures) — the compute input. */
	getPrevious(taskId: string): NKleinTaskFailureBackoffState | undefined {
		return this.byTaskId.get(taskId);
	}

	record(taskId: string, state: NKleinTaskFailureBackoffState): void {
		this.byTaskId.set(taskId, state);
	}

	forget(taskId: string): void {
		this.byTaskId.delete(taskId);
	}
}
