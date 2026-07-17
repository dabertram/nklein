import { describe, expect, it } from "vitest";
import { assessRewardHackSignals } from "../../../src/core/reward-hack-signals";

const diff = (file: string, added: string[], removed: string[]): string =>
	`--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${removed.map((l) => `-${l}`).join("\n")}\n${added.map((l) => `+${l}`).join("\n")}\n`;

describe("assessRewardHackSignals", () => {
	it("flags a tests-only change (green proves nothing about the fix)", () => {
		const result = assessRewardHackSignals(diff("test/score.test.ts", ["expect(cap(101)).toBe(101);"], []));
		expect(result.suspicious).toBe(true);
		expect(result.signals[0]?.kind).toBe("tests_only_change");
	});

	it("flags net assertion loss in a test file", () => {
		const patch =
			diff("src/score.ts", ["export const cap = (n: number) => Math.min(n, 100);"], []) +
			diff("test/score.test.ts", ["// tightened later"], ["expect(cap(101)).toBe(100);", "expect(cap(0)).toBe(0);"]);
		const result = assessRewardHackSignals(patch);
		expect(result.signals.some((signal) => signal.kind === "assertion_removed")).toBe(true);
	});

	it("flags added skips and vacuous assertions", () => {
		const patch =
			diff("src/a.ts", ["real change"], []) +
			diff("test/a.test.ts", ["it.skip('hard case', () => {});", "expect(true).toBe(true);"], []);
		const result = assessRewardHackSignals(patch);
		const kinds = result.signals.map((signal) => signal.kind);
		expect(kinds).toContain("test_skipped");
		expect(kinds).toContain("expectation_weakened");
	});

	it("stays quiet on an honest fix (source change + strengthened tests)", () => {
		const patch =
			diff(
				"src/score.ts",
				["export const cap = (n: number) => Math.min(n, 100);"],
				["export const cap = (n: number) => n;"],
			) + diff("test/score.test.ts", ["expect(cap(101)).toBe(100);"], []);
		const result = assessRewardHackSignals(patch);
		expect(result.suspicious).toBe(false);
		expect(result).toMatchObject({ testFilesTouched: 1, sourceFilesTouched: 1 });
	});

	it("recognizes __tests__/ and .spec. naming as test files", () => {
		const result = assessRewardHackSignals(diff("src/__tests__/x.ts", ["it.skip('y', () => {});"], []));
		expect(result.signals.some((signal) => signal.kind === "test_skipped")).toBe(true);
	});
});

describe("F12.44 source-side detectors", () => {
	const patchFor = (file: string, addedLines: string[]) =>
		[`+++ b/${file}`, ...addedLines.map((line) => `+${line}`)].join("\n");

	it("flags a literal input special-cased to a literal return", () => {
		const assessment = assessRewardHackSignals(
			patchFor("src/calc.ts", ['if (input === "test-case-4") return 42;', "return compute(input);"]),
		);
		expect(assessment.signals.some((signal) => signal.kind === "output_hardcoded")).toBe(true);
	});

	it("flags source branching on test-environment detection", () => {
		const assessment = assessRewardHackSignals(
			patchFor("src/calc.ts", ['if (process.env.VITEST) return "expected";']),
		);
		expect(assessment.signals.some((signal) => signal.kind === "checker_special_cased")).toBe(true);
	});

	it("stays quiet on ordinary source logic", () => {
		const assessment = assessRewardHackSignals(
			patchFor("src/calc.ts", ["if (input.length === 0) {", "\treturn defaultValue;", "}"]),
		);
		expect(assessment.suspicious).toBe(false);
	});
});
