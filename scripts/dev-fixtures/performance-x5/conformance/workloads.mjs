/**
 * The workloads every budget is measured against, and the answers they must produce. FROZEN: evidence, not
 * workspace.
 *
 * Each workload is a SCRIPT: a sequence of updates and queries. The expected value is the list of answers those
 * queries should have produced, derived here by replaying the script against a plain object — never copied from a
 * run of the code under test.
 */

const ROW_COUNT = 60;
const TEAMS = ["alpha", "beta", "gamma", "delta"];

function lcg(seed) {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return Math.floor(state / 65536);
	};
}

export function rowsFor(seed) {
	const next = lcg(seed);
	return Array.from({ length: ROW_COUNT }, (_unused, index) => ({
		id: `r${index}`,
		team: TEAMS[next() % TEAMS.length],
		amountMinor: (next() % 5000) + 1,
	}));
}

/** A script of `{ kind: "update" | "totals" | "top" }` steps. */
function scriptFor(seed, { updates, queries, queryKinds }) {
	const next = lcg(seed);
	const steps = [];
	for (let index = 0; index < updates + queries; index += 1) {
		if (index % 3 === 2 && steps.filter((step) => step.kind !== "update").length < queries) {
			steps.push({ kind: queryKinds[index % queryKinds.length] });
		} else {
			steps.push({
				kind: "update",
				row: {
					id: `r${next() % ROW_COUNT}`,
					team: TEAMS[next() % TEAMS.length],
					amountMinor: (next() % 5000) + 1,
				},
			});
		}
	}
	return steps;
}

/** Replay a script against a plain map — this is the reference, and it is written as the rules read. */
function replay(rows, steps) {
	const byId = new Map(rows.map((row) => [row.id, { ...row }]));
	const answers = [];
	const totals = () => {
		const sums = new Map();
		for (const row of byId.values()) {
			sums.set(row.team, (sums.get(row.team) ?? 0) + row.amountMinor);
		}
		return [...sums.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([team, totalMinor]) => ({ team, totalMinor }));
	};
	for (const step of steps) {
		if (step.kind === "update") {
			byId.set(step.row.id, { ...step.row });
		} else if (step.kind === "totals") {
			answers.push(totals());
		} else {
			const ranked = [...totals()].sort(
				(left, right) => right.totalMinor - left.totalMinor || left.team.localeCompare(right.team),
			);
			answers.push(ranked[0]?.team ?? null);
		}
	}
	return answers;
}

function build(seed, shape) {
	const rows = rowsFor(seed);
	return { rows, steps: scriptFor(seed + 1, shape) };
}

export const workloads = [
	{
		id: "W1",
		title: "20 updates and 10 totals queries",
		build: () => build(3, { updates: 20, queries: 10, queryKinds: ["totals"] }),
		expected: ({ rows, steps }) => replay(rows, steps),
		invoke: (module, deps, data) => module.runScript(deps.dataset, deps.folder, data.steps),
	},
	{
		id: "W2",
		title: "20 updates and 10 top-team queries",
		build: () => build(5, { updates: 20, queries: 10, queryKinds: ["top"] }),
		expected: ({ rows, steps }) => replay(rows, steps),
		invoke: (module, deps, data) => module.runScript(deps.dataset, deps.folder, data.steps),
	},
	{
		id: "W3",
		title: "40 updates with both query kinds interleaved",
		build: () => build(7, { updates: 40, queries: 20, queryKinds: ["totals", "top"] }),
		expected: ({ rows, steps }) => replay(rows, steps),
		invoke: (module, deps, data) => module.runScript(deps.dataset, deps.folder, data.steps),
	},
];
