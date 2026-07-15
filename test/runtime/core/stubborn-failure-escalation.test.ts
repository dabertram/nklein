import { describe, expect, it } from "vitest";
import {
	assessStubbornFailure,
	DEFAULT_STUBBORN_FAILURE_CONFIG,
	type EscalationAttempt,
} from "../../../src/core/stubborn-failure-escalation.js";

/** F3.29 — stubborn-failure escalation: exhaust alternatives → preserve best partial → park with evidence. */

const at = (over: Partial<EscalationAttempt> & { attemptId: string }): EscalationAttempt => ({
	modelId: "m1",
	approach: "simplify",
	outcome: "failure",
	qualityScore: 0,
	artifactRef: null,
	...over,
});

describe("assessStubbornFailure", () => {
	it("keeps trying while bounded alternatives remain", () => {
		const v = assessStubbornFailure([
			at({ attemptId: "1" }),
			at({ attemptId: "2", modelId: "m2", approach: "bounce" }),
		]);
		expect(v.status).toBe("keep_trying");
		expect(v.evidenceReport).toBe("");
		expect(v.remaining.models).toBe(1); // 2 distinct so far, max 3
	});

	it("reports succeeded when any attempt succeeded", () => {
		const v = assessStubbornFailure([
			at({ attemptId: "1" }),
			at({ attemptId: "2", outcome: "success", qualityScore: 0.9 }),
		]);
		expect(v.status).toBe("succeeded");
	});

	it("exhausts on the total-attempts cap and preserves the highest-quality partial", () => {
		const attempts: EscalationAttempt[] = [
			at({ attemptId: "1", modelId: "m1", qualityScore: 0.2 }),
			at({ attemptId: "2", modelId: "m2", qualityScore: 0.7, artifactRef: "branch/best" }),
			at({ attemptId: "3", modelId: "m3", qualityScore: 0.3, artifactRef: "branch/c" }),
			at({ attemptId: "4", modelId: "m1", approach: "bounce", qualityScore: 0.1 }),
			at({ attemptId: "5", modelId: "m2", approach: "self_consistency", qualityScore: 0.4 }),
			at({ attemptId: "6", modelId: "m3", approach: "persona", qualityScore: 0.0 }),
		];
		const v = assessStubbornFailure(attempts); // 6 attempts = maxTotalAttempts
		expect(v.status).toBe("exhausted");
		expect(v.bestPartial?.attemptId).toBe("2"); // highest quality 0.7
		expect(v.evidenceReport).toContain("branch/best");
		expect(v.evidenceReport.toLowerCase()).toContain("exhausted");
	});

	it("exhausts when BOTH diversity dimensions are spent even below the total cap", () => {
		// 3 distinct models AND 3 distinct approaches in 3 attempts (< max 6) → exhausted.
		const attempts: EscalationAttempt[] = [
			at({ attemptId: "1", modelId: "m1", approach: "a" }),
			at({ attemptId: "2", modelId: "m2", approach: "b" }),
			at({ attemptId: "3", modelId: "m3", approach: "c" }),
		];
		expect(assessStubbornFailure(attempts).status).toBe("exhausted");
	});

	it("notes when no usable partial artifact exists", () => {
		const attempts: EscalationAttempt[] = Array.from(
			{ length: DEFAULT_STUBBORN_FAILURE_CONFIG.maxTotalAttempts },
			(_, i) => at({ attemptId: `${i}`, modelId: `m${i}`, artifactRef: null }),
		);
		const v = assessStubbornFailure(attempts);
		expect(v.status).toBe("exhausted");
		expect(v.evidenceReport).toContain("No usable partial artifact");
	});

	it("is keep_trying for an empty history", () => {
		expect(assessStubbornFailure([]).status).toBe("keep_trying");
	});
});
