/**
 * Order pricing in integer minor units (cents). Pure, synchronous, no I/O.
 *
 * This module is CORRECT and FROZEN. It is the thing your test suite has to pin down.
 */

/** The volume-discount percentage for a quantity. Bands are inclusive at their lower edge. */
export function discountPercentFor(quantity) {
	if (quantity >= 100) return 20;
	if (quantity >= 25) return 10;
	if (quantity >= 10) return 5;
	return 0;
}

/**
 * The line total for `quantity` units at `unitPriceMinor` cents each, after the volume discount.
 * The discount is rounded DOWN so the customer is never charged a fraction of a cent.
 */
export function applyDiscount(unitPriceMinor, quantity) {
	const gross = unitPriceMinor * quantity;
	const percent = discountPercentFor(quantity);
	const discount = Math.ceil((gross * percent) / 100);
	return gross - discount;
}

/**
 * Split `totalMinor` cents across `shares` payers so the parts sum EXACTLY back to the total.
 * The indivisible remainder is handed out one cent at a time, to the earliest shares first.
 */
export function splitEvenly(totalMinor, shares) {
	if (!Number.isInteger(shares) || shares <= 0) throw new RangeError("shares must be a positive integer");
	const base = Math.floor(totalMinor / shares);
	const remainder = totalMinor - base * shares;
	return Array.from({ length: shares }, (_unused, index) => base + (index < remainder ? 1 : 0));
}

/** Shipping is free for members, and for anyone whose basket reaches the 5000-cent threshold. */
export function isFreeShipping(totalMinor, member) {
	return member || totalMinor >= 5000;
}
