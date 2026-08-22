/**
 * Operator redrive of a PARKED review card — the missing terminal-to-work transition (David 2026-08-22).
 *
 * WHAT: the review loop parks a card when its remedy ladder is spent; a park is deliberately terminal
 * ("parked/held = the operator's decision", board-liveness watchdog). But the product had NO action that turns
 * that decision back into work: the recovery panel offers verify / merge / mark-interrupted / evidence, the
 * durable scheduler's resurrect fires only for `dependency_failed` cancellations whose dependencies later
 * succeeded, and `startTask` refuses a start from the review lane. So a resumed board with parked cards could
 * only be released by hand-editing board.json — live-hit on the resume-02 board where THREE parked cards dam
 * seventeen planning cards behind them.
 *
 * WHY a decision core: the eligibility rule and the brief are the whole substance, and both must be testable
 * without a runtime. The brief matters as much as the transition — a redrive that drops the reviewer's own
 * words repeats the attempt that just failed. The park already carries the reviewer's verdict text
 * (`lastSummary` / `lastFeedback` / `parkedReason`); this composes it into a self-contained re-work brief in
 * the same shape as the review bounce: what the reviewer said, what the objective is, what the bar is, and the
 * honest note that earlier rounds are the reason this card is being sent back.
 *
 * PURE / TOTAL / DETERMINISTIC: plain values in, verdict + brief out. No clock, no I/O, no board types.
 */

/** The review facts a redrive decision needs — a projection of the card's `review` record. */
export interface OperatorRedriveReviewFacts {
	status: "in_review" | "changes_requested" | "approved" | "parked";
	round: number;
	lastVerdict: string | null;
	lastSummary: string | null;
	lastFeedback: string | null;
	parkedReason: string | null;
}

export interface OperatorRedriveInput {
	/** The lane the card sits in right now. */
	columnId: string;
	/** Null when the card was never reviewed. */
	review: OperatorRedriveReviewFacts | null;
	/** The card's objective — restated in the brief so the next attempt never works from feedback alone. */
	objective: string;
	/** Plan-mode cards resume in planning; everything else resumes in backlog for a normal start. */
	startInPlanMode: boolean;
	/** Optional operator direction, placed FIRST — it outranks the reviewer's text by construction. */
	operatorNote?: string | null;
	/** Acceptance command, when the project declares one. */
	acceptanceCommand?: string | null;
}

export type OperatorRedriveDecision =
	| { redrive: false; reason: string }
	| {
			redrive: true;
			reason: string;
			/** Lane the card returns to so the ordinary start path can take it. */
			targetColumnId: "backlog" | "planning";
			/** Self-contained re-work brief for the next attempt. */
			brief: string;
	  };

function trimmed(value: string | null | undefined): string {
	return (value ?? "").trim();
}

/**
 * Decide whether an operator may send this card back to work, and write the brief that goes with it.
 *
 * Refusals are deliberately narrow: only a PARKED card in the review lane qualifies. A card still in review
 * (`in_review`) has a live loop that would race the redrive; `approved` belongs to merge, not re-work; and a
 * card outside the review lane is already startable through the ordinary path.
 */
export function decideOperatorRedrive(input: OperatorRedriveInput): OperatorRedriveDecision {
	if (input.columnId !== "review") {
		return { redrive: false, reason: `card is in "${input.columnId}", not the review lane — start it normally` };
	}
	if (!input.review) {
		return { redrive: false, reason: "card has no review record — nothing was parked" };
	}
	if (input.review.status !== "parked") {
		return {
			redrive: false,
			reason:
				input.review.status === "in_review"
					? "review is still running — cancel or let it finish before redriving"
					: `review status is "${input.review.status}", not parked`,
		};
	}

	const operatorNote = trimmed(input.operatorNote);
	const summary = trimmed(input.review.lastSummary);
	const feedback = trimmed(input.review.lastFeedback);
	const parkedReason = trimmed(input.review.parkedReason);
	const acceptance = trimmed(input.acceptanceCommand);

	const sections: string[] = [];
	sections.push(`[Operator redrive — round ${input.review.round} parked this card; you are being sent back to it]`);
	if (operatorNote) {
		sections.push(`OPERATOR DIRECTION (outranks everything below):\n${operatorNote}`);
	}
	if (parkedReason) {
		sections.push(`WHY THE LOOP PARKED:\n${parkedReason}`);
	}
	// The reviewer's own words carry the specifics; without them a redrive repeats the failed attempt.
	if (summary || feedback) {
		sections.push(
			`WHAT THE LAST REVIEW SAID (verdict: ${input.review.lastVerdict ?? "unknown"}):\n${[summary, feedback]
				.filter(Boolean)
				.join("\n\n")}`,
		);
	} else {
		// Honest absence: a silent redrive that implies "no concerns" would misrepresent the park.
		sections.push(
			"WHAT THE LAST REVIEW SAID: no verdict text was recorded for this park — treat the objective below as the whole specification and verify every element yourself.",
		);
	}
	sections.push(`THE OBJECTIVE (unchanged):\n${trimmed(input.objective)}`);
	sections.push(
		acceptance
			? `THE BAR: the work is done when the objective is fully implemented and \`${acceptance}\` passes.`
			: "THE BAR: the work is done when every element of the objective is implemented and verified.",
	);

	return {
		redrive: true,
		reason: `parked at round ${input.review.round} (${input.review.lastVerdict ?? "no verdict"}) — returning to ${
			input.startInPlanMode ? "planning" : "backlog"
		}`,
		targetColumnId: input.startInPlanMode ? "planning" : "backlog",
		brief: sections.join("\n\n"),
	};
}
