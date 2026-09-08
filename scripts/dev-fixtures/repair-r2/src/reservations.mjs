/**
 * Reservations hold stock aside for a customer until they are either fulfilled or released.
 *
 * A released reservation holds nothing: the units go straight back into the free pool.
 */

export function createReservations() {
	return { entries: [] };
}

export function reserve(store, { id, sku, quantity }) {
	store.entries.push({ id, sku, quantity, released: false });
	return store;
}

export function release(store, id) {
	const entry = store.entries.find((candidate) => candidate.id === id);
	if (entry) entry.released = true;
	return store;
}

/** Units of `sku` currently held aside by live reservations. */
export function reservedFor(store, sku) {
	return store.entries
		.filter((entry) => entry.sku === sku)
		.reduce((total, entry) => total + entry.quantity, 0);
}
