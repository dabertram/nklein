/**
 * An instrumented dataset. FROZEN: evidence, not workspace.
 *
 * Performance here is a COUNT, never a duration. Wall time on a shared laptop is noise: it depends on what else is
 * running, and a grader that fails when the machine is busy teaches an agent to distrust the grader. So the data is
 * only reachable through `at(index)`, every read is counted, and the budget is a number of reads.
 *
 * That also makes the budget honest about what it is measuring. "Faster" is vague; "one pass over the rows plus one
 * read per lookup" is a claim about the algorithm, and it is either true or it is not.
 */

export function createDataset(rows) {
	const stored = rows.map((row) => ({ ...row }));
	let reads = 0;
	return {
		size: stored.length,
		/** The only way to reach a row. Every call is counted. */
		at(index) {
			if (!Number.isInteger(index) || index < 0 || index >= stored.length) {
				throw new RangeError(`no row at ${index}`);
			}
			reads += 1;
			return { ...stored[index] };
		},
		reads: () => reads,
		resetReads: () => {
			reads = 0;
		},
	};
}
