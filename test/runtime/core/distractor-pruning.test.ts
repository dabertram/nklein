import { describe, expect, it } from "vitest";
import { pruneDistractors } from "../../../src/core/distractor-pruning";

const items = [
	{ id: "a", score: 100 },
	{ id: "b", score: 90 },
	{ id: "c", score: 40 },
	{ id: "d", score: 10 },
];

describe("pruneDistractors", () => {
	it("keeps everything at sensitivity 0 (no pruning), sorted by score desc", () => {
		const kept = pruneDistractors(items, { sensitivity: 0 });
		expect(kept.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
	});

	it("drops the low-relevance tail harder as sensitivity rises", () => {
		// sensitivity 1 ⇒ floor = 100 * 1 * 0.8 = 80 ⇒ keep only a (100) + b (90).
		expect(pruneDistractors(items, { sensitivity: 1 }).map((i) => i.id)).toEqual(["a", "b"]);
		// sensitivity 0.5 ⇒ floor = 40 ⇒ keep a, b, c (drop d=10).
		expect(pruneDistractors(items, { sensitivity: 0.5 }).map((i) => i.id)).toEqual(["a", "b", "c"]);
	});

	it("never prunes below minKeep, even when the floor would drop more", () => {
		// sensitivity 1 would keep only 2, but minKeep 3 retains the top 3.
		expect(pruneDistractors(items, { sensitivity: 1, minKeep: 3 }).map((i) => i.id)).toEqual(["a", "b", "c"]);
	});

	it("caps survivors at maxKeep (but never below minKeep)", () => {
		expect(pruneDistractors(items, { sensitivity: 0, maxKeep: 2 }).map((i) => i.id)).toEqual(["a", "b"]);
		// maxKeep below minKeep is floored at minKeep.
		expect(pruneDistractors(items, { sensitivity: 0, minKeep: 2, maxKeep: 1 })).toHaveLength(2);
	});

	it("is stable for tied scores (preserves input order) and clamps out-of-range sensitivity", () => {
		const tied = [
			{ id: "x", score: 50 },
			{ id: "y", score: 50 },
		];
		expect(pruneDistractors(tied, { sensitivity: 5 }).map((i) => i.id)).toEqual(["x", "y"]);
		expect(pruneDistractors([], { sensitivity: 0.5 })).toEqual([]);
	});
});
