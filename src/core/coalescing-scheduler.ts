/**
 * A tiny throttle-coalescer: bounds a frequently-requested side effect to **at most one run per window**, always using
 * the LATEST argument, with a trailing-edge fire (so the final request is never dropped). Unlike a debounce, it fires
 * even under *continuous* requests — a debounce would starve forever while requests keep arriving, which is exactly the
 * wrong behavior for "rebuild + broadcast on every agent frame" (the run must keep happening while work streams).
 *
 * Used to coalesce the per-session-flush projects-payload rebuild (§5.AI: under heavy parallel agent streaming that
 * rebuild — a board disk-read + health fs-scan per project — fired ~every 150ms per workspace and helped starve the
 * single event loop). Injectable `run`/`delayMs` so the timing logic is unit-testable with fake timers.
 */

export interface CoalescingScheduler<T> {
	/** Request a run with this arg. Coalesces: at most one run per `delayMs` window; the run receives the LATEST arg. */
	schedule: (arg: T) => void;
	/** Cancel a pending run (e.g. on shutdown) without firing it. */
	cancel: () => void;
}

export function createCoalescingScheduler<T>(run: (arg: T) => void, delayMs: number): CoalescingScheduler<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let pending: { arg: T } | null = null;
	return {
		schedule(arg: T): void {
			pending = { arg };
			if (timer !== null) {
				return;
			}
			timer = setTimeout(() => {
				timer = null;
				const captured = pending;
				pending = null;
				if (captured !== null) {
					run(captured.arg);
				}
			}, delayMs);
			// Don't let a pending coalesced run keep the process alive.
			timer.unref();
		},
		cancel(): void {
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			pending = null;
		},
	};
}
