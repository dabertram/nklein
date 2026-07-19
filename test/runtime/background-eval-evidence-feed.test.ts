import { describe, expect, it } from "vitest";
import { buildBackgroundEvalEvidenceByModel } from "../../src/core/background-eval-evidence-feed";
import type { ModelEvalRun } from "../../src/core/model-eval-aggregation";

function run(modelId: string, role: string, difficulty: ModelEvalRun["difficulty"]): ModelEvalRun {
	return { modelId, role, difficulty, passed: true, qualityScore: 0.9, latencyMs: 1_000, retries: 0 };
}

describe("background-eval evidence feed (F1.32b)", () => {
	it("gives the sparsely-covered model more probe need than the well-covered one", () => {
		const runs: ModelEvalRun[] = [
			// covered: worker across three tiers + reviewer two tiers
			run("covered", "worker", "trivial"),
			run("covered", "worker", "easy"),
			run("covered", "worker", "medium"),
			run("covered", "reviewer", "trivial"),
			run("covered", "reviewer", "easy"),
			// sparse: one lone cell
			run("sparse", "worker", "trivial"),
		];
		const evidence = buildBackgroundEvalEvidenceByModel(runs, { now: 1_000_000 });
		const covered = evidence.get("covered");
		const sparse = evidence.get("sparse");
		expect(covered).toBeDefined();
		expect(sparse).toBeDefined();
		expect(sparse?.probeCount ?? 0).toBeGreaterThan(0);
		expect((sparse?.probeCount ?? 0) >= (covered?.probeCount ?? 0)).toBe(true);
		expect((sparse?.topProbePriority ?? 0) >= (covered?.topProbePriority ?? 0)).toBe(true);
	});

	it("returns an empty map for an empty run log (missing store degrades to zero-need ties)", () => {
		expect(buildBackgroundEvalEvidenceByModel([], { now: 1 }).size).toBe(0);
	});
});
