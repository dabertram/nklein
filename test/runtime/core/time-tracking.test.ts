import { describe, expect, it } from "vitest";
import {
	computeProjectTimeTracking,
	computeTimeTracking,
	type TimeTrackingAttempt,
} from "../../../src/core/time-tracking";

const attempt = (startedAt: number | null, completedAt: number | null, outcome = "success"): TimeTrackingAttempt => ({
	startedAt,
	completedAt,
	outcome,
});

describe("computeTimeTracking (F1.40 card metrics)", () => {
	it("ages to now while open, and to completedAt once done", () => {
		expect(computeTimeTracking({ createdAt: 100, attempts: [], now: 1_100 }).ageTotalMs).toBe(1_000);
		expect(computeTimeTracking({ createdAt: 100, completedAt: 600, attempts: [], now: 5_000 }).ageTotalMs).toBe(500);
	});

	it("sums LLM time over all attempts, and successful-only over success outcomes", () => {
		const metrics = computeTimeTracking({
			createdAt: 0,
			now: 10_000,
			attempts: [attempt(0, 1_000, "success"), attempt(2_000, 2_500, "loop"), attempt(3_000, 3_800, "success")],
		});
		// total = 1000 + 500 + 800; successful = 1000 + 800
		expect(metrics.llmTotalMs).toBe(2_300);
		expect(metrics.llmSuccessfulMs).toBe(1_800);
	});

	it("active time is the UNION of attempt spans (overlaps merged, never double-counted)", () => {
		const metrics = computeTimeTracking({
			createdAt: 0,
			now: 10_000,
			// [0,1000] and [500,1500] overlap → union [0,1500] = 1500; plus a disjoint [3000,3200] = 200.
			attempts: [attempt(0, 1_000), attempt(500, 1_500), attempt(3_000, 3_200)],
		});
		expect(metrics.activeMs).toBe(1_700);
		// LLM total double-counts the overlap: 1000 + 1000 + 200.
		expect(metrics.llmTotalMs).toBe(2_200);
	});

	it("skips attempts missing a start or end (legacy rows) in the LLM + active terms", () => {
		const metrics = computeTimeTracking({
			createdAt: 0,
			now: 5_000,
			attempts: [attempt(null, 1_000), attempt(2_000, null), attempt(3_000, 3_500, "success")],
		});
		expect(metrics.llmTotalMs).toBe(500);
		expect(metrics.activeMs).toBe(500);
	});

	it("never returns a negative age (clock skew guard)", () => {
		expect(computeTimeTracking({ createdAt: 5_000, attempts: [], now: 1_000 }).ageTotalMs).toBe(0);
	});
});

describe("computeProjectTimeTracking (F1.40 project metrics)", () => {
	it("ages from the earliest card and unions active spans across cards", () => {
		const metrics = computeProjectTimeTracking({
			now: 10_000,
			cards: [{ createdAt: 2_000 }, { createdAt: 500 }, { createdAt: 4_000 }],
			// Two cards active at once: [1000,3000] and [2000,2500] → union [1000,3000] = 2000.
			attempts: [attempt(1_000, 3_000), attempt(2_000, 2_500)],
		});
		expect(metrics.ageTotalMs).toBe(9_500); // now - earliest(500)
		expect(metrics.activeMs).toBe(2_000);
		expect(metrics.llmTotalMs).toBe(2_500); // 2000 + 500 (double-counts overlap)
	});

	it("an empty project reports zero age but still folds stray attempts", () => {
		const metrics = computeProjectTimeTracking({ now: 10_000, cards: [], attempts: [attempt(0, 400, "success")] });
		expect(metrics.ageTotalMs).toBe(0);
		expect(metrics.llmSuccessfulMs).toBe(400);
	});
});
