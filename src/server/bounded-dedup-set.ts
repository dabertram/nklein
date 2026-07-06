/**
 * §5.U — a bounded, FIFO-evicting dedup set extracted from `runtime-server`. Insertion-ordered keys with a hard cap: once
 * `remember` pushes past `capacity`, the oldest key is evicted. Used to fold a re-emitting terminal outcome exactly once
 * per run (§5.AA/§5.AB) without unbounded growth. Pure data structure — no I/O, no time — so it's deterministically
 * testable, and each caller owns its own instance (no process-global mutable state leaking across modules).
 */
export interface BoundedDedupSet {
	/** True when the key has already been remembered (and not yet evicted). */
	has(key: string): boolean;
	/** Record the key; if that pushes the set past its capacity, evict the oldest key. */
	remember(key: string): void;
	/** The current number of remembered keys (≤ capacity). */
	size(): number;
}

/** Create a bounded dedup set holding at most `capacity` keys (must be ≥ 1). */
export function createBoundedDedupSet(capacity: number): BoundedDedupSet {
	if (!Number.isInteger(capacity) || capacity < 1) {
		throw new Error(`createBoundedDedupSet: capacity must be a positive integer, got ${capacity}.`);
	}
	const keys = new Set<string>();
	return {
		has(key: string): boolean {
			return keys.has(key);
		},
		remember(key: string): void {
			keys.add(key);
			if (keys.size > capacity) {
				const oldest = keys.values().next().value;
				if (oldest !== undefined) {
					keys.delete(oldest);
				}
			}
		},
		size(): number {
			return keys.size;
		},
	};
}
