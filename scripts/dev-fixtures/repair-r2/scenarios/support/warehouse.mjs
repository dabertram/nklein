/**
 * Deterministic warehouse data for the frozen scenarios. FROZEN — do not edit.
 */

export function createRng(seed) {
	let state = seed >>> 0 || 0x9e37_79b9;
	return () => {
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 0x1_0000_0000;
	};
}

export const SKUS = ["BOLT-8", "BOLT-12", "NUT-8", "WASHER-8", "BRACKET-L"];

/** A snapshot with predictable stock levels for every sku. */
export function makeSnapshot(seed, warehouse = "WH-1") {
	const random = createRng(seed);
	const onHand = {};
	for (const sku of SKUS) onHand[sku] = 5 + Math.floor(random() * 40);
	return { warehouse, onHand };
}

/** An order whose lines repeat skus on purpose, so per-line accounting has to be right. */
export function makeOrder(seed, lineCount = 8) {
	const random = createRng(seed ^ 0x5bf0_3635);
	const lines = [];
	for (let index = 0; index < lineCount; index += 1) {
		lines.push({
			sku: SKUS[Math.floor(random() * SKUS.length)],
			quantity: 1 + Math.floor(random() * 18),
		});
	}
	return { id: `ORD-${seed}`, lines };
}

export const clone = (value) => JSON.parse(JSON.stringify(value));
