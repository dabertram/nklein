import { describe, expect, it } from "vitest";
import {
	computeProjectTimeTracking,
	computeTimeTracking,
	type TimeTrackingActivity,
} from "../../../src/core/time-tracking";

// A run: started at `start`, wall-ended at `end`, with `llmMs` of prompt→response-end LLM time, success by default.
const run = (
	start: number | null,
	end: number | null,
	llmMs: number | null,
	successful = true,
): TimeTrackingActivity => ({
	startedAt: start,
	endedAt: end,
	llmMs,
	successful,
});

describe("computeTimeTracking (F1.40 card metrics)", () => {
	it("ages to now while open, and to completedAt once done", () => {
		expect(computeTimeTracking({ createdAt: 100, activities: [], now: 1_100 }).ageTotalMs).toBe(1_000);
		expect(computeTimeTracking({ createdAt: 100, completedAt: 600, activities: [], now: 5_000 }).ageTotalMs).toBe(
			500,
		);
	});

	it("LLM time is the SUM of per-run prompt→response durations; successful-only over success outcomes", () => {
		const metrics = computeTimeTracking({
			createdAt: 0,
			now: 10_000,
			activities: [run(0, 1_000, 800, true), run(2_000, 2_500, 400, false), run(3_000, 3_800, 700, true)],
		});
		expect(metrics.llmTotalMs).toBe(1_900); // 800 + 400 + 700
		expect(metrics.llmSuccessfulMs).toBe(1_500); // 800 + 700
	});

	it("active time is the UNION of run WALL spans (overlaps merged, never double-counted)", () => {
		const metrics = computeTimeTracking({
			createdAt: 0,
			now: 10_000,
			// [0,1000] and [500,1500] overlap → union [0,1500] = 1500; plus a disjoint [3000,3200] = 200.
			activities: [run(0, 1_000, 900), run(500, 1_500, 900), run(3_000, 3_200, 100)],
		});
		expect(metrics.activeMs).toBe(1_700);
		// LLM total is independent of the wall spans — it sums the measured LLM durations.
		expect(metrics.llmTotalMs).toBe(1_900);
	});

	it("skips runs missing wall timing (active) or LLM timing (LLM sum) independently", () => {
		const metrics = computeTimeTracking({
			createdAt: 0,
			now: 5_000,
			// run 1: no start → not active, but has llmMs. run 2: has span, no llmMs. run 3: both.
			activities: [run(null, 1_000, 300), run(2_000, 2_400, null), run(3_000, 3_500, 250)],
		});
		expect(metrics.llmTotalMs).toBe(550); // 300 + 250
		expect(metrics.activeMs).toBe(900); // [2000,2400]=400 + [3000,3500]=500
	});

	it("never returns a negative age (clock skew guard)", () => {
		expect(computeTimeTracking({ createdAt: 5_000, activities: [], now: 1_000 }).ageTotalMs).toBe(0);
	});
});

describe("computeProjectTimeTracking (F1.40 project metrics)", () => {
	it("ages from the earliest card and unions active spans across cards", () => {
		const metrics = computeProjectTimeTracking({
			now: 10_000,
			cards: [{ createdAt: 2_000 }, { createdAt: 500 }, { createdAt: 4_000 }],
			// Two cards active at once: [1000,3000] and [2000,2500] → union [1000,3000] = 2000.
			activities: [run(1_000, 3_000, 1_500), run(2_000, 2_500, 400)],
		});
		expect(metrics.ageTotalMs).toBe(9_500); // now - earliest(500)
		expect(metrics.activeMs).toBe(2_000);
		expect(metrics.llmTotalMs).toBe(1_900); // 1500 + 400 (LLM sum counts both)
	});

	it("an empty project reports zero age but still folds stray runs", () => {
		const metrics = computeProjectTimeTracking({ now: 10_000, cards: [], activities: [run(0, 400, 300, true)] });
		expect(metrics.ageTotalMs).toBe(0);
		expect(metrics.llmSuccessfulMs).toBe(300);
	});
});
