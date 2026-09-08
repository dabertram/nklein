/**
 * The workloads every budget is measured against, and the answers they must produce. FROZEN: evidence, not
 * workspace.
 *
 * Each workload states its own expected result, computed here from the rows rather than copied from a run of the
 * current implementation. An expected value taken from the code under test is not a test.
 */

const ROW_COUNT = 60;

export function rowsFor(seed) {
	// Deterministic, no dependencies: a small LCG so the data is fixed but not trivially ordered.
	let state = seed;
	const next = () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state;
	};
	return Array.from({ length: ROW_COUNT }, (_unused, index) => ({
		id: `r${index}`,
		team: `t${next() % 5}`,
		amountMinor: (next() % 5000) + 1,
	}));
}

export const workloads = [
	{
		id: "W1",
		title: "total each team's spend",
		build: () => ({ rows: rowsFor(7), lookups: null }),
		expected: ({ rows }) => {
			const totals = new Map();
			for (const row of rows) {
				totals.set(row.team, (totals.get(row.team) ?? 0) + row.amountMinor);
			}
			return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([team, totalMinor]) => ({ team, totalMinor }));
		},
		invoke: (module, dataset) => module.totalsByTeam(dataset),
	},
	{
		id: "W2",
		title: "resolve 40 rows by id",
		build: () => ({ rows: rowsFor(11), lookups: Array.from({ length: 40 }, (_unused, index) => `r${(index * 7) % 60}`) }),
		expected: ({ rows, lookups }) => lookups.map((id) => rows.find((row) => row.id === id).amountMinor),
		invoke: (module, dataset, data) => module.amountsFor(dataset, data.lookups),
	},
	{
		id: "W3",
		title: "resolve 40 rows by id, where a third of them are missing",
		build: () => ({
			rows: rowsFor(13),
			lookups: Array.from({ length: 40 }, (_unused, index) => (index % 3 === 0 ? `missing-${index}` : `r${(index * 7) % 60}`)),
		}),
		expected: ({ rows, lookups }) => lookups.map((id) => rows.find((row) => row.id === id)?.amountMinor ?? null),
		invoke: (module, dataset, data) => module.amountsFor(dataset, data.lookups),
	},
];
