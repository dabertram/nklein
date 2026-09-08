/**
 * An instrumented batch store. FROZEN: evidence, not workspace.
 *
 * Deterministic, in-process, never throws for a miss — an unknown id simply comes back absent. It counts two
 * things, and they are different questions:
 *
 *  - **calls**: how many round trips. This is the N+1 axis. A hundred single-id fetches and one batch of a hundred
 *    return the same data; only one of them survives contact with a network.
 *  - **idsRequested**: how many ids you asked for in total. This is the duplication axis. Asking for the same
 *    customer forty times in one batch is cheaper than forty calls and still forty times more than necessary.
 *
 * Both are exact and machine-independent, which wall time is not.
 */

export const MAX_BATCH = 25;

export function createStore(records) {
	const table = new Map(Object.entries(records));
	let calls = 0;
	let idsRequested = 0;
	const requestedIds = [];
	return {
		/**
		 * Fetch up to MAX_BATCH records at once. Returns `{ found }`, an object keyed by the ids that exist.
		 * Asking for more than MAX_BATCH is refused — batching is not the same as fetching everything.
		 */
		fetchMany(ids) {
			if (!Array.isArray(ids)) {
				throw new TypeError("fetchMany takes an array of ids");
			}
			if (ids.length > MAX_BATCH) {
				throw new RangeError(`fetchMany takes at most ${MAX_BATCH} ids, was given ${ids.length}`);
			}
			calls += 1;
			idsRequested += ids.length;
			requestedIds.push(...ids);
			const found = {};
			for (const id of ids) {
				if (table.has(id)) {
					found[id] = { ...table.get(id) };
				}
			}
			return { found };
		},
		calls: () => calls,
		idsRequested: () => idsRequested,
		/** Every id asked for, in order — so a case can check nothing was requested twice. */
		requestedIds: () => [...requestedIds],
	};
}
