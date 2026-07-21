import { describe, expect, it } from "vitest";
import {
	applyRetrievalDiscriminator,
	buildRetrievalDiscriminatorPrompt,
	parseRetrievalDiscriminatorDecision,
} from "../../../src/core/retrieval-discriminator";

const candidates = [
	{ id: "a", text: "alpha" },
	{ id: "b", text: "beta" },
	{ id: "c", text: "gamma" },
	{ id: "d", text: "delta" },
];

describe("retrieval discriminator", () => {
	it("parses strict or fenced flat JSON", () => {
		expect(parseRetrievalDiscriminatorDecision('{"ranked_ids":["b","a"],"keep_ids":["b"]}')).toEqual({
			rankedIds: ["b", "a"],
			keepIds: ["b"],
		});
		expect(parseRetrievalDiscriminatorDecision('```json\n{"ranked_ids":["a"],"keep_ids":[]}\n```')).toEqual({
			rankedIds: ["a"],
			keepIds: [],
		});
		expect(parseRetrievalDiscriminatorDecision("not json")).toBeNull();
	});

	it("keeps the ranked floor, honors useful IDs, and reports exact prunes", () => {
		const applied = applyRetrievalDiscriminator(
			candidates,
			{ rankedIds: ["c", "b", "d", "a"], keepIds: ["c", "d"] },
			{ minKeep: 2, maxKeep: 3 },
		);
		expect(applied).toEqual({
			kept: [candidates[2], candidates[1], candidates[3]],
			pruned: [candidates[0]],
			applied: true,
		});
	});

	it("puts omitted candidates at the ordered tail instead of silently deleting them", () => {
		const applied = applyRetrievalDiscriminator(candidates, { rankedIds: ["c"], keepIds: ["c"] });
		expect(applied.kept.map((candidate) => candidate.id)).toEqual(["c", "a"]);
		expect(applied.pruned.map((candidate) => candidate.id)).toEqual(["b", "d"]);
	});

	it("fails open when rank output is foreign-only or candidate IDs collide", () => {
		expect(applyRetrievalDiscriminator(candidates, { rankedIds: ["unknown"], keepIds: ["unknown"] }).applied).toBe(
			false,
		);
		expect(
			applyRetrievalDiscriminator(
				[
					{ id: "same", text: "one" },
					{ id: "same", text: "two" },
				],
				{ rankedIds: ["same"], keepIds: ["same"] },
			).applied,
		).toBe(false);
	});

	it("bounds prompt inputs before the model call", () => {
		const prompt = buildRetrievalDiscriminatorPrompt({
			query: `needle${"q".repeat(3_000)}`,
			candidates: Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, text: "x".repeat(2_000) })),
		});
		expect(prompt).toContain("needle");
		expect(prompt).toContain("[c7]");
		expect(prompt).not.toContain("[c8]");
		expect(prompt.length).toBeLessThan(16_000);
	});
});
