/**
 * An instrumented, pull-based source. FROZEN: evidence, not workspace.
 *
 * It yields records one at a time and counts how many were actually pulled. That single number is the whole
 * performance story here: a pipeline that materialises every stage pulls the entire source before it can answer
 * anything, and a pipeline that streams pulls only as far as the answer requires.
 *
 * It is an iterable, so `for...of`, spread and array methods all work — which is exactly the trap. Spreading it
 * pulls everything, and the count says so.
 */

export function createSource(records) {
	let pulled = 0;
	const stored = records.map((record) => ({ ...record }));
	return {
		size: stored.length,
		[Symbol.iterator]() {
			let index = 0;
			return {
				next() {
					if (index >= stored.length) {
						return { done: true, value: undefined };
					}
					pulled += 1;
					const value = { ...stored[index] };
					index += 1;
					return { done: false, value };
				},
			};
		},
		pulled: () => pulled,
	};
}
