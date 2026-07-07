import { describe, expect, it } from "vitest";
import type { ReviewerCandidate } from "../../../src/nklein-agent/nklein-reviewer-candidate-selection";
import { panelLineageBreadth, selectReviewerPanel } from "../../../src/nklein-agent/nklein-reviewer-panel-selection";

// modelId drives lineage; score drives depth ordering.
const cand = (modelKey: string, modelId: string, score: number): ReviewerCandidate => ({ modelKey, modelId, score });

describe("selectReviewerPanel", () => {
	it("picks the deepest judge from each DISTINCT non-worker family (max diversity)", () => {
		const panel = selectReviewerPanel({
			candidates: [
				cand("m1", "mistralai/devstral-small", 80),
				cand("g1", "gemma-3-12b", 70),
				cand("q1", "qwen3-8b", 90), // worker lineage → excluded from pass 1
				cand("p1", "phi-4-reasoning-plus", 60),
			],
			workerLineage: "qwen",
			size: 3,
		});
		// 3 distinct non-qwen families, depth-first: mistral(80) > gemma(70) > phi(60); the higher-scored qwen is excluded.
		expect(panel.map((c) => c.modelKey)).toEqual(["m1", "g1", "p1"]);
		expect(panelLineageBreadth(panel)).toBe(3);
	});

	it("does not pick the worker's own lineage in the diversity pass", () => {
		const panel = selectReviewerPanel({
			candidates: [cand("q1", "qwopus3.6-27b", 95), cand("m1", "mistralai/devstral", 50)],
			workerLineage: "qwen",
			size: 3,
		});
		// q1 is qwen (worker lineage) → only picked in the FILL pass, after the diverse mistral.
		expect(panel[0].modelKey).toBe("m1"); // diverse first
		expect(panel.map((c) => c.modelKey)).toContain("q1"); // filled to reach size
	});

	it("fills to size with the best remaining when fewer distinct families than size", () => {
		const panel = selectReviewerPanel({
			candidates: [
				cand("m1", "mistralai/devstral-a", 80),
				cand("m2", "mistralai/devstral-b", 75), // same mistral family, 2nd best
				cand("g1", "gemma-3", 60),
			],
			workerLineage: "qwen",
			size: 3,
		});
		// Pass 1: mistral(m1) + gemma(g1) = 2 distinct. Pass 2 fills with m2 (best remaining).
		expect(panel.map((c) => c.modelKey)).toEqual(["m1", "g1", "m2"]);
		expect(panelLineageBreadth(panel)).toBe(2); // real diversity is 2 families despite 3 judges
	});

	it("returns fewer than size when fewer candidates exist (a 1-model fleet ⇒ 1-judge panel)", () => {
		expect(
			selectReviewerPanel({ candidates: [cand("m1", "mistral-x", 50)], workerLineage: "qwen", size: 3 }),
		).toHaveLength(1);
		expect(selectReviewerPanel({ candidates: [], workerLineage: "qwen", size: 3 })).toEqual([]);
	});

	it("size 0 yields an empty panel", () => {
		expect(
			selectReviewerPanel({ candidates: [cand("m1", "mistral-x", 50)], workerLineage: "qwen", size: 0 }),
		).toEqual([]);
	});
});
