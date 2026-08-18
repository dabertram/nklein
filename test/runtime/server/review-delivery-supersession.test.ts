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

	it("rejects a changed artifact and preserves the legacy summary fallback for an unknown artifact", () => {
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: 7,
				currentTurnGeneration: 7,
				currentSummaryState: "awaiting_review",
				admittedCommit: "abc",
				currentCommit: "def",
			}),
		).toBe(true);
		// Artifact unknown (no admitted commit): the busy-summary fallback stays conservative.
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: null,
				currentTurnGeneration: null,
				currentSummaryState: "running",
				admittedCommit: null,
				currentCommit: null,
			}),
		).toBe(true);
	});

	it("never supersedes an identical artifact (dead-session rescue restart, completed-without-merge 2026-08-18)", () => {
		// Bed runs 195608/212433: the worker session died, the watchdog rescued the card, and a rescue
		// restart projected a busy state with a null admitted generation — the fallback discarded an
		// APPROVED delivery whose result commit was byte-identical to the one under delivery.
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: null,
				currentTurnGeneration: null,
				currentSummaryState: "running",
				admittedCommit: "abc",
				currentCommit: "abc",
			}),
		).toBe(false);
		// A MEASURED generation advance keeps its authority even on an unchanged commit (its capture is
		// inbound) — the same-artifact override applies only to the unattributable busy-state fallback.
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: 7,
				currentTurnGeneration: 9,
				currentSummaryState: "running",
				admittedCommit: "abc",
				currentCommit: "abc",
			}),
		).toBe(true);
		// A genuinely newer artifact still supersedes regardless of session state.
		expect(
			isReviewDeliverySuperseded({
				admittedTurnGeneration: null,
				currentTurnGeneration: null,
				currentSummaryState: "idle",
				admittedCommit: "abc",
				currentCommit: "def",
			}),
		).toBe(true);
	});
});
