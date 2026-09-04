import { describe, expect, it } from "vitest";
import {
	classifyModelSize,
	fleetClassCapabilityPrior,
	MODEL_SIZE_TIER_REFERENCE,
	MODEL_SIZE_TIERS,
	maxComplexityForCapability,
	requiredCapabilityForCard,
	smallestTierClearing,
	tierForParamB,
} from "../../../src/core/model-size-tier-capability";

describe("model-size-tier capability mapping (F3.41)", () => {
	it("classifies size tiers by total params and compute tiers by active params (dense vs MoE)", () => {
		expect(tierForParamB(4)).toBe("xs");
		expect(tierForParamB(9)).toBe("s");
		expect(tierForParamB(12)).toBe("m");
		expect(tierForParamB(27)).toBe("l");
		expect(tierForParamB(31)).toBe("xl");
		expect(tierForParamB(125)).toBe("beyond");
		expect(classifyModelSize({ totalParamB: 27 })).toEqual({ sizeTier: "l", computeTier: "l", isMoe: false });
		// Qwen3.6-35B-A3B: xl by knowledge, xs by per-token cost.
		expect(classifyModelSize({ totalParamB: 35, activeParamB: 3 })).toEqual({
			sizeTier: "xl",
			computeTier: "xs",
			isMoe: true,
		});
	});

	it("the reference table is ordered and best-in-class priors dominate typical priors", () => {
		expect(MODEL_SIZE_TIER_REFERENCE.map((entry) => entry.tier)).toEqual([...MODEL_SIZE_TIERS]);
		for (const entry of MODEL_SIZE_TIER_REFERENCE) {
			expect(entry.bestInClassCapability).toBeGreaterThan(entry.typicalCapability);
			expect(entry.bestInClass.length).toBeGreaterThan(0);
		}
	});

	it("fleet priors grow with size, and a MoE is discounted toward its compute tier", () => {
		const dense9 = fleetClassCapabilityPrior({ totalParamB: 9 });
		const dense27 = fleetClassCapabilityPrior({ totalParamB: 27 });
		const moe35a3 = fleetClassCapabilityPrior({ totalParamB: 35, activeParamB: 3 });
		const dense31 = fleetClassCapabilityPrior({ totalParamB: 31 });
		expect(dense27).toBeGreaterThan(dense9);
		expect(moe35a3).toBeLessThan(dense31);
		expect(moe35a3).toBeGreaterThan(dense9);
	});

	it("required capability is monotone in complexity, file count, and label", () => {
		expect(requiredCapabilityForCard({ complexity: 20 })).toBeLessThan(requiredCapabilityForCard({ complexity: 60 }));
		expect(requiredCapabilityForCard({ complexity: 40, likelyFileCount: 1 })).toBeLessThan(
			requiredCapabilityForCard({ complexity: 40, likelyFileCount: 4 }),
		);
		expect(requiredCapabilityForCard({ complexity: 40, difficulty: "easy" })).toBeLessThan(
			requiredCapabilityForCard({ complexity: 40, difficulty: "hard" }),
		);
		expect(requiredCapabilityForCard({ complexity: 100, likelyFileCount: 9, difficulty: "very-hard" })).toBe(100);
		expect(requiredCapabilityForCard({ complexity: 0 })).toBe(0);
	});

	it("maxComplexityForCapability inverts requiredCapabilityForCard at the boundary", () => {
		for (const capability of [30, 45, 58, 74]) {
			const maxComplexity = maxComplexityForCapability(capability, { likelyFileCount: 2, difficulty: "medium" });
			expect(
				requiredCapabilityForCard({ complexity: maxComplexity, likelyFileCount: 2, difficulty: "medium" }),
			).toBeLessThanOrEqual(capability);
			expect(
				requiredCapabilityForCard({ complexity: maxComplexity + 2, likelyFileCount: 2, difficulty: "medium" }),
			).toBeGreaterThan(capability);
		}
	});

	it("answers 'which tier can do this card' — a 9B clears small single-file cards, not multi-file hard ones", () => {
		const small = requiredCapabilityForCard({ complexity: 35, likelyFileCount: 1, difficulty: "easy" });
		expect(smallestTierClearing(small)).toBe("xs" === smallestTierClearing(small) ? "xs" : "s");
		const medium = requiredCapabilityForCard({ complexity: 60, likelyFileCount: 2, difficulty: "medium" });
		expect(["s", "m", "l"]).toContain(smallestTierClearing(medium));
		const heavy = requiredCapabilityForCard({ complexity: 85, likelyFileCount: 4, difficulty: "hard" });
		expect(["beyond", null]).toContain(smallestTierClearing(heavy));
		expect(smallestTierClearing(0)).toBe("xs");
	});
});
