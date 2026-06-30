/**
 * Per-task effective context-window size, extracted from InMemoryNKleinTaskSessionService.
 *
 * The service's `resolveContextWindowForTask` is the only reader/writer: it records a launch's
 * (normalized) context window when one is supplied and otherwise reads back the last known value.
 * Lifting the map here keeps that resolver as the single access point while removing one more
 * field from the monolith.
 *
 * Behavior-preserving: {@link set}/{@link get} mirror the inline map ops ({@link get} bakes in the
 * `?? null` default), and {@link forget} mirrors a single `.delete()`. Note the cleanup asymmetry is
 * preserved at the call sites — the service drops this on four of its five terminal paths (not the
 * second-opinion review-finally path), exactly as before; this store does not change that.
 */
export class TaskContextWindowStore {
	private readonly byTaskId = new Map<string, number | null>();

	/** Records a task's resolved (normalized) effective context window. */
	set(taskId: string, contextWindow: number | null): void {
		this.byTaskId.set(taskId, contextWindow);
	}

	/** The task's last known context window, or null if none was recorded. */
	get(taskId: string): number | null {
		return this.byTaskId.get(taskId) ?? null;
	}

	forget(taskId: string): void {
		this.byTaskId.delete(taskId);
	}

	clear(): void {
		this.byTaskId.clear();
	}
}
