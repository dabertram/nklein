import { immediateIo } from "./io.mjs";

/**
 * A shared tally.
 *
 * `record` is asynchronous because the tally is flushed over IO, and several callers hold the same metrics object
 * at once. Every increment must survive: two concurrent records of one key add two, not one.
 */
export function createMetrics() {
	return { counts: new Map() };
}

export function countOf(metrics, key) {
	return metrics.counts.get(key) ?? 0;
}

export async function record(metrics, key, deps = {}) {
	const io = deps.io ?? immediateIo;
	const current = metrics.counts.get(key) ?? 0;
	await io.yield();
	metrics.counts.set(key, current + 1);
}
