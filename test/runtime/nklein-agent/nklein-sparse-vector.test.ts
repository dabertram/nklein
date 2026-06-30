import { describe, expect, it } from "vitest";

import { cosineSimilarity, entriesToVector, vectorToEntries } from "../../../src/nklein-agent/nklein-sparse-vector";

describe("vectorToEntries", () => {
	it("serializes a vector to entries sorted by token", () => {
		const vector = new Map([
			["b", 2],
			["a", 1],
			["c", 3],
		]);
		expect(vectorToEntries(vector)).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
	});
});

describe("entriesToVector", () => {
	it("rebuilds a vector, dropping blank tokens and non-finite weights", () => {
		const vector = entriesToVector([
			["a", 1],
			["  ", 2],
			["b", Number.NaN],
			["c", Number.POSITIVE_INFINITY],
			["d", 4],
		]);
		expect([...vector.entries()]).toEqual([
			["a", 1],
			["d", 4],
		]);
	});

	it("round-trips with vectorToEntries", () => {
		const entries: Array<[string, number]> = [
			["a", 1],
			["b", 2],
		];
		expect(vectorToEntries(entriesToVector(entries))).toEqual(entries);
	});
});

describe("cosineSimilarity", () => {
	it("is 1 for identical vectors", () => {
		const vector = new Map([
			["a", 3],
			["b", 4],
		]);
		expect(cosineSimilarity(vector, new Map(vector))).toBeCloseTo(1);
	});

	it("is 0 for vectors with no shared tokens (orthogonal)", () => {
		expect(cosineSimilarity(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(0);
	});

	it("is 0 when either vector is empty", () => {
		expect(cosineSimilarity(new Map(), new Map([["a", 1]]))).toBe(0);
		expect(cosineSimilarity(new Map([["a", 1]]), new Map())).toBe(0);
	});

	it("computes the expected fractional similarity for partial overlap", () => {
		// left = {a:1, b:1} (|left| = √2), right = {a:1} (|right| = 1), dot = 1 → 1/√2
		expect(
			cosineSimilarity(
				new Map([
					["a", 1],
					["b", 1],
				]),
				new Map([["a", 1]]),
			),
		).toBeCloseTo(1 / Math.sqrt(2));
	});

	it("ignores magnitude scaling (cosine, not dot)", () => {
		expect(cosineSimilarity(new Map([["a", 1]]), new Map([["a", 100]]))).toBeCloseTo(1);
	});
});
