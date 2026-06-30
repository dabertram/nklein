import { describe, expect, it } from "vitest";

import { addWeightedEdge, buildPersonalizationVector, calculatePageRank } from "../../../src/nklein-agent/pagerank";

const sum = (xs: readonly number[]) => xs.reduce((total, x) => total + x, 0);

describe("buildPersonalizationVector", () => {
	it("returns null when no node is boosted (all weights <= 1)", () => {
		expect(buildPersonalizationVector([1, 1, 0])).toBeNull();
	});

	it("returns a normalized vector (summing to 1) when a node is boosted", () => {
		const vector = buildPersonalizationVector([3, 1]);
		expect(vector).not.toBeNull();
		expect(sum(vector ?? [])).toBeCloseTo(1);
		expect(vector?.[0]).toBeCloseTo(0.75);
	});
});

describe("addWeightedEdge", () => {
	it("adds a directed weighted edge", () => {
		const edges = new Map<number, Map<number, number>>();
		addWeightedEdge(edges, 0, 1, 2);
		expect(edges.get(0)?.get(1)).toBe(2);
	});

	it("ignores self-loops and non-positive weights", () => {
		const edges = new Map<number, Map<number, number>>();
		addWeightedEdge(edges, 0, 0, 5);
		addWeightedEdge(edges, 0, 1, 0);
		addWeightedEdge(edges, 0, 1, -1);
		expect(edges.size).toBe(0);
	});

	it("accumulates the weight of repeated edges", () => {
		const edges = new Map<number, Map<number, number>>();
		addWeightedEdge(edges, 0, 1, 1);
		addWeightedEdge(edges, 0, 1, 3);
		expect(edges.get(0)?.get(1)).toBe(4);
	});
});

describe("calculatePageRank", () => {
	it("returns an empty array for zero nodes", () => {
		expect(calculatePageRank(0, new Map())).toEqual([]);
	});

	it("conserves total rank mass (≈ 1)", () => {
		const edges = new Map<number, Map<number, number>>();
		addWeightedEdge(edges, 0, 2, 1);
		addWeightedEdge(edges, 1, 2, 1);
		expect(sum(calculatePageRank(3, edges))).toBeCloseTo(1);
	});

	it("ranks a more-referenced node higher", () => {
		const edges = new Map<number, Map<number, number>>();
		addWeightedEdge(edges, 0, 2, 1);
		addWeightedEdge(edges, 1, 2, 1); // node 2 is referenced by both 0 and 1
		const ranks = calculatePageRank(3, edges);
		expect(ranks[2]).toBeGreaterThan(ranks[0] ?? 0);
		expect(ranks[2]).toBeGreaterThan(ranks[1] ?? 0);
	});

	it("stays uniform when there are no edges (all dangling)", () => {
		const ranks = calculatePageRank(3, new Map());
		expect(ranks[0]).toBeCloseTo(1 / 3);
		expect(ranks[1]).toBeCloseTo(1 / 3);
		expect(ranks[2]).toBeCloseTo(1 / 3);
	});
});
