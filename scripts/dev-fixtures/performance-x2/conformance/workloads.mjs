/**
 * The workloads every budget is measured against, and the answers they must produce. FROZEN: evidence, not
 * workspace. Expected values are derived here from the inputs, never copied from a run of the code under test.
 */

const ITEM_COUNT = 200;
const CURRENCIES = ["EUR", "USD", "GBP", "CHF"];
const GROUPS = ["north", "south", "east", "west", "central"];

export const RATES = { EUR: 100, USD: 92, GBP: 118, CHF: 104 };

export function itemsFor(seed) {
	let state = seed;
	const next = () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state;
	};
	return Array.from({ length: ITEM_COUNT }, (_unused, index) => ({
		id: `i${index}`,
		group: GROUPS[next() % GROUPS.length],
		currency: CURRENCIES[next() % CURRENCIES.length],
		tier: `t${next() % 3}`,
		amountMinor: (next() % 9000) + 1,
	}));
}

/** The reference answers, written as the rules read — not as the current code happens to compute them. */
function convertedOf(item, rates) {
	return Math.round((item.amountMinor * rates[item.currency]) / 100);
}

function scoreOf(item) {
	let score = 0;
	for (const character of `${item.id}:${item.tier}`) {
		score = (score * 31 + character.codePointAt(0)) % 100000;
	}
	return score;
}

export const workloads = [
	{
		id: "W1",
		title: "convert every item into the base currency",
		build: () => ({ items: itemsFor(3) }),
		expected: ({ items }) => items.map((item) => ({ id: item.id, baseMinor: convertedOf(item, RATES) })),
		invoke: (module, deps, data) => module.convertAll(data.items, deps.priceBook),
	},
	{
		id: "W2",
		title: "rank every group's items by score, highest first",
		build: () => ({ items: itemsFor(5) }),
		expected: ({ items }) => {
			const groups = new Map();
			for (const item of items) {
				groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
			}
			return [...groups.keys()]
				.sort()
				.map((group) => ({
					group,
					ranked: groups
						.get(group)
						.map((item) => ({ id: item.id, score: scoreOf(item) }))
						.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
						.map((entry) => entry.id),
				}));
		},
		invoke: (module, deps, data) => module.rankByGroup(data.items, deps.scorer),
	},
	{
		id: "W3",
		title: "the group report: converted totals and the top item of each group",
		build: () => ({ items: itemsFor(7) }),
		expected: ({ items }) => {
			const groups = new Map();
			for (const item of items) {
				const current = groups.get(item.group) ?? { group: item.group, totalBaseMinor: 0, top: null, topScore: -1 };
				current.totalBaseMinor += convertedOf(item, RATES);
				const score = scoreOf(item);
				if (score > current.topScore || (score === current.topScore && item.id.localeCompare(current.top) < 0)) {
					current.top = item.id;
					current.topScore = score;
				}
				groups.set(item.group, current);
			}
			return [...groups.values()]
				.sort((left, right) => left.group.localeCompare(right.group))
				.map(({ group, totalBaseMinor, top }) => ({ group, totalBaseMinor, top }));
		},
		invoke: (module, deps, data) => module.groupReport(data.items, deps.priceBook, deps.scorer),
	},
];
