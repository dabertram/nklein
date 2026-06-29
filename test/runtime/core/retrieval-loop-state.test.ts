import { describe, expect, it } from "vitest";
import { nextRetrievalAction, type RetrievalLoopState } from "../../../src/core/retrieval-loop-state";

/** Minimal valid baseline state — all flags false / counts zero, budget generous. */
const base: RetrievalLoopState = {
	iteration: 0,
	maxIterations: 10,
	hasQueryPlan: false,
	hitCount: 0,
	fetchedCount: 0,
	sufficient: false,
};

describe("nextRetrievalAction", () => {
	it("returns formulate_query when there is no query plan (and budget remains)", () => {
		expect(nextRetrievalAction({ ...base, hasQueryPlan: false })).toBe("formulate_query");
	});

	it("returns search when a plan exists but no hits have been retrieved yet", () => {
		expect(nextRetrievalAction({ ...base, hasQueryPlan: true, hitCount: 0 })).toBe("search");
	});

	it("returns fetch when fetchedCount is less than hitCount", () => {
		expect(nextRetrievalAction({ ...base, hasQueryPlan: true, hitCount: 5, fetchedCount: 2 })).toBe("fetch");
	});

	it("returns synthesize when all hits have been fetched (fetchedCount === hitCount)", () => {
		expect(nextRetrievalAction({ ...base, hasQueryPlan: true, hitCount: 3, fetchedCount: 3 })).toBe("synthesize");
	});

	it("returns stop_sufficient when sufficient is true", () => {
		expect(nextRetrievalAction({ ...base, sufficient: true })).toBe("stop_sufficient");
	});

	it("returns stop_budget_exhausted when iteration equals maxIterations", () => {
		// boundary: iteration === maxIterations is exhausted
		expect(nextRetrievalAction({ ...base, iteration: 10, maxIterations: 10 })).toBe("stop_budget_exhausted");
	});

	it("returns stop_budget_exhausted when iteration exceeds maxIterations", () => {
		expect(nextRetrievalAction({ ...base, iteration: 15, maxIterations: 10 })).toBe("stop_budget_exhausted");
	});

	// Precedence override cases -----------------------------------------------

	it("sufficient OVERRIDES budget exhaustion: stop_sufficient even when iteration >= maxIterations", () => {
		expect(nextRetrievalAction({ ...base, sufficient: true, iteration: 10, maxIterations: 10 })).toBe(
			"stop_sufficient",
		);
	});

	it("budget OVERRIDES formulate: stop_budget_exhausted even when hasQueryPlan is false", () => {
		expect(nextRetrievalAction({ ...base, hasQueryPlan: false, iteration: 10, maxIterations: 10 })).toBe(
			"stop_budget_exhausted",
		);
	});

	// Boundary / edge cases ---------------------------------------------------

	it("sufficient at iteration 0 (very first tick) returns stop_sufficient immediately", () => {
		expect(nextRetrievalAction({ ...base, sufficient: true, iteration: 0 })).toBe("stop_sufficient");
	});

	it("iteration === maxIterations - 1 with plan and hits continues (returns fetch)", () => {
		// One iteration left — should NOT yet stop; here fetched < hits so expect fetch.
		expect(
			nextRetrievalAction({
				...base,
				iteration: 9,
				maxIterations: 10,
				hasQueryPlan: true,
				hitCount: 4,
				fetchedCount: 1,
			}),
		).toBe("fetch");
	});

	it("iteration === maxIterations - 1 with plan and all hits fetched returns synthesize", () => {
		// One iteration left, all hits in — should synthesize, not stop.
		expect(
			nextRetrievalAction({
				...base,
				iteration: 9,
				maxIterations: 10,
				hasQueryPlan: true,
				hitCount: 2,
				fetchedCount: 2,
			}),
		).toBe("synthesize");
	});

	it("treats negative hitCount defensively (hitCount < 0 → search, not fetch)", () => {
		expect(nextRetrievalAction({ ...base, hasQueryPlan: true, hitCount: -3, fetchedCount: 0 })).toBe("search");
	});
});

describe("maxIterations=0 boundary", () => {
	it("stops immediately on a zero budget regardless of other state", async () => {
		const { nextRetrievalAction } = await import("../../../src/core/retrieval-loop-state");
		expect(
			nextRetrievalAction({
				iteration: 0,
				maxIterations: 0,
				hasQueryPlan: false,
				hitCount: 0,
				fetchedCount: 0,
				sufficient: false,
			}),
		).toBe("stop_budget_exhausted");
	});
});
