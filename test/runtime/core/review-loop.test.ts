import { describe, expect, it } from "vitest";
import {
	DEFAULT_MAX_REVIEW_ROUNDS,
	decideReviewLoopAction,
	type ReviewRoundRecord,
} from "../../../src/core/review-loop";

function record(overrides: Partial<ReviewRoundRecord> = {}): ReviewRoundRecord {
	return {
		round: 1,
		verdict: "request_changes",
		feedbackFingerprint: "fb-1",
		workFingerprint: "work-1",
		...overrides,
	};
}

describe("decideReviewLoopAction", () => {
	it("delivers on approval regardless of round", () => {
		expect(
			decideReviewLoopAction({
				verdict: "approve",
				round: 5,
				feedbackFingerprint: null,
				workFingerprint: "work-9",
				history: [],
			}).action,
		).toBe("deliver");
	});

	it("bounces back to the worker on the first change request", () => {
		const result = decideReviewLoopAction({
			verdict: "request_changes",
			round: 1,
			feedbackFingerprint: "fb-1",
			workFingerprint: "work-1",
			history: [],
		});
		expect(result.action).toBe("bounce_to_worker");
	});

	it("bounces repeatedly while the work keeps changing", () => {
		const history: ReviewRoundRecord[] = [
			record({ round: 1, feedbackFingerprint: "fb-1", workFingerprint: "work-1" }),
		];
		const result = decideReviewLoopAction({
			verdict: "request_changes",
			round: 2,
			feedbackFingerprint: "fb-2",
			workFingerprint: "work-2",
			history,
		});
		expect(result.action).toBe("bounce_to_worker");
	});

	it("parks on an identical loop (same feedback on unchanged work)", () => {
		const history: ReviewRoundRecord[] = [
			record({ round: 1, feedbackFingerprint: "fb-x", workFingerprint: "work-x" }),
			record({ round: 2, feedbackFingerprint: "fb-y", workFingerprint: "work-y" }),
		];
		const result = decideReviewLoopAction({
			verdict: "request_changes",
			round: 3,
			feedbackFingerprint: "fb-x",
			workFingerprint: "work-x",
			history,
		});
		expect(result.action).toBe("park");
		expect(result.reason).toMatch(/looping/i);
	});

	it("parks on a stall (worker made no change since the last review)", () => {
		const history: ReviewRoundRecord[] = [
			record({ round: 1, feedbackFingerprint: "fb-1", workFingerprint: "work-1" }),
		];
		const result = decideReviewLoopAction({
			verdict: "request_changes",
			round: 2,
			feedbackFingerprint: "fb-2-different",
			workFingerprint: "work-1", // unchanged from the previous round
			history,
		});
		expect(result.action).toBe("park");
		expect(result.reason).toMatch(/stalled/i);
	});

	it("parks once the round limit is reached with changing work", () => {
		const history: ReviewRoundRecord[] = Array.from({ length: DEFAULT_MAX_REVIEW_ROUNDS - 1 }, (_, index) =>
			record({ round: index + 1, feedbackFingerprint: `fb-${index}`, workFingerprint: `work-${index}` }),
		);
		const result = decideReviewLoopAction({
			verdict: "request_changes",
			round: DEFAULT_MAX_REVIEW_ROUNDS,
			feedbackFingerprint: `fb-${DEFAULT_MAX_REVIEW_ROUNDS}`,
			workFingerprint: `work-${DEFAULT_MAX_REVIEW_ROUNDS}`,
			history,
		});
		expect(result.action).toBe("park");
		expect(result.reason).toMatch(/round limit/i);
	});

	it("does not false-trip stall/identical guards when fingerprints are unknown (null)", () => {
		const history: ReviewRoundRecord[] = [record({ round: 1, feedbackFingerprint: null, workFingerprint: null })];
		const result = decideReviewLoopAction({
			verdict: "request_changes",
			round: 2,
			feedbackFingerprint: null,
			workFingerprint: null,
			history,
		});
		expect(result.action).toBe("bounce_to_worker");
	});

	it("respects a custom maxRounds", () => {
		const result = decideReviewLoopAction({
			verdict: "request_changes",
			round: 2,
			maxRounds: 2,
			feedbackFingerprint: "fb-2",
			workFingerprint: "work-2",
			history: [record({ round: 1, feedbackFingerprint: "fb-1", workFingerprint: "work-1" })],
		});
		expect(result.action).toBe("park");
	});
});
