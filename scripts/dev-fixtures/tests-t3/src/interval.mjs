/**
 * Closed integer intervals: `{ start, end }` with BOTH endpoints inside the interval.
 *
 * This module is CORRECT and FROZEN. Everything interesting about it lives at an edge — the empty collection, a
 * single interval, two intervals that touch without overlapping, one interval swallowed by another, and the outer
 * bounds themselves. Ordinary mid-range inputs exercise almost none of it.
 */

/**
 * Merge overlapping and TOUCHING intervals into a sorted, disjoint cover. `[1,3]` and `[4,6]` touch (nothing sits
 * between 3 and 4) and merge into `[1,6]`; `[1,3]` and `[5,6]` do not. Input order does not matter and the input
 * is not mutated.
 */
export function mergeIntervals(intervals) {
	if (intervals.length === 0) return [];
	const sorted = [...intervals].sort((left, right) => left.start - right.start);
	const merged = [{ start: sorted[0].start, end: sorted[0].end }];
	for (let index = 1; index < sorted.length; index += 1) {
		const current = sorted[index];
		const last = merged[merged.length - 1];
		if (current.start <= last.end + 1) {
			merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, current.end) };
			continue;
		}
		merged.push({ start: current.start, end: current.end });
	}
	return merged;
}

/** Does `point` sit inside any of the intervals? Both endpoints count as inside. */
export function contains(intervals, point) {
	return intervals.some((interval) => point >= interval.start && point <= interval.end);
}

/** The single widest interval. Ties go to the earliest in the list; an empty list has none. */
export function widest(intervals) {
	if (intervals.length === 0) return null;
	let best = intervals[0];
	for (let index = 1; index < intervals.length; index += 1) {
		const candidate = intervals[index];
		if (candidate.end - candidate.start > best.end - best.start) best = candidate;
	}
	return best;
}

/**
 * Pull `point` into the outer bounds of the merged cover: below the lowest start it becomes that start, above the
 * highest end it becomes that end, and anywhere in between it is returned unchanged. An empty cover clamps to null.
 */
export function clampToBounds(intervals, point) {
	const merged = mergeIntervals(intervals);
	if (merged.length === 0) return null;
	const low = merged[0].start;
	const high = merged[merged.length - 1].end;
	if (point < low) return low;
	if (point > high) return high;
	return point;
}
