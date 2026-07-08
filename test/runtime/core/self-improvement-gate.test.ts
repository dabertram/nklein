import { describe, expect, it } from "vitest";
import { decideSelfImprovementApproval, type SelfImprovementSignals } from "../../../src/core/self-improvement-gate";

/** All gates green (the ONLY approving state). */
function allPass(overrides: Partial<SelfImprovementSignals> = {}): SelfImprovementSignals {
	return {
		protectedTestsPass: true,
		newTestCoverageAdded: true,
		replayEvalPass: true,
		securityCheckPass: true,
		humanReviewApproved: true,
		humanMergeApproved: true,
		...overrides,
	};
}

describe("M4 self-improvement gate (§5.AF safety keystone)", () => {
	it("approves ONLY when every gate passes", () => {
		const d = decideSelfImprovementApproval(allPass());
		expect(d.approve).toBe(true);
		expect(d.blockers).toEqual([]);
	});

	it("blocks when the protected suite is not green", () => {
		const d = decideSelfImprovementApproval(allPass({ protectedTestsPass: false }));
		expect(d.approve).toBe(false);
		expect(d.blockers).toContain("protected/full test suite not green");
	});

	it("blocks a fix with no new test coverage (unproven)", () => {
		expect(decideSelfImprovementApproval(allPass({ newTestCoverageAdded: false })).approve).toBe(false);
	});

	it("distinguishes a FAILED gate from a NOT-RUN gate", () => {
		expect(decideSelfImprovementApproval(allPass({ replayEvalPass: false })).blockers).toContain(
			"replay-eval FAILED",
		);
		expect(decideSelfImprovementApproval(allPass({ replayEvalPass: null })).blockers).toContain(
			"replay-eval not run",
		);
		expect(decideSelfImprovementApproval(allPass({ securityCheckPass: false })).blockers).toContain(
			"automated security check FAILED",
		);
		expect(decideSelfImprovementApproval(allPass({ humanReviewApproved: null })).blockers).toContain(
			"human security review pending",
		);
	});

	it("NEVER approves without an explicit human merge approval (M4 never self-merges)", () => {
		const d = decideSelfImprovementApproval(allPass({ humanMergeApproved: false }));
		expect(d.approve).toBe(false);
		expect(d.blockers).toContain("human merge approval missing (M4 never self-merges unsupervised)");
	});

	it("enumerates ALL unmet gates at once (fail-closed, no partial-credit)", () => {
		const d = decideSelfImprovementApproval({
			protectedTestsPass: false,
			newTestCoverageAdded: false,
			replayEvalPass: null,
			securityCheckPass: false,
			humanReviewApproved: null,
			humanMergeApproved: false,
		});
		expect(d.approve).toBe(false);
		expect(d.blockers).toHaveLength(6);
		expect(d.reason).toContain("BLOCKED");
	});
});
