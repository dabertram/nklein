import { describe, expect, it } from "vitest";
import {
	type CachedPrefix,
	DEFAULT_HIT_RATE,
	DEFAULT_RECENCY_HALF_LIFE,
	decidePrefixRetention,
	prefixRetentionValue,
	rankPrefixesByRetention,
	shouldAdmitPrefix,
} from "../../../src/core/cache-prefix-retention";

/** Terse prefix builder for the tests. */
function prefix(id: string, tokenCount: number, extra: Partial<CachedPrefix> = {}): CachedPrefix {
	return { id, tokenCount, ageSinceUse: 0, ...extra };
}

describe("prefixRetentionValue", () => {
	it("rewards a higher hit-rate at equal size and recency", () => {
		const hot = prefix("hot", 1000, { hitRate: 0.9 });
		const cold = prefix("cold", 1000, { hitRate: 0.1 });
		expect(prefixRetentionValue(hot)).toBeGreaterThan(prefixRetentionValue(cold));
	});

	it("rewards recency — a fresher prefix outranks an equally-hit stale one", () => {
		const fresh = prefix("fresh", 1000, { hitRate: 0.5, ageSinceUse: 0 });
		const stale = prefix("stale", 1000, { hitRate: 0.5, ageSinceUse: DEFAULT_RECENCY_HALF_LIFE * 4 });
		expect(prefixRetentionValue(fresh)).toBeGreaterThan(prefixRetentionValue(stale));
	});

	it("is PER TOKEN — a smaller prefix of equal reuse value ranks higher (earns its footprint)", () => {
		const small = prefix("small", 500, { hitRate: 0.6 });
		const big = prefix("big", 5000, { hitRate: 0.6 });
		expect(prefixRetentionValue(small)).toBeGreaterThan(prefixRetentionValue(big));
	});

	it("halves the recency factor at exactly one half-life", () => {
		const fresh = prefix("f", 1000, { hitRate: 1, ageSinceUse: 0 });
		const oneHalfLife = prefix("h", 1000, { hitRate: 1, ageSinceUse: DEFAULT_RECENCY_HALF_LIFE });
		// value ∝ recencyWeight; at one half-life recency is 0.5 → value is exactly half the fresh value.
		expect(prefixRetentionValue(oneHalfLife)).toBeCloseTo(prefixRetentionValue(fresh) / 2, 10);
	});

	it("defaults a missing hit-rate to the neutral prior", () => {
		const missing = prefix("m", 1000);
		const explicit = prefix("e", 1000, { hitRate: DEFAULT_HIT_RATE });
		expect(prefixRetentionValue(missing)).toBe(prefixRetentionValue(explicit));
	});

	it("clamps an out-of-range hit-rate into [0,1]", () => {
		const over = prefix("over", 1000, { hitRate: 5 });
		const one = prefix("one", 1000, { hitRate: 1 });
		expect(prefixRetentionValue(over)).toBe(prefixRetentionValue(one));

		const under = prefix("under", 1000, { hitRate: -3 });
		const zero = prefix("zero", 1000, { hitRate: 0 });
		expect(prefixRetentionValue(under)).toBe(prefixRetentionValue(zero));
	});

	it("keeps a zero-hit but recent prefix above 0 (baseline gives it a chance before it has hits)", () => {
		const zeroHitFresh = prefix("z", 1000, { hitRate: 0, ageSinceUse: 0 });
		expect(prefixRetentionValue(zeroHitFresh)).toBeGreaterThan(0);
	});

	it("treats a zero-size prefix as maximally valuable (nothing to reclaim, so never evict it)", () => {
		const zeroSize = prefix("empty", 0, { hitRate: 0.1 });
		const realOne = prefix("real", 1000, { hitRate: 1.0 });
		// Zero footprint frees no budget → it should never be sacrificed → value ranks above a costed prefix.
		expect(prefixRetentionValue(zeroSize)).toBeGreaterThan(prefixRetentionValue(realOne));
	});

	it("normalizes negative / non-finite sizes and ages to non-negative", () => {
		// Negative size → treated as 0 (max value); NaN age → treated as 0 (fresh). Must not throw or produce NaN.
		const messy = prefix("messy", -100, { ageSinceUse: Number.NaN, hitRate: 0.5 });
		expect(Number.isFinite(prefixRetentionValue(messy)) || prefixRetentionValue(messy) === Number.POSITIVE_INFINITY);
		expect(Number.isNaN(prefixRetentionValue(messy))).toBe(false);
	});

	it("honors a custom recency half-life", () => {
		const p = prefix("p", 1000, { hitRate: 1, ageSinceUse: 100 });
		// With halfLife=100 the age is exactly one half-life → recency 0.5; the default halfLife barely decays at age 100.
		expect(prefixRetentionValue(p, { recencyHalfLife: 100 })).toBeLessThan(prefixRetentionValue(p));
	});
});

describe("decidePrefixRetention", () => {
	it("keeps everything when the budget covers the whole pool", () => {
		const pool = [prefix("a", 1000), prefix("b", 1000), prefix("c", 1000)];
		const d = decidePrefixRetention(pool, 10_000);
		expect(new Set(d.keep)).toEqual(new Set(["a", "b", "c"]));
		expect(d.evict).toEqual([]);
		expect(d.keptTokens).toBe(3000);
		expect(d.overBudget).toBe(false);
	});

	it("evicts the lowest-value prefix first when the budget is tight", () => {
		// All same size → value ranks purely by hit-rate here. Budget fits exactly two of three.
		const pool = [
			prefix("hot", 1000, { hitRate: 0.9 }),
			prefix("warm", 1000, { hitRate: 0.5 }),
			prefix("cold", 1000, { hitRate: 0.1 }),
		];
		const d = decidePrefixRetention(pool, 2000);
		expect(new Set(d.keep)).toEqual(new Set(["hot", "warm"]));
		expect(d.evict).toEqual(["cold"]);
		expect(d.keptTokens).toBe(2000);
		expect(d.overBudget).toBe(false);
	});

	it("prefers several small hot prefixes over one big low-value prefix (the swarm anti-pattern it fixes)", () => {
		// A plain LRU keyed only on recency could keep `giant`; the cost-aware value must sacrifice it for the small hot ones.
		const pool = [
			prefix("giant", 4000, { hitRate: 0.3, ageSinceUse: 0 }),
			prefix("s1", 1000, { hitRate: 0.9 }),
			prefix("s2", 1000, { hitRate: 0.9 }),
			prefix("s3", 1000, { hitRate: 0.9 }),
		];
		const d = decidePrefixRetention(pool, 3000);
		expect(new Set(d.keep)).toEqual(new Set(["s1", "s2", "s3"]));
		expect(d.evict).toEqual(["giant"]);
		expect(d.keptTokens).toBe(3000);
	});

	it("retains pinned prefixes first and never evicts them, even when they overrun the budget", () => {
		const pool = [prefix("pin", 5000, { pinned: true, hitRate: 0.0 }), prefix("hot", 1000, { hitRate: 0.9 })];
		const d = decidePrefixRetention(pool, 3000); // pin alone (5000) > budget (3000)
		expect(d.keep).toEqual(["pin"]);
		expect(d.evict).toEqual(["hot"]);
		expect(d.keptTokens).toBe(5000);
		expect(d.overBudget).toBe(true);
		expect(d.reason).toContain("OVER BUDGET");
	});

	it("keeps a pin plus whatever unpinned prefixes still fit under it", () => {
		const pool = [
			prefix("pin", 1000, { pinned: true }),
			prefix("hot", 1000, { hitRate: 0.9 }),
			prefix("cold", 1000, { hitRate: 0.1 }),
		];
		const d = decidePrefixRetention(pool, 2000); // pin (1000) + one more (1000)
		expect(d.keep).toEqual(["pin", "hot"]);
		expect(d.evict).toEqual(["cold"]);
		expect(d.overBudget).toBe(false);
	});

	it("evicts everything unpinned on a non-positive budget", () => {
		const pool = [prefix("a", 1000, { hitRate: 0.9 }), prefix("b", 1000)];
		const d = decidePrefixRetention(pool, 0);
		expect(d.keep).toEqual([]);
		expect(new Set(d.evict)).toEqual(new Set(["a", "b"]));
		expect(d.keptTokens).toBe(0);
	});

	it("skips a too-big prefix but still admits a smaller lower-ranked one that fits (cache-coherent packing)", () => {
		// `big` outranks `mid` by value, but does not fit the leftover budget; `mid` does → keep `mid`, evict `big`.
		const pool = [prefix("big", 2500, { hitRate: 0.95, ageSinceUse: 0 }), prefix("mid", 900, { hitRate: 0.6 })];
		const d = decidePrefixRetention(pool, 1000);
		expect(d.keep).toEqual(["mid"]);
		expect(d.evict).toEqual(["big"]);
		expect(d.keptTokens).toBe(900);
	});

	it("breaks value ties by smaller footprint, then input order", () => {
		// Identical hit-rate + age ⇒ value ∝ 1/size ⇒ smaller wins; make sizes differ to exercise the size tiebreak.
		const pool = [prefix("bigger", 1200, { hitRate: 0.5 }), prefix("smaller", 800, { hitRate: 0.5 })];
		const d = decidePrefixRetention(pool, 800); // only one fits
		expect(d.keep).toEqual(["smaller"]);
		expect(d.evict).toEqual(["bigger"]);
	});

	it("is empty-in / empty-out", () => {
		const d = decidePrefixRetention([], 5000);
		expect(d.keep).toEqual([]);
		expect(d.evict).toEqual([]);
		expect(d.keptTokens).toBe(0);
		expect(d.overBudget).toBe(false);
	});

	it("does not mutate the input pool", () => {
		const pool = [prefix("a", 1000, { hitRate: 0.1 }), prefix("b", 1000, { hitRate: 0.9 })];
		const snapshot = JSON.parse(JSON.stringify(pool));
		decidePrefixRetention(pool, 1000);
		expect(pool).toEqual(snapshot);
	});

	it("normalizes a non-finite budget to 0 (evict all unpinned)", () => {
		const pool = [prefix("a", 1000, { hitRate: 0.9 })];
		const d = decidePrefixRetention(pool, Number.NaN);
		expect(d.keep).toEqual([]);
		expect(d.evict).toEqual(["a"]);
	});

	it("reports a truthful over-budget reason string", () => {
		const d = decidePrefixRetention([prefix("a", 1000, { hitRate: 0.9 })], 2000);
		expect(d.reason).toContain("kept 1 prefix(es)");
		expect(d.reason).toContain("1000/2000");
		expect(d.reason).not.toContain("OVER BUDGET");
	});
});

describe("shouldAdmitPrefix", () => {
	it("admits a new prefix that fits without eviction", () => {
		const current = [prefix("a", 1000, { hitRate: 0.9 })];
		const candidate = prefix("new", 1000, { hitRate: 0.5 });
		const r = shouldAdmitPrefix(current, candidate, 5000);
		expect(r.admit).toBe(true);
		expect(r.evict).toEqual([]);
		expect(r.reason).toContain("without eviction");
	});

	it("admits a high-value candidate and reports the incumbent(s) it displaces", () => {
		const current = [prefix("cold", 1000, { hitRate: 0.05 })];
		const candidate = prefix("hot", 1000, { hitRate: 0.95 });
		const r = shouldAdmitPrefix(current, candidate, 1000); // budget only holds one
		expect(r.admit).toBe(true);
		expect(r.evict).toEqual(["cold"]);
		expect(r.reason).toContain("cold");
	});

	it("rejects a candidate lower-value than the incumbents already filling a full budget", () => {
		const current = [prefix("hot", 1000, { hitRate: 0.95 })];
		const candidate = prefix("oneshot", 1000, { hitRate: 0.02 });
		const r = shouldAdmitPrefix(current, candidate, 1000); // full — candidate would evict the hotter incumbent
		expect(r.admit).toBe(false);
		expect(r.evict).toEqual([]);
		expect(r.reason).toContain("lower value");
	});

	it("always admits a pinned candidate", () => {
		const current = [prefix("hot", 5000, { hitRate: 0.99 })];
		const candidate = prefix("pin", 5000, { pinned: true, hitRate: 0 });
		const r = shouldAdmitPrefix(current, candidate, 1000); // way over budget, but the pin is retained
		expect(r.admit).toBe(true);
	});

	it("does not count the candidate itself as a displaced incumbent", () => {
		const current = [prefix("a", 1000, { hitRate: 0.9 }), prefix("b", 1000, { hitRate: 0.9 })];
		const candidate = prefix("c", 1000, { hitRate: 0.01 }); // rejected → evict must be empty, never ['c']
		const r = shouldAdmitPrefix(current, candidate, 2000);
		expect(r.admit).toBe(false);
		expect(r.evict).not.toContain("c");
		expect(r.evict).toEqual([]);
	});
});

describe("rankPrefixesByRetention", () => {
	it("ranks by value descending with pinned first", () => {
		const pool = [
			prefix("cold", 1000, { hitRate: 0.1 }),
			prefix("pin", 9999, { pinned: true }),
			prefix("hot", 1000, { hitRate: 0.9 }),
		];
		const ranked = rankPrefixesByRetention(pool);
		expect(ranked.map((r) => r.id)).toEqual(["pin", "hot", "cold"]);
		expect(ranked[0]?.value).toBe(Number.POSITIVE_INFINITY);
		expect(ranked[1]?.value).toBeGreaterThan(ranked[2]?.value ?? 0);
	});

	it("exposes normalized token counts and does not mutate the input", () => {
		const pool = [prefix("a", -50, { hitRate: 0.5 }), prefix("b", 1200, { hitRate: 0.5 })];
		const snapshot = JSON.parse(JSON.stringify(pool));
		const ranked = rankPrefixesByRetention(pool);
		expect(ranked.find((r) => r.id === "a")?.tokenCount).toBe(0); // -50 floored
		expect(ranked.find((r) => r.id === "b")?.tokenCount).toBe(1200);
		expect(pool).toEqual(snapshot);
	});

	it("is empty-in / empty-out", () => {
		expect(rankPrefixesByRetention([])).toEqual([]);
	});
});
