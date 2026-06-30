import { describe, expect, it } from "vitest";

import { extractReadFileSummaries } from "../../../src/nklein-agent/nklein-read-file-input-summary";

describe("extractReadFileSummaries", () => {
	it("summarizes a bare path string (trimmed)", () => {
		expect(extractReadFileSummaries("  src/a.ts  ")).toEqual(["src/a.ts"]);
	});

	it("renders line bounds as path:start-end", () => {
		expect(extractReadFileSummaries({ path: "a.ts", start_line: 5, end_line: 10 })).toEqual(["a.ts:5-10"]);
	});

	it("uses 1 for a missing start and EOF for a missing end", () => {
		expect(extractReadFileSummaries({ path: "a.ts", start_line: 5 })).toEqual(["a.ts:5-EOF"]);
		expect(extractReadFileSummaries({ path: "a.ts", end_line: 10 })).toEqual(["a.ts:1-10"]);
	});

	it("emits just the path when there are no line bounds", () => {
		expect(extractReadFileSummaries({ path: "a.ts" })).toEqual(["a.ts"]);
	});

	it("accepts the file_path and filePath aliases", () => {
		expect(extractReadFileSummaries({ file_path: "b.ts" })).toEqual(["b.ts"]);
		expect(extractReadFileSummaries({ filePath: "c.ts" })).toEqual(["c.ts"]);
	});

	it("reads an array of arguments", () => {
		expect(extractReadFileSummaries([{ path: "a.ts" }, "b.ts"])).toEqual(["a.ts", "b.ts"]);
	});

	it("reads the file_paths and files collections (string or array)", () => {
		expect(extractReadFileSummaries({ file_paths: ["a.ts", "b.ts"] })).toEqual(["a.ts", "b.ts"]);
		expect(extractReadFileSummaries({ files: "c.ts" })).toEqual(["c.ts"]);
	});

	it("de-duplicates across the input's own path and its collections", () => {
		expect(extractReadFileSummaries({ path: "a.ts", files: ["a.ts", "b.ts"] })).toEqual(["a.ts", "b.ts"]);
	});

	it("returns an empty list for a non-record, path-less, or empty input", () => {
		expect(extractReadFileSummaries(42)).toEqual([]);
		expect(extractReadFileSummaries({ unrelated: 1 })).toEqual([]);
		expect(extractReadFileSummaries("   ")).toEqual([]);
	});
});
