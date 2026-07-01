import { describe, expect, it } from "vitest";
import { estimateQualityEffectiveBudget, type QualityObservation } from "../../../src/core/context-budget-knee";

// A generous floor is applied by default (≥32k, invariant #3); most tests pass floorTokens: 0 to inspect the raw fit.
const NO_FLOOR = { floorTokens: 0 } as const;

describe("estimateQualityEffectiveBudget", () => {
	it("returns insufficient (null budget) when there are no observations", () => {
		const result = estimateQualityEffectiveBudget([]);
		expect(result.budgetTokens).toBeNull();
		expect(result.peakTokens).toBeNull();
		expect(result.peakQuality).toBeNull();
		expect(result.basis).toBe("insufficient");
		expect(result.confident).toBe(false);
		expect(result.levelCount).toBe(0);
	});

	it("ignores non-finite and non-positive observations (and is insufficient if none remain)", () => {
		const observations: QualityObservation[] = [
			{ contextTokens: 0, qualityScore: 0.9 },
			{ contextTokens: -5000, qualityScore: 0.9 },
			{ contextTokens: Number.NaN, qualityScore: 0.9 },
			{ contextTokens: 8000, qualityScore: Number.POSITIVE_INFINITY },
		];
		const result = estimateQualityEffectiveBudget(observations, NO_FLOOR);
		expect(result.basis).toBe("insufficient");
		expect(result.budgetTokens).toBeNull();
		expect(result.levelCount).toBe(0);
	});

	it("detects a plateau: the knee is the level where quality stops rising by >= epsilon", () => {
		// quality climbs 0.5 → 0.7 → 0.71 → 0.71 → the gain from 16k onward is < epsilon(0.05) ⇒ knee at 16k.
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.5 },
			{ contextTokens: 16_000, qualityScore: 0.7 },
			{ contextTokens: 32_000, qualityScore: 0.71 },
			{ contextTokens: 64_000, qualityScore: 0.71 },
		];
		const result = estimateQualityEffectiveBudget(observations, { floorTokens: 0, plateauEpsilon: 0.05 });
		expect(result.basis).toBe("plateau");
		expect(result.budgetTokens).toBe(16_000);
		expect(result.peakTokens).toBe(32_000); // max quality 0.71 is first reached at 32k (earliest-on-tie peak)
		expect(result.confident).toBe(true);
		expect(result.levelCount).toBe(4);
	});

	it("peak is the EARLIEST (cheapest) level reaching the max quality on a tie", () => {
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.6 },
			{ contextTokens: 16_000, qualityScore: 0.9 },
			{ contextTokens: 32_000, qualityScore: 0.9 }, // same peak value, larger size ⇒ NOT the reported peak
		];
		const result = estimateQualityEffectiveBudget(observations, NO_FLOOR);
		expect(result.peakQuality).toBe(0.9);
		expect(result.peakTokens).toBe(16_000);
	});

	it("detects decline (context rot): budget targets the peak, never the larger worse-scoring context", () => {
		// quality rises then falls: 0.5 → 0.85 → 0.6. The drop 0.85→0.6 exceeds epsilon ⇒ decline; knee = peak (16k).
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.5 },
			{ contextTokens: 16_000, qualityScore: 0.85 },
			{ contextTokens: 64_000, qualityScore: 0.6 },
		];
		const result = estimateQualityEffectiveBudget(observations, { floorTokens: 0, plateauEpsilon: 0.02 });
		expect(result.basis).toBe("decline");
		expect(result.budgetTokens).toBe(16_000);
		expect(result.peakTokens).toBe(16_000);
		expect(result.peakQuality).toBe(0.85);
	});

	it("monotonic: when quality keeps rising across every level, the knee is the largest observed level", () => {
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.4 },
			{ contextTokens: 16_000, qualityScore: 0.6 },
			{ contextTokens: 32_000, qualityScore: 0.8 },
		];
		const result = estimateQualityEffectiveBudget(observations, { floorTokens: 0, plateauEpsilon: 0.05 });
		expect(result.basis).toBe("monotonic");
		expect(result.budgetTokens).toBe(32_000);
		expect(result.peakTokens).toBe(32_000);
	});

	it("never returns a budget below the ≥32k floor even when the knee lands lower", () => {
		// A plateau at 8k would fit 8000 tokens, but the floor (invariant #3) raises the returned budget to 32k.
		const observations: QualityObservation[] = [
			{ contextTokens: 4_000, qualityScore: 0.5 },
			{ contextTokens: 8_000, qualityScore: 0.9 },
			{ contextTokens: 16_000, qualityScore: 0.9 },
		];
		const result = estimateQualityEffectiveBudget(observations); // default floor 32_000
		expect(result.basis).toBe("plateau");
		expect(result.budgetTokens).toBe(32_000); // floored up from the 8k knee
		expect(result.peakTokens).toBe(8_000); // diagnostics still report the true (sub-floor) peak
	});

	it("averages quality across repeated probes at the same context level", () => {
		// Two probes at 16k: 0.6 and 0.8 ⇒ mean 0.7. So 8k(0.5) → 16k(0.7) rises by 0.2, then flat vs 32k(0.7).
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.5 },
			{ contextTokens: 16_000, qualityScore: 0.6 },
			{ contextTokens: 16_000, qualityScore: 0.8 },
			{ contextTokens: 32_000, qualityScore: 0.7 },
		];
		const result = estimateQualityEffectiveBudget(observations, { floorTokens: 0, plateauEpsilon: 0.05 });
		expect(result.levelCount).toBe(3); // the two 16k probes collapse into one level
		expect(result.basis).toBe("plateau");
		expect(result.budgetTokens).toBe(16_000);
	});

	it("bins near-identical context sizes within binTolerance into one level", () => {
		// 8000 and 8003 are the same level within tolerance 10; without binning they'd be two distinct levels.
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.6 },
			{ contextTokens: 8_003, qualityScore: 0.8 },
			{ contextTokens: 32_000, qualityScore: 0.9 },
		];
		const binned = estimateQualityEffectiveBudget(observations, { floorTokens: 0, binTolerance: 10 });
		expect(binned.levelCount).toBe(2); // {~8000}, {32000}
		const exact = estimateQualityEffectiveBudget(observations, { floorTokens: 0, binTolerance: 0 });
		expect(exact.levelCount).toBe(3); // 8000, 8003, 32000 all distinct
	});

	it("flags low confidence when fewer than minLevels distinct levels back the fit (budget still returned)", () => {
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.5 },
			{ contextTokens: 16_000, qualityScore: 0.9 },
		];
		const result = estimateQualityEffectiveBudget(observations, { floorTokens: 0, minLevels: 3 });
		expect(result.confident).toBe(false); // only 2 levels
		expect(result.levelCount).toBe(2);
		expect(result.budgetTokens).not.toBeNull(); // still computed from what exists
	});

	it("respects a custom minLevels for the confidence flag", () => {
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.5 },
			{ contextTokens: 16_000, qualityScore: 0.9 },
		];
		const result = estimateQualityEffectiveBudget(observations, { floorTokens: 0, minLevels: 2 });
		expect(result.confident).toBe(true);
	});

	it("epsilon controls plateau sensitivity: a small rise is 'still improving' under a tiny epsilon", () => {
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.5 },
			{ contextTokens: 16_000, qualityScore: 0.7 },
			{ contextTokens: 32_000, qualityScore: 0.73 }, // +0.03 gain
		];
		// epsilon 0.05: the +0.03 gain is below threshold ⇒ plateau at 16k.
		const coarse = estimateQualityEffectiveBudget(observations, { floorTokens: 0, plateauEpsilon: 0.05 });
		expect(coarse.basis).toBe("plateau");
		expect(coarse.budgetTokens).toBe(16_000);
		// epsilon 0.01: the +0.03 gain counts as improvement ⇒ monotonic, knee at the largest level 32k.
		const fine = estimateQualityEffectiveBudget(observations, { floorTokens: 0, plateauEpsilon: 0.01 });
		expect(fine.basis).toBe("monotonic");
		expect(fine.budgetTokens).toBe(32_000);
	});

	it("handles a single usable observation (knee = that level, low confidence)", () => {
		const result = estimateQualityEffectiveBudget([{ contextTokens: 16_000, qualityScore: 0.8 }], NO_FLOOR);
		expect(result.basis).toBe("monotonic"); // no successor to compare ⇒ the lone level is the knee
		expect(result.budgetTokens).toBe(16_000);
		expect(result.peakTokens).toBe(16_000);
		expect(result.confident).toBe(false);
		expect(result.levelCount).toBe(1);
	});

	it("does not mutate the input observations array or its elements", () => {
		const observations: QualityObservation[] = [
			{ contextTokens: 16_000, qualityScore: 0.9 },
			{ contextTokens: 8_000, qualityScore: 0.5 }, // deliberately out of order
		];
		const snapshot = JSON.parse(JSON.stringify(observations));
		estimateQualityEffectiveBudget(observations);
		expect(observations).toEqual(snapshot); // order + values unchanged (sorting happens on a copy)
	});

	it("plateau chosen at the FIRST flat step even if a later rise occurs (earliest knee wins)", () => {
		// 8k→16k rises (+0.2); 16k→32k is flat (+0.0) ⇒ plateau at 16k, regardless of a later 64k bump.
		const observations: QualityObservation[] = [
			{ contextTokens: 8_000, qualityScore: 0.5 },
			{ contextTokens: 16_000, qualityScore: 0.7 },
			{ contextTokens: 32_000, qualityScore: 0.7 },
			{ contextTokens: 64_000, qualityScore: 0.95 },
		];
		const result = estimateQualityEffectiveBudget(observations, { floorTokens: 0, plateauEpsilon: 0.05 });
		expect(result.basis).toBe("plateau");
		expect(result.budgetTokens).toBe(16_000);
		expect(result.peakTokens).toBe(64_000); // the peak diagnostic still reflects the true max
	});
});
