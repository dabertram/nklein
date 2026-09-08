/**
 * Retry, cancellation and bounded concurrency — with every source of non-determinism handed in by the caller.
 *
 * This module is CORRECT and FROZEN. It never reads a clock, never creates a timer and never touches a global:
 * `sleep` is injected, the cancellation token is constructed by the caller, and the worker is the caller's own
 * function. That is deliberate. It means a test can pin down *ordering* exactly — how many attempts ran, what
 * delays were asked for, how many workers were in flight at once, which promise settled first — without ever
 * waiting on real time. A test that reaches for a real timer here is testing the timer, not this module.
 */

/** Raised when work stops because the caller cancelled it. */
export class CancelledError extends Error {
	constructor() {
		super("cancelled");
		this.name = "CancelledError";
	}
}

/**
 * A cancellation token the caller drives. Registering a listener on an ALREADY cancelled token fires it at once —
 * a late subscriber must not miss the event that has already happened.
 */
export function createCancellation() {
	let cancelled = false;
	const listeners = new Set();
	return {
		get cancelled() {
			return cancelled;
		},
		cancel() {
			if (cancelled) return;
			cancelled = true;
			const pending = [...listeners];
			listeners.clear();
			for (const listener of pending) listener();
		},
		onCancel(listener) {
			if (cancelled) listener();
			else listeners.add(listener);
		},
	};
}

/**
 * Call `operation(attempt)` until it resolves, at most `attempts` times.
 *
 * Between two tries it awaits `sleep(delay)` with an exponentially growing delay: the FIRST backoff is `backoffMs`,
 * then double, then double again. There is no backoff after the last attempt — the caller is not made to wait for
 * a retry that will never happen. Cancellation is observed before every attempt, so a token cancelled while a
 * backoff is in flight stops the next try, and the rejection is a `CancelledError`, not the operation's own error.
 */
export async function runWithRetry(operation, { attempts, backoffMs, sleep, cancellation }) {
	if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("attempts must be a positive integer");
	let cancelled = false;
	cancellation?.onCancel(() => {
		cancelled = true;
	});
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		if (cancelled) throw new CancelledError();
		try {
			return await operation(attempt);
		} catch (error) {
			lastError = error;
			if (attempt === attempts) break;
			await sleep(backoffMs * 2 ** (attempt - 1));
		}
	}
	throw lastError;
}

/**
 * Map `items` through `worker`, with at most `limit` calls in flight at any moment.
 *
 * The result is in INPUT order however the individual calls happen to settle, and no more than `limit` workers ever
 * overlap — including when there are fewer items than the limit allows.
 */
export async function mapWithConcurrency(items, worker, limit) {
	if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer");
	const results = new Array(items.length);
	let next = 0;
	async function pump() {
		while (next < items.length) {
			const index = next;
			next += 1;
			const value = await worker(items[index], index);
			results[index] = value;
		}
	}
	const runners = [];
	for (let slot = 0; slot < Math.min(limit, items.length); slot += 1) runners.push(pump());
	await Promise.all(runners);
	return results;
}
