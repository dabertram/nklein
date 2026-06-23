import { describe, expect, it } from "vitest";
import type { RuntimeDecompositionKnowledgeUsageAggregate, RuntimeModelPerformanceAggregate } from "@/runtime/types";
import { rollUpAggregatesByModel, summarizeDecompositionKnowledge } from "./model-performance-stats-dialog";

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
