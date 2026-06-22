/**
 * Second-opinion review loop decision core.
 *
 * Every worker card that reaches Review gets a second-opinion pass from the reviewer role (potentially a
 * different local model). The reviewer returns a structured verdict; this pure function decides what happens
 * next — deliver (approved), bounce back to the worker with the feedback, or park for the human. Bouncing back
 * is a normal part of the flow (like a human dev team's review), bounded by a generous round limit plus
 * **stall** and **identical-loop** detection so a weak model can't ping-pong forever:
 *
 *  - **round limit** — after `maxRounds` change requests without approval, park.
 *  - **stall** — the worker produced no change since the previous review round, so re-reviewing is pointless.
 *  - **identical loop** — the same feedback on the same unchanged work as an earlier round (the model is stuck).
 *
 * Keeping this pure makes the loop's escape conditions unit-testable without a live model or board.
 */

export type ReviewVerdict = "approve" | "request_changes";

/** Default generous round cap; the stall/identical-loop guards usually trip well before this. */
export const DEFAULT_MAX_REVIEW_ROUNDS = 20;

export interface ReviewRoundRecord {
	/** 1-based review round this record describes. */
	round: number;
	verdict: ReviewVerdict;
	/** Hash of the reviewer's change-request feedback (null for an approval / no feedback). */
	feedbackFingerprint: string | null;
	/** Hash of the worker output (diff) that was reviewed this round (null when unknown). */
	workFingerprint: string | null;
}

export type ReviewLoopAction =
	/** Approved — proceed to delivery (commit/PR) with the reviewer's sign-off. */
	| { action: "deliver"; reason: string }
	/** Changes requested and progress is still possible — send back to the worker with the feedback. */
	| { action: "bounce_to_worker"; reason: string }
	/** Stop the loop and park for the human (round limit, stall, or identical loop). */
	| { action: "park"; reason: string };

export interface DecideReviewLoopInput {
	verdict: ReviewVerdict;
	/** 1-based current review round (the round that just produced `verdict`). */
	round: number;
	/** Round cap before parking; defaults to {@link DEFAULT_MAX_REVIEW_ROUNDS}. */
	maxRounds?: number;
	/** Fingerprint of the current round's change-request feedback (null for an approval). */
	feedbackFingerprint: string | null;
	/** Fingerprint of the worker output reviewed this round. */
	workFingerprint: string | null;
	/** Prior review rounds for this card, oldest first. */
	history: readonly ReviewRoundRecord[];
}

export function decideReviewLoopAction(input: DecideReviewLoopInput): ReviewLoopAction {
	if (input.verdict === "approve") {
		return { action: "deliver", reason: "Reviewer approved the work." };
	}
	const maxRounds = input.maxRounds ?? DEFAULT_MAX_REVIEW_ROUNDS;

	// Identical loop: the same change request on the same unchanged work as an earlier round.
	if (input.workFingerprint !== null && input.feedbackFingerprint !== null) {
		const identical = input.history.some(
			(record) =>
				record.verdict === "request_changes" &&
				record.feedbackFingerprint === input.feedbackFingerprint &&
				record.workFingerprint === input.workFingerprint,
		);
		if (identical) {
			return {
				action: "park",
				reason: "Review is looping: the same change request on unchanged work. Parking for a human.",
			};
		}
	}

	// Stall: the worker produced no change since the previous review round.
	const previous = input.history.at(-1);
	if (previous && input.workFingerprint !== null && previous.workFingerprint === input.workFingerprint) {
		return {
			action: "park",
			reason: "Review stalled: the worker made no changes after the last review. Parking for a human.",
		};
	}

	// Round limit.
	if (input.round >= maxRounds) {
		return {
			action: "park",
			reason: `Reached the review round limit (${maxRounds}) without approval. Parking for a human.`,
		};
	}

	return {
		action: "bounce_to_worker",
		reason: "Reviewer requested changes; sending the card back to the worker with the feedback.",
	};
}
