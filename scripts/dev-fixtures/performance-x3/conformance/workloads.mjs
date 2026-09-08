/**
 * The workloads every budget is measured against, and the answers they must produce. FROZEN: evidence, not
 * workspace. Expected values are derived here from the inputs.
 */

const ORDER_COUNT = 150;
const CUSTOMER_COUNT = 40;
const REGION_COUNT = 6;

/**
 * A tiny LCG, read from its HIGH bits.
 *
 * The low bits of a power-of-two LCG cycle with a very short period, so `state % 40` produced six distinct
 * customers out of forty and the whole point of the workload — many orders over many customers — quietly
 * disappeared. Shifting first fixes the distribution and keeps the data fully deterministic.
 */
function lcg(seed) {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return Math.floor(state / 65536);
	};
}

export function buildWorld(seed) {
	const next = lcg(seed);
	const regions = Object.fromEntries(
		Array.from({ length: REGION_COUNT }, (_unused, index) => [`g${index}`, { id: `g${index}`, name: `Region ${index}` }]),
	);
	const customers = Object.fromEntries(
		Array.from({ length: CUSTOMER_COUNT }, (_unused, index) => [
			`c${index}`,
			{ id: `c${index}`, name: `Customer ${index}`, regionId: `g${next() % REGION_COUNT}` },
		]),
	);
	const orders = Array.from({ length: ORDER_COUNT }, (_unused, index) => ({
		id: `o${index}`,
		customerId: `c${next() % CUSTOMER_COUNT}`,
		totalMinor: (next() % 8000) + 1,
	}));
	return { regions, customers, orders };
}

export const workloads = [
	{
		id: "W1",
		title: "name the customer on every order",
		build: () => buildWorld(3),
		storeOf: (world) => world.customers,
		expected: (world) =>
			world.orders.map((order) => ({
				id: order.id,
				customerName: world.customers[order.customerId].name,
				totalMinor: order.totalMinor,
			})),
		invoke: (module, store, world) => module.nameOrders(world.orders, store),
	},
	{
		id: "W2",
		title: "name the customer on every order, where some customers do not exist",
		build: () => {
			const world = buildWorld(5);
			// Point a third of the orders at customers that were deleted.
			world.orders = world.orders.map((order, index) =>
				index % 3 === 0 ? { ...order, customerId: `gone-${index % 7}` } : order,
			);
			return world;
		},
		storeOf: (world) => world.customers,
		expected: (world) =>
			world.orders.map((order) => ({
				id: order.id,
				customerName: world.customers[order.customerId]?.name ?? null,
				totalMinor: order.totalMinor,
			})),
		invoke: (module, store, world) => module.nameOrders(world.orders, store),
	},
	{
		id: "W3",
		title: "total each region's orders, two hops from the order",
		build: () => buildWorld(9),
		storeOf: (world) => ({ ...world.customers, ...world.regions }),
		expected: (world) => {
			const totals = new Map();
			for (const order of world.orders) {
				const region = world.regions[world.customers[order.customerId].regionId];
				totals.set(region.name, (totals.get(region.name) ?? 0) + order.totalMinor);
			}
			return [...totals.entries()]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([regionName, totalMinor]) => ({ regionName, totalMinor }));
		},
		invoke: (module, store, world) => module.totalsByRegion(world.orders, store),
	},
];
