import { describe, expect, it } from "vitest";
import { buildFitnessRoutingEvidence, stableFitnessModelKey } from "../../../src/core/fitness-routing-evidence";
import type { FitnessRow } from "../../../src/core/fitness-table-schema";
import { roleEvidenceKey } from "../../../src/core/ledger-evidence";

function row(
	modelKey: string,
	role: string,
	difficultyTier: string,
	sampleCount: number,
	successCount: number,
): FitnessRow {
	return {
		modelKey,
		role,
		difficultyTier,
		sampleCount,
		successCount,
		retryBudget: 0,
		failureModes: [],
		meanWallTimeMs: null,
		meanWallTimeSamples: 0,
		tokensPerSec: null,
		tokensPerSecSamples: 0,
		knowledgeUseCount: 0,
		knowledgeSkipCount: 0,
		updatedAt: 0,
	} as unknown as FitnessRow;
}

describe("stableFitnessModelKey", () => {
	it("strips a provider prefix and an endpoint suffix onto the bare id", () => {
		expect(stableFitnessModelKey("lmstudio:google/gemma-4-31b-qat:http://localhost:1234/v1")).toBe(
			"google/gemma-4-31b-qat",
		);
		expect(stableFitnessModelKey("lmstudio:qwen/qwen3-8b:default")).toBe("qwen/qwen3-8b");
	});

	it("passes bare ids through unchanged and is idempotent", () => {
		expect(stableFitnessModelKey("google/gemma-4-31b-qat")).toBe("google/gemma-4-31b-qat");
		expect(stableFitnessModelKey(stableFitnessModelKey("lmstudio:a/b:http://x/v1"))).toBe("a/b");
	});
});

describe("buildFitnessRoutingEvidence", () => {
	it("aggregates difficulty tiers per (model, role), weighted by samples, under the NORMALIZED key", () => {
		const evidence = buildFitnessRoutingEvidence([
			row("google/gemma-4-31b-qat", "reviewer", "easy", 1, 1),
			row("google/gemma-4-31b-qat", "reviewer", "medium", 1, 1),
			row("google/gemma-4-31b-qat", "reviewer", "hard", 2, 1), // 0.5 rate, double weight
		]);
		const hit = evidence.fitnessRoleSuccessByKey.get(roleEvidenceKey("google/gemma-4-31b-qat", "reviewer"));
		expect(hit?.samples).toBe(4);
		expect(hit?.successRate).toBeCloseTo((1 + 1 + 0.5 * 2) / 4, 5); // 0.75
	});

	it("folds BOTH writer key shapes (bare harness + canonical runtime) onto one row", () => {
		const evidence = buildFitnessRoutingEvidence([
			row("google/gemma-4-31b-qat", "worker", "easy", 2, 2),
			row("lmstudio:google/gemma-4-31b-qat:http://localhost:1234/v1", "worker", "easy", 2, 0),
		]);
		const hit = evidence.fitnessRoleSuccessByKey.get(roleEvidenceKey("google/gemma-4-31b-qat", "worker"));
		expect(hit?.samples).toBe(4);
		expect(hit?.successRate).toBeCloseTo(0.5, 5);
	});

	it("skips zero-sample cells and returns an empty map for no rows", () => {
		expect(buildFitnessRoutingEvidence([row("m", "worker", "easy", 0, 0)]).fitnessRoleSuccessByKey.size).toBe(0);
		expect(buildFitnessRoutingEvidence([]).fitnessRoleSuccessByKey.size).toBe(0);
	});
});
