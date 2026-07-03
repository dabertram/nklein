import { describe, expect, it } from "vitest";
import { extractRejectedToolNames, isPreExecutionToolRejection } from "../../../src/nklein-agent/tool-rejection-signal";

describe("isPreExecutionToolRejection (§5.BD)", () => {
	it("matches the SDK's pre-execution rejection wrapper", () => {
		expect(
			isPreExecutionToolRejection(
				"Tool call read_files was rejected before execution: Invalid input for tool read_files: Type validation failed",
			),
		).toBe(true);
	});

	it("matches a bare Zod type-validation message", () => {
		expect(isPreExecutionToolRejection("Type validation failed: expected array, received string")).toBe(true);
	});

	it("does NOT count a normal in-execute tool failure (a blocked write / missing file)", () => {
		expect(isPreExecutionToolRejection("Blocked write_file: path is outside this card's declared file scope")).toBe(
			false,
		);
		expect(isPreExecutionToolRejection("ENOENT: no such file or directory")).toBe(false);
		expect(isPreExecutionToolRejection("Blocked read_files: this exact file content was already read")).toBe(false);
	});

	it("is false for null / empty", () => {
		expect(isPreExecutionToolRejection(null)).toBe(false);
		expect(isPreExecutionToolRejection(undefined)).toBe(false);
		expect(isPreExecutionToolRejection("")).toBe(false);
	});
});

describe("extractRejectedToolNames (§5.BD — per-tool attribution)", () => {
	it("extracts EVERY distinct tool from a multi-tool rejection message (the bug: first-only)", () => {
		const message =
			"2 tool call(s) failed: [edit_file] Tool call edit_file was rejected before execution: Type validation failed: expected number, received string; [read_files] Tool call read_files was rejected before execution: Type validation failed";
		expect(extractRejectedToolNames(message)).toEqual(["edit_file", "read_files"]);
	});

	it("returns the single tool for a one-tool rejection, and dedupes repeats", () => {
		expect(
			extractRejectedToolNames(
				"1 tool call(s) failed: [edit_file] Tool call edit_file was rejected before execution: x",
			),
		).toEqual(["edit_file"]);
		expect(extractRejectedToolNames("2 tool call(s) failed: [edit_file] a; [edit_file] b")).toEqual(["edit_file"]);
	});

	it("does not mistake an incidental [token] inside the error detail for a tool name", () => {
		// The Zod detail contains a bracketed token, but only the segment-leading names are tools.
		const message = "1 tool call(s) failed: [apply_patch] Type validation failed: at path [items] expected array";
		expect(extractRejectedToolNames(message)).toEqual(["apply_patch"]);
	});

	it("returns empty for null/blank/non-matching input (caller records one 'unknown tool')", () => {
		expect(extractRejectedToolNames(null)).toEqual([]);
		expect(extractRejectedToolNames("")).toEqual([]);
		expect(extractRejectedToolNames("some unrelated error with no bracketed tools")).toEqual([]);
	});
});
