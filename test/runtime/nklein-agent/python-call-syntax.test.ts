import { describe, expect, it } from "vitest";

import {
	extractBalancedParens,
	parsePythonKwargs,
	parsePythonValue,
	splitTopLevelArgs,
} from "../../../src/nklein-agent/python-call-syntax";

describe("extractBalancedParens", () => {
	it("returns the inner body and close index for a balanced call", () => {
		expect(extractBalancedParens("foo(a, b)", 3)).toEqual({ body: "a, b", end: 8 });
	});

	it("ignores brackets inside strings", () => {
		const text = "f('a)b')";
		expect(extractBalancedParens(text, 1)).toEqual({ body: "'a)b'", end: text.length - 1 });
	});

	it("handles nested brackets", () => {
		expect(extractBalancedParens("f([1, 2])", 1)?.body).toBe("[1, 2]");
	});

	it("returns null when unbalanced", () => {
		expect(extractBalancedParens("f(a, b", 1)).toBeNull();
	});
});

describe("splitTopLevelArgs", () => {
	it("splits on top-level commas only", () => {
		expect(splitTopLevelArgs("a, [1, 2], b")).toEqual(["a", " [1, 2]", " b"]);
	});

	it("ignores commas inside strings", () => {
		expect(splitTopLevelArgs('a, "x, y", b')).toEqual(["a", ' "x, y"', " b"]);
	});
});

describe("parsePythonValue", () => {
	it("unwraps single- and double-quoted strings", () => {
		expect(parsePythonValue('"hi"')).toBe("hi");
		expect(parsePythonValue("'hi'")).toBe("hi");
	});

	it("parses booleans and None/null (case-insensitive)", () => {
		expect(parsePythonValue("True")).toBe(true);
		expect(parsePythonValue("false")).toBe(false);
		expect(parsePythonValue("None")).toBeNull();
		expect(parsePythonValue("null")).toBeNull();
	});

	it("parses numbers", () => {
		expect(parsePythonValue("42")).toBe(42);
		expect(parsePythonValue("-3.5")).toBe(-3.5);
	});

	it("parses scientific notation and leading/trailing-dot floats as NUMBERS, not strings", () => {
		// The old /^-?\d+(?:\.\d+)?$/ rejected these valid Python literals, so a numeric tool arg like
		// timeout=1e5 arrived as the string "1e5" instead of 100000.
		expect(parsePythonValue("1e5")).toBe(100000);
		expect(parsePythonValue("1.5e-3")).toBe(0.0015);
		expect(parsePythonValue("1E-3")).toBe(0.001);
		expect(parsePythonValue(".5")).toBe(0.5);
		expect(parsePythonValue("5.")).toBe(5);
	});

	it("does NOT mis-parse near-numeric junk as a number (stays a string)", () => {
		for (const junk of ["1e", "1,000", "0x1F", "1.2.3", "Infinity"]) {
			expect(parsePythonValue(junk)).toBe(junk);
		}
	});

	it("parses lists/dicts via JSON repair (single→double quotes)", () => {
		expect(parsePythonValue("[1, 2, 3]")).toEqual([1, 2, 3]);
		expect(parsePythonValue("{'a': 1}")).toEqual({ a: 1 });
	});

	it("falls back to the raw (trimmed) string for unrecognized values", () => {
		expect(parsePythonValue("  bareword  ")).toBe("bareword");
	});
});

describe("parsePythonKwargs", () => {
	it("parses keyword arguments into an object", () => {
		expect(parsePythonKwargs('path="a.ts", start=2')).toEqual({ path: "a.ts", start: 2 });
	});

	it("skips positional arguments", () => {
		expect(parsePythonKwargs("foo, k=1")).toEqual({ k: 1 });
	});

	it("does not treat a comparison as a keyword argument", () => {
		expect(parsePythonKwargs("a == b")).toEqual({});
	});

	it("parses a list-valued keyword argument", () => {
		expect(parsePythonKwargs("xs=[1, 2]")).toEqual({ xs: [1, 2] });
	});
});
