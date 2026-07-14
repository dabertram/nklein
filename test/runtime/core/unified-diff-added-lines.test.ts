import { describe, expect, it } from "vitest";
import { parseAddedLinesFromUnifiedDiff } from "../../../src/core/unified-diff-added-lines.js";

/** Pure input pipeline for the delivery-quality gate: git unified diff → added lines per file. */
describe("parseAddedLinesFromUnifiedDiff", () => {
	it("extracts added lines per file, excluding the +++ header and context/removed lines", () => {
		const patch = [
			"diff --git a/src/a.ts b/src/a.ts",
			"index 111..222 100644",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -1,2 +1,3 @@",
			" const kept = 1;",
			"-const removed = 2;",
			"+const addedOne = 2;",
			"+const addedTwo = 3;",
			"diff --git a/test/a.test.ts b/test/a.test.ts",
			"--- a/test/a.test.ts",
			"+++ b/test/a.test.ts",
			"@@ -0,0 +1 @@",
			"+expect(addedOne).toBe(2);",
		].join("\n");
		const files = parseAddedLinesFromUnifiedDiff(patch);
		expect(files).toEqual([
			{ path: "src/a.ts", addedLines: ["const addedOne = 2;", "const addedTwo = 3;"] },
			{ path: "test/a.test.ts", addedLines: ["expect(addedOne).toBe(2);"] },
		]);
	});

	it("skips pure deletions (+++ /dev/null) and yields nothing for them", () => {
		const patch = [
			"diff --git a/gone.ts b/gone.ts",
			"--- a/gone.ts",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"-const x = 1;",
		].join("\n");
		expect(parseAddedLinesFromUnifiedDiff(patch)).toEqual([]);
	});

	it("attaches added lines to the destination path (b/ prefix stripped)", () => {
		const patch = [
			"diff --git a/old.ts b/new.ts",
			"--- a/old.ts",
			"+++ b/new.ts",
			"@@ -1 +1 @@",
			"+renamed content",
		].join("\n");
		expect(parseAddedLinesFromUnifiedDiff(patch)).toEqual([{ path: "new.ts", addedLines: ["renamed content"] }]);
	});

	it("returns an empty array for an empty or content-less diff", () => {
		expect(parseAddedLinesFromUnifiedDiff("")).toEqual([]);
		expect(parseAddedLinesFromUnifiedDiff("diff --git a/x b/x\nindex 1..2\n")).toEqual([]);
	});
});
