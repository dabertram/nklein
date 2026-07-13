import type { EscalationSuggestionKind } from "./escalation-suggestions.js";

/**
 * F2.18 — map a hard-stuck escalation suggestion to the RESUME ACTION the operator takes, and pin the contract
 * that taking it re-enters the card's EXACT suspended state rather than restarting. A stuck card is PARKED with
 * its result branch intact; the redrive path resumes from that branch (it checks the branch out again), so an
 * approved suggestion continues the attempt instead of throwing away the work done so far.
 *
 * Three resume modes:
 *   - `direct_redrive`   — the operator's approval IS the unblock (the blocked action is now allowed, or a more
 *     capable model is now loaded); the card can redrive immediately, resuming its suspended state.
 *   - `input_then_redrive` — the operator must first supply something (an answer, context, a relaxed
 *     constraint) that gets threaded into the card, THEN the redrive resumes with that input in hand.
 *   - `manual` — no in-app resume: the fix lives outside the card (re-scope/split spawns new cards; a fresh
 *     environment fix may need a manual restart). The suggestion is advice, not a one-click resume.
 * Pure + total.
 */

export type EscalationResumeMode = "direct_redrive" | "input_then_redrive" | "manual";

export interface EscalationResumeAction {
	kind: EscalationSuggestionKind;
	mode: EscalationResumeMode;
	/** The action-button label the panel renders (null when `manual` — no in-app button). */
	actionLabel: string | null;
	/** True when taking the action resumes the card's EXACT suspended state (its parked result branch). */
	resumesSuspendedState: boolean;
	/** What the operator must provide first (only for `input_then_redrive`). */
	requiresInput: "answer" | "context" | "constraint" | null;
}

const RESUME_ACTIONS: Record<EscalationSuggestionKind, EscalationResumeAction> = {
	clarify_ambiguity: {
		kind: "clarify_ambiguity",
		mode: "input_then_redrive",
		actionLabel: "Answer & resume",
		resumesSuspendedState: true,
		requiresInput: "answer",
	},
	provide_context: {
		kind: "provide_context",
		mode: "input_then_redrive",
		actionLabel: "Add context & resume",
		resumesSuspendedState: true,
		requiresInput: "context",
	},
	adjust_constraints: {
		kind: "adjust_constraints",
		mode: "input_then_redrive",
		actionLabel: "Adjust & resume",
		resumesSuspendedState: true,
		requiresInput: "constraint",
	},
	approve_blocked_action: {
		kind: "approve_blocked_action",
		mode: "direct_redrive",
		actionLabel: "Approve & resume",
		resumesSuspendedState: true,
		requiresInput: null,
	},
	provide_more_capable_model: {
		kind: "provide_more_capable_model",
		mode: "direct_redrive",
		actionLabel: "Resume with the new model",
		resumesSuspendedState: true,
		requiresInput: null,
	},
	fix_environment: {
		kind: "fix_environment",
		// The fix is outside the card, but once done the SAME parked card can redrive — offer the resume.
		mode: "direct_redrive",
		actionLabel: "Retry after fixing",
		resumesSuspendedState: true,
		requiresInput: null,
	},
	rescope_or_split: {
		kind: "rescope_or_split",
		// Re-scoping produces NEW cards — there is no single suspended state to resume; this is genuinely manual.
		mode: "manual",
		actionLabel: null,
		resumesSuspendedState: false,
		requiresInput: null,
	},
};

/** The resume action for a suggestion kind. Pure lookup. */
export function describeEscalationResumeAction(kind: EscalationSuggestionKind): EscalationResumeAction {
	return RESUME_ACTIONS[kind];
}

/** Whether a suggestion offers an in-app resume button (everything except the manual `rescope_or_split`). */
export function isResumableEscalation(kind: EscalationSuggestionKind): boolean {
	return RESUME_ACTIONS[kind].mode !== "manual";
}
