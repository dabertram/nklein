import { describe, expect, it } from "vitest";
import {
	cacheHealthFromCachedTokens,
	classifyCacheHealth,
	interpretLlamaCppCacheTimings,
} from "../../../src/core/cache-health";

describe("classifyCacheHealth (universal TTFT double-prefix probe)", () => {
	it("calls a big cold→warm TTFT drop healthy at the default 3x threshold", () => {
		// cold 1000 / warm 200 → 5x: the warm prefix was served from the KV cache.
		const verdict = classifyCacheHealth({ coldTtftMs: 1000, warmTtftMs: 200 });
		expect(verdict.speedup).toBe(5);
		expect(verdict.healthy).toBe(true);
		expect(verdict.reason).toMatch(/reused/);
	});

	it("calls a near-equal cold/warm TTFT broken (the SWA/hybrid silent recompute)", () => {
		// cold 1000 / warm 950 → ~1.05x: the prefix was recomputed, not cached.
		const verdict = classifyCacheHealth({ coldTtftMs: 1000, warmTtftMs: 950 });
		expect(verdict.healthy).toBe(false);
		expect(verdict.speedup).toBeCloseTo(1000 / 950, 5);
		expect(verdict.reason).toMatch(/recomputed/);
	});

	it("honors a custom minSpeedup threshold", () => {
		// 4x speedup: healthy at the default 3x, but not at a stricter 5x bar.
		expect(classifyCacheHealth({ coldTtftMs: 800, warmTtftMs: 200 }).healthy).toBe(true);
		expect(classifyCacheHealth({ coldTtftMs: 800, warmTtftMs: 200, minSpeedup: 5 }).healthy).toBe(false);
	});

	it("treats non-positive timings as unusable", () => {
		expect(classifyCacheHealth({ coldTtftMs: 0, warmTtftMs: 200 })).toEqual({
			healthy: false,
			speedup: 0,
			reason: "unusable timing",
		});
		expect(classifyCacheHealth({ coldTtftMs: 1000, warmTtftMs: 0 })).toEqual({
			healthy: false,
			speedup: 0,
			reason: "unusable timing",
		});
		expect(classifyCacheHealth({ coldTtftMs: -10, warmTtftMs: 200 }).healthy).toBe(false);
	});

	it("treats NaN / non-finite timings as unusable (no Infinity speedup)", () => {
		expect(classifyCacheHealth({ coldTtftMs: Number.NaN, warmTtftMs: 200 }).reason).toBe("unusable timing");
		expect(classifyCacheHealth({ coldTtftMs: 1000, warmTtftMs: Number.NaN }).speedup).toBe(0);
		expect(classifyCacheHealth({ coldTtftMs: Number.POSITIVE_INFINITY, warmTtftMs: 200 }).healthy).toBe(false);
	});
});

describe("interpretLlamaCppCacheTimings (prompt_n / cache_n)", () => {
	it("calls a mostly-reused prefix healthy", () => {
		// cacheN 900 reused, promptN 100 freshly prefilled → hitRatio 0.9.
		const verdict = interpretLlamaCppCacheTimings({ promptN: 100, cacheN: 900 });
		expect(verdict.reusedTokens).toBe(900);
		expect(verdict.totalPrefillTokens).toBe(1000);
		expect(verdict.hitRatio).toBeCloseTo(0.9, 5);
		expect(verdict.healthy).toBe(true);
	});

	it("calls a mostly-recomputed prefix unhealthy", () => {
		// cacheN 100 reused, promptN 900 reprocessed → hitRatio 0.1.
		const verdict = interpretLlamaCppCacheTimings({ promptN: 900, cacheN: 100 });
		expect(verdict.hitRatio).toBeCloseTo(0.1, 5);
		expect(verdict.healthy).toBe(false);
	});

	it("handles a zero-token turn as 0 hit-ratio (not NaN) and unhealthy", () => {
		expect(interpretLlamaCppCacheTimings({ promptN: 0, cacheN: 0 })).toEqual({
			reusedTokens: 0,
			totalPrefillTokens: 0,
			hitRatio: 0,
			healthy: false,
		});
	});

	it("guards negative reported counts to 0", () => {
		const verdict = interpretLlamaCppCacheTimings({ promptN: -50, cacheN: -10 });
		expect(verdict.reusedTokens).toBe(0);
		expect(verdict.totalPrefillTokens).toBe(0);
		expect(verdict.hitRatio).toBe(0);
		expect(verdict.healthy).toBe(false);
	});
});

describe("cacheHealthFromCachedTokens (advisory cached_tokens — LM Studio #778 unreliable)", () => {
	it("computes a hit-ratio and flags healthy at >= 0.5", () => {
		expect(cacheHealthFromCachedTokens({ inputTokens: 1000, cachedTokens: 800 })).toEqual({
			hitRatio: 0.8,
			healthy: true,
		});
		expect(cacheHealthFromCachedTokens({ inputTokens: 1000, cachedTokens: 100 }).healthy).toBe(false);
	});

	it("clamps an over-reported cached count to a max ratio of 1 and guards zero/negative input", () => {
		// cachedTokens > inputTokens cannot mean >100% reuse.
		expect(cacheHealthFromCachedTokens({ inputTokens: 100, cachedTokens: 250 }).hitRatio).toBe(1);
		// No input tokens → 0, not NaN; negative input guarded to 0.
		expect(cacheHealthFromCachedTokens({ inputTokens: 0, cachedTokens: 0 })).toEqual({ hitRatio: 0, healthy: false });
		expect(cacheHealthFromCachedTokens({ inputTokens: -5, cachedTokens: 10 }).hitRatio).toBe(0);
	});
});
