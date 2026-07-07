import { describe, expect, it } from "vitest";
import { type AutoReviewCardRecord, decideAutoReviewCardAction } from "../../../src/server/auto-review-card-decision";

const record = (columnId: string, card: AutoReviewCardRecord["card"]): AutoReviewCardRecord => ({ columnId, card });
const autoCommit = { autoReviewEnabled: true, autoReviewMode: "commit" };

describe("decideAutoReviewCardAction", () => {
	it("skips entirely (no auto-complete, no move) for a missing card", () => {
		expect(decideAutoReviewCardAction(undefined)).toEqual({ shouldAutoComplete: false, moveToReview: false });
	});

	it("skips an already-completed card regardless of its auto-review flags", () => {
		expect(decideAutoReviewCardAction(record("completed", autoCommit))).toEqual({
			shouldAutoComplete: false,
			moveToReview: false,
		});
	});

	it("skips a plan-mode card (planning is not an auto-completable work card)", () => {
		expect(decideAutoReviewCardAction(record("in_progress", { ...autoCommit, startInPlanMode: true }))).toEqual({
			shouldAutoComplete: false,
			moveToReview: false,
		});
	});

	it("a card already in review is auto-completable but is NOT moved again", () => {
		expect(decideAutoReviewCardAction(record("review", autoCommit))).toEqual({
			shouldAutoComplete: true,
			moveToReview: false,
		});
	});

	it("a work card in another lane is auto-completable AND moved into review", () => {
		expect(decideAutoReviewCardAction(record("in_progress", autoCommit))).toEqual({
			shouldAutoComplete: true,
			moveToReview: true,
		});
	});

	it("defaults a missing autoReviewMode to 'commit' (so an enabled card auto-completes)", () => {
		expect(decideAutoReviewCardAction(record("in_progress", { autoReviewEnabled: true })).shouldAutoComplete).toBe(
			true,
		);
	});

	it("is NOT auto-completable when auto-review is off or the mode is not 'commit' — but still moves to review", () => {
		expect(decideAutoReviewCardAction(record("in_progress", { autoReviewEnabled: false }))).toEqual({
			shouldAutoComplete: false,
			moveToReview: true,
		});
		expect(
			decideAutoReviewCardAction(record("in_progress", { autoReviewEnabled: true, autoReviewMode: "ask" })),
		).toEqual({ shouldAutoComplete: false, moveToReview: true });
	});
});
