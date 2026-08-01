import { describe, expect, it } from "vitest";
import {
	measureSerializationCost,
	type PairConflictClassifier,
	type SerializationCostBoard,
} from "../../../src/core/serialization-cost";

/**
 * P21.12 — what file-level serialization actually costs.
 *
 * The load-bearing behaviour is the SPLIT. Aggregated over every board the live measurement said 26% serialized,
 * which reads as a strong case for symbol-level detection. Split by board kind it inverts: 82% on single-file
 * benchmark katas (where collision is a property of the fixture) against 4% on real projects. **Aggregating would
 * have produced a number that justified building the thing.**
 */

/** Classifies red when two cards share any path — enough to exercise the aggregation. */
const sharedPathClassifier: PairConflictClassifier = (left, right) => {
	const shared = (left.filesLikelyTouched ?? []).filter((path) => (right.filesLikelyTouched ?? []).includes(path));
	return { conflictClass: shared.length > 0 ? "red" : "green", sharedSpecificPaths: shared };
};

function board(name: string, isBenchmarkFixture: boolean, cards: string[][]): SerializationCostBoard {
	return {
		name,
		isBenchmarkFixture,
		cards: cards.map((filesLikelyTouched, index) => ({ id: `${name}-${index}`, filesLikelyTouched })),
	};
}

describe("measureSerializationCost", () => {
	it("SPLITS benchmark fixtures from real work — the finding the aggregate hides", () => {
		const report = measureSerializationCost({
			classify: sharedPathClassifier,
			boards: [
				// A single-file kata: every pair collides, by construction of the fixture.
				board("aider-kata", true, [["lib.rs"], ["lib.rs"], ["lib.rs"]]),
				// Real work: disjoint scopes.
				board("real", false, [["a.ts"], ["b.ts"], ["c.ts"]]),
			],
		});
		expect(report.benchmarkFixtures.rate).toBe(1);
		expect(report.realWork.rate).toBe(0);
		// The aggregate alone would read as 50% and argue for work the real-work number says is unnecessary.
		expect(report.all.rate).toBe(0.5);
	});

	it("names the paths doing the serializing, worst first", () => {
		const report = measureSerializationCost({
			classify: sharedPathClassifier,
			boards: [board("b", false, [["hot.ts", "x.ts"], ["hot.ts"], ["hot.ts"], ["x.ts"]])],
		});
		expect(report.topPaths[0]).toEqual({ path: "hot.ts", pairs: 3 });
	});

	it("reports CLASS COUNTS, so a mis-read verdict field cannot produce a clean zero", () => {
		// This exact mistake happened while taking the live measurement: the verdict property was read as `klass`
		// instead of `conflictClass`, every comparison was false, and the run reported a confident 0% serialized.
		const report = measureSerializationCost({
			classify: sharedPathClassifier,
			boards: [board("b", false, [["a.ts"], ["a.ts"], ["b.ts"]])],
		});
		expect(report.classCounts.red).toBe(1);
		expect(report.classCounts.green).toBe(2);
	});

	it("ignores cards with no declared scope rather than diluting the rate", () => {
		// A card the mechanism never examines must not count as a pair it declined to serialize.
		const report = measureSerializationCost({
			classify: sharedPathClassifier,
			boards: [
				{ name: "b", isBenchmarkFixture: false, cards: [{ id: "1", filesLikelyTouched: ["a.ts"] }, { id: "2" }] },
			],
		});
		expect(report.all.pairs).toBe(0);
	});

	it("skips a board that cannot produce a pair", () => {
		const report = measureSerializationCost({
			classify: sharedPathClassifier,
			boards: [board("solo", false, [["a.ts"]])],
		});
		expect(report.all.boards).toBe(0);
	});

	it("reports rate NULL, not zero, when a group has no pairs", () => {
		// "No benchmark boards" is not "benchmarks never serialize".
		const report = measureSerializationCost({
			classify: sharedPathClassifier,
			boards: [board("real", false, [["a.ts"], ["b.ts"]])],
		});
		expect(report.benchmarkFixtures.rate).toBeNull();
		expect(report.realWork.rate).toBe(0);
	});

	it("says plainly that no measurable board proves nothing", () => {
		expect(measureSerializationCost({ classify: sharedPathClassifier, boards: [] }).summary).toMatch(
			/says nothing about serialization cost/u,
		);
	});

	it("carries the upper-bound caveat into the summary", () => {
		// 4% is what symbols could recover AT MOST — some of those pairs collide at symbol level too. A reader
		// acting on the number sees that without opening the source.
		const report = measureSerializationCost({
			classify: sharedPathClassifier,
			boards: [board("real", false, [["a.ts"], ["a.ts"]])],
		});
		expect(report.summary).toMatch(/UPPER BOUND/u);
	});
});
