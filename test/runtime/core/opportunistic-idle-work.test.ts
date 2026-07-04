import { describe, expect, it } from "vitest";
import { decideOpportunisticIdleWork, findReviewCandidateTaskIds } from "../../../src/core/opportunistic-idle-work";

const board = (reviewCardIds: string[]) => ({
	columns: [
		{ id: "in_progress", cards: [{ id: "running-1" }] },
		{ id: "review", cards: reviewCardIds.map((id) => ({ id })) },
		{ id: "completed", cards: [{ id: "done-1" }] },
	],
});

describe("findReviewCandidateTaskIds", () => {
	it("returns review-lane card ids not already dispatched", () => {
		expect(findReviewCandidateTaskIds(board(["r1", "r2", "r3"]), new Set(["r2"]))).toEqual(["r1", "r3"]);
	});

	it("empty when there is no review lane or it is empty", () => {
		expect(findReviewCandidateTaskIds({ columns: [{ id: "backlog", cards: [] }] }, new Set())).toEqual([]);
		expect(findReviewCandidateTaskIds(board([]), new Set())).toEqual([]);
	});
});

describe("decideOpportunisticIdleWork", () => {
	it("HARD veto: real queued/active work suppresses all opportunistic work, even with review candidates", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: true,
			reviewCandidateTaskIds: ["card-1"],
		});
		expect(decision.verdict.chosen).toBeNull();
		expect(decision.reviewTaskId).toBeNull();
		expect(decision.verdict.reason).toMatch(/vetoed/i);
	});

	it("idle + a review candidate ⇒ chooses review and targets the first candidate", () => {
		const decision = decideOpportunisticIdleWork({
			hasRealQueuedWork: false,
			reviewCandidateTaskIds: ["card-1", "card-2"],
		});
		expect(decision.verdict.chosen).toBe("review");
		expect(decision.reviewTaskId).toBe("card-1");
	});

	it("idle with nothing available ⇒ null (the other 4 pickers have no producer yet)", () => {
		const decision = decideOpportunisticIdleWork({ hasRealQueuedWork: false, reviewCandidateTaskIds: [] });
		expect(decision.verdict.chosen).toBeNull();
		expect(decision.reviewTaskId).toBeNull();
	});
});
