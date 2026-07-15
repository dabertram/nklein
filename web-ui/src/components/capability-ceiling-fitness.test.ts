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

import { deriveTopReevalCells } from "./model-performance-stats-dialog";

describe("deriveTopReevalCells", () => {
	const now = 1000 * 24 * 60 * 60 * 1000;
	const r = (modelKey: string, sampleCount: number, updatedAt: number | null) => ({
		modelKey,
		role: "worker",
		difficultyTier: "easy" as const,
		successRate: 0.5,
		confidenceLowerBound: 0.4,
		confidenceBand: "low" as const,
		sampleCount,
		belowBar: false,
		retryBudget: 0,
		tokensPerSec: null,
		meanWallTimeMs: null,
		updatedAt,
	});

	it("ranks never-measured/thin/stale cells first", () => {
		const top = deriveTopReevalCells(
			[r("settled", 8, now), r("never", 0, null), r("stale-thin", 1, now - 200 * 24 * 60 * 60 * 1000)] as never,
			now,
		);
		expect(top[0]?.cellKey).not.toContain("settled"); // settled ranks last
		expect(top.some((c) => c.cellKey.includes("never") || c.cellKey.includes("stale-thin"))).toBe(true);
	});

	it("is empty for no rows", () => {
		expect(deriveTopReevalCells([], now)).toEqual([]);
	});
});
