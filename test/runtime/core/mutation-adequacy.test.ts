import { describe, expect, it } from "vitest";
import { computeMutationScore, decideMutationAdequacy, generateLineMutants } from "../../../src/core/mutation-adequacy";

describe("generateLineMutants (F12.46)", () => {
	it("mutates comparisons, logic, arithmetic, and literals on the CHANGED lines only", () => {
		const source = ["const a = x === 1;", "const b = y < 2 && z;", "const untouched = q === 3;"].join("\n");
		const mutants = generateLineMutants(source, [1, 2]);
		const operators = mutants.map((m) => m.operator);
		expect(operators).toContain("eq_flip");
		expect(operators).toContain("lt_to_lte");
		expect(operators).toContain("and_to_or");
		expect(mutants.every((m) => m.line !== 3)).toBe(true);
		const flip = mutants.find((m) => m.operator === "eq_flip");
		expect(flip?.mutated).toBe("const a = x !== 1;");
	});

	it("never mutates inside string literals or comments, and skips import/blank/comment lines", () => {
		const source = [
			'const s = "a === b && c";',
			"// x === y",
			"import { z } from './z';",
			"",
			"const ok = p >= 9;",
		].join("\n");
		const mutants = generateLineMutants(source, [1, 2, 3, 4, 5]);
		expect(mutants.filter((m) => m.line === 1)).toHaveLength(0);
		expect(mutants.filter((m) => m.line === 2)).toHaveLength(0);
		expect(mutants.filter((m) => m.line === 3)).toHaveLength(0);
		const line5 = mutants.filter((m) => m.line === 5);
		expect(line5.map((m) => m.operator)).toContain("gte_to_gt");
		expect(line5.map((m) => m.operator)).toContain("off_by_one_up");
	});

	it("bounds mutants to one site per operator per line and stays deterministic", () => {
		const source = "if (a === b && c === d) { run(); }";
		const first = generateLineMutants(source, [1]);
		expect(first.filter((m) => m.operator === "eq_flip")).toHaveLength(1);
		expect(generateLineMutants(source, [1])).toEqual(first);
	});
});

describe("score + gate", () => {
	it("scores killed/total and clamps degenerate inputs", () => {
		expect(computeMutationScore(3, 5)).toEqual({ totalMutants: 5, killedMutants: 3, score: 0.6 });
		expect(computeMutationScore(9, 5).killedMutants).toBe(5);
		expect(computeMutationScore(0, 0).score).toBeNull();
	});

	it("gates on adequacy with honest thin-sample handling", () => {
		expect(decideMutationAdequacy(computeMutationScore(5, 6)).verdict).toBe("adequate");
		expect(decideMutationAdequacy(computeMutationScore(1, 6)).verdict).toBe("inadequate");
		expect(decideMutationAdequacy(computeMutationScore(1, 2)).verdict).toBe("unmeasured");
		expect(decideMutationAdequacy(computeMutationScore(0, 0)).verdict).toBe("unmeasured");
		expect(decideMutationAdequacy(computeMutationScore(4, 10), { threshold: 0.3 }).verdict).toBe("adequate");
	});
});
