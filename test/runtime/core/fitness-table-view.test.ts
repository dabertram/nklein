import { describe, expect, it } from "vitest";
import { fitnessRowSchema } from "../../../src/core/fitness-table-schema";
import { buildFitnessTableView, DEFAULT_FITNESS_VIEW_CRITERIA } from "../../../src/core/fitness-table-view";

/** Build a valid FitnessRow (schema-defaulted) with the fields a test cares about. */
function row(over: {
	modelKey: string;
	role?: string;
	difficultyTier?: "easy" | "medium" | "hard";
	sampleCount?: number;
	successCount?: number;
	failureModes?: { kind: string; count: number }[];
}) {
	return fitnessRowSchema.parse({
		modelKey: over.modelKey,
		role: over.role ?? "worker",
		difficultyTier: over.difficultyTier ?? "medium",
		sampleCount: over.sampleCount ?? 0,
		successCount: over.successCount ?? 0,
		...(over.failureModes ? { failureModes: over.failureModes } : {}),
	});
}

describe("buildFitnessTableView", () => {
	it("derives successRate and sorts worst-first (tie broken by cell key)", () => {
		const view = buildFitnessTableView([
			row({ modelKey: "strong-m", sampleCount: 10, successCount: 9 }),
			row({ modelKey: "weak-m", sampleCount: 10, successCount: 2 }),
			row({ modelKey: "mid-b", sampleCount: 4, successCount: 2 }),
			row({ modelKey: "mid-a", sampleCount: 4, successCount: 2 }),
		]);
		expect(view.map((r) => r.modelKey)).toEqual(["weak-m", "mid-a", "mid-b", "strong-m"]);
		expect(view[0]?.successRate).toBeCloseTo(0.2);
		expect(view.at(-1)?.successRate).toBeCloseTo(0.9);
	});

	it("flags belowBar for well-sampled cells under the bar, but NOT under-sampled ones", () => {
		const view = buildFitnessTableView([
			// well-sampled + under 50% ⇒ failing.
			row({ modelKey: "failing", sampleCount: 5, successCount: 1 }),
			// under 50% BUT only 2 samples (< minSamples 3) ⇒ not yet judged.
			row({ modelKey: "unproven", sampleCount: 2, successCount: 0 }),
			// well-sampled + above the bar ⇒ passing.
			row({ modelKey: "passing", sampleCount: 5, successCount: 4 }),
		]);
		const byKey = new Map(view.map((r) => [r.modelKey, r.belowBar]));
		expect(byKey.get("failing")).toBe(true);
		expect(byKey.get("unproven")).toBe(false);
		expect(byKey.get("passing")).toBe(false);
	});

	it("respects an injected criteria (a stricter bar condemns a borderline cell)", () => {
		const rows = [row({ modelKey: "borderline", sampleCount: 10, successCount: 6 })]; // 60%
		expect(buildFitnessTableView(rows, DEFAULT_FITNESS_VIEW_CRITERIA)[0]?.belowBar).toBe(false); // 60% ≥ 50%
		expect(buildFitnessTableView(rows, { minSuccessRate: 0.8, minSamples: 3 })[0]?.belowBar).toBe(true); // 60% < 80%
	});

	it("carries failure modes through and handles an unsampled cell (rate 0, not below-bar)", () => {
		const view = buildFitnessTableView([
			row({ modelKey: "m", sampleCount: 0, successCount: 0, failureModes: [{ kind: "tool_loop", count: 3 }] }),
		]);
		expect(view[0]?.successRate).toBe(0);
		expect(view[0]?.belowBar).toBe(false); // 0 samples < minSamples ⇒ not judged
		expect(view[0]?.failureModes).toEqual([{ kind: "tool_loop", count: 3 }]);
	});

	it("returns an empty list for an empty table", () => {
		expect(buildFitnessTableView([])).toEqual([]);
	});
});
