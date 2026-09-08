/**
 * Deterministic ticket generation for the frozen scenarios. FROZEN — do not edit.
 *
 * Nothing here reads the clock: every timestamp is derived from a fixed epoch and a seeded xorshift, so a scenario
 * that passes once passes always.
 */

export const EPOCH_MS = 1_700_000_000_000;

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

/**
 * `count` tickets with strictly distinct creation times (so "the N oldest" is never ambiguous) and a mix of open
 * and closed statuses.
 */
export function makeTickets(seed, count, nowMs = EPOCH_MS) {
	const random = createRng(seed);
	const tickets = [];
	let offsetMinutes = 3;
	for (let index = 0; index < count; index += 1) {
		offsetMinutes += 1 + Math.floor(random() * 90);
		tickets.push({
			id: `T-${String(index).padStart(3, "0")}`,
			status: random() < 0.3 ? "closed" : "open",
			createdAt: nowMs - offsetMinutes * 60_000,
		});
	}
	// Hand them back in an order that is not the answer, so a correct implementation has to sort.
	return tickets.slice().reverse();
}

/** A single open ticket that is exactly `ageMinutes` old at `nowMs`. */
export function ticketAged(ageMinutes, nowMs = EPOCH_MS) {
	return { id: `AGE-${ageMinutes}`, status: "open", createdAt: nowMs - ageMinutes * 60_000 };
}
