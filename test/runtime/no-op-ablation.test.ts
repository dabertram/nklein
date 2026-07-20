import { describe, expect, it } from "vitest";
import { assessNoOpAblation, assessOracleScore, type TestOutcome } from "../../src/core/no-op-ablation";

const green = (...ids: string[]): TestOutcome[] => ids.map((testId) => ({ testId, passed: true }));
const red = (...ids: string[]): TestOutcome[] => ids.map((testId) => ({ testId, passed: false }));

describe("assessNoOpAblation", () => {
	it("reports LOAD_BEARING when stubbing the artifact breaks tests", () => {
		const result = assessNoOpAblation({ baseline: green("a", "b"), ablated: red("a", "b") });
		expect(result.verdict).toBe("load_bearing");
		expect(result.brokenByStub).toEqual(["a", "b"]);
	});

	it("reports DECORATIVE when stubbing breaks nothing — the Building-to-the-Test shape", () => {
		// The tests are not lying about their results; they are lying about what produced them.
		const result = assessNoOpAblation({ baseline: green("a", "b"), ablated: green("a", "b") });
		expect(result.verdict).toBe("decorative");
		expect(result.reason).toContain("lying about what produced them");
	});

	it("names the tests that passed WITH and WITHOUT the artifact, even when load-bearing", () => {
		// Each indifferent test is one that never measured this artifact — worth knowing even on a good verdict.
		const result = assessNoOpAblation({
			baseline: green("real", "indifferent"),
			ablated: [
				{ testId: "real", passed: false },
				{ testId: "indifferent", passed: true },
			],
		});
		expect(result.verdict).toBe("load_bearing");
		expect(result.indifferentTests).toEqual(["indifferent"]);
		expect(result.reason).toContain("never measured this artifact");
	});

	it("is INCONCLUSIVE when the baseline was already red — not a pass", () => {
		// Stubbing cannot make anything newly fail, so there is no signal in either direction.
		const result = assessNoOpAblation({ baseline: red("a"), ablated: red("a") });
		expect(result.verdict).toBe("inconclusive");
		expect(result.reason).toContain("no signal in either direction");
	});

	it("is INCONCLUSIVE when no tests ran at all", () => {
		// 'Nothing broke' is not evidence when nothing was watching.
		const result = assessNoOpAblation({ baseline: [], ablated: [] });
		expect(result.verdict).toBe("inconclusive");
		expect(result.reason).toContain("nothing was watching");
	});

	it("is INCONCLUSIVE — and blames the HARNESS — when the two runs cannot be compared", () => {
		const result = assessNoOpAblation({ baseline: green("a"), ablated: green("different-test") });
		expect(result.verdict).toBe("inconclusive");
		expect(result.reason).toContain("harness problem");
	});

	it("ignores tests that were red at baseline when judging", () => {
		// Only baseline-green tests carry information about what the artifact contributes.
		const result = assessNoOpAblation({
			baseline: [...green("works"), ...red("already-broken")],
			ablated: [
				{ testId: "works", passed: false },
				{ testId: "already-broken", passed: false },
			],
		});
		expect(result.verdict).toBe("load_bearing");
		expect(result.brokenByStub).toEqual(["works"]);
	});
});

describe("assessOracleScore", () => {
	it("treats a PERFECT in-loop score as SUSPICIOUS — confidence goes down, not up", () => {
		// This reads backwards on purpose: the failure mode produces a better-looking result than honest work.
		const result = assessOracleScore({ passed: 222, total: 222, oracleInLoop: true });
		expect(result.suspicion).toBe("suspicious");
		expect(result.reason).toContain("evidence of gaming, not quality");
	});

	it("says the check must be run rather than asked for", () => {
		// Prompt-level guardrails were MEASURED not to work, so an instruction is not a control.
		const result = assessOracleScore({ passed: 10, total: 10, oracleInLoop: true });
		expect(result.reason).toContain("MEASURED not to work");
	});

	it("treats a perfect OUT-of-loop score as merely perfect", () => {
		const result = assessOracleScore({ passed: 10, total: 10, oracleInLoop: false });
		expect(result.suspicion).toBe("expected");
	});

	it("does not flag a non-perfect in-loop score", () => {
		const result = assessOracleScore({ passed: 9, total: 10, oracleInLoop: true });
		expect(result.suspicion).toBe("expected");
	});

	it("handles an empty oracle", () => {
		expect(assessOracleScore({ passed: 0, total: 0, oracleInLoop: true }).suspicion).toBe("expected");
	});
});
