/**
 * §5.AW N-eyes review LENSES (audit 2026-07-02 W4.4) — "as many eyes as available, but each looks DIFFERENTLY."
 * N reviewers given the same generic "review this" prompt largely re-derive the same top findings (redundancy ≠
 * value); the value of an extra eye comes from an ORTHOGONAL assigned perspective. Lens ORDER follows the measured
 * multi-agent failure mass (MAST, arXiv:2503.13657 — see docs/dev/research-2026-07-02.md): specification/intent
 * failures dominate (41.8%), then inter-agent/integration misalignment (36.9%), then verification gaps (21.3%) —
 * so eye #1 always asks "is this what was ASKED?", not "is the style nice?".
 *
 * Pure. The wiring pairs this with lineage diversity (§5.AB — family diversity is the load-bearing axis; lenses
 * compose on top) and the blind-then-confer protocol (each eye reviews blind first; author self-claims REDACTED).
 */

export type ReviewLensId =
	| "spec_fit"
	| "integration"
	| "test_quality"
	| "correctness"
	| "security"
	| "performance"
	| "simplicity"
	// F12.5: the DYNAMIC rubric lens (per-card checklist from `verification-rubric.ts`) — never in REVIEW_LENSES
	// (it has no static stance); the runner appends it when the card's spec yields a non-empty rubric.
	| "rubric";

export interface ReviewLens {
	id: ReviewLensId;
	/** The one-line stance instruction injected into that eye's review prompt. */
	stance: string;
	/** Only reviewers at/above this capability tier render this lens reliably (weak reviewers get the basics). */
	minReviewerTier: "weak" | "mid" | "strong";
}

/** Ordered by measured failure mass — the first N lenses are always the most valuable N. */
export const REVIEW_LENSES: readonly ReviewLens[] = [
	{
		id: "spec_fit",
		// P20.12 (2026-07-31) — RESTRUCTURED from requirement-enumeration to BEHAVIOURAL COMPARISON.
		//
		// The previous stance was "re-read the spec, LIST EACH REQUIREMENT, and verify the diff satisfies it —
		// flag anything missing, extra, or misinterpreted". arXiv 2508.12358 (ASE'25) measured exactly that shape
		// on spec-conformance judging and found it fails in ONE direction — **over-correction: flagging CORRECT
		// code as defective** — with a three-step decomposition collapsing GPT-4o from 52.4% to 11.0%, and MORE
		// chain-of-thought making it worse. "Behavioural Comparison" recovered it to 85.4%.
		//
		// Two things made the old wording the bad case rather than a neutral one: the step-by-step enumeration
		// itself, and "flag anything missing, EXTRA, or misinterpreted", which primes a reviewer to treat any
		// difference from its own imagined implementation as a defect. This lens carries `minReviewerTier: "weak"`
		// — it is assigned to the smallest models on the fleet, which is precisely the population the study
		// measured degrading, and it is eye #1 on EVERY panel including single-eye reviews of trivial cards.
		//
		// The replacement asks what the code DOES and compares that to what was asked, and requires a nameable
		// input or situation before anything counts as a defect — the same "failure scenario or it did not happen"
		// discipline the rest of this codebase's review surface already uses.
		//
		// ⚠️ UNMEASURED HERE: this is an evidence-backed prompt change, not a locally verified improvement. Its
		// effect on !Klein's own bounce rate is exactly what the review-quality telemetry should show next.
		stance:
			"Judge ONLY whether the change does what was ASKED, by comparing BEHAVIOUR. For each thing the task asks for, state what the code now does in that situation, then say whether that matches what was asked. Report a defect only when you can name the specific input or situation where the behaviour differs from the request — if you cannot name one, it is not a finding. Do not flag style, structure, naming, or code that merely differs from how you would have written it.",
		minReviewerTier: "weak",
	},
	{
		id: "integration",
		stance:
			"Judge ONLY how this change composes with its neighbors: the sibling cards' work, the interfaces it touches, and the callers it affects — flag contract drift, duplicated responsibilities, and merge hazards.",
		minReviewerTier: "mid",
	},
	{
		id: "test_quality",
		stance:
			"Judge ONLY the tests: do they actually pin the required behavior (not just execute the code)? Would the tests fail if the feature were broken? Flag tautological, missing, or gamed tests (incl. edits to test/gate files).",
		minReviewerTier: "mid",
	},
	{
		id: "correctness",
		stance:
			"Judge ONLY functional correctness: trace the changed logic for wrong outputs, unhandled edge cases, off-by-ones, and error paths — cite the exact line for each defect.",
		minReviewerTier: "weak",
	},
	{
		id: "security",
		stance:
			"Judge ONLY security: injection surfaces, path traversal, secrets, unsafe deserialization, privilege/isolation boundaries — assume inputs are hostile.",
		minReviewerTier: "strong",
	},
	{
		id: "performance",
		stance:
			"Judge ONLY performance: complexity regressions, hot-path allocations, N+1 patterns, unbounded growth — only flag issues with a plausible real-world impact.",
		minReviewerTier: "mid",
	},
	{
		id: "simplicity",
		stance:
			"Judge ONLY simplicity/maintainability: needless abstraction, duplication, dead code, unclear naming — advisory polish, never a merge blocker on its own.",
		minReviewerTier: "weak",
	},
];

const TIER_ORDER = { weak: 0, mid: 1, strong: 2 } as const;

/**
 * Assign the next `eyes` lenses in failure-mass order, skipping lenses the reviewer tier can't render reliably
 * (a weak reviewer gets spec-fit + correctness + simplicity — never a security verdict it can't back). Difficulty
 * scales depth via the caller choosing `eyes` (trivial card = 1 eye; risky/hard = the fuller panel).
 */
export function assignReviewLenses(input: { eyes: number; reviewerTier: "weak" | "mid" | "strong" }): ReviewLens[] {
	const eligible = REVIEW_LENSES.filter((lens) => TIER_ORDER[lens.minReviewerTier] <= TIER_ORDER[input.reviewerTier]);
	return eligible.slice(0, Math.max(0, Math.trunc(input.eyes)));
}

/**
 * The marginal-value stopping rule (§5.AW): stop adding eyes when the last eye contributed nothing new.
 * `newFindingsPerEye` is the count of NON-DUPLICATE findings each successive eye added.
 */
export function shouldStopAddingEyes(newFindingsPerEye: readonly number[]): boolean {
	if (newFindingsPerEye.length === 0) {
		return false;
	}
	return newFindingsPerEye[newFindingsPerEye.length - 1] === 0;
}
