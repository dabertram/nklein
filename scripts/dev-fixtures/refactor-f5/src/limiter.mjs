// A fixed-window rate limiter. Everything it knows lives in this module, so nothing can be run twice at once.

import { recordDenial } from "./audit-log.mjs";

let counters = new Map();
let config = { windowMs: 60000, max: 5 };
let clock = () => Date.now();

export function configure(next) {
	config = { ...config, ...(next ?? {}) };
	return { ...config };
}

export function currentConfig() {
	return { ...config };
}

export function setClock(nextClock) {
	clock = typeof nextClock === "function" ? nextClock : () => Date.now();
}

export function reset() {
	counters = new Map();
}

export function allow(key) {
	if (typeof key !== "string" || key === "") {
		throw new TypeError("a rate-limit key must be a non-empty string");
	}
	const now = clock();
	const existing = counters.get(key);
	let window = existing;
	if (!existing || now >= existing.resetAt) {
		window = { hits: 0, resetAt: now + config.windowMs };
	}
	if (window.hits >= config.max) {
		counters.set(key, window);
		recordDenial(key, now);
		return { allowed: false, remaining: 0, resetAt: window.resetAt };
	}
	window.hits += 1;
	counters.set(key, window);
	return { allowed: true, remaining: config.max - window.hits, resetAt: window.resetAt };
}
