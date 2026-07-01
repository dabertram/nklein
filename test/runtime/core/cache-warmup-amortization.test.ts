import { describe, expect, it } from "vitest";
import {
	decideWarmupAmortization,
	type PrefixCostProfile,
	warmupBreakevenReuses,
	warmupSavingPerReuse,
} from "../../../src/core/cache-warmup-amortization";

/** Terse cost-profile builder for the tests. */
function profile(coldPrefillCost: number, warmPrefillCost: number): PrefixCostProfile {
	return { coldPrefillCost, warmPrefillCost };
}

describe("warmupSavingPerReuse", () => {
	it("saves the cold-minus-warm delta when the cache is healthy and warm is cheaper", () => {
		// The canonical local win: ~200s cold vs ~5s warm at 40k context.
		expect(warmupSavingPerReuse(profile(200, 5))).toEqual({ savingPerReuse: 195, canSave: true });
	});

	it("cannot save when warm is not strictly cheaper than cold", () => {
		expect(warmupSavingPerReuse(profile(50, 50))).toEqual({ savingPerReuse: 0, canSave: false });
		expect(warmupSavingPerReuse(profile(50, 80))).toEqual({ savingPerReuse: 0, canSave: false });
	});

	it("forces the saving to zero when the cache is UNHEALTHY, even with a tiny warm cost", () => {
		// An unhealthy cache re-prefills every turn — there is no warm regime to save into (item E).
		expect(warmupSavingPerReuse(profile(200, 5), false)).toEqual({ savingPerReuse: 0, canSave: false });
	});

	it("defaults cacheHealthy to true", () => {
		expect(warmupSavingPerReuse(profile(100, 10)).canSave).toBe(true);
	});

	it("floors messy (negative / non-finite / fractional) costs to non-negative before subtracting", () => {
		expect(warmupSavingPerReuse(profile(Number.NaN, 5))).toEqual({ savingPerReuse: 0, canSave: false }); // cold→0
		expect(warmupSavingPerReuse(profile(30, -5))).toEqual({ savingPerReuse: 30, canSave: true }); // warm→0
		expect(warmupSavingPerReuse(profile(10.5, 4.25))).toEqual({ savingPerReuse: 6.25, canSave: true });
	});
});

describe("warmupBreakevenReuses", () => {
	it("breaks even at 0 reuses against the default (pay-cold-every-send) alternative", () => {
		// Against "don't cache at all", warming pays from the very first reuse: cold + n·warm < (1+n)·cold for n>=1.
		expect(warmupBreakevenReuses(profile(200, 5))).toBe(0);
	});

	it("requires more reuses when the alternative per-send cost is cheaper than cold", () => {
		// Alternative costs 20/send; warming pays 100 up front (cold − alt = 80 extra) and saves 15/reuse (alt − warm).
		// ceil(80 / 15) = ceil(5.33) = 6.
		expect(warmupBreakevenReuses(profile(100, 5), 20)).toBe(6);
	});

	it("breaks even at exactly the quotient when it divides evenly", () => {
		// extra up-front = cold − alt = 90 − 30 = 60; per-reuse gain = alt − warm = 30 − 10 = 20; 60/20 = 3.
		expect(warmupBreakevenReuses(profile(90, 10), 30)).toBe(3);
	});

	it("never breaks even when the warm regime is not cheaper than the alternative", () => {
		// alt (10) <= warm (10): no per-reuse gain, so the up-front cost is never repaid.
		expect(warmupBreakevenReuses(profile(200, 10), 10)).toBe(Number.POSITIVE_INFINITY);
		expect(warmupBreakevenReuses(profile(200, 40), 30)).toBe(Number.POSITIVE_INFINITY);
	});

	it("never breaks even when the cache is unhealthy, regardless of costs", () => {
		expect(warmupBreakevenReuses(profile(200, 5), undefined, false)).toBe(Number.POSITIVE_INFINITY);
	});

	it("returns 0 (not negative) when the cold establish is cheaper than the alternative per send", () => {
		// A cheap cold establish vs an expensive alternative: no extra up-front cost, so breakeven is 0 reuses.
		expect(warmupBreakevenReuses(profile(40, 5), 100)).toBe(0);
	});

	it("floors a messy alternative cost to non-negative", () => {
		// alt → 0 means per-reuse gain = 0 − warm < 0 ⇒ never breaks even.
		expect(warmupBreakevenReuses(profile(200, 5), Number.NaN)).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("decideWarmupAmortization", () => {
	it("is worth warming when reuses meet the breakeven against not caching at all", () => {
		const decision = decideWarmupAmortization({ profile: profile(200, 5), expectedReuses: 1 });
		expect(decision.worthWarming).toBe(true);
		expect(decision.savingPerReuse).toBe(195);
		expect(decision.breakevenReuses).toBe(0);
		// Net vs not caching: 1 reuse saves 195, no extra up-front (alt = cold) → +195.
		expect(decision.netSaving).toBe(195);
		expect(decision.reason).toContain("worth warming");
	});

	it("a strict one-shot (0 reuses) is worth it against the default only when breakeven is 0", () => {
		// 0 reuses still clears a breakeven of 0 (canSave holds); net saving is 0 (no reuses, no extra up-front).
		const decision = decideWarmupAmortization({ profile: profile(200, 5), expectedReuses: 0 });
		expect(decision.worthWarming).toBe(true);
		expect(decision.netSaving).toBe(0);
	});

	it("a one-shot against a CHEAPER alternative is NOT worth warming (item E)", () => {
		// Cheaper alternative (20/send) demands 6 reuses to break even; a one-shot (0) falls short → don't warm.
		const decision = decideWarmupAmortization({
			profile: profile(100, 5),
			expectedReuses: 0,
			alternativePerSendCost: 20,
		});
		expect(decision.worthWarming).toBe(false);
		expect(decision.breakevenReuses).toBe(6);
		expect(decision.reason).toContain("not worth warming");
	});

	it("becomes worth warming once the reuse horizon reaches the breakeven", () => {
		const args = { profile: profile(100, 5), alternativePerSendCost: 20 } as const;
		expect(decideWarmupAmortization({ ...args, expectedReuses: 5 }).worthWarming).toBe(false); // 5 < 6
		expect(decideWarmupAmortization({ ...args, expectedReuses: 6 }).worthWarming).toBe(true); // 6 >= 6
	});

	it("reports the net saving across a long horizon (for ranking scarce warm slots)", () => {
		// 10 reuses × (alt 20 − warm 5 = 15 saving) − (cold 100 − alt 20 = 80 up-front) = 150 − 80 = 70.
		const decision = decideWarmupAmortization({
			profile: profile(100, 5),
			expectedReuses: 10,
			alternativePerSendCost: 20,
		});
		expect(decision.netSaving).toBe(70);
		expect(decision.worthWarming).toBe(true);
	});

	it("is never worth warming when the cache is unhealthy, with a one-shot rationale", () => {
		const decision = decideWarmupAmortization({
			profile: profile(200, 5),
			expectedReuses: 1000,
			cacheHealthy: false,
		});
		expect(decision.worthWarming).toBe(false);
		expect(decision.savingPerReuse).toBe(0);
		expect(decision.breakevenReuses).toBe(Number.POSITIVE_INFINITY);
		// Net = 1000 · 0 − 0 up-front (alt defaults to cold) = 0.
		expect(decision.netSaving).toBe(0);
		expect(decision.reason).toContain("reserve for one-shot calls");
	});

	it("is not worth warming when warm is not cheaper than cold (nothing to amortize)", () => {
		const decision = decideWarmupAmortization({ profile: profile(50, 50), expectedReuses: 100 });
		expect(decision.worthWarming).toBe(false);
		expect(decision.savingPerReuse).toBe(0);
		expect(decision.reason).toContain("nothing to amortize");
	});

	it("floors a messy / fractional expected-reuse count to a non-negative integer", () => {
		// 3.9 reuses → 3; against the default alternative (breakeven 0) it is still worth warming.
		const decision = decideWarmupAmortization({ profile: profile(90, 10), expectedReuses: 3.9 });
		expect(decision.worthWarming).toBe(true);
		// Net vs not caching: 3 reuses × (90 − 10) − 0 up-front = 240.
		expect(decision.netSaving).toBe(240);

		const negative = decideWarmupAmortization({
			profile: profile(100, 5),
			expectedReuses: -5,
			alternativePerSendCost: 20,
		});
		expect(negative.worthWarming).toBe(false); // -5 → 0 reuses, below breakeven 6
	});

	it("defaults cacheHealthy to true when omitted", () => {
		expect(decideWarmupAmortization({ profile: profile(100, 10), expectedReuses: 1 }).worthWarming).toBe(true);
	});

	it("computes a negative net saving when the horizon falls short of a cheaper alternative", () => {
		// 2 reuses × (alt 20 − warm 5 = 15) − (cold 100 − alt 20 = 80) = 30 − 80 = −50 (warming loses over this horizon).
		const decision = decideWarmupAmortization({
			profile: profile(100, 5),
			expectedReuses: 2,
			alternativePerSendCost: 20,
		});
		expect(decision.netSaving).toBe(-50);
		expect(decision.worthWarming).toBe(false);
	});
});
