import { describe, expect, it } from "vitest";
import {
	bestFitnessCandidateForCell,
	projectFailingCells,
	projectFitnessRowsToStableModelKeys,
	projectPassingCells,
	rankFitnessCandidatesForCell,
} from "../../../src/core/fitness-projections";
import { type FitnessRow, fitnessCellKey } from "../../../src/core/fitness-table-schema";

const row = (
	over: Partial<FitnessRow> & Pick<FitnessRow, "modelKey" | "sampleCount" | "successCount">,
): FitnessRow => ({
	role: "worker",
	difficultyTier: "medium",
	retryBudget: 0,
	failureModes: [],
	meanWallTimeMs: null,
	meanWallTimeSamples: 0,
	tokensPerSec: null,
	tokensPerSecSamples: 0,
	knowledgeUseCount: 0,
	knowledgeSkipCount: 0,
	updatedAt: null,
	...over,
});

const byCell = (rows: readonly FitnessRow[]): Record<string, FitnessRow> =>
	Object.fromEntries(rows.map((r) => [fitnessCellKey(r), r]));

describe("projectFitnessRowsToStableModelKeys (F2.21)", () => {
	it("is a no-op when the resolver has no stable mapping (returns each row unchanged)", () => {
		const rows = byCell([row({ modelKey: "runtime-abc", sampleCount: 3, successCount: 2 })]);
		const projected = projectFitnessRowsToStableModelKeys(rows, (key) => key);
		expect(projected).toEqual(rows);
	});

	it("merges two runtime-id rows that map to the same stable model + role + difficulty", () => {
		const rows = byCell([
			row({ modelKey: "runtime-a", role: "worker", difficultyTier: "medium", sampleCount: 4, successCount: 3 }),
			row({ modelKey: "runtime-b", role: "worker", difficultyTier: "medium", sampleCount: 6, successCount: 2 }),
		]);
		const projected = projectFitnessRowsToStableModelKeys(rows, () => "qwen3-8b");
		const cell = fitnessCellKey({ modelKey: "qwen3-8b", role: "worker", difficultyTier: "medium" });
		expect(Object.keys(projected)).toEqual([cell]);
		expect(projected[cell]?.modelKey).toBe("qwen3-8b");
		expect(projected[cell]?.sampleCount).toBe(10);
		expect(projected[cell]?.successCount).toBe(5);
	});

	it("keeps rows in DISTINCT role/difficulty cells separate even when the model key collapses", () => {
		const rows = byCell([
			row({ modelKey: "runtime-a", role: "worker", difficultyTier: "medium", sampleCount: 4, successCount: 4 }),
			row({ modelKey: "runtime-b", role: "reviewer", difficultyTier: "medium", sampleCount: 5, successCount: 5 }),
		]);
		const projected = projectFitnessRowsToStableModelKeys(rows, () => "qwen3-8b");
		expect(Object.keys(projected).sort()).toEqual([
			fitnessCellKey({ modelKey: "qwen3-8b", role: "reviewer", difficultyTier: "medium" }),
			fitnessCellKey({ modelKey: "qwen3-8b", role: "worker", difficultyTier: "medium" }),
		]);
	});
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

describe("knowledge-use tiebreak (F1.1)", () => {
	it("ranks the knowledge-consulting model above an otherwise-identical one; unknown sorts last", () => {
		const tied = [
			row({ modelKey: "blind", sampleCount: 10, successCount: 8, knowledgeUseCount: 0, knowledgeSkipCount: 10 }),
			row({ modelKey: "grounded", sampleCount: 10, successCount: 8, knowledgeUseCount: 9, knowledgeSkipCount: 1 }),
			row({ modelKey: "unknown", sampleCount: 10, successCount: 8 }),
		];
		const ranked = rankFitnessCandidatesForCell(tied, { role: "worker", difficultyTier: "medium" });
		expect(ranked.map((candidate) => candidate.modelKey)).toEqual(["grounded", "blind", "unknown"]);
	});

	it("never outranks a higher success rate", () => {
		const rows2 = [
			row({ modelKey: "better", sampleCount: 10, successCount: 9 }),
			row({ modelKey: "grounded", sampleCount: 10, successCount: 8, knowledgeUseCount: 10 }),
		];
		const ranked = rankFitnessCandidatesForCell(rows2, { role: "worker", difficultyTier: "medium" });
		expect(ranked[0]?.modelKey).toBe("better");
	});
});
