import { describe, expect, it } from "vitest";
import { applySpeedCapabilityDial, type SpeedCapabilityCandidate } from "../../../src/core/speed-capability-dial";

interface Candidate extends SpeedCapabilityCandidate {
	id: string;
}

const c = (id: string, fitScore: number, tokensPerSecond: number | null): Candidate => ({
	id,
	fitScore,
	tokensPerSecond,
});

const ids = (result: { ranked: Candidate[] }): string[] => result.ranked.map((entry) => entry.id);

describe("applySpeedCapabilityDial (§5.I#4)", () => {
	const ranked = [c("big", 90, 12), c("mid", 82, 45), c("small", 78, 70), c("weak", 40, 200)];

	it('"capability" (or omitted) leaves the fit order byte-identical', () => {
		expect(ids(applySpeedCapabilityDial({ ranked, dial: "capability" }))).toEqual(["big", "mid", "small", "weak"]);
		expect(ids(applySpeedCapabilityDial({ ranked, dial: undefined }))).toEqual(["big", "mid", "small", "weak"]);
		expect(applySpeedCapabilityDial({ ranked, dial: undefined }).reordered).toBe(false);
	});

	it('"speed" promotes the fastest candidate WITHIN the fit margin; a much-weaker fast model never jumps', () => {
		const result = applySpeedCapabilityDial({ ranked, dial: "speed" });
		// margin 15 from top (90) ⇒ pool = big/mid/small (weak at 40 stays outside, last).
		expect(ids(result)).toEqual(["small", "mid", "big", "weak"]);
		expect(result.reordered).toBe(true);
	});

	it('"speed" keeps unmeasured (null tok/s) candidates after measured ones, in fit order', () => {
		const result = applySpeedCapabilityDial({
			ranked: [c("a", 90, null), c("b", 85, 30), c("d", 84, null), c("e", 80, 60)],
			dial: "speed",
		});
		expect(ids(result)).toEqual(["e", "b", "a", "d"]); // measured fast-first, then unmeasured by fit
	});

	it('"balanced" blends fit + speed ranks so a near-equal-but-faster model wins without speed dominating', () => {
		// fit ranks: big 0 / mid 1 / small 2 · speed ranks: small 0 / mid 1 / big 2 ⇒ sums 2/2/2 → stable fit order?
		// Use scores where balanced genuinely flips: fast(88, 100tps) vs strong(90, 10tps) vs mid(89, 50tps):
		// fit ranks strong0 mid1 fast2 · speed ranks fast0 mid1 strong2 ⇒ sums strong2 mid2 fast2 ⇒ stable (fit) order.
		const flip = applySpeedCapabilityDial({
			ranked: [c("strong", 90, 10), c("fast", 89, 100), c("slowish", 88, 20)],
			dial: "balanced",
		});
		// fit: strong0 fast1 slowish2 · speed: fast0 slowish1 strong2 ⇒ sums: strong2 fast1 slowish3 ⇒ fast wins.
		expect(ids(flip)).toEqual(["fast", "strong", "slowish"]);
	});

	it("respects a custom margin and no-ops on singleton/empty lists", () => {
		// margin 5: only big is in the pool ⇒ nothing to re-order.
		expect(ids(applySpeedCapabilityDial({ ranked, dial: "speed", marginPts: 5 }))).toEqual([
			"big",
			"mid",
			"small",
			"weak",
		]);
		expect(applySpeedCapabilityDial({ ranked: [], dial: "speed" }).ranked).toEqual([]);
		expect(ids(applySpeedCapabilityDial({ ranked: [c("only", 50, 1)], dial: "speed" }))).toEqual(["only"]);
	});
});
