import { describe, expect, it } from "vitest";
import { parseAddedResultLines, planMutationAdequacy } from "../../../src/core/mutation-adequacy-plan";

describe("mutation adequacy planning", () => {
	it("maps added unified-diff rows onto delivered result line numbers", () => {
		const patch = [
			"diff --git a/src/range.ts b/src/range.ts",
			"--- a/src/range.ts",
			"+++ b/src/range.ts",
			"@@ -10,2 +10,3 @@",
			" context();",
			"-return oldValue;",
			"+const enabled = true;",
			"+return value >= 1 && enabled;",
			"@@ -30 +31 @@",
			"-return 0;",
			"+return 1;",
		].join("\n");

		expect(parseAddedResultLines(patch)).toEqual([
			{ line: 11, content: "const enabled = true;" },
			{ line: 12, content: "return value >= 1 && enabled;" },
			{ line: 31, content: "return 1;" },
		]);
	});

	it("is not applicable unless the delivery also changed a test file", () => {
		const result = planMutationAdequacy({
			changedFiles: ["src/range.ts"],
			filePatches: [{ path: "src/range.ts", patch: "@@ -1 +1 @@\n-return false;\n+return true;" }],
		});

		expect(result).toEqual({
			applicable: false,
			reason: "no authored or edited test file in the delivered patch",
			candidates: [],
			truncatedCandidates: 0,
		});
	});

	it("mutates implementation additions but never the changed tests themselves", () => {
		const result = planMutationAdequacy({
			changedFiles: ["src/range.ts", "test/range.test.ts"],
			filePatches: [
				{
					path: "test/range.test.ts",
					patch: "@@ -1 +1 @@\n-expect(run()).toBe(false);\n+expect(run()).toBe(true);",
				},
				{
					path: "src/range.ts",
					patch: "@@ -4 +4 @@\n-return false;\n+return value >= 1 && enabled;",
				},
			],
		});

		expect(result.applicable).toBe(true);
		expect(result.candidates.length).toBeGreaterThanOrEqual(3);
		expect(result.candidates.every((candidate) => candidate.path === "src/range.ts")).toBe(true);
		expect(result.candidates.every((candidate) => candidate.line === 4)).toBe(true);
		expect(result.candidates.map((candidate) => candidate.operator)).toEqual(
			expect.arrayContaining(["gte_to_gt", "and_to_or", "off_by_one_up"]),
		);
	});

	it("sorts paths before applying the global deterministic cap", () => {
		const result = planMutationAdequacy({
			changedFiles: ["test/a.test.ts", "src/z.ts", "src/a.ts"],
			maxMutants: 2,
			filePatches: [
				{ path: "src/z.ts", patch: "@@ -1 +1 @@\n-return false;\n+return true && value > 0;" },
				{ path: "src/a.ts", patch: "@@ -1 +1 @@\n-return false;\n+return true && value > 0;" },
			],
		});

		expect(result.candidates).toHaveLength(2);
		expect(result.candidates.map((candidate) => candidate.path)).toEqual(["src/a.ts", "src/z.ts"]);
		expect(result.truncatedCandidates).toBeGreaterThan(0);
	});

	it("reports an honest thin sample when no added implementation line is mutable", () => {
		const result = planMutationAdequacy({
			changedFiles: ["src/types.ts", "test/types.test.ts"],
			filePatches: [{ path: "src/types.ts", patch: "@@ -1,0 +1 @@\n+export type Value = string;" }],
		});

		expect(result).toMatchObject({
			applicable: true,
			candidates: [],
			truncatedCandidates: 0,
		});
		expect(result.reason).toContain("no added implementation line");
	});
});
