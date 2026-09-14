/**
 * P21.6b — the PER-TASK diff-size predictor, the leaf the sizing invariant was waiting on. PURE core.
 *
 * ── WHY THE POOLED MEDIAN COULD NEVER ENFORCE ──
 * The plan-time sizing verdict compares a task's predicted diff size against the fleet's proven review ceiling.
 * The prediction was the pooled MEDIAN of successfully-judged diffs and the ceiling the best per-model P90 of the
 * same stream — and median ≤ p90 for any one population, so the review half of the verdict was structurally inert:
 * no task could ever be predicted past the ceiling. Only a predictor that tells tasks APART can arm it.
 *
 * ── THE EVIDENCE SAYS THE FEATURES DO TELL THEM APART (measured 2026-09-14, 338 real judgments) ──
 * Leave-one-out median absolute error against actual reviewed diff lines: pooled median 38 lines, a
 * (complexity band × files-likely-touched) cell median 23. `filesLikelyTouched` is the strongest signal — medians
 * of 24 / 46 / 81 / 132 lines for 0 / 1 / 2 / 3+ files — and the complexity band second (18 / 88 / 60 / 144 for
 * ≤20 / ≤35 / ≤50 / >50). Neither is invented: both are recorded on every `plan_sizing_verdict` row beside the
 * prediction, straight from the task's own declaration, and joined to the card's later `review_capacity_evidence`.
 *
 * ── CALIBRATED FROM THE STREAM AT CALL TIME, NOT A BAKED TABLE ──
 * The item's policy: "derive the ceiling from what the available auto-review models have empirically reviewed";
 * "unknown evidence means no proven room"; never a parameter count, never an invented default. The same rule
 * governs the prediction. Each level of the ladder needs {@link DIFF_PREDICTION_MIN_SAMPLE} successful judgments,
 * and the ladder falls back — cell → files bucket → complexity band → pooled — until a level has them; below that
 * even the pooled median is null and the caller reports the missing half exactly as before. So the predictor
 * sharpens as the drains accrue evidence and never asserts a number the stream cannot back.
 *
 * Pure + total: no clock, no I/O; rows without features contribute only to the pooled level.
 */

/**
 * Minimum successful judgments a ladder level needs before its median is a defensible number — the same floor
 * the review ceiling uses (`REVIEW_CAPACITY_MIN_SAMPLE`). Declared here rather than imported: `review-capacity`
 * imports THIS module, and a constant read across that cycle at module-evaluation time would be undefined.
 */
export const DIFF_PREDICTION_MIN_SAMPLE = 5;

/** One judged diff with (when the sizing observation recorded them) the task's own declared features. */
export interface DiffSizeEvidenceRow {
	readonly outcome: string;
	readonly diffLines: number;
	readonly plannedComplexity?: number | null;
	readonly filesLikelyTouchedCount?: number | null;
}

export interface DiffSizePredictionInput {
	readonly plannedComplexity: number | null | undefined;
	readonly filesLikelyTouchedCount: number | null | undefined;
	readonly rows: readonly DiffSizeEvidenceRow[];
}

export type DiffSizePredictionBasis =
	/** Median of judgments with the same complexity band AND files bucket — the sharpest level. */
	| "cell"
	/** Median of judgments with the same files bucket. */
	| "files"
	/** Median of judgments with the same complexity band. */
	| "band"
	/** The pooled median — what shipped before this predictor; still the floor of the ladder. */
	| "pooled"
	/** Fewer than the minimum sample even pooled: no defensible number, the caller reports the missing half. */
	| "insufficient";

export interface DiffSizePrediction {
	readonly lines: number | null;
	readonly basis: DiffSizePredictionBasis;
	/** Successful judgments behind the number (0 when insufficient). */
	readonly sample: number;
}

/** The judgments a prediction may rest on — a bounce IS a completed judgment; a park is the failure the ceiling avoids. */
const SUCCESSFUL_JUDGMENTS: ReadonlySet<string> = new Set(["delivered", "bounced"]);

/** Complexity bands (the decomposer's 0-100 scale). Edges chosen where the measured medians actually step. */
export function complexityBand(complexity: number): "≤20" | "≤35" | "≤50" | ">50" {
	if (complexity <= 20) return "≤20";
	if (complexity <= 35) return "≤35";
	if (complexity <= 50) return "≤50";
	return ">50";
}

/** Files-likely-touched buckets; 3+ is one bucket because the tail is thin and its median is already the largest. */
export function filesBucket(count: number): 0 | 1 | 2 | 3 {
	if (count <= 0) return 0;
	if (count === 1) return 1;
	if (count === 2) return 2;
	return 3;
}

function finiteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function medianOf(sorted: readonly number[]): number | null {
	if (sorted.length === 0) {
		return null;
	}
	return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/**
 * Predict the reviewed diff size of a planned task from what comparable tasks actually produced.
 * Returns the sharpest level of the ladder that has a defensible sample, and names it.
 */
export function predictTaskDiffLines(input: DiffSizePredictionInput): DiffSizePrediction {
	const judged = (input.rows ?? []).filter(
		(row) => row && SUCCESSFUL_JUDGMENTS.has(row.outcome) && finiteNonNegative(row.diffLines),
	);
	const wantBand = finiteNonNegative(input.plannedComplexity) ? complexityBand(input.plannedComplexity) : null;
	const wantFiles = finiteNonNegative(input.filesLikelyTouchedCount)
		? filesBucket(input.filesLikelyTouchedCount)
		: null;
	const rowBand = (row: DiffSizeEvidenceRow) =>
		finiteNonNegative(row.plannedComplexity) ? complexityBand(row.plannedComplexity) : null;
	const rowFiles = (row: DiffSizeEvidenceRow) =>
		finiteNonNegative(row.filesLikelyTouchedCount) ? filesBucket(row.filesLikelyTouchedCount) : null;
	const levels: { basis: DiffSizePredictionBasis; pick: (row: DiffSizeEvidenceRow) => boolean }[] = [
		...(wantBand !== null && wantFiles !== null
			? [
					{
						basis: "cell" as const,
						pick: (row: DiffSizeEvidenceRow) => rowBand(row) === wantBand && rowFiles(row) === wantFiles,
					},
				]
			: []),
		...(wantFiles !== null
			? [{ basis: "files" as const, pick: (row: DiffSizeEvidenceRow) => rowFiles(row) === wantFiles }]
			: []),
		...(wantBand !== null
			? [{ basis: "band" as const, pick: (row: DiffSizeEvidenceRow) => rowBand(row) === wantBand }]
			: []),
		{ basis: "pooled" as const, pick: () => true },
	];
	for (const level of levels) {
		const sizes = judged
			.filter(level.pick)
			.map((row) => row.diffLines)
			.sort((left, right) => left - right);
		if (sizes.length >= DIFF_PREDICTION_MIN_SAMPLE) {
			return { lines: medianOf(sizes), basis: level.basis, sample: sizes.length };
		}
	}
	return { lines: null, basis: "insufficient", sample: 0 };
}
