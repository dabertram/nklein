/**
 * N13 dispose-flush contract: a service that fires durable writes without awaiting them must still be able to
 * FLUSH them at dispose. The live instance: `dispose()` resolved while a fire-and-forget attempt-ledger write was
 * still landing, so the write raced a recursive temp-dir removal (`ENOTEMPTY` mid-walk) — "passed in isolation,
 * failed in the suite". Tracking every fire-and-forget write and awaiting the outstanding set at dispose makes
 * "disposed ⇒ writes flushed" true by construction instead of by luck.
 *
 * Failures stay swallowed exactly as the fire-and-forget sites already swallowed them — this changes WHEN
 * dispose returns, never whether a write error propagates.
 */
export interface PendingWriteTracker {
	/** Track a fire-and-forget write. Errors are swallowed (the caller already chose not to observe them). */
	track(write: Promise<unknown>): void;
	/** Resolve once every write tracked so far has settled. New writes tracked during the wait are included. */
	flush(): Promise<void>;
	/** The number of writes still in flight (diagnostics/tests). */
	pending(): number;
}

export function createPendingWriteTracker(): PendingWriteTracker {
	const inFlight = new Set<Promise<unknown>>();
	return {
		track(write: Promise<unknown>): void {
			const tracked: Promise<unknown> = write.then(
				() => undefined,
				() => undefined,
			);
			inFlight.add(tracked);
			void tracked.then(() => inFlight.delete(tracked));
		},
		async flush(): Promise<void> {
			// Writes can enqueue further writes; loop until the set is empty rather than snapshotting once.
			while (inFlight.size > 0) {
				await Promise.all([...inFlight]);
			}
		},
		pending(): number {
			return inFlight.size;
		},
	};
}
