import { reservedFor } from "./reservations.mjs";
import { applyMovements, unitsOf } from "./stock-ledger.mjs";

/**
 * Allocate an order against a stock snapshot, line by line in order.
 *
 * A line may take at most what is free for its sku — units on hand, minus units held by live reservations, minus
 * whatever earlier lines of this same order already took. Two lines for one sku can therefore never add up to more
 * than the shelf holds.
 *
 * Returns `{ allocations, snapshot }` where `snapshot` is the stock that results. The caller's snapshot is a value
 * and is left exactly as it was, so the same allocation can be replayed from it and give the same answer.
 */
export function allocate(snapshot, reservations, order) {
	const allocations = [];
	for (const line of order.lines) {
		const free = unitsOf(snapshot, line.sku) - reservedFor(reservations, line.sku);
		const take = Math.max(0, Math.min(line.quantity, free));
		allocations.push({ sku: line.sku, quantity: take });
		applyMovements(snapshot, [{ sku: line.sku, delta: -take }]);
	}
	return { allocations, snapshot };
}

/** Total units allocated for a sku across an allocation result. */
export function allocatedFor(allocations, sku) {
	return allocations
		.filter((allocation) => allocation.sku === sku)
		.reduce((total, allocation) => total + allocation.quantity, 0);
}
