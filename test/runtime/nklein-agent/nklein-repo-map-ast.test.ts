import { describe, expect, it } from "vitest";

import { createSymbol, extractAstSourceFacts } from "../../../src/nklein-agent/nklein-repo-map-ast";

describe("createSymbol", () => {
	it("derives the 1-based line from the byte offset", () => {
		const symbol = createSymbol("a.ts", "line1\nline2\nNAME", "NAME", "function", 12);
		expect(symbol).toEqual({
			name: "NAME",
			kind: "function",
			path: "a.ts",
			line: 3,
			referenceCount: 0,
			rankScore: 0,
		});
	});
});

describe("extractAstSourceFacts", () => {
	const source = [
		'import { foo, bar as baz } from "./mod";',
		"export function hello() {}",
		"export function useThing() {}",
		"class MyClass {}",
		"interface Shape {}",
		"type Alias = string;",
		"enum Color { Red }",
		"const x = 1;",
		"const useHook = () => {};",
	].join("\n");

	const facts = extractAstSourceFacts("sample.ts", source);
	const kindByName = Object.fromEntries(facts.symbols.map((s) => [s.name, s.kind]));

	it("classifies declarations by kind", () => {
		expect(kindByName.hello).toBe("function");
		expect(kindByName.MyClass).toBe("class");
		expect(kindByName.Shape).toBe("interface");
		expect(kindByName.Alias).toBe("type");
		expect(kindByName.Color).toBe("enum");
		expect(kindByName.x).toBe("const");
	});

	it("classifies use-prefixed declarations as hooks", () => {
		expect(kindByName.useThing).toBe("hook");
		expect(kindByName.useHook).toBe("hook");
	});

	it("collects imports with their original imported names", () => {
		expect(facts.imports).toEqual([{ modulePath: "./mod", importedNames: ["foo", "bar"] }]);
	});

	it("collects identifiers", () => {
		expect(facts.identifiers).toContain("hello");
		expect(facts.identifiers).toContain("MyClass");
	});

	it("parses TSX content without throwing", () => {
		const tsx = "export function View() { return <div>{label}</div>; }";
		const tsxFacts = extractAstSourceFacts("view.tsx", tsx);
		expect(tsxFacts.symbols.map((s) => s.name)).toContain("View");
	});
});
