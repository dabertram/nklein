import { describe, expect, it } from "vitest";
import { combineVerifierVerdicts, type VerifierVerdict } from "../../src/core/verifier-ensemble";

const PASS_TESTS: VerifierVerdict = { kind: "execution_tests", outcome: "pass" };

describe("verifier ensemble (F12.97)", () => {
	it("accepts when the blocking verifier passed and nothing objected", () => {
		const result = combineVerifierVerdicts([PASS_TESTS, { kind: "shortcut_monitor", outcome: "pass" }]);
		expect(result.decision).toBe("accept");
		expect(result.reason).toContain("every configured verifier agreed");
	});

	it("REJECTS on a red execution run — advisory passes cannot outvote it", () => {
		const result = combineVerifierVerdicts([
			{ kind: "execution_tests", outcome: "fail", detail: "3 tests failed" },
			{ kind: "shortcut_monitor", outcome: "pass" },
			{ kind: "diff_minimality", outcome: "pass" },
		]);
		expect(result.decision).toBe("reject");
		expect(result.reason).toContain("cannot be outvoted");
	});

	it("escalates to review when two independent checks object", () => {
		const result = combineVerifierVerdicts([
			PASS_TESTS,
			{ kind: "shortcut_monitor", outcome: "fail", detail: "harness tampering" },
			{ kind: "diff_minimality", outcome: "fail", detail: "bloated" },
		]);
		expect(result.decision).toBe("needs_review");
		expect(result.reason).toContain("converging concerns");
		expect(result.objecting).toEqual(["shortcut_monitor", "diff_minimality"]);
	});

	it("surfaces a lone objection instead of auto-accepting it", () => {
		const result = combineVerifierVerdicts([
			PASS_TESTS,
			{ kind: "shortcut_monitor", outcome: "fail", detail: "solution lookup" },
		]);
		expect(result.decision).toBe("needs_review");
		expect(result.reason).toContain("solution lookup");
		expect(result.reason).toContain("rather than auto-accepted");
	});

	it("NAMES missing verifiers rather than treating absence as agreement", () => {
		const result = combineVerifierVerdicts([
			PASS_TESTS,
			{ kind: "property_checks", outcome: "unavailable" },
			{ kind: "rubric_judge", outcome: "unavailable" },
		]);
		expect(result.decision).toBe("accept");
		expect(result.missing).toEqual(["property_checks", "rubric_judge"]);
		expect(result.reason).toContain("could not run");
	});

	it("refuses to approve when NOTHING could run", () => {
		const result = combineVerifierVerdicts([
			{ kind: "execution_tests", outcome: "unavailable" },
			{ kind: "shortcut_monitor", outcome: "unavailable" },
		]);
		expect(result.decision).toBe("needs_review");
		expect(result.reason).toContain("absence of evidence is not approval");
	});

	it("is order-independent (replayable acceptance)", () => {
		const a = combineVerifierVerdicts([PASS_TESTS, { kind: "diff_minimality", outcome: "fail" }]);
		const b = combineVerifierVerdicts([{ kind: "diff_minimality", outcome: "fail" }, PASS_TESTS]);
		expect(a.decision).toBe(b.decision);
	});
});
