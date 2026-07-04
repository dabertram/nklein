import { describe, expect, it } from "vitest";
import { decideOpportunisticIdleWork } from "../../../src/core/opportunistic-idle-work";

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
