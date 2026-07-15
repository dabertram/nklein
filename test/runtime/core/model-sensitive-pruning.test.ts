import { describe, expect, it } from "vitest";
import {
	type EvidenceItem,
	estimateDistractorSensitivity,
	pruneEvidenceForModel,
} from "../../../src/core/model-sensitive-pruning.js";

/** F4.13 — model-sensitive retrieval pruning: prune by relevance scaled to model distractor sensitivity, keep facts+citations. */

const item = (over: Partial<EvidenceItem> & { id: string; relevance: number }): EvidenceItem => ({
	kind: "index",
	required: false,
	isCitation: false,
	...over,
});

describe("estimateDistractorSensitivity", () => {
	it("is ~0 for a robust model and high for a distraction-prone one", () => {
		const robust = estimateDistractorSensitivity([{ noiseFraction: 0.5, baselineQuality: 0.9, noisyQuality: 0.9 }]);
		expect(robust).toBe(0);
		const sensitive = estimateDistractorSensitivity([
			{ noiseFraction: 0.5, baselineQuality: 0.9, noisyQuality: 0.3 },
		]);
		expect(sensitive).toBeGreaterThan(0.9); // 0.6 drop / 0.5 noise = 1.2 → clamped 1
	});

	it("ignores zero-noise observations (no signal)", () => {
		expect(estimateDistractorSensitivity([{ noiseFraction: 0, baselineQuality: 0.9, noisyQuality: 0.1 }])).toBe(0);
	});
});

describe("pruneEvidenceForModel", () => {
	const items: EvidenceItem[] = [
		item({ id: "req", relevance: 0.05, required: true }),
		item({ id: "cite", relevance: 0.05, isCitation: true }),
		item({ id: "high", relevance: 0.9 }),
		item({ id: "mid", relevance: 0.4 }),
		item({ id: "low", relevance: 0.1 }),
	];

	it("always keeps required facts and citations regardless of relevance", () => {
		const result = pruneEvidenceForModel(items, 1); // max sensitivity
		expect(result.kept.map((i) => i.id)).toContain("req");
		expect(result.kept.map((i) => i.id)).toContain("cite");
		expect(result.pruned.map((i) => i.id)).not.toContain("req");
	});

	it("a robust model keeps more; a sensitive model prunes low-relevance distractors harder", () => {
		const robust = pruneEvidenceForModel(items, 0);
		const sensitive = pruneEvidenceForModel(items, 1);
		expect(sensitive.pruned.length).toBeGreaterThan(robust.pruned.length);
		// The high-relevance item survives even at max sensitivity; the low one is pruned.
		expect(sensitive.kept.map((i) => i.id)).toContain("high");
		expect(sensitive.pruned.map((i) => i.id)).toContain("low");
	});

	it("does not over-prune: keeps at least the top prunable item when all would be dropped", () => {
		const allLow: EvidenceItem[] = [item({ id: "a", relevance: 0.05 }), item({ id: "b", relevance: 0.02 })];
		const result = pruneEvidenceForModel(allLow, 1); // threshold 0.75 → both below
		expect(result.kept.map((i) => i.id)).toContain("a"); // top-relevance rescued
		expect(result.pruned.map((i) => i.id)).toEqual(["b"]);
	});
});
