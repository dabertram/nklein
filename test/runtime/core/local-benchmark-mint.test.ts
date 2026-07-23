import { describe, expect, it } from "vitest";
import {
	buildLocalBenchmarkExecutionPrompt,
	LOCAL_BENCHMARK_PUBLIC_ACCEPTANCE,
	localBenchmarkProblemStatement,
	PINNED_SWE_SMITH_COMMIT,
	planLocalBenchmarkMutations,
} from "../../../src/core/local-benchmark-mint";

describe("local benchmark mint", () => {
	it("plans bounded deterministic implementation mutations without exposing the answer", () => {
		const source = "export function allowed(value: number) {\n\treturn value >= 1 && value < 4;\n}\n";
		const result = planLocalBenchmarkMutations({
			files: [{ path: "src/range.ts", source }],
			testFiles: ["test/range.test.ts"],
			maxMutants: 3,
		});
		expect(result).toHaveLength(3);
		expect(result.every((candidate) => candidate.file === "src/range.ts")).toBe(true);
		expect(localBenchmarkProblemStatement("src/range.ts")).not.toContain(result[0].original);
		expect(buildLocalBenchmarkExecutionPrompt(localBenchmarkProblemStatement("src/range.ts"))).toContain(
			`Acceptance check: ${LOCAL_BENCHMARK_PUBLIC_ACCEPTANCE}`,
		);
		expect(PINNED_SWE_SMITH_COMMIT).toMatch(/^[0-9a-f]{40}$/u);
	});

	it("refuses test mutation, traversal, duplicates, and unbounded campaigns", () => {
		expect(() =>
			planLocalBenchmarkMutations({
				files: [{ path: "test/a.ts", source: "return a === b" }],
				testFiles: ["test/a.ts"],
			}),
		).toThrow(/protected test/);
		expect(() =>
			planLocalBenchmarkMutations({ files: [{ path: "../a.ts", source: "return true" }], testFiles: [] }),
		).toThrow(/safe repository-relative/);
		expect(() =>
			planLocalBenchmarkMutations({
				files: [
					{ path: "a.ts", source: "return true" },
					{ path: "a.ts", source: "return false" },
				],
				testFiles: [],
			}),
		).toThrow(/Duplicate/);
		expect(() => planLocalBenchmarkMutations({ files: [], testFiles: [], maxMutants: 101 })).toThrow(
			/between 1 and 100/,
		);
	});
});
