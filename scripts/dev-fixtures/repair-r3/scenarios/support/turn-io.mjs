/**
 * A hand-stepped IO seam for the frozen scenarios. FROZEN — do not edit.
 *
 * `io.yield()` parks its caller instead of resolving. `drain()` releases parked callers in the order they parked,
 * one at a time, letting each one's continuation run to completion before releasing the next. Ordering is therefore
 * fully determined by the code under test, and nothing here depends on wall-clock time: there is no timer, no
 * duration and no sleep anywhere in this file. `settle()` uses `setImmediate` purely as "let the microtask queue
 * finish", which introduces no delay.
 */

const settle = () => new Promise((resolve) => setImmediate(resolve));

export function createTurnIo() {
	const parked = [];
	return {
		io: {
			yield() {
				return new Promise((resolve) => {
					parked.push(resolve);
				});
			},
		},
		pending: () => parked.length,
		/** Release parked callers, FIFO, until nothing is parked. Returns how many were released. */
		async drain(limit = 5000) {
			let released = 0;
			while (parked.length > 0 && released < limit) {
				const resolve = parked.shift();
				released += 1;
				resolve();
				await settle();
			}
			return released;
		},
	};
}

/** A job that succeeds after `turns` simulated IO turns. */
export function okJob(id, value, turns = 1) {
	return {
		id,
		async run(io) {
			for (let turn = 0; turn < turns; turn += 1) await io.yield();
			return value;
		},
	};
}

/** A job that throws after `turns` simulated IO turns. */
export function failingJob(id, message, turns = 1) {
	return {
		id,
		async run(io) {
			for (let turn = 0; turn < turns; turn += 1) await io.yield();
			throw new Error(message);
		},
	};
}
