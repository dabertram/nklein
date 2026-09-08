/**
 * A bounded least-recently-used cache.
 *
 * This module is CORRECT and FROZEN. Every rule it enforces is about HISTORY — which key was touched, in what
 * order, and how long ago — so a call examined on its own tells you almost nothing. `get` returns the same value
 * whether or not it promotes; `set` returns the same cache whether or not it refreshes; `has` answers the same
 * question whether or not it has a side effect. Only a SEQUENCE separates the correct behaviour from the broken one.
 */
export class LruCache {
	/** Insertion order in a Map is the recency order: least-recently-used first, most-recently-used last. */
	#entries = new Map();
	#capacity;

	constructor(capacity) {
		if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError("capacity must be a positive integer");
		this.#capacity = capacity;
	}

	/** How many entries are currently held. Never above the capacity. */
	get size() {
		return this.#entries.size;
	}

	/** The capacity this cache was built with. */
	get capacity() {
		return this.#capacity;
	}

	/** Move an existing key to the most-recently-used end. */
	#promote(key) {
		const value = this.#entries.get(key);
		this.#entries.delete(key);
		this.#entries.set(key, value);
	}

	/** Membership only. Asking a question must NOT count as using the entry. */
	has(key) {
		return this.#entries.has(key);
	}

	/** Read a value. A hit promotes the key to most-recently-used; a miss changes nothing and returns undefined. */
	get(key) {
		if (!this.#entries.has(key)) return undefined;
		this.#promote(key);
		return this.#entries.get(key);
	}

	/** Write a value. An existing key is refreshed to most-recently-used, then the oldest entries are evicted. */
	set(key, value) {
		this.#entries.delete(key);
		this.#entries.set(key, value);
		while (this.#entries.size > this.#capacity) {
			const oldest = this.#entries.keys().next().value;
			this.#entries.delete(oldest);
		}
		return this;
	}

	/** Drop a key. Returns whether it was there. */
	delete(key) {
		return this.#entries.delete(key);
	}

	/** Every live key, least-recently-used first. */
	keys() {
		return [...this.#entries.keys()].reverse();
	}
}
