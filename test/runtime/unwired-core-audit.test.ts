import { describe, expect, it } from "vitest";
import { auditUnwiredCores, extractExportedSymbols, isCommentMention } from "../../src/core/unwired-core-audit";

describe("extractExportedSymbols", () => {
	it("finds exported functions and consts", () => {
		const symbols = extractExportedSymbols(
			"m.ts",
			["export function alpha() {}", "export async function beta() {}", "export const GAMMA = 3;"].join("\n"),
		);
		expect(symbols.map((s) => s.name).sort()).toEqual(["GAMMA", "alpha", "beta"]);
	});

	it("ignores non-exported declarations", () => {
		expect(extractExportedSymbols("m.ts", "function hidden() {}\nconst LOCAL = 1;")).toHaveLength(0);
	});

	it("does not treat exported types as callable symbols", () => {
		const symbols = extractExportedSymbols("m.ts", "export interface Foo {}\nexport type Bar = string;");
		expect(symbols).toHaveLength(0);
	});
});

describe("isCommentMention", () => {
	it("recognizes docblock and line comments", () => {
		expect(isCommentMention("  * see arrangeContextForSmartZone")).toBe(true);
		expect(isCommentMention("// uses planCacheStablePrefixOrder")).toBe(true);
		expect(isCommentMention("/* planCacheStablePrefixOrder */")).toBe(true);
	});

	it("does not classify real code as a comment", () => {
		expect(isCommentMention("const x = planCacheStablePrefixOrder(fragments);")).toBe(false);
	});
});

describe("auditUnwiredCores", () => {
	it("reports a symbol with no references at all as an orphan", () => {
		const result = auditUnwiredCores({
			symbols: [{ module: "a.ts", name: "orphan" }],
			referenceLines: new Map(),
		});
		expect(result.orphans).toHaveLength(1);
		expect(result.orphans[0]?.consumers).toBe(0);
	});

	it("does NOT report a symbol with a real call site", () => {
		const result = auditUnwiredCores({
			symbols: [{ module: "a.ts", name: "used" }],
			referenceLines: new Map([["a.ts::used", ["const y = used(1);"]]]),
		});
		expect(result.orphans).toHaveLength(0);
	});

	it("catches the COMMENT-ONLY case a naive grep count would miss", () => {
		// This is the exact trap from the 2026-07-20 hand audit: two 'consumers', both docblock mentions.
		const result = auditUnwiredCores({
			symbols: [{ module: "smart-zone.ts", name: "arrangeContextForSmartZone" }],
			referenceLines: new Map([
				[
					"smart-zone.ts::arrangeContextForSmartZone",
					[" * §5.AD `arrangeContextForSmartZone` then ORDERS them", "// see arrangeContextForSmartZone"],
				],
			]),
		});
		expect(result.orphans).toHaveLength(1);
		expect(result.commentOnlyOrphans).toHaveLength(1);
		expect(result.summary).toContain("naive grep would report them as wired");
	});

	it("frames orphans as questions, never as a delete verdict", () => {
		const result = auditUnwiredCores({
			symbols: [{ module: "a.ts", name: "orphan" }],
			referenceLines: new Map(),
		});
		expect(result.summary).toContain("QUESTION, not a verdict");
		expect(result.summary).not.toContain("delete");
	});

	it("admits the scan's own limits so an orphan is never read as proof of absence", () => {
		const result = auditUnwiredCores({ symbols: [{ module: "a.ts", name: "o" }], referenceLines: new Map() });
		expect(result.summary).toContain("can miss re-exports or dynamic lookups");
	});

	it("says so plainly when everything is wired", () => {
		const result = auditUnwiredCores({
			symbols: [{ module: "a.ts", name: "used" }],
			referenceLines: new Map([["a.ts::used", ["used();"]]]),
		});
		expect(result.orphans).toHaveLength(0);
		expect(result.summary).toContain("at least one non-test consumer");
	});
});
