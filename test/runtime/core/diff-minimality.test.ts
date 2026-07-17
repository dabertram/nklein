import { describe, expect, it } from "vitest";
import { assessDiffMinimality } from "../../../src/core/diff-minimality";

const patch = (files: { path: string; add: number; del: number }[]): string =>
	files
		.map(
			(f) =>
				`--- a/${f.path}\n+++ b/${f.path}\n@@ -1,${f.del} +1,${f.add} @@\n` +
				Array.from({ length: f.del }, (_, i) => `-old ${i}`).join("\n") +
				"\n" +
				Array.from({ length: f.add }, (_, i) => `+new ${i}`).join("\n"),
		)
		.join("\n");

describe("assessDiffMinimality", () => {
	it("scores a small in-scope diff as minimal", () => {
		const result = assessDiffMinimality({
			patch: patch([{ path: "src/habit-score.ts", add: 6, del: 2 }]),
			expectedScopeFiles: ["src/habit-score.ts"],
		});
		expect(result.verdict).toBe("minimal");
		expect(result).toMatchObject({ linesAdded: 6, linesRemoved: 2, linesChanged: 8 });
	});

	it("flags out-of-scope files as bloated (the over-eagerness signal)", () => {
		const result = assessDiffMinimality({
			patch: patch([
				{ path: "src/habit-score.ts", add: 4, del: 1 },
				{ path: "README.md", add: 30, del: 0 },
			]),
			expectedScopeFiles: ["src/habit-score.ts"],
		});
		expect(result.verdict).toBe("bloated");
		expect(result.outOfScopeFiles).toEqual(["README.md"]);
		expect(result.reason).toContain("outside the declared scope");
	});

	it("treats an empty diff as an abstention, not a failure", () => {
		const result = assessDiffMinimality({ patch: "" });
		expect(result.verdict).toBe("empty");
		expect(result.reason).toContain("valid abstention");
	});

	it("grades size: within budget = minimal, 1–2x = acceptable, >2x = bloated", () => {
		const inScope = { expectedScopeFiles: ["a.ts"] };
		expect(assessDiffMinimality({ patch: patch([{ path: "a.ts", add: 50, del: 20 }]), ...inScope }).verdict).toBe(
			"minimal",
		);
		expect(assessDiffMinimality({ patch: patch([{ path: "a.ts", add: 150, del: 20 }]), ...inScope }).verdict).toBe(
			"acceptable",
		);
		expect(assessDiffMinimality({ patch: patch([{ path: "a.ts", add: 300, del: 20 }]), ...inScope }).verdict).toBe(
			"bloated",
		);
	});

	it("skips scope checking when no scope was declared", () => {
		const result = assessDiffMinimality({ patch: patch([{ path: "anywhere.ts", add: 3, del: 0 }]) });
		expect(result.outOfScopeFiles).toEqual([]);
		expect(result.verdict).toBe("minimal");
	});

	it("matches scope entries with ./ prefixes and nested paths", () => {
		const result = assessDiffMinimality({
			patch: patch([{ path: "src/deep/file.ts", add: 2, del: 1 }]),
			expectedScopeFiles: ["./src/deep/file.ts"],
		});
		expect(result.outOfScopeFiles).toEqual([]);
	});
});
