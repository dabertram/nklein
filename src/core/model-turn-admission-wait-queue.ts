/**
 * Fair reservations for model-turn admission resources.
 *
 * Admission is re-evaluated from live LM Studio state, so waiters still poll. This queue only closes the race between
 * "capacity became free" and the oldest waiter polling again: a fresh task that targets the same constrained resource
 * must join behind that waiter instead of stealing the slot.
 *
 * F1.34c (2026-07-25): reservations EXPIRE. A waiter that stops polling (its start attempt was abandoned — bounded
 * turn timeout, teardown, crash) used to hold its reservation forever, silently blocking every later task on the
 * resource. A LIVE waiter re-polls at least every ~30s (the admission poll loop), so an entry unseen for 60s is dead
 * and is pruned on the next reservation lookup.
 */
const RESERVATION_STALE_MS = 60_000;

export class ModelTurnAdmissionWaitQueue {
	private nextSequence = 0;
	private readonly byTaskId = new Map<string, { resourceId: string; sequence: number; lastSeenAt: number }>();

	/** Join one resource queue. Repeated polls preserve position (and refresh liveness); a resource change rejoins at the end. */
	enqueue(taskId: string, resourceId: string, now = Date.now()): void {
		const existing = this.byTaskId.get(taskId);
		if (existing?.resourceId === resourceId) {
			existing.lastSeenAt = now;
			return;
		}
		this.byTaskId.set(taskId, { resourceId, sequence: this.nextSequence++, lastSeenAt: now });
	}

	remove(taskId: string): void {
		this.byTaskId.delete(taskId);
	}

	/** Oldest LIVE task holding a reservation for any resource this request can consume (stale waiters are pruned). */
	reservedFor(resourceIds: readonly string[], now = Date.now()): string | null {
		const wanted = new Set(resourceIds);
		let first: { taskId: string; sequence: number } | null = null;
		for (const [taskId, waiter] of this.byTaskId) {
			if (now - waiter.lastSeenAt > RESERVATION_STALE_MS) {
				this.byTaskId.delete(taskId);
				continue;
			}
			if (!wanted.has(waiter.resourceId)) continue;
			if (!first || waiter.sequence < first.sequence) first = { taskId, sequence: waiter.sequence };
		}
		return first?.taskId ?? null;
	}

	resourceFor(taskId: string): string | null {
		return this.byTaskId.get(taskId)?.resourceId ?? null;
	}
}
