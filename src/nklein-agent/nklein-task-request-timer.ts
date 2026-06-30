/**
 * Per-task model-request timing, extracted from InMemoryNKleinTaskSessionService.
 *
 * Stamps when a task's model request starts ({@link markStarted}) so the runtime can later
 * attribute a wall-clock duration to it ({@link elapsedMs}, used when recording per-request
 * latency in the model registry). The clock is injected so the service shares its session clock
 * and tests can drive time deterministically.
 *
 * Behavior-preserving: each method mirrors the inline map op it replaced; {@link elapsedMs} keeps
 * the `> 0 ? … : null` guard, so an unknown start or a non-positive delta yields null rather than a
 * bogus (zero/negative) duration.
 */
export class TaskRequestTimer {
	private readonly startedAtByTaskId = new Map<string, number>();

	constructor(private readonly clock: () => number) {}

	/** Stamps the start of a task's model request at the current clock time. */
	markStarted(taskId: string): void {
		this.startedAtByTaskId.set(taskId, this.clock());
	}

	/** Wall-clock ms from the task's recorded start to `observedAt`, or null if unknown/non-positive. */
	elapsedMs(taskId: string, observedAt: number): number | null {
		const startedAt = this.startedAtByTaskId.get(taskId);
		if (typeof startedAt !== "number") {
			return null;
		}
		const elapsed = observedAt - startedAt;
		return elapsed > 0 ? elapsed : null;
	}

	forget(taskId: string): void {
		this.startedAtByTaskId.delete(taskId);
	}

	clear(): void {
		this.startedAtByTaskId.clear();
	}
}
