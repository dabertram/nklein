import { describe, expect, it } from "vitest";
import {
	decideDefaultFlip,
	mcnemarTest,
	type PairedOutcome,
	wilsonInterval,
} from "../../../src/core/ab-significance-gate";

/** Build `count` paired outcomes with the given a/b values. */
function pairs(spec: { a: boolean; b: boolean; count: number }[]): PairedOutcome[] {
	return spec.flatMap(({ a, b, count }) => Array.from({ length: count }, () => ({ a, b })));
}

describe("mcnemarTest", () => {
	it("counts discordant pairs and matches the exact two-sided p-value (10 worse / 2 better ⇒ p≈0.0386)", () => {
		// 12 discordant pairs, min=2: 2*P(X<=2 | n=12,p=0.5) = 2*(1+12+66)/4096 ≈ 0.03857.
		const result = mcnemarTest(
			pairs([
				{ a: true, b: false, count: 10 },
				{ a: false, b: true, count: 2 },
			]),
		);
		expect(result.worse).toBe(10);
		expect(result.better).toBe(2);
		expect(result.pValue).toBeCloseTo(0.0386, 3);
		expect(result.significant).toBe(true);
	});

	it("gives p≈1 (no evidence) when discordant pairs are balanced", () => {
		const result = mcnemarTest(
			pairs([
				{ a: true, b: false, count: 5 },
				{ a: false, b: true, count: 5 },
			]),
		);
		expect(result.pValue).toBeCloseTo(1, 5);
		expect(result.significant).toBe(false);
	});

	it("p=1 when there is no discordance at all", () => {
		expect(
			mcnemarTest(
				pairs([
					{ a: true, b: true, count: 8 },
					{ a: false, b: false, count: 2 },
				]),
			).pValue,
		).toBe(1);
	});

	it("agrees with the large-n normal approximation (uses exact ≤2000, approx above)", () => {
		// Lopsided large discordance is clearly significant either way.
		const big = mcnemarTest(
			pairs([
				{ a: false, b: true, count: 1600 },
				{ a: true, b: false, count: 1200 },
			]),
		);
		expect(big.significant).toBe(true);
		expect(big.pValue).toBeLessThan(0.001);
	});
});

describe("wilsonInterval", () => {
	it("brackets the point estimate and stays within [0,1]", () => {
		const ci = wilsonInterval(8, 10);
		expect(ci.point).toBe(0.8);
		expect(ci.low).toBeGreaterThan(0.4);
		expect(ci.low).toBeLessThan(0.8);
		expect(ci.high).toBeGreaterThan(0.8);
		expect(ci.high).toBeLessThanOrEqual(1);
	});

	it("handles the degenerate n=0 case", () => {
		expect(wilsonInterval(0, 0)).toEqual({ point: 0, low: 0, high: 1 });
	});
});

describe("decideDefaultFlip", () => {
	it("does NOT flip when the candidate is better only within the noise band (the whole point)", () => {
		// A tiny, non-significant edge — exactly the 'eyeballed green' case that should NOT flip.
		const decision = decideDefaultFlip({
			pairs: pairs([
				{ a: true, b: true, count: 90 },
				{ a: false, b: true, count: 3 }, // 3 better
				{ a: true, b: false, count: 2 }, // 2 worse
				{ a: false, b: false, count: 5 },
			]),
		});
		expect(decision.flip).toBe(false);
		expect(decision.delta).toBeCloseTo(0.01, 5); // +1pp
		expect(decision.reason).toContain("within noise");
	});

	it("flips when the candidate is significantly AND practically better", () => {
		const decision = decideDefaultFlip({
			pairs: pairs([
				{ a: true, b: true, count: 60 },
				{ a: false, b: true, count: 20 }, // 20 better
				{ a: true, b: false, count: 3 }, // 3 worse
				{ a: false, b: false, count: 17 },
			]),
		});
		expect(decision.flip).toBe(true);
		expect(decision.mcnemar.significant).toBe(true);
		expect(decision.reason).toContain("flip");
	});

	it("does NOT flip when the candidate is significant but below the required practical effect", () => {
		const decision = decideDefaultFlip({
			pairs: pairs([
				{ a: false, b: true, count: 20 },
				{ a: true, b: false, count: 3 },
				{ a: true, b: true, count: 77 },
			]),
			minEffect: 0.25, // demand +25pp; actual is +17pp
		});
		expect(decision.mcnemar.significant).toBe(true);
		expect(decision.flip).toBe(false);
		expect(decision.reason).toContain("below the required");
	});

	it("never flips on an empty eval", () => {
		expect(decideDefaultFlip({ pairs: [] }).flip).toBe(false);
	});
});
