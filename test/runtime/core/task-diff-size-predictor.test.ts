import { describe, expect, it } from "vitest";
import {
	complexityBand,
	DIFF_PREDICTION_MIN_SAMPLE,
	type DiffSizeEvidenceRow,
	filesBucket,
	predictTaskDiffLines,
} from "../../../src/core/task-diff-size-predictor";

/**
 * P21.6b — the per-task diff predictor: calibrated from the judged stream at call time, sharpest level with a
 * defensible sample wins, and "unknown evidence means no number" (null), never a guessed default.
 */
function judged(diffLines: number, features: Partial<DiffSizeEvidenceRow> = {}): DiffSizeEvidenceRow {
	return { outcome: "delivered", diffLines, ...features };
}
const five = (lines: number, features: Partial<DiffSizeEvidenceRow>) =>
	Array.from({ length: DIFF_PREDICTION_MIN_SAMPLE }, (_, i) => judged(lines + i, features));

describe("predictTaskDiffLines", () => {
	it("uses the (band × files) cell median when that cell has the minimum sample", () => {
		const rows = [
			...five(130, { plannedComplexity: 30, filesLikelyTouchedCount: 3 }),
			...five(20, { plannedComplexity: 30, filesLikelyTouchedCount: 0 }),
			...five(500, { plannedComplexity: 80, filesLikelyTouchedCount: 3 }),
		];
		const prediction = predictTaskDiffLines({ plannedComplexity: 33, filesLikelyTouchedCount: 4, rows });
		expect(prediction.basis).toBe("cell");
		expect(prediction.sample).toBe(DIFF_PREDICTION_MIN_SAMPLE);
		expect(prediction.lines).toBe(132); // median of 130..134, not the pooled median
	});

	it("falls back one level at a time — files bucket, then complexity band, then pooled", () => {
		const filesOnly = [
			...five(80, { plannedComplexity: 90, filesLikelyTouchedCount: 2 }), // same files, other band
			...five(10, { plannedComplexity: 10, filesLikelyTouchedCount: 0 }),
		];
		expect(
			predictTaskDiffLines({ plannedComplexity: 30, filesLikelyTouchedCount: 2, rows: filesOnly }),
		).toMatchObject({
			basis: "files",
			lines: 82,
		});
		const bandOnly = [
			...five(60, { plannedComplexity: 30, filesLikelyTouchedCount: 0 }), // same band, other files
			...five(900, { plannedComplexity: 90, filesLikelyTouchedCount: 2 }),
		];
		expect(predictTaskDiffLines({ plannedComplexity: 33, filesLikelyTouchedCount: 3, rows: bandOnly })).toMatchObject(
			{
				basis: "band",
				lines: 62,
			},
		);
		const pooledOnly = five(40, {}); // legacy rows without features contribute only to the pooled level
		expect(
			predictTaskDiffLines({ plannedComplexity: 33, filesLikelyTouchedCount: 3, rows: pooledOnly }),
		).toMatchObject({
			basis: "pooled",
			lines: 42,
		});
	});

	it("is null and named insufficient below the minimum sample — the caller reports the missing half", () => {
		expect(predictTaskDiffLines({ plannedComplexity: 30, filesLikelyTouchedCount: 1, rows: [judged(50)] })).toEqual({
			lines: null,
			basis: "insufficient",
			sample: 0,
		});
		expect(predictTaskDiffLines({ plannedComplexity: 30, filesLikelyTouchedCount: 1, rows: [] }).lines).toBeNull();
	});

	it("counts bounces as judgments and ignores parks and malformed rows", () => {
		const rows = [
			...Array.from({ length: 4 }, (_, i) => ({ outcome: "bounced", diffLines: 70 + i })),
			judged(74),
			{ outcome: "parked", diffLines: 9_999 },
			{ outcome: "delivered", diffLines: Number.NaN },
			{ outcome: "delivered", diffLines: -1 },
		];
		const prediction = predictTaskDiffLines({ plannedComplexity: null, filesLikelyTouchedCount: null, rows });
		expect(prediction).toMatchObject({ basis: "pooled", sample: 5, lines: 72 });
	});

	it("a task with no features skips the feature levels and lands on pooled", () => {
		const rows = five(30, { plannedComplexity: 30, filesLikelyTouchedCount: 1 });
		expect(
			predictTaskDiffLines({ plannedComplexity: undefined, filesLikelyTouchedCount: undefined, rows }).basis,
		).toBe("pooled");
	});

	it("bands and buckets sit where the measured medians step", () => {
		expect([0, 20, 21, 35, 36, 50, 51, 100].map(complexityBand)).toEqual([
			"≤20",
			"≤20",
			"≤35",
			"≤35",
			"≤50",
			"≤50",
			">50",
			">50",
		]);
		expect([0, 1, 2, 3, 9].map(filesBucket)).toEqual([0, 1, 2, 3, 3]);
	});
});
