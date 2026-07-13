import { describe, expect, it } from "vitest";
import type {
	RuntimeDecompositionKnowledgeUsageAggregate,
	RuntimeFitnessTableResponse,
	RuntimeModelPerformanceAggregate,
} from "@/runtime/types";
import {
	FITNESS_STALE_AFTER_MS,
	filterAndSortFitnessRows,
	isFitnessRowStale,
	rollUpAggregatesByModel,
	selectModelRollups,
	summarizeDecompositionKnowledge,
} from "./model-performance-stats-dialog";

function aggregate(overrides: Partial<RuntimeModelPerformanceAggregate>): RuntimeModelPerformanceAggregate {
	return {
		key: "k",
		scope: "overall",
		appVersion: null,
		workspacePathHash: null,
		projectName: null,
		role: "worker",
		providerId: "lmstudio",
		modelId: "qwen3-8b",
		endpoint: null,
		runs: 0,
		completedRuns: 0,
		failedRuns: 0,
		interruptedRuns: 0,
		awaitingReviewRuns: 0,
		successRate: 0,
		averageWallTimeMs: null,
		averageTimeToFirstTokenMs: null,
		averageInputTokens: null,
		averageOutputTokens: null,
		averageContextPressure: null,
		lastObservedAt: 0,
		...overrides,
	};
}

describe("rollUpAggregatesByModel (todo §5.Q)", () => {
	it("combines overall-scope role splits into one global row per model with exact successRate", () => {
		const rollups = rollUpAggregatesByModel([
			aggregate({
				scope: "overall",
				role: "architect",
				modelId: "qwen3-8b",
				runs: 4,
				completedRuns: 3,
				failedRuns: 1,
				lastObservedAt: 10,
			}),
			aggregate({
				scope: "overall",
				role: "worker",
				modelId: "qwen3-8b",
				runs: 6,
				completedRuns: 3,
				interruptedRuns: 3,
				lastObservedAt: 20,
			}),
			aggregate({
				scope: "overall",
				role: "worker",
				modelId: "deepseek",
				runs: 2,
				completedRuns: 2,
				lastObservedAt: 5,
			}),
			// Non-overall scopes re-count the same runs and MUST be ignored (else the model is double-counted).
			aggregate({
				scope: "version",
				role: "worker",
				modelId: "qwen3-8b",
				runs: 6,
				completedRuns: 3,
				lastObservedAt: 99,
			}),
			aggregate({
				scope: "project",
				role: "worker",
				modelId: "qwen3-8b",
				runs: 6,
				completedRuns: 3,
				lastObservedAt: 99,
			}),
		]);

		expect(rollups).toHaveLength(2);
		// Sorted by runs desc → qwen3-8b (10) before deepseek (2). One row per model, not per role/scope.
		expect(rollups[0]?.modelId).toBe("qwen3-8b");
		expect(rollups[0]).toMatchObject({ runs: 10, completedRuns: 6, failedRuns: 1, interruptedRuns: 3 });
		// lastObservedAt is the max across overall rows only (20), never the ignored version/project rows (99).
		expect(rollups[0]?.lastObservedAt).toBe(20);
		// successRate is recomputed from summed counts (6/10), not averaged across rows.
		expect(rollups[0]?.successRate).toBeCloseTo(0.6);
		expect(rollups[1]).toMatchObject({ modelId: "deepseek", runs: 2, successRate: 1 });
	});

	it("returns an empty list when there are no aggregates", () => {
		expect(rollUpAggregatesByModel([])).toEqual([]);
	});
});

describe("selectModelRollups (todo §5.Q backend precision rollup)", () => {
	it("prefers the backend model-scope aggregates (with exact timing) when present", () => {
		const rollups = selectModelRollups([
			// The overall-scope rows would also roll up, but the precise model-scope row must win.
			aggregate({ scope: "overall", role: "worker", modelId: "qwen3-8b", runs: 99, completedRuns: 99 }),
			aggregate({
				scope: "model",
				role: "unknown",
				modelId: "qwen3-8b",
				endpoint: "http://localhost:1234/v1",
				runs: 10,
				completedRuns: 6,
				successRate: 0.6,
				averageWallTimeMs: 4200,
				lastObservedAt: 50,
			}),
		]);
		expect(rollups).toHaveLength(1);
		expect(rollups[0]).toMatchObject({ modelId: "qwen3-8b", runs: 10, successRate: 0.6, averageWallTimeMs: 4200 });
	});

	it("falls back to the client overall-scope roll-up when no model scope is present (older server)", () => {
		const rollups = selectModelRollups([
			aggregate({ scope: "overall", role: "worker", modelId: "qwen3-8b", runs: 4, completedRuns: 2 }),
		]);
		expect(rollups).toHaveLength(1);
		expect(rollups[0]).toMatchObject({ modelId: "qwen3-8b", runs: 4, successRate: 0.5 });
		expect(rollups[0]?.averageWallTimeMs).toBeUndefined();
	});
});

function decompAggregate(
	overrides: Partial<RuntimeDecompositionKnowledgeUsageAggregate>,
): RuntimeDecompositionKnowledgeUsageAggregate {
	return {
		key: "k",
		scope: "overall",
		appVersion: null,
		workspacePathHash: null,
		projectName: null,
		role: "architect",
		providerId: "lmstudio",
		modelId: "qwen3-8b",
		decompositions: 0,
		withKnowledgeTools: 0,
		withoutKnowledgeTools: 0,
		knowledgeUsageRate: 0,
		lastDecomposedAt: 0,
		...overrides,
	};
}

describe("summarizeDecompositionKnowledge (todo §5.B)", () => {
	it("sums only overall-scope aggregates and recomputes the knowledge-first rate", () => {
		const totals = summarizeDecompositionKnowledge([
			decompAggregate({ scope: "overall", role: "architect", decompositions: 4, withKnowledgeTools: 3 }),
			decompAggregate({ scope: "overall", role: "worker", decompositions: 6, withKnowledgeTools: 2 }),
			// version/project rows re-count the same decompositions and must be ignored (no double-count).
			decompAggregate({ scope: "version", decompositions: 10, withKnowledgeTools: 5 }),
			decompAggregate({ scope: "project", decompositions: 10, withKnowledgeTools: 5 }),
		]);
		expect(totals.decompositions).toBe(10);
		expect(totals.withKnowledgeTools).toBe(5);
		expect(totals.rate).toBeCloseTo(0.5);
	});

	it("returns zeros when there are no aggregates", () => {
		expect(summarizeDecompositionKnowledge([])).toEqual({ decompositions: 0, withKnowledgeTools: 0, rate: 0 });
	});
});

type FitnessRow = RuntimeFitnessTableResponse["rows"][number];

function fitnessRow(overrides: Partial<FitnessRow>): FitnessRow {
	return {
		modelKey: "qwen3-8b",
		role: "worker",
		difficultyTier: "medium",
		sampleCount: 10,
		successCount: 6,
		successRate: 0.6,
		confidenceLowerBound: 0.3,
		confidenceBand: "medium",
		retryBudget: 1,
		failureModes: [],
		meanWallTimeMs: null,
		tokensPerSec: null,
		updatedAt: 1000,
		belowBar: false,
		...overrides,
	};
}

const NOW = 10_000_000_000;

describe("isFitnessRowStale (F2.22)", () => {
	it("treats an unknown evaluation time as stale (fails cautious)", () => {
		expect(isFitnessRowStale(fitnessRow({ updatedAt: null }), NOW)).toBe(true);
	});

	it("is fresh within the window and stale past it", () => {
		expect(isFitnessRowStale(fitnessRow({ updatedAt: NOW - 1000 }), NOW)).toBe(false);
		expect(isFitnessRowStale(fitnessRow({ updatedAt: NOW - FITNESS_STALE_AFTER_MS - 1 }), NOW)).toBe(true);
	});
});

describe("filterAndSortFitnessRows (F2.22)", () => {
	const baseOptions = {
		roleFilter: "all" as const,
		belowBarOnly: false,
		bandFilter: "all" as const,
		stalenessFilter: "all" as const,
		sort: "successRate" as const,
		now: NOW,
	};

	it("filters by role", () => {
		const rows = [fitnessRow({ role: "worker" }), fitnessRow({ role: "reviewer" })];
		const result = filterAndSortFitnessRows(rows, { ...baseOptions, roleFilter: "reviewer" });
		expect(result).toHaveLength(1);
		expect(result[0]?.role).toBe("reviewer");
	});

	it("filters to below-bar cells only", () => {
		const rows = [fitnessRow({ modelKey: "a", belowBar: true }), fitnessRow({ modelKey: "b", belowBar: false })];
		const result = filterAndSortFitnessRows(rows, { ...baseOptions, belowBarOnly: true });
		expect(result.map((row) => row.modelKey)).toEqual(["a"]);
	});

	it("filters by confidence band", () => {
		const rows = [
			fitnessRow({ modelKey: "hi", confidenceBand: "high" }),
			fitnessRow({ modelKey: "lo", confidenceBand: "low" }),
		];
		const result = filterAndSortFitnessRows(rows, { ...baseOptions, bandFilter: "high" });
		expect(result.map((row) => row.modelKey)).toEqual(["hi"]);
	});

	it("splits fresh vs stale on the window", () => {
		const rows = [
			fitnessRow({ modelKey: "fresh", updatedAt: NOW - 1000 }),
			fitnessRow({ modelKey: "stale", updatedAt: NOW - FITNESS_STALE_AFTER_MS - 1 }),
			fitnessRow({ modelKey: "unknown", updatedAt: null }),
		];
		expect(
			filterAndSortFitnessRows(rows, { ...baseOptions, stalenessFilter: "fresh" }).map((r) => r.modelKey),
		).toEqual(["fresh"]);
		expect(
			filterAndSortFitnessRows(rows, { ...baseOptions, stalenessFilter: "stale" })
				.map((r) => r.modelKey)
				.sort(),
		).toEqual(["stale", "unknown"]);
	});

	it("sorts by confidence lower bound (highest first), breaking ties on sample count", () => {
		const rows = [
			fitnessRow({ modelKey: "low-conf", confidenceLowerBound: 0.1, sampleCount: 5 }),
			fitnessRow({ modelKey: "high-conf", confidenceLowerBound: 0.8, sampleCount: 5 }),
			fitnessRow({ modelKey: "tie-more-samples", confidenceLowerBound: 0.8, sampleCount: 50 }),
		];
		const result = filterAndSortFitnessRows(rows, { ...baseOptions, sort: "confidence" });
		expect(result.map((row) => row.modelKey)).toEqual(["tie-more-samples", "high-conf", "low-conf"]);
	});

	it("sorts by success rate by default, breaking ties on sample count", () => {
		const rows = [
			fitnessRow({ modelKey: "worst", successRate: 0.2, sampleCount: 5 }),
			fitnessRow({ modelKey: "best", successRate: 0.9, sampleCount: 5 }),
			fitnessRow({ modelKey: "best-more-samples", successRate: 0.9, sampleCount: 40 }),
		];
		const result = filterAndSortFitnessRows(rows, baseOptions);
		expect(result.map((row) => row.modelKey)).toEqual(["best-more-samples", "best", "worst"]);
	});
});
