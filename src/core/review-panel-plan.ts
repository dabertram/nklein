/**
 * §5.AW review-PANEL planner — compose the complexity classifier's OUTPUT (a {@link TaskComplexity} band) with the
 * N-eyes lens assignment into a single "how many eyes, looking how" decision. The two halves already exist and are
 * unit-tested in isolation; this core is the thin, deterministic BRIDGE the wiring calls: complexity → how many eyes,
 * then {@link assignReviewLenses} → which orthogonal lenses those eyes wear, tier-gated.
 *
 * WHY a dedicated ladder (not just `eyes = f(complexity)` inline): the two axes must stay DECOUPLED. Complexity sets
 * DEPTH (how many perspectives are worth spending), but the reviewer TIER sets what a perspective can be BACKED by —
 * and those are independent. A high-risk (complex) card does NOT license a weak reviewer to emit a security verdict it
 * cannot substantiate: {@link assignReviewLenses} caps the lens list at the tier's eligible set, so asking for 7 eyes
 * from a weak model yields only its 3 backable lenses (spec_fit + correctness + simplicity), never `security`. The
 * ladder here only ever RAISES the eye COUNT with complexity; the tier gate is what keeps the panel honest.
 *
 * PRIME DIRECTIVE #1: DECIDES only — pure + deterministic, no I/O, no clock, no randomness. Composes ONLY by import.
 */

import { assignReviewLenses, type ReviewLens } from "./review-lenses";
import type { TaskComplexity } from "./sysprompt-level";

/** How many DISTINCT reviewer lenses (orthogonal perspectives) each complexity band is worth spending. */
export interface ReviewPanelPlan {
	/** The number of eyes (distinct lenses) requested for this card — before the tier gate trims to backable lenses. */
	eyes: number;
	/** The tier-gated, failure-mass-ordered lenses the panel actually gets (may be shorter than `eyes` for weak tiers). */
	lenses: ReviewLens[];
}

/**
 * The complexity → eyes ladder. DEPTH scales with how much can go wrong, INCLUSIVE toward more scrutiny on the harder
 * bands (an under-reviewed hard change costs more than one extra lens on an easy one — mirrors the classifier's own
 * "inclusive toward higher complexity" bias):
 *  - `trivial`  → 1 eye  (the single most-valuable lens: spec-fit — "is this what was asked?").
 *  - `standard` → 2 eyes.
 *  - `complex`  → the FULL panel (request every lens; the tier gate decides how many are backable).
 *  - `novel`    → the full panel too (nothing deeper than "all available lenses" exists).
 *
 * `Number.POSITIVE_INFINITY` for the full-panel bands lets {@link assignReviewLenses}'s `slice` take ALL eligible
 * lenses for the tier without this core needing to know the lens-catalog length (kept as the single source of truth in
 * `review-lenses.ts`). `assignReviewLenses` truncates the count internally, so the request never over-runs the catalog.
 */
function eyesForComplexity(complexity: TaskComplexity): number {
	switch (complexity) {
		case "trivial":
			return 1;
		case "standard":
			return 2;
		case "complex":
		case "novel":
			return Number.POSITIVE_INFINITY;
	}
}

/**
 * Plan a review panel: map task complexity to an eye COUNT, then hand that count + the reviewer tier to
 * {@link assignReviewLenses} to pick the failure-mass-ordered, tier-backable lenses. Pure/deterministic — the same
 * inputs always yield the same plan.
 *
 * The returned `lenses` may be SHORTER than `eyes` when the reviewer tier cannot back every requested lens: a weak
 * reviewer on a `complex` card still gets only its 3 eligible lenses (never `security`), because risk raises the eye
 * count but never the reviewer's capability. `eyes` reports what was REQUESTED; `lenses.length` is what was granted.
 */
export function planReviewPanel(input: {
	complexity: TaskComplexity;
	reviewerTier: "weak" | "mid" | "strong";
}): ReviewPanelPlan {
	const eyes = eyesForComplexity(input.complexity);
	const lenses = assignReviewLenses({ eyes, reviewerTier: input.reviewerTier });
	return { eyes, lenses };
}
