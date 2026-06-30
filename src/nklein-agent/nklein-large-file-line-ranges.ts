/**
 * Pure line-range geometry for the large-file workflow, extracted from nklein-large-file-workflow.
 * A {@link LineRange} is an inclusive 1-based `[start, end]` span of file lines. These helpers do the
 * merge/coverage/lookup math with no workflow state, so they are behavior-preserving and unit-testable.
 */

export interface LineRange {
	start: number;
	end: number;
}

/** Sort and merge ranges, treating a gap of a single line as adjacent (so `1-3` and `4-6` merge to `1-6`). */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
	const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
	const merged: LineRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end + 1) {
			previous.end = Math.max(previous.end, range.end);
			continue;
		}
		merged.push({ ...range });
	}
	return merged;
}

/** True when the merged coverage runs contiguously from line 1 through (at least) the last line. */
export function hasEofCoverage(ranges: readonly LineRange[], totalLines: number): boolean {
	const firstRange = mergeRanges(ranges)[0];
	return Boolean(firstRange && firstRange.start === 1 && firstRange.end >= totalLines);
}

/** Distinct lines covered so far (overlaps merged) — drives the index/total progress in read results (§5.O). */
export function coveredLineCount(ranges: readonly LineRange[]): number {
	return mergeRanges(ranges).reduce((total, range) => total + (range.end - range.start + 1), 0);
}

/** The first range that contains `line` (inclusive), or null when no range covers it. */
export function findRangeContainingLine(ranges: readonly LineRange[], line: number): LineRange | null {
	return ranges.find((range) => range.start <= line && range.end >= line) ?? null;
}

/** Format a range as `start-end`, or `"unknown"` for a null range. */
export function formatRange(range: LineRange | null): string {
	return range ? `${range.start}-${range.end}` : "unknown";
}
