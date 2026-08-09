import { describe, expect, it } from "vitest";
import { changedFilesFromPatch } from "../../../src/core/patch-changed-files";
import { listGradedTestFiles } from "../../../src/core/swebench-instance";

/**
 * The patch→files parser, shared by SWE-bench tamper detection and the P20.3b delivery scheduler.
 *
 * The whole reason it reads `diff --git` and not `+++` is the DELETION case, so that is the test that carries
 * the module. A `+++`-based parser looks correct on every add and every modify — the two shapes anyone writes a
 * fixture for — and silently drops deletions, where `+++` is `/dev/null`. The two callers would then fail in
 * opposite directions: the grader misses a deleted graded file (a tamper it cannot see), and the scheduler
 * counts a deleted module as unchanged.
 */
describe("what the patch touched", () => {
	it("finds an added file", () => {
		const patch = [
			"diff --git a/src/new.ts b/src/new.ts",
			"new file mode 100644",
			"--- /dev/null",
			"+++ b/src/new.ts",
		].join("\n");

		expect(changedFilesFromPatch(patch)).toEqual(["src/new.ts"]);
	});

	it("finds a DELETED file, where `+++` is /dev/null", () => {
		// The case the `diff --git` choice exists for. A `+++` parser returns nothing here and looks fine
		// everywhere else.
		const patch = [
			"diff --git a/src/gone.ts b/src/gone.ts",
			"deleted file mode 100644",
			"--- a/src/gone.ts",
			"+++ /dev/null",
		].join("\n");

		expect(changedFilesFromPatch(patch)).toEqual(["src/gone.ts"]);
	});

	it("takes the POST-change path for a rename", () => {
		// The `b/` side is what exists afterwards, so it is the only one a later lookup can resolve.
		const patch = ["diff --git a/src/old-name.ts b/src/new-name.ts", "similarity index 95%"].join("\n");

		expect(changedFilesFromPatch(patch)).toEqual(["src/new-name.ts"]);
	});

	it("collects several files, de-duplicated and sorted", () => {
		const patch = [
			"diff --git a/src/b.ts b/src/b.ts",
			"@@ -1 +1 @@",
			"diff --git a/src/a.ts b/src/a.ts",
			"@@ -1 +1 @@",
			"diff --git a/src/b.ts b/src/b.ts",
		].join("\n");

		expect(changedFilesFromPatch(patch)).toEqual(["src/a.ts", "src/b.ts"]);
	});

	it("is not fooled by diff CONTENT that looks like a header", () => {
		// A patch to a file that itself contains diff text — documentation, a fixture, this very test — must not
		// contribute phantom paths. The anchor is what makes an added line (`+diff --git …`) not match.
		const patch = [
			"diff --git a/docs/guide.md b/docs/guide.md",
			"@@ -1 +1 @@",
			"+diff --git a/phantom.ts b/phantom.ts",
			" diff --git a/context-phantom.ts b/context-phantom.ts",
		].join("\n");

		expect(changedFilesFromPatch(patch)).toEqual(["docs/guide.md"]);
	});

	it("returns empty for an empty or header-less patch, rather than guessing", () => {
		for (const patch of ["", "\n\n", "just some prose", "--- a/x\n+++ b/x"]) {
			expect(changedFilesFromPatch(patch), JSON.stringify(patch)).toEqual([]);
		}
	});
});

describe("the SWE-bench caller stays behaviour-identical", () => {
	it("delegates rather than keeping a second copy of the rule", () => {
		// The extraction's whole point. If these ever diverge, the grader and the scheduler disagree about the
		// same patch, and only one of them is right.
		const patch = [
			"diff --git a/tests/test_a.py b/tests/test_a.py",
			"deleted file mode 100644",
			"+++ /dev/null",
			"diff --git a/src/mod.py b/src/mod.py",
		].join("\n");

		expect(listGradedTestFiles(patch)).toEqual(changedFilesFromPatch(patch));
		expect(listGradedTestFiles(patch)).toEqual(["src/mod.py", "tests/test_a.py"]);
	});
});
