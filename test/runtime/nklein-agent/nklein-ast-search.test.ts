import { describe, expect, it } from "vitest";
import { findAstShapeMatches } from "../../../src/nklein-agent/nklein-ast-search";

const SAMPLE = [
	"export function target(a: number) { return a; }",
	"export function callerOne() { return target(1); }",
	"const callerTwo = () => target(2) + obj.target(3);",
	"function unrelated() { return other(4); }",
	"interface Shape { area(): number }",
	"class Circle implements Shape { area() { return 1; } }",
	"class Square extends Circle {}",
].join("\n");

describe("findAstShapeMatches (F12.1a)", () => {
	it("finds callers by shape — including method-style calls — with the enclosing declaration named", () => {
		const matches = findAstShapeMatches("src/x.ts", SAMPLE, { kind: "callers", symbol: "target" });
		expect(matches.map((match) => match.enclosing)).toEqual(["callerOne", "callerTwo", "callerTwo"]);
		expect(matches[0]?.line).toBe(2);
		// A text grep would also hit line 1 (the definition) — the shape query does not.
		expect(matches.every((match) => match.line !== 1)).toBe(true);
	});

	it("finds definitions and implementations/extensions by shape", () => {
		expect(findAstShapeMatches("src/x.ts", SAMPLE, { kind: "definitions", symbol: "target" })).toHaveLength(1);
		const implementations = findAstShapeMatches("src/x.ts", SAMPLE, { kind: "implementations", symbol: "Shape" });
		expect(implementations.map((match) => match.snippet)).toEqual([
			"class Circle implements Shape { area() { return 1; } }",
		]);
		const extensions = findAstShapeMatches("src/x.ts", SAMPLE, { kind: "implementations", symbol: "Circle" });
		expect(extensions[0]?.snippet).toContain("Square");
	});

	it("returns nothing for non-TS files — the lexical tier owns those", () => {
		expect(findAstShapeMatches("notes.md", "target(1)", { kind: "callers", symbol: "target" })).toEqual([]);
	});

	it("finds ALL references (usages) while excluding the definition's own name token", () => {
		const references = findAstShapeMatches("src/x.ts", SAMPLE, { kind: "references", symbol: "target" });
		// callerOne + callerTwo (two usages: call + property access base is not target) — never line 1's definition.
		expect(references.length).toBeGreaterThanOrEqual(2);
		expect(references.every((match) => match.line !== 1)).toBe(true);
	});
});
