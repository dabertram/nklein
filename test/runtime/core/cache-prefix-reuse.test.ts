import { describe, expect, it } from "vitest";
import { type CacheFragment, estimatePrefixReuse, sharedPrefixTokens } from "../../../src/core/cache-prefix-reuse";

/** Terse fragment builder for the tests. */
function frag(id: string, tokenCount: number): CacheFragment {
	return { id, tokenCount };
}

describe("sharedPrefixTokens", () => {
	it("returns the whole sequence when previous and next are identical", () => {
		const seq = [frag("sys", 100), frag("tools", 200), frag("task", 50)];
		expect(sharedPrefixTokens(seq, seq)).toEqual({ sharedFragments: 3, sharedTokens: 350 });
	});

	it("stops at the first fragment whose id differs", () => {
		const prev = [frag("sys", 100), frag("tools", 200), frag("taskA", 50)];
		const next = [frag("sys", 100), frag("tools", 200), frag("taskB", 40)];
		// sys + tools match; taskA vs taskB differs → prefix is the first two.
		expect(sharedPrefixTokens(prev, next)).toEqual({ sharedFragments: 2, sharedTokens: 300 });
	});

	it("stops when the id matches but the token count differs (bytes changed)", () => {
		const prev = [frag("sys", 100), frag("tools", 200)];
		const next = [frag("sys", 100), frag("tools", 201)];
		expect(sharedPrefixTokens(prev, next)).toEqual({ sharedFragments: 1, sharedTokens: 100 });
	});

	it("breaks immediately when the first fragment differs (the cliff)", () => {
		const prev = [frag("date-2026-06-30", 8), frag("sys", 100), frag("tools", 200)];
		const next = [frag("date-2026-07-01", 8), frag("sys", 100), frag("tools", 200)];
		// A volatile fragment placed FIRST wipes the whole reusable prefix — the §5.AQ item-D warning, quantified.
		expect(sharedPrefixTokens(prev, next)).toEqual({ sharedFragments: 0, sharedTokens: 0 });
	});

	it("counts only up to the shorter sequence when next is a prefix of previous", () => {
		const prev = [frag("sys", 100), frag("tools", 200), frag("history", 300)];
		const next = [frag("sys", 100), frag("tools", 200)];
		expect(sharedPrefixTokens(prev, next)).toEqual({ sharedFragments: 2, sharedTokens: 300 });
	});

	it("counts only up to the shorter sequence when previous is a prefix of next (append-only turn)", () => {
		const prev = [frag("sys", 100), frag("tools", 200)];
		const next = [frag("sys", 100), frag("tools", 200), frag("turn-2", 42)];
		// Append-only history: the whole prior prefix is reused, only the new tail re-prefills.
		expect(sharedPrefixTokens(prev, next)).toEqual({ sharedFragments: 2, sharedTokens: 300 });
	});

	it("is empty when either sequence is empty", () => {
		expect(sharedPrefixTokens([], [frag("sys", 100)])).toEqual({ sharedFragments: 0, sharedTokens: 0 });
		expect(sharedPrefixTokens([frag("sys", 100)], [])).toEqual({ sharedFragments: 0, sharedTokens: 0 });
		expect(sharedPrefixTokens([], [])).toEqual({ sharedFragments: 0, sharedTokens: 0 });
	});

	it("normalizes messy token counts (negative / non-finite / fractional → floored non-negative)", () => {
		const prev = [frag("a", -5), frag("b", Number.NaN), frag("c", 10.9)];
		const next = [frag("a", 0), frag("b", 0), frag("c", 10)];
		// -5→0 and 0 match; NaN→0 and 0 match; 10.9→10 and 10 match → all three shared, summing 0+0+10.
		expect(sharedPrefixTokens(prev, next)).toEqual({ sharedFragments: 3, sharedTokens: 10 });
	});

	it("does not mutate its inputs", () => {
		const prev = [frag("sys", 100), frag("tools", 200)];
		const next = [frag("sys", 100), frag("other", 200)];
		const prevCopy = structuredClone(prev);
		const nextCopy = structuredClone(next);
		sharedPrefixTokens(prev, next);
		expect(prev).toEqual(prevCopy);
		expect(next).toEqual(nextCopy);
	});
});

describe("estimatePrefixReuse", () => {
	it("reports full reuse for an unchanged prompt (best case)", () => {
		const seq = [frag("sys", 100), frag("tools", 200)];
		expect(estimatePrefixReuse(seq, seq)).toEqual({
			sharedFragments: 2,
			sharedTokens: 300,
			nextTotalTokens: 300,
			recomputeTokens: 0,
			reuseRatio: 1,
			requiresRecompute: false,
			firstFragmentChanged: false,
		});
	});

	it("reports the stable-prefix + volatile-suffix layout (the §5.AQ target: reuse most, re-prefill only the tail)", () => {
		const prev = [frag("sys", 100), frag("tools", 200), frag("suffix-turn1", 50)];
		const next = [frag("sys", 100), frag("tools", 200), frag("suffix-turn2", 50)];
		const est = estimatePrefixReuse(prev, next);
		expect(est.sharedFragments).toBe(2);
		expect(est.sharedTokens).toBe(300);
		expect(est.nextTotalTokens).toBe(350);
		expect(est.recomputeTokens).toBe(50);
		expect(est.reuseRatio).toBeCloseTo(300 / 350, 10);
		expect(est.requiresRecompute).toBe(true);
		expect(est.firstFragmentChanged).toBe(false);
	});

	it("reports the cliff (volatile content at the FRONT) as zero reuse + a flipped firstFragmentChanged", () => {
		const prev = [frag("date-A", 8), frag("sys", 100), frag("tools", 200)];
		const next = [frag("date-B", 8), frag("sys", 100), frag("tools", 200)];
		const est = estimatePrefixReuse(prev, next);
		expect(est.sharedFragments).toBe(0);
		expect(est.sharedTokens).toBe(0);
		expect(est.nextTotalTokens).toBe(308);
		expect(est.recomputeTokens).toBe(308);
		expect(est.reuseRatio).toBe(0);
		expect(est.requiresRecompute).toBe(true);
		expect(est.firstFragmentChanged).toBe(true);
	});

	it("quantifies the layout win: same fragments, date moved from FRONT to SUFFIX reuses vastly more", () => {
		// Bad layout: volatile date first → 0 reuse every turn.
		const badPrev = [frag("date-A", 8), frag("sys", 100), frag("tools", 200)];
		const badNext = [frag("date-B", 8), frag("sys", 100), frag("tools", 200)];
		// Good layout: same content, date moved to the suffix → the stable prefix survives.
		const goodPrev = [frag("sys", 100), frag("tools", 200), frag("date-A", 8)];
		const goodNext = [frag("sys", 100), frag("tools", 200), frag("date-B", 8)];
		const bad = estimatePrefixReuse(badPrev, badNext);
		const good = estimatePrefixReuse(goodPrev, goodNext);
		expect(bad.reuseRatio).toBe(0);
		expect(good.reuseRatio).toBeGreaterThan(bad.reuseRatio);
		expect(good.sharedTokens).toBe(300);
		expect(good.recomputeTokens).toBe(8);
	});

	it("treats one-empty-one-not as the cliff (full prefill of the non-empty side)", () => {
		const cold = estimatePrefixReuse([], [frag("sys", 100), frag("tools", 200)]);
		expect(cold).toEqual({
			sharedFragments: 0,
			sharedTokens: 0,
			nextTotalTokens: 300,
			recomputeTokens: 300,
			reuseRatio: 0,
			requiresRecompute: true,
			firstFragmentChanged: true,
		});
	});

	it("handles both sequences empty: nothing shared, nothing to recompute, no cliff", () => {
		expect(estimatePrefixReuse([], [])).toEqual({
			sharedFragments: 0,
			sharedTokens: 0,
			nextTotalTokens: 0,
			recomputeTokens: 0,
			reuseRatio: 0,
			requiresRecompute: false,
			firstFragmentChanged: false,
		});
	});

	it("handles next shrinking to empty (nothing to prefill, no cliff since position 0 has no next)", () => {
		const est = estimatePrefixReuse([frag("sys", 100)], []);
		expect(est.nextTotalTokens).toBe(0);
		expect(est.recomputeTokens).toBe(0);
		expect(est.reuseRatio).toBe(0);
		expect(est.requiresRecompute).toBe(false);
		// prev has a first fragment, next does not → they disagree at position 0.
		expect(est.firstFragmentChanged).toBe(true);
	});

	it("reuseRatio never exceeds 1 and recomputeTokens is never negative (shared is always a subset of next)", () => {
		const prev = [frag("sys", 100), frag("tools", 200), frag("extra", 999)];
		const next = [frag("sys", 100), frag("tools", 200)];
		const est = estimatePrefixReuse(prev, next);
		expect(est.reuseRatio).toBeLessThanOrEqual(1);
		expect(est.reuseRatio).toBe(1); // next is fully a prefix of prev → 100% reuse of the (shorter) next
		expect(est.recomputeTokens).toBe(0);
		expect(est.recomputeTokens).toBeGreaterThanOrEqual(0);
	});

	it("a first-fragment token-count change (bytes differ) is still the cliff", () => {
		const prev = [frag("sys", 100), frag("tools", 200)];
		const next = [frag("sys", 101), frag("tools", 200)];
		const est = estimatePrefixReuse(prev, next);
		expect(est.firstFragmentChanged).toBe(true);
		expect(est.sharedFragments).toBe(0);
		expect(est.reuseRatio).toBe(0);
	});
});
