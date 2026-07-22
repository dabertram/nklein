import { describe, expect, it } from "vitest";
import { isReviewDeliverySuperseded } from "../../../src/server/review-delivery-supersession";

describe("isReviewDeliverySuperseded", () => {
	it("does not mistake a late busy projection from the admitted turn for a newer round", () => {
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: 7,
				currentTurnGeneration: 7,
				currentSummaryState: "running",
				admittedCommit: "abc",
				currentCommit: "abc",
			}),
		).toBe(false);
	});

	it("rejects a genuinely newer turn before it captures another commit", () => {
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: 7,
				currentTurnGeneration: 8,
				currentSummaryState: "running",
				admittedCommit: "abc",
				currentCommit: "abc",
			}),
		).toBe(true);
	});

	it("rejects a changed artifact and preserves the legacy summary fallback", () => {
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: 7,
				currentTurnGeneration: 7,
				currentSummaryState: "awaiting_review",
				admittedCommit: "abc",
				currentCommit: "def",
			}),
		).toBe(true);
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: null,
				currentTurnGeneration: null,
				currentSummaryState: "running",
				admittedCommit: "abc",
				currentCommit: "abc",
			}),
		).toBe(true);
	});
});
