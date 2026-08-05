/**
 * P21.6b — the EMPIRICAL review-capacity deriver, pure.
 *
 * Input: `review_capacity_evidence` observation rows (recorded by the second-opinion runner: the reviewed
 * diff's line count + outcome per reviewer model). Output: the diff-line ceiling a given model has PROVEN it
 * can review, for `decideTaskSizing`'s `reviewCapacityLines` input.
 *
 * THE POLICY (David resolved 2026-07-21, recorded in the item): the ceiling comes from what the available
 * auto-review models have EMPIRICALLY reviewed successfully — never parameter count, advertised context, or
 * an invented universal default. Unknown evidence means NO PROVEN ROOM (null), and the caller's answer to
 * null is a conservative split, not a guess.
 *
 * What counts as a successful REVIEW: `delivered` and `bounced` both do — a bounce is a completed act of
 * judgment (the reviewer read the diff and produced a verdict); `parked` resolutions are the failures this
 * ceiling exists to avoid (the reviewer could not produce a verdict at that size). The ceiling is the
 * PERCENTILE of successfully-judged sizes rather than the max: one lucky giant review must not license
 * routine giants.
 */

export interface ReviewCapacityEvidenceRow {
	readonly reviewerModelId: string | null;
	readonly outcome: string;
	readonly diffLines: number;
}

export interface ReviewCapacityVerdict {
	/** The proven ceiling in diff lines, or null when the evidence cannot support one. */
	readonly ceilingLines: number | null;
	/** Successful-judgment sample size behind the ceiling. */
	readonly sample: number;
	/** Why the ceiling is what it is — the caller surfaces this instead of re-deriving. */
	readonly basis: "empirical_percentile" | "insufficient_evidence" | "no_evidence";
}

/** Judgments below this sample size prove nothing — the policy's "unknown evidence means no proven room". */
export const REVIEW_CAPACITY_MIN_SAMPLE = 5;

/** The percentile of successfully-judged sizes taken as the ceiling (conservative, not the max). */
export const REVIEW_CAPACITY_PERCENTILE = 0.9;

const SUCCESSFUL_JUDGMENTS: ReadonlySet<string> = new Set(["delivered", "bounced"]);

export function deriveReviewCapacity(
	rows: readonly ReviewCapacityEvidenceRow[],
	modelId: string,
): ReviewCapacityVerdict {
	const normalized = modelId.trim();
	const judged = rows.filter(
		(row) =>
			row.reviewerModelId !== null &&
			row.reviewerModelId.trim() === normalized &&
			SUCCESSFUL_JUDGMENTS.has(row.outcome) &&
			Number.isFinite(row.diffLines) &&
			row.diffLines >= 0,
	);
	if (judged.length === 0) {
		return { ceilingLines: null, sample: 0, basis: "no_evidence" };
	}
	if (judged.length < REVIEW_CAPACITY_MIN_SAMPLE) {
		return { ceilingLines: null, sample: judged.length, basis: "insufficient_evidence" };
	}
	const sizes = judged.map((row) => row.diffLines).sort((left, right) => left - right);
	// ceil(p·n)−1: for n=10 at p=.9 this is index 8 — floor(p·n) would land on index 9, the MAX, exactly the
	// "one lucky giant licenses routine giants" failure the percentile exists to prevent.
	const index = Math.min(sizes.length - 1, Math.max(0, Math.ceil(REVIEW_CAPACITY_PERCENTILE * sizes.length) - 1));
	return { ceilingLines: sizes[index] ?? null, sample: judged.length, basis: "empirical_percentile" };
}

/**
 * The FLEET ceiling: the best proven ceiling across the models a review could actually route to. A card only
 * needs ONE capable reviewer, so the max of proven ceilings is the honest bound; models with no proven room
 * contribute nothing (they neither raise nor veto).
 */
export function deriveFleetReviewCapacity(
	rows: readonly ReviewCapacityEvidenceRow[],
	modelIds: readonly string[],
): ReviewCapacityVerdict {
	const verdicts = modelIds
		.map((modelId) => deriveReviewCapacity(rows, modelId))
		.filter((verdict) => verdict.ceilingLines !== null);
	if (verdicts.length === 0) {
		const anyEvidence = modelIds.some((modelId) => deriveReviewCapacity(rows, modelId).sample > 0);
		return { ceilingLines: null, sample: 0, basis: anyEvidence ? "insufficient_evidence" : "no_evidence" };
	}
	const best = verdicts.reduce((left, right) => ((right.ceilingLines ?? 0) > (left.ceilingLines ?? 0) ? right : left));
	return best;
}
