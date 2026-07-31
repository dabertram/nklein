import { describe, expect, it } from "vitest";
import {
	computeImportClosure,
	isNonSourceSpecifier,
	parseImportSpecifiers,
	resolveRelativeSpecifier,
} from "../../../src/core/module-import-closure";

/**
 * Guards for the reachability walker.
 *
 * These matter more than they look: `model-acquisition-boundary.test.ts` concludes "the autonomous runtime cannot
 * reach model acquisition" from this walker's output, and **every way of getting the walker wrong shrinks the
 * closure, which makes that conclusion PASS**. So the cases below are mostly about edges NOT being dropped.
 */

function closureOf(files: Record<string, string>, entryPoints: readonly string[]) {
	return computeImportClosure({
		entryPoints,
		knownFiles: new Set(Object.keys(files)),
		readSource: (file) => files[file] ?? null,
	});
}

describe("parseImportSpecifiers", () => {
	it("catches every import form that creates a structural edge", () => {
		const specifiers = parseImportSpecifiers(
			[
				'import a from "./a";',
				'import { b } from "./b";',
				'import type { C } from "./c";',
				'export { d } from "./d";',
				'export * from "./e";',
				'import "./f";',
				'const g = await import("./g");',
			].join("\n"),
		);
		// As a SET: extraction runs one pass per import form, so the output order reflects that implementation
		// detail rather than the file. A closure walk is order-independent, so pinning the order would be pinning
		// an artifact — and would break the next time a form is added.
		expect(new Set(specifiers)).toEqual(new Set(["./a", "./b", "./c", "./d", "./e", "./f", "./g"]));
	});

	it("counts `import type` as an edge — erased at runtime, still a dependency", () => {
		expect(parseImportSpecifiers('import type { X } from "./x";')).toEqual(["./x"]);
	});

	it("ignores PROSE that happens to match — the real false positive from this codebase", () => {
		// `/** Human-readable "why recalled / where from". */` matches `from`-then-quote and captures the rest of
		// the file. Real specifiers never contain whitespace, so the filter costs no genuine edge.
		const source = '/** Human-readable "why recalled / where from". */\n\tprovenance: string;\n';
		expect(parseImportSpecifiers(source)).toEqual([]);
	});
});

describe("resolveRelativeSpecifier", () => {
	const known = new Set(["src/a.ts", "src/dir/index.ts", "src/b.ts"]);

	it("resolves an extensionless import", () => {
		expect(resolveRelativeSpecifier("src/entry.ts", "./a", known)).toBe("src/a.ts");
	});

	it("resolves a directory import through its index", () => {
		expect(resolveRelativeSpecifier("src/entry.ts", "./dir", known)).toBe("src/dir/index.ts");
	});

	it("rewrites a `.js` specifier to the `.ts` source — the edge that silently vanishes otherwise", () => {
		// This codebase mixes extensionless imports with explicit `.js` suffixes for ESM output. Without this the
		// edge disappears and the closure quietly shrinks.
		expect(resolveRelativeSpecifier("src/entry.ts", "./b.js", known)).toBe("src/b.ts");
	});

	it("walks up out of a subdirectory", () => {
		expect(resolveRelativeSpecifier("src/deep/nested/entry.ts", "../../a", known)).toBe("src/a.ts");
	});

	it("returns null for a package import — it cannot reach source", () => {
		expect(resolveRelativeSpecifier("src/entry.ts", "vitest", known)).toBeNull();
	});

	it("returns null for a relative import that resolves to nothing", () => {
		expect(resolveRelativeSpecifier("src/entry.ts", "./missing", known)).toBeNull();
	});
});

describe("isNonSourceSpecifier", () => {
	it("treats a json import as a leaf", () => {
		expect(isNonSourceSpecifier("../../package.json")).toBe(true);
	});

	it("does NOT treat a source import as a leaf", () => {
		expect(isNonSourceSpecifier("./thing.ts")).toBe(false);
		expect(isNonSourceSpecifier("./thing")).toBe(false);
	});
});

describe("computeImportClosure", () => {
	it("is TRANSITIVE — the property the whole boundary check rests on", () => {
		const { reached } = closureOf(
			{
				"src/entry.ts": 'import "./a";',
				"src/a.ts": 'import "./b";',
				"src/b.ts": 'import "./c";',
				"src/c.ts": "",
			},
			["src/entry.ts"],
		);
		expect([...reached].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/entry.ts"]);
	});

	it("is DIRECTIONAL — importing the entry does not make you reachable from it", () => {
		// This is what lets acquisition share the REST transport: acquisition → client is fine, because the walk
		// runs forward from the runtime and never follows an edge backwards.
		const { reached } = closureOf({ "src/entry.ts": "", "src/importer.ts": 'import "./entry";' }, ["src/entry.ts"]);
		expect(reached.has("src/importer.ts")).toBe(false);
	});

	it("terminates on an import CYCLE instead of spinning", () => {
		const { reached } = closureOf({ "src/a.ts": 'import "./b";', "src/b.ts": 'import "./a";' }, ["src/a.ts"]);
		expect(reached.size).toBe(2);
	});

	it("REPORTS a relative import that resolves to nothing", () => {
		const { unresolvedRelative } = closureOf({ "src/entry.ts": 'import "./gone";' }, ["src/entry.ts"]);
		expect(unresolvedRelative).toEqual([{ from: "src/entry.ts", specifier: "./gone" }]);
	});

	it("does NOT report a json leaf as unresolved", () => {
		const { unresolvedRelative } = closureOf({ "src/entry.ts": 'import p from "../package.json";' }, [
			"src/entry.ts",
		]);
		expect(unresolvedRelative).toEqual([]);
	});

	it("ignores an entry point that is not a known file rather than inventing it", () => {
		expect(closureOf({ "src/a.ts": "" }, ["src/nope.ts"]).reached.size).toBe(0);
	});
});
