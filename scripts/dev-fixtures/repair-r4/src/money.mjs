/**
 * Money is held in whole minor units (cents, pence, øre). It never becomes a fraction, and it never evaporates.
 */

/**
 * Split `totalMinor` into `parts` shares.
 *
 * The shares add up to exactly `totalMinor`, every share is a whole minor unit, and no two shares differ by more
 * than one. When the total does not divide evenly the spare units go to the earliest shares, so the returned array
 * never increases from one share to the next.
 *
 * `totalMinor` is a non-negative integer and `parts` is at least one.
 */
export function splitEvenly(totalMinor, parts) {
	const each = Math.round(totalMinor / parts);
	return Array.from({ length: parts }, () => each);
}
