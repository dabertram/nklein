/**
 * Deterministic seeded PRNG (mulberry32) — the simulator's variance backbone. Every "random" choice a scenario
 * makes (which track fires, whether chaos triggers, response timing jitter) draws from ONE seeded stream, so the
 * same seed replays the exact same misbehavior sequence (David's hard requirement: full chaos coverage AND 100%
 * deterministic flows from the same machinery). No Math.random anywhere in this package.
 */

export interface SeededRng {
	/** Uniform float in [0, 1). */
	next(): number;
	/** Uniform integer in [0, maxExclusive). */
	int(maxExclusive: number): number;
	/** True with probability p (clamped to [0,1]). */
	chance(p: number): boolean;
	/** Pick one element (throws on empty). */
	pick<T>(items: readonly T[]): T;
	/** Derive an independent child stream (stable for the same label + parent seed). */
	child(label: string): SeededRng;
}

/** FNV-1a 32-bit hash — folds a string label into a derived seed. */
function hashLabel(seed: number, label: string): number {
	let hash = 0x811c9dc5 ^ seed;
	for (let index = 0; index < label.length; index++) {
		hash ^= label.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function createSeededRng(seed: number): SeededRng {
	let state = seed >>> 0;
	const next = (): number => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int(maxExclusive: number): number {
			if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) {
				return 0;
			}
			return Math.floor(next() * maxExclusive);
		},
		chance(p: number): boolean {
			if (p <= 0) {
				return false;
			}
			if (p >= 1) {
				return true;
			}
			return next() < p;
		},
		pick<T>(items: readonly T[]): T {
			if (items.length === 0) {
				throw new Error("pick() on an empty list");
			}
			return items[Math.floor(next() * items.length)] as T;
		},
		child(label: string): SeededRng {
			return createSeededRng(hashLabel(seed, label));
		},
	};
}
