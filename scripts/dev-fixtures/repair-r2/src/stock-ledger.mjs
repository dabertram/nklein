/**
 * Stock snapshots.
 *
 * A snapshot is `{ warehouse, onHand: { [sku]: units } }` and is a **value**: applying movements to one answers
 * "what would the stock be", it does not edit the snapshot the caller handed over. Two callers holding the same
 * snapshot must never be able to see each other's arithmetic.
 */

/** Units of `sku` in a snapshot. */
export function unitsOf(snapshot, sku) {
	return snapshot.onHand[sku] ?? 0;
}

/**
 * The snapshot that results from applying `movements` (each `{ sku, delta }`) to `snapshot`.
 */
export function applyMovements(snapshot, movements) {
	for (const movement of movements) {
		snapshot.onHand[movement.sku] = unitsOf(snapshot, movement.sku) + movement.delta;
	}
	return snapshot;
}
