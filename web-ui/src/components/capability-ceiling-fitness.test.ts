import { describe, expect, it } from "vitest";
import { deriveFitnessCapabilityCeiling } from "./model-performance-stats-dialog";

/** F3.35 web surface — capability ceiling derived from the fitness browser rows (shared core). */
const row = (modelKey: string, role: string, confidenceLowerBound: number) => ({
	modelKey,
	role,
	difficultyTier: "medium" as const,
	successRate: confidenceLowerBound,
	confidenceLowerBound,
	confidenceBand: "medium" as const,
	sampleCount: 5,
	belowBar: false,
	retryBudget: 0,
	tokensPerSec: null,
	meanWallTimeMs: null,
	updatedAt: 0,
});

describe("deriveFitnessCapabilityCeiling", () => {
	it("flags a role whose best measured model is below the bar", () => {
		const hits = deriveFitnessCapabilityCeiling([row("weak", "reviewer", 0.55), row("ok", "worker", 0.7)] as never);
		expect(hits.map((h) => h.role)).toEqual(["reviewer"]); // worker (0.7 ≥ 0.6) clears; reviewer (0.55 < 0.7) doesn't
	});

	it("returns no hits when every present role clears its bar", () => {
		expect(deriveFitnessCapabilityCeiling([row("strong", "worker", 0.9)] as never)).toEqual([]);
	});

	it("is empty for no rows", () => {
		expect(deriveFitnessCapabilityCeiling([])).toEqual([]);
	});
});
