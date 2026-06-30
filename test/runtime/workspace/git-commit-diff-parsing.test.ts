import { describe, expect, it } from "vitest";

import {
	parseCommitNameStatusEntries,
	parseCommitNumstatEntries,
	parseCommitPatchEntries,
} from "../../../src/workspace/git-commit-diff-parsing";

describe("parseCommitNameStatusEntries", () => {
	it("maps status codes to added/deleted/modified", () => {
		expect(parseCommitNameStatusEntries("M\0a.ts\0A\0b.ts\0D\0c.ts\0")).toEqual([
			{ path: "a.ts", status: "modified" },
			{ path: "b.ts", status: "added" },
			{ path: "c.ts", status: "deleted" },
		]);
	});

	it("parses a rename (R) with previous and new paths", () => {
		expect(parseCommitNameStatusEntries("R100\0old.ts\0new.ts\0")).toEqual([
			{ path: "new.ts", previousPath: "old.ts", status: "renamed" },
		]);
	});

	it("returns no entries for empty output", () => {
		expect(parseCommitNameStatusEntries("")).toEqual([]);
	});
});

describe("parseCommitNumstatEntries", () => {
	it("parses additions/deletions per file", () => {
		expect(parseCommitNumstatEntries("5\t3\ta.ts\0")).toEqual([{ path: "a.ts", additions: 5, deletions: 3 }]);
	});

	it("treats a '-' count (binary file) as zero", () => {
		expect(parseCommitNumstatEntries("-\t-\timg.png\0")).toEqual([{ path: "img.png", additions: 0, deletions: 0 }]);
	});

	it("parses the trailing-tab rename form (path + previousPath follow)", () => {
		expect(parseCommitNumstatEntries("2\t1\t\0old.ts\0new.ts\0")).toEqual([
			{ path: "new.ts", previousPath: "old.ts", additions: 2, deletions: 1 },
		]);
	});
});

describe("parseCommitPatchEntries", () => {
	it("splits a patch into per-file segments keyed by path", () => {
		const output = [
			"diff --git a/a.ts b/a.ts",
			"index 111..222 100644",
			"--- a/a.ts",
			"+++ b/a.ts",
			"@@ -1 +1 @@",
			"-old",
			"+new",
			"diff --git a/b.ts b/b.ts",
			"index 333..444 100644",
			"--- a/b.ts",
			"+++ b/b.ts",
		].join("\n");
		const entries = parseCommitPatchEntries(output);
		expect(entries.map((e) => e.path)).toEqual(["a.ts", "b.ts"]);
		expect(entries[0]?.patch.startsWith("diff --git a/a.ts b/a.ts")).toBe(true);
		expect(entries[0]?.previousPath).toBeUndefined();
	});

	it("records previousPath for a renamed file", () => {
		const output = "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts";
		expect(parseCommitPatchEntries(output)).toEqual([
			{ path: "new.ts", previousPath: "old.ts", patch: `diff --git ${output.slice("diff --git ".length)}` },
		]);
	});

	it("returns no entries for empty output", () => {
		expect(parseCommitPatchEntries("")).toEqual([]);
	});
});
