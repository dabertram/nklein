// Order enrichment. Correct, and it goes back to the store once per order.

export function nameOrders(orders, store) {
	return orders.map((order) => {
		const { found } = store.fetchMany([order.customerId]);
		const customer = found[order.customerId];
		return {
			id: order.id,
			customerName: customer ? customer.name : null,
			totalMinor: order.totalMinor,
		};
	});
}

export function totalsByRegion(orders, store) {
	const totals = new Map();
	for (const order of orders) {
		const customer = store.fetchMany([order.customerId]).found[order.customerId];
		const region = store.fetchMany([customer.regionId]).found[customer.regionId];
		totals.set(region.name, (totals.get(region.name) ?? 0) + order.totalMinor);
	}
	return [...totals.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([regionName, totalMinor]) => ({ regionName, totalMinor }));
}
