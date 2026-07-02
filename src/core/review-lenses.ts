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
	| "simplicity";

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
		stance:
			"Judge ONLY whether the change does what was ASKED: re-read the task/spec, list each requirement, and verify the diff satisfies it — flag anything missing, extra, or misinterpreted.",
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
