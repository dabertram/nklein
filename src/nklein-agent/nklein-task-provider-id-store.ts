/**
 * Per-task provider-id cache, extracted from InMemoryNKleinTaskSessionService.
 *
 * This is a cache, not authoritative state: the service's `resolveProviderIdForTask` reads it and,
 * on a miss, re-derives the provider from the session runtime and repopulates it — so a missing or
 * dropped entry is harmless (it is simply re-derived on the next read). {@link get} returns the raw
 * value (callers apply their own `?? UNCONFIGURED_PROVIDER_ID` fallback / truthy check).
 *
 * Behavior-preserving: the methods mirror the inline map ops one-for-one. The service still drops
 * this on only two of its terminal paths (clearTaskSession + the review-finally cleanup), exactly
 * as before — benign precisely because the value is re-derivable.
 */
export class TaskProviderIdStore {
	private readonly byTaskId = new Map<string, string>();

	/** The cached provider id, or undefined if not currently cached. */
	get(taskId: string): string | undefined {
		return this.byTaskId.get(taskId);
	}

	set(taskId: string, providerId: string): void {
		this.byTaskId.set(taskId, providerId);
	}

	forget(taskId: string): void {
		this.byTaskId.delete(taskId);
	}

	clear(): void {
		this.byTaskId.clear();
	}
}
