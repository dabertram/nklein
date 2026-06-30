import { describe, expect, it } from "vitest";

import { parseReadFileRequests } from "../../../src/nklein-agent/nklein-read-file-request";

describe("parseReadFileRequests", () => {
	it("parses a bare path string into a single request", () => {
		expect(parseReadFileRequests(" src/a.ts ")).toEqual([{ path: "src/a.ts", startLine: null, endLine: null }]);
	});

	it("returns an empty list for a blank string", () => {
		expect(parseReadFileRequests("   ")).toEqual([]);
	});

	it("parses an array of path strings and drops blank entries", () => {
		expect(parseReadFileRequests(["a.ts", "  ", "b.ts"])).toEqual([
			{ path: "a.ts", startLine: null, endLine: null },
			{ path: "b.ts", startLine: null, endLine: null },
		]);
	});

	it("parses an array of objects with line ranges", () => {
		expect(parseReadFileRequests([{ path: "a.ts", start_line: 1, end_line: 10 }])).toEqual([
			{ path: "a.ts", startLine: 1, endLine: 10 },
		]);
	});

	it("reads the files/file_paths/paths array keys from an object", () => {
		for (const key of ["files", "file_paths", "paths"]) {
			expect(parseReadFileRequests({ [key]: ["a.ts"] })).toEqual([{ path: "a.ts", startLine: null, endLine: null }]);
		}
	});

	it("accepts a single (non-array) value under a known key", () => {
		expect(parseReadFileRequests({ files: "a.ts" })).toEqual([{ path: "a.ts", startLine: null, endLine: null }]);
	});

	it("parses a single {path, start_line, end_line} record", () => {
		expect(parseReadFileRequests({ path: "a.ts", start_line: 3, end_line: 7 })).toEqual([
			{ path: "a.ts", startLine: 3, endLine: 7 },
		]);
	});

	it("truncates float line numbers and rejects non-finite ones", () => {
		expect(parseReadFileRequests({ path: "a.ts", start_line: 2.9, end_line: Number.NaN })).toEqual([
			{ path: "a.ts", startLine: 2, endLine: null },
		]);
	});

	it("drops entries without a usable path", () => {
		expect(parseReadFileRequests([{ start_line: 1 }, { path: "  " }])).toEqual([]);
	});

	it("returns an empty list for null, a number, or an empty object", () => {
		expect(parseReadFileRequests(null)).toEqual([]);
		expect(parseReadFileRequests(42)).toEqual([]);
		expect(parseReadFileRequests({})).toEqual([]);
	});
});
