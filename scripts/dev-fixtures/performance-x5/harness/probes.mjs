/**
 * Instrumented inputs for an aggregate that has to stay correct while the data changes underneath it.
 * FROZEN: evidence, not workspace.
 *
 * Two counters, because there are two different ways to waste work here:
 *
 *  - `dataset.at(index)` — reading the original rows. A view that re-reads its source on every query has not built
 *    anything; it is a query, dressed up.
 *  - `folder.add(total, delta)` — combining one number into a running total. A view that re-folds every row on
 *    every query is recomputing the answer it already had. This is the counter that makes "incremental" mean
 *    something specific rather than something aspirational.
 *
 * Both are pure and deterministic, so the counts are exact and identical on every machine.
 */

export function createDataset(rows) {
	const stored = rows.map((row) => ({ ...row }));
	let reads = 0;
	return {
		size: stored.length,
		at(index) {
			if (!Number.isInteger(index) || index < 0 || index >= stored.length) {
				throw new RangeError(`no row at ${index}`);
			}
			reads += 1;
			return { ...stored[index] };
		},
		reads: () => reads,
	};
}

export function createFolder() {
	let calls = 0;
	return {
		/** Combine `delta` into `total`. Counted. */
		add(total, delta) {
			calls += 1;
			return total + delta;
		},
		calls: () => calls,
	};
}
