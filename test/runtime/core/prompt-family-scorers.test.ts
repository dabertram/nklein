import { describe, expect, it } from "vitest";
import { scoreDefectCatchingReview, scorePassingCode, scoreValidDag } from "../../../src/core/prompt-family-scorers";

describe("scoreValidDag", () => {
	it("scores 1 for a valid acyclic graph with resolvable edges", () => {
		expect(
			scoreValidDag({
				nodes: ["a", "b", "c"],
				edges: [
					{ from: "a", to: "b" },
					{ from: "b", to: "c" },
				],
			}),
		).toBe(1);
	});

	it("scores 0 for a cycle", () => {
		expect(
			scoreValidDag({
				nodes: ["a", "b"],
				edges: [
					{ from: "a", to: "b" },
					{ from: "b", to: "a" },
				],
			}),
		).toBe(0);
	});

	it("scores 0 when an edge references an unknown node", () => {
		expect(scoreValidDag({ nodes: ["a"], edges: [{ from: "a", to: "ghost" }] })).toBe(0);
	});

	it("an edgeless node set is a trivially valid DAG", () => {
		expect(scoreValidDag({ nodes: ["a", "b"], edges: [] })).toBe(1);
	});

	it("detects a longer cycle (a→b→c→a)", () => {
		expect(
			scoreValidDag({
				nodes: ["a", "b", "c"],
				edges: [
					{ from: "a", to: "b" },
					{ from: "b", to: "c" },
					{ from: "c", to: "a" },
				],
			}),
		).toBe(0);
	});
});

describe("scorePassingCode", () => {
	it("is the pass fraction", () => {
		expect(scorePassingCode(8, 10)).toBe(0.8);
		expect(scorePassingCode(10, 10)).toBe(1);
	});

	it("0 total tests ⇒ 0 (nothing proven)", () => {
		expect(scorePassingCode(0, 0)).toBe(0);
	});

	it("clamps passed to [0,total]", () => {
		expect(scorePassingCode(20, 10)).toBe(1);
		expect(scorePassingCode(-5, 10)).toBe(0);
	});
});

describe("scoreDefectCatchingReview", () => {
	it("is the recall of seeded defects", () => {
		expect(scoreDefectCatchingReview(["d1", "d3"], ["d1", "d2", "d3", "d4"])).toBe(0.5);
	});

	it("catching all seeded defects ⇒ 1", () => {
		expect(scoreDefectCatchingReview(["d1", "d2"], ["d1", "d2"])).toBe(1);
	});

	it("no seeded defects ⇒ 1 (a clean review of clean code is correct)", () => {
		expect(scoreDefectCatchingReview([], [])).toBe(1);
	});

	it("flagging non-defects doesn't inflate the score (only seeded ones count)", () => {
		expect(scoreDefectCatchingReview(["noise", "d1"], ["d1", "d2"])).toBe(0.5);
	});
});

describe("scorer non-finite / duplicate-node fail-safe (regression: bug-hunt 2026-07-05)", () => {
	it("scorePassingCode sanitizes NaN to 0", () => {
		expect(scorePassingCode(Number.NaN, 10)).toBe(0);
		expect(scorePassingCode(5, Number.NaN)).toBe(0);
		expect(Number.isNaN(scorePassingCode(Number.NaN, Number.NaN))).toBe(false);
	});

	it("scoreValidDag deduplicates node ids (a valid DAG with a repeated node id is not misreported as a cycle)", () => {
		// Before the fix: removed(2) !== raw graph.nodes.length(3) ⇒ wrongly scored 0.
		expect(scoreValidDag({ nodes: ["a", "b", "b"], edges: [{ from: "a", to: "b" }] })).toBe(1);
	});
});
