import { describe, expect, it } from "vitest";

import {
	coveredLineCount,
	findRangeContainingLine,
	formatRange,
	hasEofCoverage,
	mergeRanges,
} from "../../../src/nklein-agent/nklein-large-file-line-ranges";

describe("mergeRanges", () => {
	it("sorts and merges overlapping and adjacent ranges (gap of 1 is adjacent)", () => {
		expect(
			mergeRanges([
				{ start: 4, end: 6 },
				{ start: 1, end: 3 },
				{ start: 6, end: 8 },
			]),
		).toEqual([{ start: 1, end: 8 }]);
	});

	it("keeps ranges separated by a gap greater than one line distinct", () => {
		expect(
			mergeRanges([
				{ start: 1, end: 3 },
				{ start: 5, end: 7 },
			]),
		).toEqual([
			{ start: 1, end: 3 },
			{ start: 5, end: 7 },
		]);
	});

	it("returns an empty array for no ranges", () => {
		expect(mergeRanges([])).toEqual([]);
	});

	it("does not mutate the input array", () => {
		const input = [{ start: 1, end: 2 }];
		mergeRanges(input);
		expect(input).toEqual([{ start: 1, end: 2 }]);
	});
});

describe("hasEofCoverage", () => {
	it("is true when merged coverage spans line 1 through the last line", () => {
		expect(
			hasEofCoverage(
				[
					{ start: 1, end: 5 },
					{ start: 6, end: 10 },
				],
				10,
			),
		).toBe(true);
	});

	it("is false when coverage does not start at line 1", () => {
		expect(hasEofCoverage([{ start: 2, end: 10 }], 10)).toBe(false);
	});

	it("is false when coverage stops short of the last line", () => {
		expect(hasEofCoverage([{ start: 1, end: 8 }], 10)).toBe(false);
	});
});

describe("coveredLineCount", () => {
	it("counts distinct covered lines, merging overlaps", () => {
		expect(
			coveredLineCount([
				{ start: 1, end: 5 },
				{ start: 4, end: 8 },
			]),
		).toBe(8);
	});

	it("is zero for no ranges", () => {
		expect(coveredLineCount([])).toBe(0);
	});
});

describe("findRangeContainingLine", () => {
	const ranges = [
		{ start: 1, end: 5 },
		{ start: 10, end: 12 },
	];

	it("returns the range that contains the line (inclusive bounds)", () => {
		expect(findRangeContainingLine(ranges, 5)).toEqual({ start: 1, end: 5 });
		expect(findRangeContainingLine(ranges, 10)).toEqual({ start: 10, end: 12 });
	});

	it("returns null when no range contains the line", () => {
		expect(findRangeContainingLine(ranges, 7)).toBeNull();
	});
});

describe("formatRange", () => {
	it("formats a range as start-end", () => {
		expect(formatRange({ start: 3, end: 9 })).toBe("3-9");
	});

	it("returns 'unknown' for a null range", () => {
		expect(formatRange(null)).toBe("unknown");
	});
});
