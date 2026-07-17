import { describe, expect, it } from "vitest";
import { decideDecomposition, draftSetCoupling } from "../../../src/core/anti-decomposition-guard";

describe("decideDecomposition (F12.37)", () => {
	it("never decomposes a routine task — one worker beats a manufactured fan-out", () => {
		const verdict = decideDecomposition({ taskText: "Fix the typo in the README heading." });
		expect(verdict.decompose).toBe(false);
		expect(verdict.reason).toContain("trivial");
	});

	it("serializes a tightly-coupled draft set and allows a loosely-coupled one", () => {
		const signals = { taskText: "Refactor the scoring pipeline across modules.", multiFile: true };
		const coupled = decideDecomposition(signals, [
			{ files: ["src/score.ts", "src/index.ts"] },
			{ files: ["src/score.ts", "src/index.ts", "src/report.ts"] },
		]);
		expect(coupled.decompose).toBe(false);
		expect(coupled.reason).toContain("fight over the same code");

		const loose = decideDecomposition(signals, [
			{ files: ["src/parser.ts"] },
			{ files: ["src/report.ts"] },
			{ files: ["src/cli.ts"] },
		]);
		expect(loose.decompose).toBe(true);
		expect(loose.coupling).toBe(0);
	});

	it("computes mean pairwise Jaccard coupling and ignores unscoped cards", () => {
		expect(draftSetCoupling([{ files: ["a"] }, { files: ["a"] }])).toBe(1);
		expect(draftSetCoupling([{ files: ["a"] }, { files: [] }, { files: ["b"] }])).toBe(0);
		expect(draftSetCoupling([{ files: ["a"] }])).toBe(0);
	});

	it("decomposes a complex task with no draft set as planned", () => {
		const verdict = decideDecomposition({
			taskText: "Build the new multi-service ingestion architecture with migrations.",
			multiFile: true,
		});
		expect(verdict.decompose).toBe(true);
	});
});
