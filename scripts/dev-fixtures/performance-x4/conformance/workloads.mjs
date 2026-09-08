/**
 * The workloads every budget is measured against, and the answers they must produce. FROZEN: evidence, not
 * workspace. Expected values are derived here from the records.
 */

const RECORD_COUNT = 500;

function lcg(seed) {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return Math.floor(state / 65536);
	};
}

export function recordsFor(seed) {
	const next = lcg(seed);
	return Array.from({ length: RECORD_COUNT }, (_unused, index) => ({
		id: `r${index}`,
		region: ["north", "south", "east"][next() % 3],
		amountMinor: (next() % 9000) + 1,
	}));
}

/** The position of the record the answer depends on — the honest lower bound on how far a stream must read. */
export function firstIndexWhere(records, predicate) {
	return records.findIndex(predicate);
}

export const workloads = [
	{
		id: "W1",
		title: "the first northern record over 5000",
		build: () => ({ records: recordsFor(3) }),
		expected: ({ records }) =>
			records.find((record) => record.region === "north" && record.amountMinor > 5000)?.id ?? null,
		invoke: (module, source) => module.firstBigNorthern(source),
	},
	{
		id: "W2",
		title: "the ids of the first ten records over 4000, doubled",
		build: () => ({ records: recordsFor(5) }),
		expected: ({ records }) =>
			records
				.filter((record) => record.amountMinor > 4000)
				.slice(0, 10)
				.map((record) => `${record.id}:${record.amountMinor * 2}`),
		invoke: (module, source) => module.topTenDoubled(source),
	},
	{
		id: "W3",
		title: "is there any record over 8900 (there is, late in the source)",
		build: () => ({ records: recordsFor(7) }),
		expected: ({ records }) => records.some((record) => record.amountMinor > 8900),
		invoke: (module, source) => module.anyOver(source, 8900),
	},
	{
		id: "W4",
		title: "is there any record over 9500 (there is not, so the whole source must be read)",
		build: () => ({ records: recordsFor(7) }),
		expected: ({ records }) => records.some((record) => record.amountMinor > 9500),
		invoke: (module, source) => module.anyOver(source, 9500),
	},
];
