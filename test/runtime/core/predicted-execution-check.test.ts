import { describe, expect, it } from "vitest";
import { assessPredictedExecution, comparePredictedExecution } from "../../../src/core/predicted-execution-check";

describe("comparePredictedExecution", () => {
	it("matches despite CRLF, trailing whitespace, and trailing blank lines", () => {
		const result = comparePredictedExecution({
			label: "npm test",
			predicted: "ok 1\nok 2\n",
			actual: "ok 1  \r\nok 2\r\n\r\n",
		});
		expect(result.matched).toBe(true);
	});

	it("localizes the first divergent line with a compact excerpt", () => {
		const result = comparePredictedExecution({
			label: "score(101)",
			predicted: "score: 101",
			actual: "score: 100",
		});
		expect(result.matched).toBe(false);
		expect(result.firstDivergentLine).toBe(1);
		expect(result.divergence).toContain('"score: 101"');
		expect(result.divergence).toContain('"score: 100"');
	});

	it("flags missing/extra lines as divergence", () => {
		const result = comparePredictedExecution({ label: "x", predicted: "a", actual: "a\nb" });
		expect(result.matched).toBe(false);
		expect(result.firstDivergentLine).toBe(2);
		expect(result.divergence).toContain("<absent>");
	});
});

describe("assessPredictedExecution", () => {
	it("passes when every case matches and fails on a single divergence", () => {
		const pass = assessPredictedExecution([
			{ label: "a", predicted: "1", actual: "1" },
			{ label: "b", predicted: "2", actual: "2" },
		]);
		expect(pass).toMatchObject({ pass: true, matchedCount: 2, mismatchedCount: 0 });

		const fail = assessPredictedExecution([
			{ label: "a", predicted: "1", actual: "1" },
			{ label: "b", predicted: "2", actual: "3" },
		]);
		expect(fail.pass).toBe(false);
		expect(fail.reason).toContain("mental trace is wrong");
		expect(fail.reason).toContain("[b]");
	});

	it("treats zero cases as pass-with-note (caller decides whether to require predictions)", () => {
		const verdict = assessPredictedExecution([]);
		expect(verdict.pass).toBe(true);
		expect(verdict.reason).toContain("nothing to falsify");
	});
});
