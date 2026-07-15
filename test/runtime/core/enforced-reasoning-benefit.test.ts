import { describe, expect, it } from "vitest";
import {
	learnReasoningBenefit,
	type ReasoningObservation,
	shouldEnforceReasoning,
} from "../../../src/core/enforced-reasoning-benefit.js";

/** F3.16 — learn whether enforced reasoning helps a model×role×difficulty cell. */

const obs = (reasoningEnabled: boolean, qualityScore: number): ReasoningObservation => ({
	reasoningEnabled,
	qualityScore,
});

describe("learnReasoningBenefit", () => {
	it("recommends enforce when reasoning clearly lifts quality with enough samples", () => {
		const profile = learnReasoningBenefit([
			obs(true, 0.9),
			obs(true, 0.85),
			obs(true, 0.95),
			obs(false, 0.5),
			obs(false, 0.55),
			obs(false, 0.45),
		]);
		expect(profile.benefit).toBeCloseTo(0.9 - 0.5, 1);
		expect(profile.recommendation).toBe("enforce");
		expect(shouldEnforceReasoning(profile)).toBe(true);
	});

	it("recommends skip when reasoning does not help", () => {
		const profile = learnReasoningBenefit([
			obs(true, 0.6),
			obs(true, 0.62),
			obs(true, 0.58),
			obs(false, 0.63),
			obs(false, 0.6),
			obs(false, 0.61),
		]);
		expect(profile.recommendation).toBe("skip");
		expect(shouldEnforceReasoning(profile)).toBe(false);
	});

	it("is insufficient_evidence below the per-arm sample floor, honoring the fallback", () => {
		const profile = learnReasoningBenefit([obs(true, 0.9), obs(false, 0.4)]);
		expect(profile.recommendation).toBe("insufficient_evidence");
		expect(shouldEnforceReasoning(profile, true)).toBe(true);
		expect(shouldEnforceReasoning(profile, false)).toBe(false);
	});

	it("reports null benefit when one arm was never measured", () => {
		const profile = learnReasoningBenefit([obs(true, 0.9), obs(true, 0.8), obs(true, 0.85)]);
		expect(profile.qualityWithoutReasoning).toBeNull();
		expect(profile.benefit).toBeNull();
		expect(profile.recommendation).toBe("insufficient_evidence");
	});
});
