import { describe, expect, it } from "vitest";

import {
	buildReadCoverageByPath,
	parseReadCoveragePart,
	splitReadInputSummary,
} from "../../../src/nklein-agent/nklein-read-coverage";

describe("splitReadInputSummary", () => {
	it("splits on commas, trims, and drops blank parts", () => {
		expect(splitReadInputSummary(" a:1-2 ,, b:3-4 ,  ")).toEqual(["a:1-2", "b:3-4"]);
	});

	it("returns an empty array for blank input", () => {
		expect(splitReadInputSummary("   ")).toEqual([]);
	});
});

describe("parseReadCoveragePart", () => {
	it("parses a well-formed path:start-end part", () => {
		expect(parseReadCoveragePart("src/a.ts:1-10")).toEqual({ path: "src/a.ts", start: 1, end: 10 });
	});

	it("splits on the LAST colon so a drive-letter path keeps its colon", () => {
		expect(parseReadCoveragePart("c:\\file.ts:5-9")).toEqual({ path: "c:\\file.ts", start: 5, end: 9 });
	});

	it("returns null when there is no usable colon", () => {
		expect(parseReadCoveragePart("no-range")).toBeNull();
		expect(parseReadCoveragePart(":1-2")).toBeNull(); // colon at index 0 → empty path
	});

	it("returns null for a malformed or non-numeric range", () => {
		expect(parseReadCoveragePart("a.ts:1-")).toBeNull();
		expect(parseReadCoveragePart("a.ts:x-y")).toBeNull();
		expect(parseReadCoveragePart("a.ts:1")).toBeNull();
	});

	it("rejects a zero start (start must be > 0) and an inverted range", () => {
		expect(parseReadCoveragePart("a.ts:0-5")).toBeNull();
		expect(parseReadCoveragePart("a.ts:9-3")).toBeNull();
	});

	it("accepts a single-line range (end === start)", () => {
		expect(parseReadCoveragePart("a.ts:4-4")).toEqual({ path: "a.ts", start: 4, end: 4 });
	});
});

describe("buildReadCoverageByPath", () => {
	it("merges overlapping and adjacent ranges (gap of 1 counts as adjacent)", () => {
		const [coverage] = buildReadCoverageByPath([{ inputSummary: "a.ts:1-5, a.ts:4-8, a.ts:9-10" }]);
		expect(coverage?.path).toBe("a.ts");
		// 1-5 ∪ 4-8 = 1-8, then 9-10 is adjacent (gap of 1) → 1-10
		expect(coverage?.ranges).toEqual([{ start: 1, end: 10 }]);
		expect(coverage?.nextUnreadLine).toBe(11);
	});

	it("does not merge ranges separated by a gap greater than one line", () => {
		const [coverage] = buildReadCoverageByPath([{ inputSummary: "a.ts:1-3, a.ts:6-8" }]);
		expect(coverage?.ranges).toEqual([
			{ start: 1, end: 3 },
			{ start: 6, end: 8 },
		]);
		// contiguous run from line 1 stops at 3 → next unread is 4
		expect(coverage?.nextUnreadLine).toBe(4);
	});

	it("reports nextUnreadLine = 1 when coverage does not start at line 1", () => {
		const [coverage] = buildReadCoverageByPath([{ inputSummary: "a.ts:3-9" }]);
		expect(coverage?.nextUnreadLine).toBe(1);
	});

	it("groups ranges per path and skips invalid parts", () => {
		const coverage = buildReadCoverageByPath([
			{ inputSummary: "a.ts:1-2, bogus, b.ts:5-5" },
			{ inputSummary: "a.ts:2-4" },
		]);
		const byPath = Object.fromEntries(coverage.map((entry) => [entry.path, entry]));
		expect(byPath["a.ts"]?.ranges).toEqual([{ start: 1, end: 4 }]);
		expect(byPath["b.ts"]?.ranges).toEqual([{ start: 5, end: 5 }]);
	});

	it("returns an empty result when no part is valid", () => {
		expect(buildReadCoverageByPath([{ inputSummary: "nope, also-nope" }])).toEqual([]);
	});
});
