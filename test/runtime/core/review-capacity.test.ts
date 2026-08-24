import { describe, expect, it } from "vitest";
import {
	assessPlannedTaskSizing,
	deriveFleetReviewCapacity,
	deriveReviewCapacity,
	deriveTypicalDiffLines,
	formatSizingSplitRejection,
	REVIEW_CAPACITY_MIN_SAMPLE,
	type ReviewCapacityEvidenceRow,
	selectOversizedPlannedTasks,
} from "../../../src/core/review-capacity";

/**
 * P21.6b — the empirical ceiling's contract: derived only from proven judgments, percentile not max,
 * and "unknown evidence means no proven room" (null), never a guessed default.
 */
function row(modelId: string, outcome: string, diffLines: number): ReviewCapacityEvidenceRow {
	return { reviewerModelId: modelId, outcome, diffLines };
}

describe("deriveReviewCapacity", () => {
	it("returns the 90th-percentile of successfully-judged sizes — one lucky giant does not license routine giants", () => {
		const rows = [
			...[120, 150, 180, 200, 240, 260, 300, 340, 400].map((lines) => row("m", "delivered", lines)),
			row("m", "delivered", 5_000),
		];
		const verdict = deriveReviewCapacity(rows, "m");
		expect(verdict.basis).toBe("empirical_percentile");
		expect(verdict.sample).toBe(10);
		expect(verdict.ceilingLines).toBeLessThan(5_000); // never the max
		expect(verdict.ceilingLines).toBeGreaterThanOrEqual(340);
	});

	it("bounces count as successful judgments; parks do not", () => {
		const rows = [
			...[100, 110, 120, 130].map((lines) => row("m", "bounced", lines)),
			row("m", "delivered", 140),
			row("m", "parked", 9_999),
		];
		const verdict = deriveReviewCapacity(rows, "m");
		expect(verdict.sample).toBe(REVIEW_CAPACITY_MIN_SAMPLE);
		expect(verdict.ceilingLines).toBeLessThanOrEqual(140);
	});

	it("below the minimum sample: no proven room (null), named as insufficient — the caller splits conservatively", () => {
		const rows = [row("m", "delivered", 200), row("m", "delivered", 220)];
		expect(deriveReviewCapacity(rows, "m")).toEqual({
			ceilingLines: null,
			sample: 2,
			basis: "insufficient_evidence",
		});
		expect(deriveReviewCapacity([], "m")).toEqual({ ceilingLines: null, sample: 0, basis: "no_evidence" });
	});

	it("evidence is per-model — another model's judgments prove nothing here", () => {
		const rows = [100, 120, 140, 160, 180].map((lines) => row("other", "delivered", lines));
		expect(deriveReviewCapacity(rows, "m").basis).toBe("no_evidence");
	});
});

describe("deriveFleetReviewCapacity", () => {
	it("takes the best PROVEN ceiling across routable models — a card needs one capable reviewer", () => {
		const rows = [
			...[100, 110, 120, 130, 140].map((lines) => row("small", "delivered", lines)),
			...[400, 420, 440, 460, 480].map((lines) => row("big", "delivered", lines)),
		];
		const verdict = deriveFleetReviewCapacity(rows, ["small", "big", "unproven"]);
		expect(verdict.basis).toBe("empirical_percentile");
		expect(verdict.ceilingLines).toBeGreaterThanOrEqual(460);
	});

	it("no model with proven room ⇒ null, distinguishing some-evidence from none", () => {
		const rows = [row("small", "delivered", 100)];
		expect(deriveFleetReviewCapacity(rows, ["small"]).basis).toBe("insufficient_evidence");
		expect(deriveFleetReviewCapacity([], ["small"]).basis).toBe("no_evidence");
	});
});

describe("deriveTypicalDiffLines", () => {
	it("median of judged sizes; null below the evidence floor (no invented constants)", () => {
		const rows = [100, 200, 300, 400, 500].map((lines) => row("any", "delivered", lines));
		expect(deriveTypicalDiffLines(rows)).toBe(300);
		expect(deriveTypicalDiffLines(rows.slice(0, 3))).toBeNull();
	});
});

describe("assessPlannedTaskSizing (P21.6b slice 3 — observe-first plan-time verdict)", () => {
	const evidenced = [100, 120, 140, 160, 180].map((lines) => row("m", "delivered", lines));

	it("produces the full two-ceiling verdict only when BOTH evidence halves exist", () => {
		const assessment = assessPlannedTaskSizing({
			rows: evidenced,
			modelContextTokens: 32_000,
			estimatedTaskTokens: 8_000,
		});
		expect(assessment.basis).toBe("verdict");
		expect(assessment.verdict?.fits).toBe(true);
		expect(assessment.reviewCeiling.basis).toBe("empirical_percentile");
		expect(assessment.estimatedDiffLines).toBe(140); // the median baseline forecast
	});

	it("names WHICH half is missing instead of guessing (the flip decision's denominator)", () => {
		expect(assessPlannedTaskSizing({ rows: [], modelContextTokens: 32_000, estimatedTaskTokens: 8_000 }).basis).toBe(
			"no_review_evidence",
		);
		expect(
			assessPlannedTaskSizing({ rows: evidenced, modelContextTokens: null, estimatedTaskTokens: 8_000 }).basis,
		).toBe("no_context_window");
		expect(assessPlannedTaskSizing({ rows: [], modelContextTokens: null, estimatedTaskTokens: 8_000 }).basis).toBe(
			"no_evidence_at_all",
		);
	});

	it("a review-ceiling overrun binds by NAME — the split remedy, never the bigger-model lever", () => {
		// The only PROVEN reviewer (5+ samples) handles ~50-line diffs; the big diffs all came from
		// under-sampled models that prove nothing — so the typical diff (median 1000) dwarfs the proven
		// ceiling (50) while context is comfortable. The verdict must name review_capacity as binding.
		const rows = [
			...[50, 50, 50, 50, 50].map((lines) => row("proven-small", "delivered", lines)),
			...[1_000, 1_000, 1_000, 1_000].map((lines) => row("unproven-a", "delivered", lines)),
			...[1_000, 1_000, 1_000, 1_000].map((lines) => row("unproven-b", "delivered", lines)),
		];
		const assessment = assessPlannedTaskSizing({
			rows,
			modelContextTokens: 200_000,
			estimatedTaskTokens: 4_000,
		});
		expect(assessment.basis).toBe("verdict");
		expect(assessment.reviewCeiling.ceilingLines).toBe(50);
		expect(assessment.estimatedDiffLines).toBe(1_000);
		expect(assessment.verdict?.binding).toBe("review_capacity");
		expect(assessment.verdict?.mustSplit).toBe(true);
		expect(assessment.verdict?.reason).toContain("cannot be fixed with a bigger model");
	});

	/**
	 * The DARK-STREAM regression (root-caused 2026-08-19). 2512 real evidence rows existed and 772 real
	 * assessments were recorded, and every single assessment read `no_evidence_at_all` — because the writer
	 * attributed each row to the PINNED reviewer, which is null on the default auto path. The rows were real;
	 * the join key could never match. These pins fail if that shape ever returns.
	 */
	describe("unattributed evidence (the 2026-08-19 dark-stream bug)", () => {
		it("cannot derive a ceiling from rows whose reviewer is unattributed, however many there are", () => {
			const unattributed: ReviewCapacityEvidenceRow[] = Array.from({ length: 500 }, () => ({
				reviewerModelId: null,
				outcome: "delivered",
				diffLines: 120,
			}));
			// The model list comes from the rows themselves, so unattributed rows yield NO models at all.
			const modelIds = [
				...new Set(
					unattributed.map((r) => r.reviewerModelId).filter((id): id is string => id !== null && id.trim() !== ""),
				),
			];
			expect(modelIds).toEqual([]);
			expect(deriveFleetReviewCapacity(unattributed, modelIds).ceilingLines).toBeNull();
			// …and that is exactly what made every plan-time assessment evidence-less.
			expect(
				assessPlannedTaskSizing({ rows: unattributed, modelContextTokens: 200_000, estimatedTaskTokens: 4_000 })
					.basis,
			).toBe("no_review_evidence");
		});

		it("the SAME rows, once attributed, produce a real verdict — proving attribution was the whole gap", () => {
			const attributed: ReviewCapacityEvidenceRow[] = Array.from({ length: 500 }, () => ({
				reviewerModelId: "qwen3.8-27b-mlx",
				outcome: "delivered",
				diffLines: 120,
			}));
			const assessment = assessPlannedTaskSizing({
				rows: attributed,
				modelContextTokens: 200_000,
				estimatedTaskTokens: 4_000,
			});
			expect(assessment.basis).toBe("verdict");
			expect(assessment.reviewCeiling.ceilingLines).toBe(120);
		});
	});
});

describe("P21.6b enforce half (pure)", () => {
	const fits = assessPlannedTaskSizing({
		rows: Array.from({ length: 5 }, () => row("m", "delivered", 40)),
		modelContextTokens: 200_000,
		estimatedTaskTokens: 10_000,
	});
	const overshoots = assessPlannedTaskSizing({
		rows: Array.from({ length: 5 }, () => row("m", "delivered", 40)),
		modelContextTokens: 8_000,
		estimatedTaskTokens: 20_000,
	});

	it("selects only tasks with a PRESENT mustSplit verdict — a missing evidence half never enforces", () => {
		const noVerdict = assessPlannedTaskSizing({ rows: [], modelContextTokens: null, estimatedTaskTokens: 20_000 });
		expect(noVerdict.verdict).toBeNull();
		const selected = selectOversizedPlannedTasks([
			{ planTaskId: "ok", title: "Fits", assessment: fits },
			{ planTaskId: "big", title: "Too big", assessment: overshoots },
			{ planTaskId: "cold", title: "No evidence", assessment: noVerdict },
		]);
		expect(selected.map((task) => task.planTaskId)).toEqual(["big"]);
	});

	it("writes the rejection FOR THE MODEL: task id, binding reason, split count, and the expansions remedy", () => {
		const selected = selectOversizedPlannedTasks([{ planTaskId: "big", title: "Too big", assessment: overshoots }]);
		const message = formatSizingSplitRejection(selected);
		expect(message).toContain('"big"');
		expect(message).toContain("MODEL CONTEXT binds");
		expect(message).toMatch(/Split into at least \d+ smaller tasks/);
		expect(message).toContain("`expansions`");
		expect(message).toContain("Do not delete or thin the scope");
	});
});
