import { describe, expect, it } from "vitest";
import { parseNPatchCandidates } from "../../../src/core/patch-candidate-parser";

const DIFF_A = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;`;

const DIFF_B = `--- a/src/bar.ts
+++ b/src/bar.ts
@@ -3,1 +3,1 @@
-old
+new`;

describe("parseNPatchCandidates", () => {
	it("parses N fenced diff blocks into discrete candidates", () => {
		const output = `Here are two options:\n\n\`\`\`diff\n${DIFF_A}\n\`\`\`\n\nand\n\n\`\`\`diff\n${DIFF_B}\n\`\`\``;
		const { candidates, rejected } = parseNPatchCandidates(output);
		expect(candidates).toHaveLength(2);
		expect(rejected).toHaveLength(0);
		expect(candidates[0].touchedPaths).toEqual(["src/foo.ts"]);
		expect(candidates[1].touchedPaths).toEqual(["src/bar.ts"]);
	});

	it("splits on `diff --git` headers when unfenced", () => {
		const output = `${DIFF_A}\n${DIFF_A.replaceAll("foo", "baz")}`;
		const { candidates } = parseNPatchCandidates(output);
		expect(candidates).toHaveLength(2);
		expect(candidates.map((c) => c.touchedPaths[0])).toEqual(["src/foo.ts", "src/baz.ts"]);
	});

	it("treats a single bare diff as one candidate", () => {
		const { candidates } = parseNPatchCandidates(DIFF_B);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].touchedPaths).toEqual(["src/bar.ts"]);
	});

	it("rejects prose / no-diff-content blocks", () => {
		const output = "```diff\nI think we should change the file but here is no actual diff.\n```";
		const { candidates, rejected } = parseNPatchCandidates(output);
		expect(candidates).toHaveLength(0);
		expect(rejected).toEqual([expect.objectContaining({ reason: "no_diff_content" })]);
	});

	it("rejects empty output", () => {
		expect(parseNPatchCandidates("").candidates).toHaveLength(0);
		expect(parseNPatchCandidates("   \n  ").candidates).toHaveLength(0);
	});

	it("rejects out-of-scope diffs when allowedPathPrefixes is set", () => {
		const output = `\`\`\`diff\n${DIFF_A}\n\`\`\`\n\`\`\`diff\n${DIFF_B}\n\`\`\``;
		const { candidates, rejected } = parseNPatchCandidates(output, { allowedPathPrefixes: ["src/foo.ts"] });
		expect(candidates.map((c) => c.touchedPaths[0])).toEqual(["src/foo.ts"]);
		expect(rejected).toEqual([expect.objectContaining({ reason: "out_of_scope" })]);
	});

	it("collapses identical duplicate candidates", () => {
		const output = `\`\`\`diff\n${DIFF_A}\n\`\`\`\n\`\`\`diff\n${DIFF_A}\n\`\`\``;
		expect(parseNPatchCandidates(output).candidates).toHaveLength(1);
	});

	it("ignores a /dev/null new path (a deletion) for the touched-path list but still parses the diff", () => {
		const del = `--- a/src/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-removed`;
		const { candidates } = parseNPatchCandidates(del);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].touchedPaths).toEqual([]);
	});
});
