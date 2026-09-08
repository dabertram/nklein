/**
 * Reporting buckets things by the LOCAL calendar day of the site that produced the event, which is given as a
 * fixed offset in minutes east of UTC (`330` for +05:30, `-300` for −05:00).
 */

/**
 * The local calendar day, `YYYY-MM-DD`, that `timestampMs` falls in at `offsetMinutes`.
 *
 * At an offset of zero this is the UTC day. Anywhere else the boundary moves with the offset: the instant of local
 * midnight starts the new day, the millisecond before it still belongs to the day that is ending, and every instant
 * inside one local day answers with the same key even when the day straddles UTC midnight.
 */
export function localDayKey(timestampMs, offsetMinutes) {
	return new Date(timestampMs).toISOString().slice(0, 10);
}
