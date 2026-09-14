import { describe, expect, it } from "vitest";
import { runtimeGeneratedFromPlanSchema } from "../../../src/core/board-api-contract";
import { deriveCardDifficultyFacts } from "../../../src/core/card-difficulty-facts";
import { requiredCapabilityForCard, smallestTierClearing } from "../../../src/core/model-size-tier-capability";

/**
 * F3.41 (d) — the decomposer's sizing is PERSISTED on every generated card as facts the router, the DAG and a
 * later calibration can read back, instead of being computed once for guidance and thrown away.
 */
describe("deriveCardDifficultyFacts", () => {
	it("keeps the inputs AND the current mapping's answer", () => {
		const facts = deriveCardDifficultyFacts({ complexity: 30, filesLikelyTouched: ["src/storage.ts"] });
		expect(facts).toEqual({ complexity: 30, likelyFileCount: 1, requiredCapability: 23, smallestTier: "xs" });
		// The answer is the F3.41 (b) mapping, not a second formula.
		expect(facts.requiredCapability).toBe(requiredCapabilityForCard({ complexity: 30, likelyFileCount: 1 }));
		expect(facts.smallestTier).toBe(smallestTierClearing(facts.requiredCapability));
	});

	it("reads a missing or empty file list as one file, as the mapping does", () => {
		expect(deriveCardDifficultyFacts({ complexity: 45 }).likelyFileCount).toBe(1);
		expect(deriveCardDifficultyFacts({ complexity: 45, filesLikelyTouched: [] }).likelyFileCount).toBe(1);
		expect(deriveCardDifficultyFacts({ complexity: 45, filesLikelyTouched: null }).likelyFileCount).toBe(1);
	});

	it("names no tier when the card is beyond the researched landscape — it must split regardless of fleet", () => {
		const facts = deriveCardDifficultyFacts({
			complexity: 100,
			filesLikelyTouched: ["a", "b", "c", "d", "e", "f", "g"],
		});
		expect(facts.requiredCapability).toBe(100);
		expect(facts.smallestTier).toBeNull();
	});

	it("clamps a malformed complexity instead of persisting one the contract would reject", () => {
		expect(deriveCardDifficultyFacts({ complexity: 140 }).complexity).toBe(100);
		expect(deriveCardDifficultyFacts({ complexity: -5 }).complexity).toBe(0);
		expect(deriveCardDifficultyFacts({ complexity: Number.NaN }).complexity).toBe(0);
	});

	it("is accepted by the board contract, which still parses cards stamped before the facts existed", () => {
		const legacy = runtimeGeneratedFromPlanSchema.parse({ planSlug: "plan", planTaskId: "t1" });
		expect(legacy.difficultyFacts).toBeUndefined();
		const stamped = runtimeGeneratedFromPlanSchema.parse({
			planSlug: "plan",
			planTaskId: "t1",
			difficultyFacts: deriveCardDifficultyFacts({ complexity: 90, filesLikelyTouched: ["a", "b", "c", "d"] }),
		});
		expect(stamped.difficultyFacts).toEqual({
			complexity: 90,
			likelyFileCount: 4,
			requiredCapability: 83,
			smallestTier: "beyond",
		});
		// A tier outside the researched table is not a tier.
		expect(() =>
			runtimeGeneratedFromPlanSchema.parse({
				planSlug: "plan",
				planTaskId: "t1",
				difficultyFacts: { complexity: 10, likelyFileCount: 1, requiredCapability: 8, smallestTier: "xxl" },
			}),
		).toThrow();
	});
});
