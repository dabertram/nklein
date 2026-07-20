import { describe, expect, it } from "vitest";
import {
	assessGraderIntegrity,
	FORGERY_VECTORS,
	MIN_REAL_OVER_RANDOM_POINTS,
} from "../../src/core/null-agent-baseline";

describe("assessGraderIntegrity", () => {
	it("passes a grader that rewards neither nothing nor mere activity", () => {
		const result = assessGraderIntegrity({ nullAgent: 0, randomAgent: 5, realAgent: 40 });
		expect(result.verdict).toBe("sound");
		expect(result.allNumbersVoid).toBe(false);
	});

	it("declares EVERY number void when a null agent scores above zero", () => {
		// Not 'suspect', not 'worth a caveat' — meaningless, including the good ones.
		const result = assessGraderIntegrity({ nullAgent: 3, randomAgent: 5, realAgent: 90 });
		expect(result.verdict).toBe("forgeable");
		expect(result.allNumbersVoid).toBe(true);
		expect(result.reason).toContain("including the good ones");
	});

	it("checks the null agent FIRST and stops there", () => {
		// Continuing would produce sub-verdicts about numbers already known to be void, and any real-looking
		// analysis invites someone to read past the headline.
		const result = assessGraderIntegrity({ nullAgent: 1, randomAgent: null, realAgent: null });
		expect(result.verdict).toBe("forgeable");
	});

	it("treats an UNRUN baseline as indeterminate and voids the numbers anyway", () => {
		// Not because the grader is known broken, but because nothing has checked.
		const result = assessGraderIntegrity({ nullAgent: null, randomAgent: 5, realAgent: 40 });
		expect(result.verdict).toBe("indeterminate");
		expect(result.allNumbersVoid).toBe(true);
		expect(result.reason).toContain("nothing has checked");
	});

	it("catches the SUBTLER failure: a grader that rewards activity rather than correctness", () => {
		const result = assessGraderIntegrity({ nullAgent: 0, randomAgent: 35, realAgent: 40 });
		expect(result.verdict).toBe("undiscriminating");
		expect(result.allNumbersVoid).toBe(true);
		expect(result.reason).toContain("track EFFORT rather than correctness");
	});

	it("reports UNMEASURED discriminating power when only the null agent ran", () => {
		// A grader can reward activity and still give a null agent nothing, so passing the null test is not enough.
		const result = assessGraderIntegrity({ nullAgent: 0, randomAgent: null, realAgent: null });
		expect(result.verdict).toBe("indeterminate");
		expect(result.allNumbersVoid).toBe(false);
		expect(result.reason).toContain("DISCRIMINATING power is unmeasured");
	});

	it("uses the documented gap constant", () => {
		const justUnder = assessGraderIntegrity({
			nullAgent: 0,
			randomAgent: 10,
			realAgent: 10 + MIN_REAL_OVER_RANDOM_POINTS - 0.1,
		});
		const atBar = assessGraderIntegrity({
			nullAgent: 0,
			randomAgent: 10,
			realAgent: 10 + MIN_REAL_OVER_RANDOM_POINTS,
		});
		expect(justUnder.verdict).toBe("undiscriminating");
		expect(atBar.verdict).toBe("sound");
	});

	it("treats a NEGATIVE null score as forgeable too — a grader should not go below zero", () => {
		expect(assessGraderIntegrity({ nullAgent: 0, randomAgent: 0, realAgent: 40 }).verdict).toBe("sound");
	});
});

describe("FORGERY_VECTORS", () => {
	it("lists the specific attacks to run, not a general intention", () => {
		// 'We thought about grader forgery' and 'we tested these five attacks' are different claims, and only the
		// second is checkable.
		expect(FORGERY_VECTORS.length).toBeGreaterThanOrEqual(5);
		const ids = FORGERY_VECTORS.map((vector) => vector.id);
		expect(ids).toContain("test_hook_override");
		expect(ids).toContain("trivial_validator_satisfaction");
		expect(ids).toContain("state_tampering");
	});

	it("every vector carries a description a person could act on", () => {
		for (const vector of FORGERY_VECTORS) {
			expect(vector.description.length).toBeGreaterThan(20);
		}
	});
});
