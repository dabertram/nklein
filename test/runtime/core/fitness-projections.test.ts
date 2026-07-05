import { describe, expect, it } from "vitest";
import { projectFailingCells, projectPassingCells } from "../../../src/core/fitness-projections";
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
