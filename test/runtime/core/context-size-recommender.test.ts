import { describe, expect, it } from "vitest";

import {
	type ContextTimingObservation,
	DEFAULT_CONTEXT_SIZE_RECOMMENDATION_POLICY,
	recommendContextCap,
} from "../../../src/core/context-size-recommender.js";

function obs(
	contextTokens: number,
	wallTimeMs: number,
	over: Partial<ContextTimingObservation> = {},
): ContextTimingObservation {
	return { contextTokens, wallTimeMs, success: true, stalled: false, ...over };
}

describe("recommendContextCap", () => {
	it("recommends no cap when every context level is comfortable", () => {
		const rec = recommendContextCap([obs(2_000, 3_000), obs(2_000, 3_500), obs(8_000, 6_000), obs(8_000, 5_500)]);
		expect(rec.recommendedMaxContextTokens).toBeNull();
		expect(rec.basis).toBe("none");
		expect(rec.confident).toBe(true);
	});

	it("caps at the largest comfortable level when a larger one slows down (slow_processing)", () => {
		const rec = recommendContextCap([
			obs(4_000, 5_000),
			obs(4_000, 6_000),
			obs(16_000, 40_000), // slow
			obs(16_000, 38_000),
		]);
		expect(rec.recommendedMaxContextTokens).toBe(4_000);
		expect(rec.basis).toBe("slow_processing");
		expect(rec.reason).toContain("4000");
	});

	it("attributes the cap to stalls when the larger level stalls rather than merely slows", () => {
		const rec = recommendContextCap([
			obs(4_000, 5_000),
			obs(4_000, 4_500),
			obs(16_000, 20_000, { stalled: true }),
			obs(16_000, 18_000, { stalled: true }),
		]);
		expect(rec.recommendedMaxContextTokens).toBe(4_000);
		expect(rec.basis).toBe("stalls");
	});

	it("when even the smallest context is slow, recommends it + adaptations (never excludes)", () => {
		const rec = recommendContextCap([obs(3_000, 30_000), obs(3_000, 31_000), obs(9_000, 45_000)]);
		expect(rec.basis).toBe("all_slow");
		expect(rec.recommendedMaxContextTokens).toBe(3_000);
		expect(rec.adaptations.length).toBeGreaterThan(0);
		expect(rec.adaptations.join(" ")).toMatch(/compact|decompose|phase/i);
	});

	it("counts a failing large level as not comfortable even if fast", () => {
		const rec = recommendContextCap([
			obs(4_000, 4_000),
			obs(4_000, 4_000),
			obs(16_000, 5_000, { success: false }),
			obs(16_000, 5_000, { success: false }),
		]);
		expect(rec.recommendedMaxContextTokens).toBe(4_000);
	});

	it("is not confident with a single level and reports insufficient evidence when empty", () => {
		const single = recommendContextCap([obs(4_000, 5_000)]);
		expect(single.confident).toBe(false);
		const empty = recommendContextCap([]);
		expect(empty.basis).toBe("insufficient_evidence");
		expect(empty.recommendedMaxContextTokens).toBeNull();
	});

	it("real qwen3-8b-shaped evidence: fast small tool-use, slow/timeout large review ⇒ caps at the fast level", () => {
		// Mirrors the 2026-07-10 capture: small tool-use contexts finished in seconds; a big reasoning/review
		// prompt hit the 30s wall. slowWallTimeMs default is 25s.
		const rec = recommendContextCap([
			obs(1_200, 3_286), // tooluse-simple
			obs(1_400, 4_606), // tooluse-multi
			obs(9_000, 30_011, { stalled: true, success: false }), // review timed out
			obs(9_200, 30_007, { stalled: true, success: false }),
		]);
		expect(rec.recommendedMaxContextTokens).toBeLessThanOrEqual(1_400);
		expect(["slow_processing", "stalls"]).toContain(rec.basis);
	});

	it("uses the policy thresholds (a laxer slow bar leaves a level comfortable)", () => {
		const lax = { ...DEFAULT_CONTEXT_SIZE_RECOMMENDATION_POLICY, slowWallTimeMs: 60_000 };
		const rec = recommendContextCap([obs(4_000, 5_000), obs(16_000, 40_000), obs(16_000, 38_000)], lax);
		expect(rec.recommendedMaxContextTokens).toBeNull();
	});
});
