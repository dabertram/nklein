import { describe, expect, it } from "vitest";
import {
	buildReplayEvalRetentionEvent,
	collectSelfImprovementSignals,
	decideSelfImprovementApproval,
	evaluateSelfImprovementReplay,
	isSelfImprovementPlanSlug,
	readRetainedReplayEvalVerdict,
	type SelfImprovementSignals,
} from "../../../src/core/self-improvement-gate";

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

	describe("F1.25 — the delivery seam's signal collection", () => {
		it("derives coverage from touched test files and the security check from taint + bounds", () => {
			const clean = collectSelfImprovementSignals({
				changedFiles: ["src/core/x.ts", "test/runtime/core/x.test.ts"],
				fullSuitePassed: true,
				taintLabels: [],
				hadBoundaryViolations: false,
			});
			expect(clean.newTestCoverageAdded).toBe(true);
			expect(clean.securityCheckPass).toBe(true);
			// Auto-delivery can never satisfy the human gates — M4 never self-merges unsupervised.
			expect(clean.humanMergeApproved).toBe(false);
			expect(clean.humanReviewApproved).toBeNull();
			expect(decideSelfImprovementApproval(clean).approve).toBe(false);

			const noTests = collectSelfImprovementSignals({
				changedFiles: ["src/core/x.ts"],
				fullSuitePassed: true,
				taintLabels: [],
				hadBoundaryViolations: false,
			});
			expect(noTests.newTestCoverageAdded).toBe(false);

			const tainted = collectSelfImprovementSignals({
				changedFiles: ["src/core/x.ts", "test/x.test.ts"],
				fullSuitePassed: true,
				taintLabels: ["web"],
				hadBoundaryViolations: false,
			});
			expect(tainted.securityCheckPass).toBe(false);
		});

		it("identifies self-improvement cards by the dogfood plan slug", () => {
			expect(isSelfImprovementPlanSlug("dogfood-2026-07-13")).toBe(true);
			expect(isSelfImprovementPlanSlug("habit-tracker")).toBe(false);
			expect(isSelfImprovementPlanSlug(null)).toBe(false);
		});
	});

	describe("F1.26 — deterministic replay evaluation, retained in the ledger", () => {
		const attempt = (outcome: string, at: number) => ({
			kind: "attempt",
			workflowId: "wf",
			taskId: "t-1",
			recordedAt: at,
			modelId: "m",
			outcome,
		});

		it("a deterministic replay passes; a drifted one fails with the divergence localized", () => {
			const captured = [attempt("success", 100), attempt("other_failure", 200)];
			expect(evaluateSelfImprovementReplay({ captured, replayed: captured })).toMatchObject({
				pass: true,
				divergenceIndex: null,
			});
			const drifted = evaluateSelfImprovementReplay({
				captured,
				replayed: [attempt("success", 100), attempt("timeout", 200)],
			});
			expect(drifted.pass).toBe(false);
			expect(drifted.divergenceIndex).toBe(1);
			expect(drifted.summary).toContain("index 1");
		});

		it("the retained verdict round-trips through the ledger and feeds the M4 signal", () => {
			const failEvent = buildReplayEvalRetentionEvent({
				workflowId: "wf",
				taskId: "t-1",
				workspacePathHash: "hash",
				evaluation: { pass: false, divergenceIndex: 3, summary: "replay diverged at causal index 3" },
				recordedAt: 100,
			});
			const passEvent = buildReplayEvalRetentionEvent({
				workflowId: "wf",
				taskId: "t-1",
				workspacePathHash: "hash",
				evaluation: { pass: true, divergenceIndex: null, summary: "replay deterministic" },
				recordedAt: 200, // a later re-run supersedes
			});
			expect(readRetainedReplayEvalVerdict([failEvent, passEvent], "t-1")).toBe(true);
			expect(readRetainedReplayEvalVerdict([failEvent], "t-1")).toBe(false);
			expect(readRetainedReplayEvalVerdict([], "t-1")).toBeNull(); // never run — stays an M4 blocker
			// The verdict lands in the gate exactly where replayEvalPass expects it.
			const signals = collectSelfImprovementSignals({
				changedFiles: ["test/x.test.ts"],
				fullSuitePassed: true,
				replayEvalPass: readRetainedReplayEvalVerdict([failEvent, passEvent], "t-1"),
				taintLabels: [],
				hadBoundaryViolations: false,
			});
			expect(signals.replayEvalPass).toBe(true);
		});
	});
});
