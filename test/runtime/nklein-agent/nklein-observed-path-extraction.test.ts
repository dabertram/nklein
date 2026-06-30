import { describe, expect, it } from "vitest";
import {
	addUniqueValue,
	extractMissingFilePathsFromText,
	extractObservedPathsFromText,
	stripFocusBrief,
} from "../../../src/nklein-agent/nklein-observed-path-extraction";

describe("addUniqueValue", () => {
	it("appends trimmed, non-empty, non-duplicate values", () => {
		const values: string[] = [];
		addUniqueValue(values, "  a  ");
		addUniqueValue(values, "a");
		addUniqueValue(values, "   ");
		addUniqueValue(values, "b");
		expect(values).toEqual(["a", "b"]);
	});
});

describe("stripFocusBrief", () => {
	it("removes the focus-brief block and the whitespace it leaves behind", () => {
		const text = "[!Klein context focus brief]inside/brief.ts[/!Klein context focus brief]\n\nreal text";
		expect(stripFocusBrief(text)).toBe("real text");
	});

	it("leaves text without a brief unchanged (apart from leading trim)", () => {
		expect(stripFocusBrief("just text")).toBe("just text");
	});
});

describe("extractObservedPathsFromText", () => {
	it("extracts distinct absolute and ~-rooted paths with known extensions", () => {
		expect(extractObservedPathsFromText("opened /src/foo.ts and ~/notes/bar.json")).toEqual([
			"/src/foo.ts",
			"~/notes/bar.json",
		]);
	});

	it("de-duplicates repeated paths", () => {
		expect(extractObservedPathsFromText("/a/b.ts then /a/b.ts again")).toEqual(["/a/b.ts"]);
	});

	it("skips glob patterns and unknown extensions", () => {
		expect(extractObservedPathsFromText("/src/*.ts")).toEqual([]);
		expect(extractObservedPathsFromText("/bin/tool.exe")).toEqual([]);
	});

	it("does not mine paths out of the focus-brief block", () => {
		const text = "[!Klein context focus brief]/hidden/inside.ts[/!Klein context focus brief]\nopened /real/file.ts";
		expect(extractObservedPathsFromText(text)).toEqual(["/real/file.ts"]);
	});
});

describe("extractMissingFilePathsFromText", () => {
	it("returns nothing when there is no missing-file signal", () => {
		expect(extractMissingFilePathsFromText("/a/b.ts is fine")).toEqual([]);
	});

	it("extracts paths when a missing-file signal is present", () => {
		expect(extractMissingFilePathsFromText("ENOENT: /a/b.ts not found")).toEqual(["/a/b.ts"]);
		expect(extractMissingFilePathsFromText("no such file or directory: ~/x/y.json")).toEqual(["~/x/y.json"]);
	});
});
