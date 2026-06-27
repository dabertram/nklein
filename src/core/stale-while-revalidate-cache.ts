/**
 * A tiny stale-while-revalidate cache: a `get()` always returns immediately with the last computed value (or the
 * `initial` on a cold cache), and when the value is older than `ttlMs` it kicks off a BACKGROUND refresh (deduped, so
 * concurrent gets share one in-flight refresh) whose result replaces the cache for next time. The caller never blocks
 * on the (potentially slow) refresh.
 *
 * Built for §5.AI: per-project health detection is expensive AND contends with agent writes under load (it ballooned to
 * tens of seconds and hung the projects-payload hot path). Health changes rarely, so it's served from this cache and
 * refreshed in the background. `coldWaitMs` lets the VERY first read briefly await the first refresh (so an idle-startup
 * payload still carries fresh data) without ever hanging — under load the wait is capped and it returns the `initial`.
 */

export interface StaleWhileRevalidateCache<T> {
	/** Return the cached value now; trigger a background refresh if stale. On a cold cache, await the first refresh up to `coldWaitMs`. */
	get(): Promise<T>;
	/** Force the next `get()` to treat the cache as stale (e.g. after a known change). */
	invalidate(): void;
}

export interface StaleWhileRevalidateCacheOptions<T> {
	/** Value returned before the first refresh completes. */
	initial: T;
	/** How long a computed value stays "fresh" before the next `get()` triggers a background refresh. */
	ttlMs: number;
	/** Produce the next value. Rejections are swallowed (the last good value is kept) so a transient failure never throws into `get()`. */
	refresh: () => Promise<T>;
	/** On a COLD cache (never computed), await the first refresh up to this long so the first read isn't `initial` when the source is fast. Default 0 (never wait). */
	coldWaitMs?: number;
}

export function createStaleWhileRevalidateCache<T>(
	options: StaleWhileRevalidateCacheOptions<T>,
): StaleWhileRevalidateCache<T> {
	const { initial, ttlMs, refresh, coldWaitMs = 0 } = options;
	let cached: T = initial;
	let computedAt = 0;
	let inFlight: Promise<void> | null = null;

	const triggerRefresh = (): Promise<void> => {
		if (inFlight) {
			return inFlight;
		}
		inFlight = refresh()
			.then((value) => {
				cached = value;
				computedAt = Date.now();
			})
			.catch(() => {
				// Keep the last good value; the next stale `get()` retries.
			})
			.finally(() => {
				inFlight = null;
			});
		return inFlight;
	};

	return {
		async get(): Promise<T> {
			const isCold = computedAt === 0;
			if (isCold || Date.now() - computedAt > ttlMs) {
				const refreshing = triggerRefresh();
				if (isCold && coldWaitMs > 0) {
					await Promise.race([
						refreshing,
						new Promise<void>((resolve) => {
							setTimeout(resolve, coldWaitMs);
						}),
					]);
				}
			}
			return cached;
		},
		invalidate(): void {
			computedAt = 0;
		},
	};
}
