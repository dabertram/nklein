import { describe, expect, it } from "vitest";
import {
	bestFitnessCandidateForCell,
	projectFailingCells,
	projectPassingCells,
	rankFitnessCandidatesForCell,
} from "../../../src/core/fitness-projections";
import type { FitnessRow } from "../../../src/core/fitness-table-schema";

const row = (
	over: Partial<FitnessRow> & Pick<FitnessRow, "modelKey" | "sampleCount" | "successCount">,
): FitnessRow => ({
	role: "worker",
	difficultyTier: "medium",
	retryBudget: 0,
	failureModes: [],
	meanWallTimeMs: null,
	tokensPerSec: null,
	updatedAt: null,
	...over,
});

const rows: FitnessRow[] = [
	row({ modelKey: "strong", sampleCount: 10, successCount: 9 }), // 0.9 — passing
	row({ modelKey: "weak", sampleCount: 10, successCount: 2 }), // 0.2 — failing
	row({ modelKey: "mid", sampleCount: 10, successCount: 6 }), // 0.6 — at bar (0.6)
	row({ modelKey: "undersampled", sampleCount: 1, successCount: 0 }), // 0.0 but too few samples
];

describe("projectFailingCells (the failing-LLM list)", () => {
	it("is below-bar, well-sampled cells sorted worst-first — excludes under-sampled ones", () => {
		const failing = projectFailingCells(rows, { minSuccessRate: 0.6, minSamples: 5 });
		expect(failing.map((r) => r.modelKey)).toEqual(["weak"]); // mid is AT 0.6 (not below); undersampled excluded
	});

	it("respects the bar (raising it pulls in mid)", () => {
		const failing = projectFailingCells(rows, { minSuccessRate: 0.7, minSamples: 5 });
		expect(failing.map((r) => r.modelKey)).toEqual(["weak", "mid"]); // worst-first
	});
});

describe("projectPassingCells (the dual)", () => {
	it("is at/above-bar, well-sampled cells sorted best-first", () => {
		const passing = projectPassingCells(rows, { minSuccessRate: 0.6, minSamples: 5 });
		expect(passing.map((r) => r.modelKey)).toEqual(["strong", "mid"]);
	});
});

describe("rankFitnessCandidatesForCell (model-selection read side)", () => {
	it("ranks models for a role×difficulty cell best-first by success rate", () => {
		const ranked = rankFitnessCandidatesForCell(rows, { role: "worker", difficultyTier: "medium" });
		// default minSamples=1 ⇒ undersampled (0.0) is included but sorts last
		expect(ranked.map((r) => r.modelKey)).toEqual(["strong", "mid", "weak", "undersampled"]);
	});

	it("excludes cells for a different role or difficulty", () => {
		const mixed: FitnessRow[] = [
			row({ modelKey: "m", role: "worker", difficultyTier: "medium", sampleCount: 5, successCount: 5 }),
			row({ modelKey: "m", role: "reviewer", difficultyTier: "medium", sampleCount: 5, successCount: 5 }),
			row({ modelKey: "m", role: "worker", difficultyTier: "hard", sampleCount: 5, successCount: 5 }),
		];
		const ranked = rankFitnessCandidatesForCell(mixed, { role: "worker", difficultyTier: "medium" });
		expect(ranked).toHaveLength(1);
	});

	it("honors minSamples (unsampled cells are not rankable)", () => {
		const ranked = rankFitnessCandidatesForCell(rows, { role: "worker", difficultyTier: "medium", minSamples: 5 });
		expect(ranked.map((r) => r.modelKey)).toEqual(["strong", "mid", "weak"]); // undersampled (1) dropped
	});

	it("tie-breaks equal success rates by sample count desc, then wall time asc", () => {
		const tied: FitnessRow[] = [
			row({ modelKey: "slow-well-sampled", sampleCount: 20, successCount: 20, meanWallTimeMs: 5000 }),
			row({ modelKey: "fast-less-sampled", sampleCount: 10, successCount: 10, meanWallTimeMs: 100 }),
			row({ modelKey: "same-samples-fast", sampleCount: 20, successCount: 20, meanWallTimeMs: 200 }),
		];
		const ranked = rankFitnessCandidatesForCell(tied, { role: "worker", difficultyTier: "medium" });
		// all rate 1.0 → sampleCount 20 beats 10; among the two 20s, faster (200) beats slower (5000)
		expect(ranked.map((r) => r.modelKey)).toEqual(["same-samples-fast", "slow-well-sampled", "fast-less-sampled"]);
	});

	it("bestFitnessCandidateForCell returns the top model or null when none has evidence", () => {
		expect(bestFitnessCandidateForCell(rows, { role: "worker", difficultyTier: "medium" })?.modelKey).toBe("strong");
		expect(bestFitnessCandidateForCell(rows, { role: "architect", difficultyTier: "easy" })).toBeNull();
	});
});
