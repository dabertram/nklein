/**
 * P18.4 — RECOVERY over compaction when a card is off-track. PURE core.
 *
 * The multi-turn failure literature's mechanism is **premature commitment without recovery**: a model decides
 * something wrong early and every later turn is spent elaborating that decision. The operational consequence is
 * sharper than it first sounds:
 *
 *   **Compacting a lost conversation PRESERVES the wrong early commitment.**
 *
 * A summary of a derailed conversation is a faithful, well-written record of the derailment. It carries the bad
 * decision forward in a form that is now shorter, cleaner and more authoritative-looking than the original — and
 * strips the meandering that was the only visible evidence something had gone wrong. **Compaction does not just
 * fail to fix drift; it launders it.**
 *
 * ── THE ASYMMETRY THIS CORE EXISTS TO ENCODE ──
 * A full context window and a derailed card present the SAME symptom — a large, unwieldy conversation — and
 * demand OPPOSITE remedies:
 *  - **on-track and long** → compact. The content is good, there is simply too much of it.
 *  - **off-track and long** → restart with a clean restatement. Compacting here makes the problem permanent.
 * A design that reaches for compaction whenever the context is large will therefore be right about half the time
 * and confidently wrong the rest, in the direction that is hardest to notice afterwards.
 *
 * ── WHY RESTART IS BOUNDED, AND WHY CAPTURED WORK CHANGES THE ANSWER ──
 * Restart discards the conversation. That is the point when the conversation is the problem — but unbounded
 * restarting is a loop that throws away work repeatedly while looking like progress. And when a card has already
 * produced REAL ARTEFACTS, restarting destroys something a reviewer could have judged: a human looking at partial
 * work can often say "this half is right", which no restart can recover. So captured work routes to review/park
 * rather than to a fresh attempt.
 *
 * This is a decision core, not a mechanism: `drift-critic.ts` (F12.92) detects that a card is off-track; this
 * decides what to DO about it. Keeping those separate is why the detector can be improved without renegotiating
 * every remedy.
 */

export type OffTrackRemedy =
	/** Nothing is wrong. Keep going. */
	| "continue"
	/** On track but the window is filling: shed tokens, keep the thread. */
	| "compact_and_continue"
	/** Off track: discard the conversation and re-state the task cleanly. */
	| "restart_with_restatement"
	/** Surface to a human — either the restart budget is spent, or there is work worth judging. */
	| "park";

export interface OffTrackSignals {
	/** From `drift-critic.ts` — is the card still pursuing the task it was given? */
	readonly onTrack: boolean;
	/** Fraction of the effective context window in use, 0..1. */
	readonly contextUtilisation: number;
	/** Restarts already spent on this card. */
	readonly restartsSoFar: number;
	/**
	 * True when the card has produced reviewable artefacts (a result branch, a diff). Restarting destroys them,
	 * and a human can often salvage partial work that no fresh attempt can recover.
	 */
	readonly hasCapturedWork: boolean;
}

export interface OffTrackDecision {
	readonly remedy: OffTrackRemedy;
	readonly reason: string;
}

/** Restarts allowed before the card goes to a human. Unbounded restarting is a loop that looks like progress. */
export const MAX_RESTATEMENT_RESTARTS = 2;
/** Context utilisation above which an ON-TRACK card is worth compacting. */
export const COMPACTION_UTILISATION = 0.75;

/**
 * Choose the remedy for a possibly-off-track card.
 *
 * The ordering is deliberate: **off-track is checked BEFORE context pressure**, so a derailed card can never fall
 * into the compaction branch on its way past. Checking pressure first would silently make compaction the default
 * for exactly the cards it harms most, since a derailed card is usually also a long one.
 */
export function decideOffTrackRemedy(signals: OffTrackSignals): OffTrackDecision {
	const utilisation = Number.isFinite(signals.contextUtilisation) ? signals.contextUtilisation : 0;

	if (!signals.onTrack) {
		// Off track. Compaction is not on the menu at all — see the docblock.
		if (signals.hasCapturedWork) {
			return {
				remedy: "park",
				reason:
					"off track BUT the card has produced reviewable work — restarting would destroy artefacts a human could judge, and a person can often salvage a half-right diff that no fresh attempt recovers",
			};
		}
		if (signals.restartsSoFar >= MAX_RESTATEMENT_RESTARTS) {
			return {
				remedy: "park",
				reason: `off track and the restart budget (${MAX_RESTATEMENT_RESTARTS}) is spent — further restarts would be a loop that discards work while looking like progress`,
			};
		}
		return {
			remedy: "restart_with_restatement",
			reason: `off track with no captured work (restart ${signals.restartsSoFar + 1}/${MAX_RESTATEMENT_RESTARTS}) — discard the conversation and re-state the task. COMPACTION IS WRONG HERE: a summary of a derailed conversation preserves the bad commitment in a shorter, cleaner, more authoritative form and strips the meandering that was the only evidence anything went wrong`,
		};
	}

	if (utilisation >= COMPACTION_UTILISATION) {
		return {
			remedy: "compact_and_continue",
			reason: `on track at ${(utilisation * 100).toFixed(0)}% context — the content is good, there is simply too much of it, so shed tokens and keep the thread`,
		};
	}

	return {
		remedy: "continue",
		reason: `on track at ${(utilisation * 100).toFixed(0)}% context — nothing to intervene on`,
	};
}

/**
 * Does this remedy discard the conversation? Useful for callers that must snapshot before acting.
 *
 * Exposed rather than left to a caller's `=== "restart_with_restatement"` check: a later remedy that also
 * discards would silently miss such a check at every call site, and the failure would be lost work.
 */
export function discardsConversation(remedy: OffTrackRemedy): boolean {
	return remedy === "restart_with_restatement";
}
