import { describe, expect, it } from "vitest";
import { formatAcceptanceSummaryForReview } from "../../../src/server/second-opinion-review-runner";

describe("formatAcceptanceSummaryForReview (W1.5 — the reviewer sees acceptance evidence)", () => {
	it("summarizes a passing check without dumping output", () => {
		const summary = formatAcceptanceSummaryForReview({
			present: true,
			command: "npm test",
			passed: true,
			exitCode: 0,
			output: "all 12 tests passed",
		});
		expect(summary).toContain("`npm test` — PASSED");
		expect(summary).not.toContain("Output tail");
	});

	it("frames a failing check as strong request-changes grounds with the output tail", () => {
		const summary = formatAcceptanceSummaryForReview({
			present: true,
			command: "npm test",
			passed: false,
			exitCode: 1,
			output: `${"x".repeat(2_000)}\nassertion failed: expected 3 to be 4`,
		});
		expect(summary).toContain("FAILED (exit 1)");
		expect(summary).toContain("strong grounds to request changes");
		expect(summary).toContain("assertion failed");
		// tail-bounded: the 2000-char prefix is truncated away
		expect(summary?.length ?? 0).toBeLessThan(1_200);
	});

	it("a missing acceptance command is itself request-changes grounds (fail-closed posture)", () => {
		const summary = formatAcceptanceSummaryForReview({
			present: false,
			command: null,
			passed: null,
			exitCode: null,
			output: "",
		});
		expect(summary).toContain("NO acceptance command");
	});

	it("unavailable evidence (null) tells the reviewer the gate fails closed", () => {
		expect(formatAcceptanceSummaryForReview(null)).toContain("UNAVAILABLE");
	});

	it("F12.60(a): a red acceptance is ATTRIBUTED when a baseline probe ran — both directions", () => {
		const red = {
			present: true,
			command: "npm test",
			passed: false,
			exitCode: 1,
			output: "1 failing",
		};
		const preExisting = formatAcceptanceSummaryForReview(red, { present: true, passed: false });
		expect(preExisting).toContain("ALREADY FAILED this check before any work");
		const introduced = formatAcceptanceSummaryForReview(red, { present: true, passed: true });
		expect(introduced).toContain("BASE tree PASSED this check before the work");
		// No probe / green acceptance / inconclusive probe ⇒ no attribution line.
		expect(formatAcceptanceSummaryForReview(red)).not.toContain("Baseline attribution");
		expect(formatAcceptanceSummaryForReview(red, { present: true, passed: null })).not.toContain(
			"Baseline attribution",
		);
		expect(formatAcceptanceSummaryForReview({ ...red, passed: true }, { present: true, passed: true })).not.toContain(
			"Baseline attribution",
		);
	});
});
