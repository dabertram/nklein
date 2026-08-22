import { describe, expect, it } from "vitest";
import { decideOperatorRedrive } from "../../../src/core/operator-redrive";

const parkedReview = {
	status: "parked" as const,
	round: 3,
	lastVerdict: "request_changes",
	lastSummary: "Card marked complete with zero file changes — both required files are missing.",
	lastFeedback: "src/incidents.ts is missing entirely. Must contain Incident, Injury, …",
	parkedReason: "same change request on unchanged work",
};

describe("decideOperatorRedrive", () => {
	it("redrives a parked review card with a brief that carries the reviewer's own words", () => {
		const decision = decideOperatorRedrive({
			columnId: "review",
			review: parkedReview,
			objective: "Implement incident types and classification.",
			startInPlanMode: false,
			acceptanceCommand: "npm test",
		});
		expect(decision.redrive).toBe(true);
		if (!decision.redrive) return;
		expect(decision.targetColumnId).toBe("backlog");
		expect(decision.brief).toContain("round 3 parked this card");
		expect(decision.brief).toContain("zero file changes");
		expect(decision.brief).toContain("src/incidents.ts is missing");
		expect(decision.brief).toContain("same change request on unchanged work");
		expect(decision.brief).toContain("Implement incident types and classification.");
		expect(decision.brief).toContain("`npm test` passes");
	});

	it("puts operator direction FIRST, above the reviewer text", () => {
		const decision = decideOperatorRedrive({
			columnId: "review",
			review: parkedReview,
			objective: "Objective.",
			startInPlanMode: false,
			operatorNote: "Only build src/incidents.ts this round; skip the log-300 half.",
		});
		expect(decision.redrive).toBe(true);
		if (!decision.redrive) return;
		const operatorIndex = decision.brief.indexOf("Only build src/incidents.ts");
		const reviewerIndex = decision.brief.indexOf("zero file changes");
		expect(operatorIndex).toBeGreaterThan(-1);
		expect(reviewerIndex).toBeGreaterThan(operatorIndex);
	});

	it("says so honestly when the park carried no verdict text, instead of implying no concerns", () => {
		const decision = decideOperatorRedrive({
			columnId: "review",
			review: { ...parkedReview, lastSummary: null, lastFeedback: null, parkedReason: null },
			objective: "Objective.",
			startInPlanMode: false,
		});
		expect(decision.redrive).toBe(true);
		if (!decision.redrive) return;
		expect(decision.brief).toContain("no verdict text was recorded");
	});

	it("plan-mode cards return to planning; others to backlog", () => {
		const planDecision = decideOperatorRedrive({
			columnId: "review",
			review: parkedReview,
			objective: "O",
			startInPlanMode: true,
		});
		expect(planDecision.redrive && planDecision.targetColumnId).toBe("planning");
	});

	it("refuses a live review, an approved card, a reviewless card, and a card outside the review lane", () => {
		expect(
			decideOperatorRedrive({
				columnId: "review",
				review: { ...parkedReview, status: "in_review" },
				objective: "O",
				startInPlanMode: false,
			}).redrive,
		).toBe(false);
		expect(
			decideOperatorRedrive({
				columnId: "review",
				review: { ...parkedReview, status: "approved" },
				objective: "O",
				startInPlanMode: false,
			}).redrive,
		).toBe(false);
		expect(
			decideOperatorRedrive({ columnId: "review", review: null, objective: "O", startInPlanMode: false }).redrive,
		).toBe(false);
		expect(
			decideOperatorRedrive({
				columnId: "in_progress",
				review: parkedReview,
				objective: "O",
				startInPlanMode: false,
			}).redrive,
		).toBe(false);
	});
});
