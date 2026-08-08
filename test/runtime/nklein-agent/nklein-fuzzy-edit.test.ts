import { describe, expect, it } from "vitest";
import {
	applySearchReplaceBlock,
	applySearchReplaceBlocks,
	similarityRatio,
} from "../../../src/nklein-agent/nklein-fuzzy-edit";

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

describe("newline preservation — the merged-line artefact (N8.1)", () => {
	// Live-found 2026-08-08, three times across three projects and two models: a file came back with two source
	// lines fused onto one, e.g. `from .cookies import (    cookiejar_from_dict, …)` where the original spanned
	// two lines. Whether OUR applier can produce that, or the model simply emits the merged form, was unsettled —
	// the ledger stores a tool-call FINGERPRINT rather than raw arguments, so a completed run cannot answer it.
	//
	// These tests attack the question from our side with BREADTH rather than one example: across every strategy
	// in the ladder, applying a block must never fuse two lines that the replacement kept separate. If our applier
	// is capable of it, one of these shapes should find it.
	const LINES = [
		"from .compat import cookielib, OrderedDict, builtin_str",
		"from .cookies import (",
		"    cookiejar_from_dict, extract_cookies_to_jar, merge_cookies)",
		"from .models import Request, PreparedRequest",
		"",
		"class Session(object):",
		"    def __init__(self):",
		"        self.headers = default_headers()",
	];
	const file = `${LINES.join("\n")}\n`;

	/**
	 * No single output line may contain TWO distinct original lines — that is precisely what a fused pair looks
	 * like. Checking "is the original followed by a newline" is NOT sufficient and this helper learned it the hard
	 * way: when a line is edited by EXTENDING it (search `X`, replace `X, extra`), the original is legitimately
	 * followed by more content on the same line, and that check reports a false fusion.
	 */
	function assertNoFusedLines(before: string, after: string, label: string) {
		const originals = before
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 3);
		for (const outputLine of after.split("\n")) {
			const contained = originals.filter((original) => outputLine.includes(original));
			expect(
				contained.length <= 1,
				`${label}: one output line contains ${contained.length} distinct source lines — they fused:\n  ${outputLine.slice(0, 100)}`,
			).toBe(true);
		}
	}

	const CASES: Array<{ label: string; search: string; replace: string }> = [
		{
			label: "single-line replace, neighbours multi-line",
			search: LINES[0] as string,
			replace: `${LINES[0]}, is_py2`,
		},
		{
			label: "replacement WITHOUT a trailing newline",
			search: LINES[3] as string,
			replace: "from .models import Request",
		},
		{
			label: "replacement WITH a trailing newline",
			search: LINES[3] as string,
			replace: "from .models import Request\n",
		},
		{
			label: "multi-line search collapsed to one line",
			search: `${LINES[1]}\n${LINES[2]}`,
			replace: "from .cookies import cookiejar_from_dict, extract_cookies_to_jar, merge_cookies",
		},
		{
			label: "one line expanded into two",
			search: LINES[0] as string,
			replace: `from .compat import cookielib, OrderedDict\nfrom .compat import builtin_str`,
		},
		{ label: "indented body line", search: LINES[7] as string, replace: "        self.headers = {}" },
		{
			label: "search with different leading whitespace (whitespace-flexible strategy)",
			search: `   ${(LINES[7] as string).trim()}`,
			replace: "        self.headers = {}",
		},
		{ label: "replacement touching a blank line", search: LINES[4] as string, replace: "" },
	];

	for (const { label, search, replace } of CASES) {
		it(`never fuses lines: ${label}`, () => {
			const result = applySearchReplaceBlocks(file, [{ search, replace }]);
			if (!result.ok || result.content === undefined) {
				return; // a block that does not apply is not this test's subject
			}
			assertNoFusedLines(file, result.content, label);
		});
	}

	it("keeps the exact line count implied by the replacement", () => {
		// The arithmetic version of the same property: replacing one line with one line cannot change the count,
		// and replacing two with one must remove exactly one.
		const before = file.split("\n").length;
		const oneForOne = applySearchReplaceBlocks(file, [
			{ search: LINES[3] as string, replace: "from .models import R" },
		]);
		expect(oneForOne.ok).toBe(true);
		expect((oneForOne.content ?? "").split("\n").length).toBe(before);

		const twoForOne = applySearchReplaceBlocks(file, [
			{ search: `${LINES[1]}\n${LINES[2]}`, replace: "from .cookies import merge_cookies" },
		]);
		if (twoForOne.ok && twoForOne.content !== undefined) {
			expect(twoForOne.content.split("\n").length).toBe(before - 1);
		}
	});
});
