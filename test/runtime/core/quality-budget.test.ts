import { describe, expect, it } from "vitest";
import { assessQualityBudget, type QualityBudgetFile } from "../../../src/core/quality-budget.js";

/** opencode-swarm quality_budget port — diff-only complexity/duplication/test-ratio ceilings. */

const lines = (n: number, seed = "const value"): string[] =>
	Array.from({ length: n }, (_, i) => `${seed} ${i} = ${i};`);

describe("assessQualityBudget", () => {
	it("passes a well-tested, right-sized change", () => {
		const files: QualityBudgetFile[] = [
			{ path: "src/a.ts", addedLines: lines(40) },
			{ path: "test/a.test.ts", addedLines: lines(20, "expect thing") },
		];
		const result = assessQualityBudget(files);
		expect(result.withinBudget).toBe(true);
		expect(result.metrics.testRatio).toBeCloseTo(0.5);
	});

	it("flags a file exceeding the per-file added-line budget", () => {
		const files: QualityBudgetFile[] = [
			{ path: "src/huge.ts", addedLines: lines(500) },
			{ path: "test/huge.test.ts", addedLines: lines(200, "expect huge") },
		];
		const result = assessQualityBudget(files);
		expect(result.violations.some((v) => v.kind === "file_too_large" && v.path === "src/huge.ts")).toBe(true);
	});

	it("flags insufficient tests when source changed but tests didn't keep up", () => {
		const files: QualityBudgetFile[] = [{ path: "src/b.ts", addedLines: lines(100) }];
		const result = assessQualityBudget(files);
		expect(result.violations.some((v) => v.kind === "insufficient_tests")).toBe(true);
		expect(result.metrics.testRatio).toBe(0);
	});

	it("derives test files from the path and does not require tests for a test-only change", () => {
		const files: QualityBudgetFile[] = [{ path: "src/__tests__/c.ts", addedLines: lines(80, "expect c") }];
		const result = assessQualityBudget(files);
		// All added lines are test lines → no source → no insufficient-tests violation.
		expect(result.metrics.sourceAddedLines).toBe(0);
		expect(result.withinBudget).toBe(true);
	});

	it("flags excessive exact-duplicate source lines (copy-paste)", () => {
		// 30 identical non-trivial lines + 10 unique → ~0.5 duplication ratio, over the 0.30 default.
		const dup = Array.from({ length: 30 }, () => "doTheExactSameThing(payload, context);");
		const unique = lines(10);
		const files: QualityBudgetFile[] = [
			{ path: "src/d.ts", addedLines: [...dup, ...unique] },
			{ path: "test/d.test.ts", addedLines: lines(15, "expect d") },
		];
		const result = assessQualityBudget(files);
		expect(result.violations.some((v) => v.kind === "excess_duplication")).toBe(true);
		expect(result.metrics.duplicationRatio).toBeGreaterThan(0.3);
	});

	it("does not count trivial lines (blank / lone brackets) toward duplication", () => {
		const files: QualityBudgetFile[] = [
			{ path: "src/e.ts", addedLines: ["}", "}", "}", "}", "const uniqueThing = compute(x);"] },
			{ path: "test/e.test.ts", addedLines: lines(5, "expect e") },
		];
		const result = assessQualityBudget(files);
		expect(result.metrics.duplicationRatio).toBe(0);
	});
});
