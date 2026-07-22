/**
 * Fair reservations for model-turn admission resources.
 *
 * Admission is re-evaluated from live LM Studio state, so waiters still poll. This queue only closes the race between
 * "capacity became free" and the oldest waiter polling again: a fresh task that targets the same constrained resource
 * must join behind that waiter instead of stealing the slot.
 */
export class ModelTurnAdmissionWaitQueue {
	private nextSequence = 0;
	private readonly byTaskId = new Map<string, { resourceId: string; sequence: number }>();

	/** Join one resource queue. Repeated polls preserve position; a route/resource change joins the new queue at the end. */
	enqueue(taskId: string, resourceId: string): void {
		const existing = this.byTaskId.get(taskId);
		if (existing?.resourceId === resourceId) return;
		this.byTaskId.set(taskId, { resourceId, sequence: this.nextSequence++ });
	}

	remove(taskId: string): void {
		this.byTaskId.delete(taskId);
	}

	/** Oldest task holding a reservation for any resource this request can consume. */
	reservedFor(resourceIds: readonly string[]): string | null {
		const wanted = new Set(resourceIds);
		let first: { taskId: string; sequence: number } | null = null;
		for (const [taskId, waiter] of this.byTaskId) {
			if (!wanted.has(waiter.resourceId)) continue;
			if (!first || waiter.sequence < first.sequence) first = { taskId, sequence: waiter.sequence };
		}
		return first?.taskId ?? null;
	}

	resourceFor(taskId: string): string | null {
		return this.byTaskId.get(taskId)?.resourceId ?? null;
	}
}
