import { describe, expect, it } from "vitest";
import {
	deriveFleetReviewCapacity,
	deriveReviewCapacity,
	REVIEW_CAPACITY_MIN_SAMPLE,
	type ReviewCapacityEvidenceRow,
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
