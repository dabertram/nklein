import { describe, expect, it } from "vitest";
import { parseApplyPatchTargets } from "../../../src/nklein-agent/nklein-apply-patch-targets";

describe("parseApplyPatchTargets", () => {
	it("returns no targets for empty, blank, or non-patch input", () => {
		expect(parseApplyPatchTargets("")).toEqual([]);
		expect(parseApplyPatchTargets("   \n  ")).toEqual([]);
		expect(parseApplyPatchTargets(undefined)).toEqual([]);
		expect(parseApplyPatchTargets(42)).toEqual([]);
	});

	it("accepts the patch as a string or as an object with an `input` string field", () => {
		const patch = "*** Delete File: gone.ts";
		expect(parseApplyPatchTargets(patch)).toEqual([{ type: "delete", path: "gone.ts" }]);
		expect(parseApplyPatchTargets({ input: patch })).toEqual([{ type: "delete", path: "gone.ts" }]);
	});

	it("tallies added lines and captures the added text for an Add File hunk", () => {
		const patch = ["*** Add File: src/new.ts", "+export const a = 1;", "+export const b = 2;"].join("\n");
		expect(parseApplyPatchTargets(patch)).toEqual([
			{ type: "add", path: "src/new.ts", addedLines: 2, addedText: "export const a = 1;\nexport const b = 2;" },
		]);
	});

	it("computes a signed delta for an Update File hunk and ignores +++/---/@@ markers", () => {
		const patch = [
			"*** Update File: src/mod.ts",
			"--- a/src/mod.ts",
			"+++ b/src/mod.ts",
			"@@ -1,2 +1,3 @@",
			"+added one",
			"+added two",
			"-removed one",
		].join("\n");
		expect(parseApplyPatchTargets(patch)).toEqual([
			{ type: "update", path: "src/mod.ts", delta: 1, addedText: "added one\nadded two" },
		]);
	});

	it("parses multiple file sections in a single patch and trims header paths", () => {
		const patch = ["*** Add File:  a.ts ", "+one", "*** Delete File: b.ts", "*** Update File: c.ts", "+two"].join(
			"\n",
		);
		expect(parseApplyPatchTargets(patch)).toEqual([
			{ type: "add", path: "a.ts", addedLines: 1, addedText: "one" },
			{ type: "delete", path: "b.ts" },
			{ type: "update", path: "c.ts", delta: 1, addedText: "two" },
		]);
	});

	it("skips a header with a missing path", () => {
		expect(parseApplyPatchTargets("*** Add File:   \n+ignored")).toEqual([]);
	});
});
