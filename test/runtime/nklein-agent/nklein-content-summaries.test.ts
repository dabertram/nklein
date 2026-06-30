import { describe, expect, it } from "vitest";

import {
	summarizeReadFileInput,
	summarizeText,
	summarizeValue,
} from "../../../src/nklein-agent/nklein-content-summaries";

describe("summarizeValue", () => {
	it("returns strings verbatim and stringifies numbers/booleans", () => {
		expect(summarizeValue("hi")).toBe("hi");
		expect(summarizeValue(42)).toBe("42");
		expect(summarizeValue(true)).toBe("true");
	});

	it("maps null and undefined to an empty string", () => {
		expect(summarizeValue(null)).toBe("");
		expect(summarizeValue(undefined)).toBe("");
	});

	it("JSON-stringifies objects", () => {
		expect(summarizeValue({ a: 1 })).toBe('{"a":1}');
	});

	it("falls back to String() when JSON.stringify throws (circular)", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(summarizeValue(circular)).toBe("[object Object]");
	});
});

describe("summarizeText", () => {
	it("collapses whitespace and trims", () => {
		expect(summarizeText("  a\n\t b   c ", 100)).toBe("a b c");
	});

	it("returns 'empty' for blank/whitespace-only text", () => {
		expect(summarizeText("   \n  ", 100)).toBe("empty");
	});

	it("returns the text unchanged when within the limit", () => {
		expect(summarizeText("short", 10)).toBe("short");
	});

	it("truncates and appends an ellipsis when over the limit", () => {
		expect(summarizeText("abcdefghij", 4)).toBe("abcd...");
	});
});

describe("summarizeReadFileInput", () => {
	it("summarizes a files array as a comma-separated path list", () => {
		expect(summarizeReadFileInput({ files: ["a.ts", "b.ts"] })).toBe("a.ts, b.ts");
	});

	it("renders line bounds as path:start-end", () => {
		expect(summarizeReadFileInput({ path: "a.ts", start_line: 1, end_line: 10 })).toBe("a.ts:1-10");
	});

	it("shows a missing bound as '?'", () => {
		expect(summarizeReadFileInput({ path: "a.ts", start_line: 5 })).toBe("a.ts:5-?");
	});

	it("de-duplicates repeated summaries", () => {
		expect(summarizeReadFileInput({ files: ["a.ts", "a.ts"] })).toBe("a.ts");
	});

	it("falls back to summarizeValue when there is nothing path-like", () => {
		expect(summarizeReadFileInput({ unrelated: 1 })).toBe('{"unrelated":1}');
	});
});
