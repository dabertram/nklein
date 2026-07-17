import { describe, expect, it } from "vitest";
import { decideVerificationFirst } from "../../../src/core/verification-first-gate";

describe("decideVerificationFirst (F12.36)", () => {
	it("bounces deterministically on any red check, listing EVERY failure for one repair round", () => {
		const decision = decideVerificationFirst([
			{ name: "typecheck", passed: false, detail: "src/a.ts(3,1): TS2304 Cannot find name 'foo'" },
			{ name: "tests", passed: false, detail: "2 failed" },
			{ name: "lint", passed: true, detail: null },
		]);
		expect(decision.action).toBe("deterministic_bounce");
		if (decision.action === "deterministic_bounce") {
			expect(decision.submission.verdict).toBe("request_changes");
			expect(decision.submission.feedback).toContain("typecheck FAILED");
			expect(decision.submission.feedback).toContain("tests FAILED");
			expect(decision.submission.feedback).toContain("no reviewer judgment was spent");
		}
	});

	it("proceeds on all-green with the green count as reviewer context", () => {
		const decision = decideVerificationFirst([
			{ name: "acceptance", passed: true, detail: null },
			{ name: "typecheck", passed: true, detail: null },
		]);
		expect(decision.action).toBe("proceed");
		if (decision.action === "proceed") {
			expect(decision.note).toContain("2 deterministic check(s) green");
		}
	});

	it("treats could-not-run as no-signal, never as red", () => {
		const decision = decideVerificationFirst([{ name: "acceptance", passed: null, detail: null }]);
		expect(decision.action).toBe("proceed");
		if (decision.action === "proceed") {
			expect(decision.note).toContain("no deterministic checks ran");
		}
	});
});
