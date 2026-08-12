import { describe, expect, it } from "vitest";
import type { ReviewRoundRecord } from "../../src/core/review-loop";
import {
	buildIntegrationParentPrompt,
	buildRedecomposeCardPrompt,
	decideReviewRedecompose,
	INTEGRATION_PARENT_PROMPT_MARKER,
	REVIEW_REDECOMPOSE_GENERATION_CAP,
	summarizeReviewAttemptEvidence,
} from "../../src/core/review-redecompose";

describe("decideReviewRedecompose", () => {
	it("spawns when the escalation rung was spent (historical rule)", () => {
		const decision = decideReviewRedecompose({
			parkKind: "review_stuck",
			escalationSpent: true,
			escalationAvailable: true,
			parentGeneration: 0,
		});
		expect(decision.spawn).toBe(true);
		expect(decision.reason).toContain("full ladder failed");
	});

	it("spawns when NO escalation exists — the single-model rig where bounce→park is the whole ladder", () => {
		const decision = decideReviewRedecompose({
			parkKind: "review_stuck",
			escalationSpent: false,
			escalationAvailable: false,
			parentGeneration: 0,
		});
		expect(decision.spawn).toBe(true);
		expect(decision.reason).toContain("no diverse/stronger worker");
	});

	it("does not spawn while an untried escalation still exists", () => {
		const decision = decideReviewRedecompose({
			parkKind: "review_stuck",
			escalationSpent: false,
			escalationAvailable: true,
			parentGeneration: 0,
		});
		expect(decision.spawn).toBe(false);
	});

	it("never spawns for a reviewer no-verdict park (the reviewer failed, not the work)", () => {
		const decision = decideReviewRedecompose({
			parkKind: "no_verdict",
			escalationSpent: true,
			escalationAvailable: false,
			parentGeneration: 0,
		});
		expect(decision.spawn).toBe(false);
		expect(decision.reason).toContain("wrong agent");
	});

	it("stops at the generation cap so a stubborn objective cannot fragment forever", () => {
		const decision = decideReviewRedecompose({
			parkKind: "review_stuck",
			escalationSpent: true,
			escalationAvailable: false,
			parentGeneration: REVIEW_REDECOMPOSE_GENERATION_CAP,
		});
		expect(decision.spawn).toBe(false);
		expect(decision.reason).toContain("Generation cap");
	});
});

describe("summarizeReviewAttemptEvidence", () => {
	const record = (round: number, verdict: "approve" | "request_changes", work: string): ReviewRoundRecord => ({
		round,
		verdict,
		feedbackFingerprint: verdict === "request_changes" ? `fp-${round}` : null,
		workFingerprint: work,
	});

	it("returns null with no change requests, counts rounds and identical-work stalls otherwise", () => {
		expect(summarizeReviewAttemptEvidence([record(1, "approve", "w1")])).toBeNull();
		const evidence = summarizeReviewAttemptEvidence([
			record(1, "request_changes", "w1"),
			record(2, "request_changes", "w1"),
			record(3, "request_changes", "w2"),
		]);
		expect(evidence).toContain("3 review round(s) requested changes");
		expect(evidence).toContain("1 round(s) re-reviewed IDENTICAL work");
	});
});

describe("buildRedecomposeCardPrompt", () => {
	it("carries the FULL situation: objective, plan target, neighbors, concerns, evidence, acceptance, budget", () => {
		const prompt = buildRedecomposeCardPrompt({
			taskTitle: "Build the report exporter",
			taskObjective: "Export weekly safety reports as signed PDFs.",
			boardContext: {
				planObjective: "Construction jobsite safety compliance tracker.",
				dependsOn: [{ title: "Define report schema", column: "completed" }],
				dependedOnBy: [{ title: "Email digest", column: "planning" }],
				siblings: [{ title: "Import inspections", column: "in_progress" }],
			},
			reviewerConcerns: [{ round: 2, timesRaised: 3, feedback: "PDF signing is stubbed out." }],
			attemptEvidence: "4 review round(s) requested changes; 2 round(s) re-reviewed IDENTICAL work.",
			acceptanceSummary: "Acceptance: `npm run verify-pdf` must pass.",
			generation: 1,
		});
		expect(prompt).toContain("decompose_project");
		expect(prompt).toContain("Export weekly safety reports as signed PDFs.");
		expect(prompt).toContain("initial main target");
		expect(prompt).toContain("Construction jobsite safety compliance tracker.");
		expect(prompt).toContain("Define report schema [completed]");
		expect(prompt).toContain("Email digest [planning]");
		expect(prompt).toContain("Import inspections [in_progress]");
		expect(prompt).toContain("(round 2, raised 3×) PDF signing is stubbed out.");
		expect(prompt).toContain("4 review round(s) requested changes");
		expect(prompt).toContain("npm run verify-pdf");
		expect(prompt).toContain("integration card gated on your children");
		expect(prompt).toContain(`generation 1 of ${REVIEW_REDECOMPOSE_GENERATION_CAP}`);
		expect(prompt).toContain("union of the children must cover the WHOLE objective");
		expect(prompt).toContain("name WHICH PART of the objective");
	});

	it("omits situation sections it has no data for, keeping the core split instructions", () => {
		const prompt = buildRedecomposeCardPrompt({
			taskTitle: "Lone card",
			taskObjective: "Do the thing.",
			generation: 2,
		});
		expect(prompt).not.toContain("surrounding board");
		expect(prompt).not.toContain("reviewers rejected");
		expect(prompt).toContain("NO further split after this one");
	});
});

describe("buildIntegrationParentPrompt", () => {
	it("starts with the idempotency marker, lists children, preserves the original objective verbatim", () => {
		const prompt = buildIntegrationParentPrompt({
			originalObjective: "Export weekly safety reports as signed PDFs.",
			childTitles: ["Schema for reports", "PDF renderer", "Signature wiring"],
		});
		expect(prompt.startsWith(INTEGRATION_PARENT_PROMPT_MARKER)).toBe(true);
		expect(prompt).toContain("- Schema for reports");
		expect(prompt).toContain("- PDF renderer");
		expect(prompt).toContain("- Signature wiring");
		expect(prompt).toContain("Export weekly safety reports as signed PDFs.");
		expect(prompt).toContain("do not take completion claims on faith");
	});
});
