/**
 * P20.3b — fold a no-op ablation verdict into card acceptance.
 *
 * The measurement (`assessNoOpAblation`) answers "do this card's tests actually measure the artifact it
 * changed?". This is the pure half that decides what acceptance DOES with that answer, in the same shape as the
 * other acceptance folds in `delivery-evidence.ts`: a null input means the check could not run, and it never
 * becomes a false green.
 *
 * ── WHY `decorative` HOLDS RATHER THAN REJECTS ──
 * A `decorative` verdict says the card's tests passed with the artifact stubbed — the strongest available signal
 * that a card's tests do not measure its own change. It is also the verdict most able to be WRONG for a reason
 * that has nothing to do with the card: an artifact exercised only indirectly (through a barrel re-export, a
 * caller, a fixture) can be genuinely covered while a path-scoped ablation sees nothing break. That exact
 * false-negative was found in this repo's own sweep, where twelve modules read as untested purely because no
 * test named their path.
 *
 * So `decorative` HOLDS the card with the indifferent tests named, for a human to confirm or dismiss. It does
 * not auto-reject, because the cost of a wrong reject is a blocked card plus a developer who learns to distrust
 * the gate — and a gate nobody trusts is worse than no gate.
 *
 * ── WHY MISSING EVIDENCE NEVER HOLDS ──
 * `inconclusive` and a null assessment both mean the ablation produced no comparable evidence — a stub that
 * broke collection, a suite already red at baseline, a run that never happened. Holding on those would punish
 * cards for the harness's own gaps, which is the false accusation this measurement's asymmetry exists to
 * prevent, pointed at the card instead of at the code.
 */

import type { AblationAssessment } from "./no-op-ablation";

export type AblationAcceptanceStatus =
	/** The stub broke baseline-green tests: the card's tests measure what it changed. */
	| "supported"
	/** No comparable evidence. Never a pass, never a hold. */
	| "unmeasured"
	/** The suite passed WITHOUT the artifact — the card's tests may not measure its change. */
	| "suspect";

export interface AblationAcceptanceEvidence {
	readonly status: AblationAcceptanceStatus;
	/** True ONLY for a load-bearing run. Absence of evidence is never recorded as evidence. */
	readonly testsMeasureTheChange: boolean;
	/** True only for `suspect`. Missing evidence must not block a card. */
	readonly holdsAcceptance: boolean;
	/** What to tell the reviewer — for `suspect`, what to check. */
	readonly detail: string;
	/** For `suspect`: the tests that passed with AND without the artifact. The actionable list. */
	readonly indifferentTests: readonly string[];
}

/** Fold an ablation assessment into acceptance evidence. `null` = the ablation could not run at all. */
export function foldAblationIntoAcceptance(assessment: AblationAssessment | null): AblationAcceptanceEvidence {
	if (assessment === null) {
		return {
			status: "unmeasured",
			testsMeasureTheChange: false,
			holdsAcceptance: false,
			detail: "The no-op ablation could not run; whether this card's tests measure its change is unknown.",
			indifferentTests: [],
		};
	}

	if (assessment.verdict === "load_bearing") {
		return {
			status: "supported",
			testsMeasureTheChange: true,
			holdsAcceptance: false,
			detail: `Stubbing the changed artifact broke ${assessment.brokenByStub.length} baseline-green test(s) — the card's tests measure its change.`,
			indifferentTests: [],
		};
	}

	if (assessment.verdict === "decorative") {
		return {
			status: "suspect",
			testsMeasureTheChange: false,
			holdsAcceptance: true,
			// The reason names BOTH readings, because the reviewer is the one who can tell them apart and the gate
			// cannot. Stating only the first would present a possible harness artefact as a finding about the card.
			detail:
				`${assessment.indifferentTests.length} test(s) passed with AND without the changed artifact. ` +
				"Either the card's tests do not measure its change, or the artifact is exercised only indirectly " +
				"(via a re-export, a caller, or a fixture) and the ablation could not see it. Confirm which before accepting.",
			indifferentTests: assessment.indifferentTests,
		};
	}

	return {
		status: "unmeasured",
		testsMeasureTheChange: false,
		holdsAcceptance: false,
		detail: `The ablation produced no comparable evidence: ${assessment.reason}`,
		indifferentTests: [],
	};
}
