import { describe, expect, it } from "vitest";
import {
	applySearchReplaceBlock,
	applySearchReplaceBlocks,
	similarityRatio,
} from "../../../src/cline-sdk/cline-fuzzy-edit";

const FILE = ["function add(a, b) {", "\treturn a + b;", "}", ""].join("\n");

describe("applySearchReplaceBlock", () => {
	it("applies an exact match", () => {
		const result = applySearchReplaceBlock(FILE, "\treturn a + b;\n", "\treturn a + b + 0;\n");
		expect(result.ok).toBe(true);
		expect(result.strategy).toBe("exact");
		expect(result.content).toContain("return a + b + 0;");
	});

	it("matches despite different uniform indentation and re-indents the replacement", () => {
		// Model used 2 spaces; file uses a tab. Search matches on trimmed content; replacement is re-indented.
		const result = applySearchReplaceBlock(FILE, "  return a + b;\n", "  return b + a;\n");
		expect(result.ok).toBe(true);
		expect(result.strategy).toBe("whitespace");
		expect(result.content).toContain("\treturn b + a;");
	});

	it("tolerates leading blank lines in the search block", () => {
		const result = applySearchReplaceBlock(FILE, "\n\n\treturn a + b;\n", "\treturn 42;\n");
		expect(result.ok).toBe(true);
		expect(result.strategy).toBe("leading_blank");
		expect(result.content).toContain("return 42;");
	});

	it("honors ... elision markers, applying each segment in order", () => {
		const file = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;", ""].join("\n");
		const search = ["const a = 1;", "...", "const d = 4;"].join("\n");
		const replace = ["const a = 10;", "...", "const d = 40;"].join("\n");
		const result = applySearchReplaceBlock(file, search, replace);
		expect(result.ok).toBe(true);
		expect(result.strategy).toBe("dotdotdots");
		expect(result.content).toContain("const a = 10;");
		expect(result.content).toContain("const d = 40;");
		expect(result.content).toContain("const b = 2;");
	});

	it("falls back to a fuzzy match when the search is close but not exact", () => {
		// Internal spacing typo ("a+ b") defeats exact and whitespace matching but resolves via fuzzy matching.
		const result = applySearchReplaceBlock(FILE, "\treturn a+ b;\n", "\treturn a * b;\n");
		expect(result.ok).toBe(true);
		expect(result.strategy).toBe("fuzzy");
		expect(result.similarity).toBeGreaterThanOrEqual(0.8);
		expect(result.content).toContain("return a * b;");
	});

	it("fails with a corrective reason and best similarity when nothing matches", () => {
		const result = applySearchReplaceBlock(FILE, "completely different content here\n", "x\n");
		expect(result.ok).toBe(false);
		expect(result.reason).toContain("Re-read the exact current text");
		expect(typeof result.bestSimilarity).toBe("number");
	});

	it("appends when the search block is empty for an existing file", () => {
		const result = applySearchReplaceBlock(FILE, "", "// trailing\n");
		expect(result.ok).toBe(true);
		expect(result.content?.endsWith("// trailing\n")).toBe(true);
	});
});

describe("applySearchReplaceBlocks", () => {
	it("applies multiple blocks in order", () => {
		const result = applySearchReplaceBlocks(FILE, [
			{ search: "function add(a, b) {\n", replace: "function sum(a, b) {\n" },
			{ search: "\treturn a + b;\n", replace: "\treturn a + b + 1;\n" },
		]);
		expect(result.ok).toBe(true);
		expect(result.content).toContain("function sum");
		expect(result.content).toContain("a + b + 1");
		expect(result.appliedStrategies).toEqual(["exact", "exact"]);
	});

	it("reports the failing block index and leaves content unchanged", () => {
		const result = applySearchReplaceBlocks(FILE, [
			{ search: "function add(a, b) {\n", replace: "function sum(a, b) {\n" },
			{ search: "nonexistent line\n", replace: "x\n" },
		]);
		expect(result.ok).toBe(false);
		expect(result.failedBlockIndex).toBe(1);
		expect(result.content).toBe(FILE);
	});
});

describe("similarityRatio", () => {
	it("returns 1 for identical and lower for divergent strings", () => {
		expect(similarityRatio("abc", "abc")).toBe(1);
		expect(similarityRatio("return a + b;", "return a + b;")).toBeGreaterThan(0.8);
		expect(similarityRatio("abc", "xyz")).toBeLessThan(0.5);
	});
});
