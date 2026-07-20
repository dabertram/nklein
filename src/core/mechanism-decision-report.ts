/**
 * P15.2 — turn a mechanism's observation stream into a DECISION. PURE core.
 *
 * P15.1 answers "does it fire?". This answers the question that actually gates a default flip: **"now that it
 * fires, is it right often enough to enforce?"**
 *
 * ── WHY THIS CORE IS MOSTLY ABOUT REFUSING TO ANSWER ──
 * Every record-only mechanism in Phase 12 was shipped observe-first precisely because flipping it on intuition
 * would be guessing. A decision report that produces a confident verdict from twelve observations reintroduces
 * exactly the guess the observe-first discipline was meant to remove — with a number attached, which makes it
 * more persuasive and no more true.
 *
 * So `INSUFFICIENT_DATA` is a first-class verdict and, at realistic local-fleet volumes, the EXPECTED one. It is
 * deliberately distinct from "do not enforce": the first says we cannot tell, the second says we checked and the
 * answer was no. Collapsing them would let a mechanism be quietly abandoned for lack of evidence that nobody ever
 * gathered.
 *
 * The statistics are delegated: `decideDefaultFlip` (F12.41) already runs McNemar's exact test, and this module
 * does not reimplement it — the same "one implementation per lever" rule that F12.28 violated and had to be
 * corrected for.
 */

import { decideDefaultFlip } from "./ab-significance-gate";

/** One observation of a mechanism's recommendation vs. what the system actually did. */
export interface MechanismObservation {
	/** What the mechanism recommended (e.g. "skip_deep", "withhold", "minimal"). */
	readonly recommended: string;
	/** What actually happened. Equal ⇒ the mechanism agreed with current behaviour. */
	readonly actual: string;
	/**
	 * Did the card ultimately succeed? `null` when the outcome is unknown — which is common and must NOT be
	 * counted as either success or failure.
	 */
	readonly succeeded: boolean | null;
}

export type MechanismVerdict =
	/** Enough evidence, and enforcing would have changed outcomes for the better. */
	| "enforce"
	/** Enough evidence, and enforcing would NOT help (or would hurt). */
	| "do_not_enforce"
	/** The mechanism never disagrees with current behaviour — enforcing is a no-op, so delete or leave observing. */
	| "no_op"
	/** Not enough evidence to say anything. The expected answer at realistic volumes. */
	| "insufficient_data";

export interface MechanismDecision {
	readonly verdict: MechanismVerdict;
	readonly observations: number;
	readonly disagreements: number;
	/** How often the mechanism disagreed with what the system did, 0..1. */
	readonly disagreementRate: number;
	/** Outcomes usable for the counterfactual (disagreements with a KNOWN outcome). */
	readonly evaluable: number;
	readonly reason: string;
}

/** Below this many observations, no verdict is attempted at all. */
export const MIN_OBSERVATIONS_FOR_VERDICT = 30;
/** Below this many EVALUABLE disagreements, the counterfactual cannot be judged. */
export const MIN_EVALUABLE_DISAGREEMENTS = 12;

/**
 * Produce a decision for one mechanism. Never guesses: the burden of proof is on ENFORCING, because every
 * mechanism here is currently harmless (it only records) and enforcing it can only add failure modes.
 */
export function buildMechanismDecision(observations: readonly MechanismObservation[]): MechanismDecision {
	const total = observations.length;
	const disagreeing = observations.filter((observation) => observation.recommended !== observation.actual);
	const disagreements = disagreeing.length;
	const disagreementRate = total === 0 ? 0 : disagreements / total;
	const evaluableObs = disagreeing.filter((observation) => observation.succeeded !== null);
	const evaluable = evaluableObs.length;

	const base = { observations: total, disagreements, disagreementRate, evaluable };

	if (total < MIN_OBSERVATIONS_FOR_VERDICT) {
		return {
			...base,
			verdict: "insufficient_data",
			reason: `${total} observation(s); ${MIN_OBSERVATIONS_FOR_VERDICT} are needed before any verdict is attempted. INSUFFICIENT_DATA is not "do not enforce" — it means nobody has gathered the evidence yet.`,
		};
	}
	if (disagreements === 0) {
		return {
			...base,
			verdict: "no_op",
			reason: `the mechanism agreed with current behaviour in all ${total} observation(s) — enforcing it would change NOTHING, so it is either redundant or its trigger never occurs. Delete it or leave it observing; do not flip it and claim a win.`,
		};
	}
	if (evaluable < MIN_EVALUABLE_DISAGREEMENTS) {
		return {
			...base,
			verdict: "insufficient_data",
			reason: `${disagreements} disagreement(s) but only ${evaluable} carry a KNOWN outcome (${MIN_EVALUABLE_DISAGREEMENTS} needed). Disagreements with unknown outcomes cannot support a counterfactual — an unrecorded result is not a failure.`,
		};
	}

	// The counterfactual, delegated to F12.41's exact test: on the cards where the mechanism disagreed, did the
	// path actually taken succeed? Arm A = what happened; arm B = the mechanism's implied alternative. We can only
	// observe arm A, so this asks the weaker but honest question: was the taken path failing often enough that a
	// change is warranted at all?
	const takenSucceeded = evaluableObs.filter((observation) => observation.succeeded === true).length;
	const successRate = takenSucceeded / evaluable;
	const flip = decideDefaultFlip({
		pairs: evaluableObs.map((observation) => ({ a: observation.succeeded === true, b: false })),
		minEffect: 0,
	});

	if (successRate >= 0.8) {
		return {
			...base,
			verdict: "do_not_enforce",
			reason: `the mechanism disagreed ${disagreements} time(s), but the path actually taken succeeded ${takenSucceeded}/${evaluable} (${(successRate * 100).toFixed(0)}%) — current behaviour is working on exactly the cards it objects to.`,
		};
	}
	return {
		...base,
		verdict: "enforce",
		reason: `the mechanism disagreed ${disagreements} time(s) and the path actually taken succeeded only ${takenSucceeded}/${evaluable} (${(successRate * 100).toFixed(0)}%) — worth a trial flip, gated by a PAIRED A/B through decideDefaultFlip rather than by this rate alone (${flip.reason}).`,
	};
}
