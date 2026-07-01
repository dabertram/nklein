import { describe, expect, it } from "vitest";
import {
	decideContextOccupancy,
	type OccupancyPressureInput,
	type ZoneOccupancy,
} from "../../../src/core/context-occupancy-pressure";

function decide(input: OccupancyPressureInput) {
	return decideContextOccupancy(input);
}

describe("decideContextOccupancy — action band", () => {
	it("proceeds in the productive middle band (between the expand floor and the compact ceiling)", () => {
		// 65% of the window: above the 50% expand floor, below the 80% compact ceiling.
		const result = decide({ usedTokens: 6_500, windowTokens: 10_000 });
		expect(result.action).toBe("proceed");
		expect(result.usedFraction).toBeCloseTo(0.65, 5);
		expect(result.trimZoneOrder).toEqual([]);
	});

	it("compacts at/above the default 80% ceiling (exact boundary compacts)", () => {
		expect(decide({ usedTokens: 8_000, windowTokens: 10_000 }).action).toBe("compact");
		expect(decide({ usedTokens: 8_100, windowTokens: 10_000 }).action).toBe("compact");
		expect(decide({ usedTokens: 7_999, windowTokens: 10_000 }).action).toBe("proceed");
	});

	it("expands at/below the default 50% floor (exact boundary expands)", () => {
		expect(decide({ usedTokens: 5_000, windowTokens: 10_000 }).action).toBe("expand");
		expect(decide({ usedTokens: 4_000, windowTokens: 10_000 }).action).toBe("expand");
		expect(decide({ usedTokens: 5_001, windowTokens: 10_000 }).action).toBe("proceed");
	});

	it("honors custom compact/expand fractions", () => {
		// Tighten to a 60% compact ceiling + a 30% expand floor.
		const opts = { compactAboveFraction: 0.6, expandBelowFraction: 0.3 } as const;
		expect(decide({ usedTokens: 6_000, windowTokens: 10_000, ...opts }).action).toBe("compact");
		expect(decide({ usedTokens: 4_500, windowTokens: 10_000, ...opts }).action).toBe("proceed");
		expect(decide({ usedTokens: 3_000, windowTokens: 10_000, ...opts }).action).toBe("expand");
	});
});

describe("decideContextOccupancy — usedFraction + headroom", () => {
	it("clamps usedFraction to [0,1] (over-window reads a full 1)", () => {
		expect(decide({ usedTokens: 15_000, windowTokens: 10_000 }).usedFraction).toBe(1);
		expect(decide({ usedTokens: 0, windowTokens: 10_000 }).usedFraction).toBe(0);
	});

	it("reports headroom under the compact ceiling, floored at 0 once reached", () => {
		// ceiling = 0.8 * 10000 = 8000; used 6000 → 2000 free.
		expect(decide({ usedTokens: 6_000, windowTokens: 10_000 }).headroomTokens).toBe(2_000);
		// At/over the ceiling → no headroom.
		expect(decide({ usedTokens: 8_000, windowTokens: 10_000 }).headroomTokens).toBe(0);
		expect(decide({ usedTokens: 12_000, windowTokens: 10_000 }).headroomTokens).toBe(0);
	});

	it("an under-filled window reports the full budget up to the ceiling as headroom (expand)", () => {
		const result = decide({ usedTokens: 2_000, windowTokens: 10_000 });
		expect(result.action).toBe("expand");
		expect(result.headroomTokens).toBe(6_000); // 8000 ceiling - 2000 used
	});
});

describe("decideContextOccupancy — trim-zone ordering", () => {
	const overFull = { usedTokens: 9_000, windowTokens: 10_000 } as const;

	it("orders middle → back → front (least-attended dead center shed first, framing last)", () => {
		const zones: ZoneOccupancy = { front: 500, middle: 4_000, back: 4_500 };
		const result = decide({ ...overFull, zones });
		expect(result.action).toBe("compact");
		expect(result.trimZoneOrder).toEqual(["middle", "back", "front"]);
	});

	it("ordering ignores zone size — a bulky front still trims LAST", () => {
		// Front is by far the largest; it must still come last (durable framing is load-bearing).
		const zones: ZoneOccupancy = { front: 8_000, middle: 500, back: 500 };
		const result = decide({ ...overFull, zones });
		expect(result.trimZoneOrder).toEqual(["middle", "back", "front"]);
	});

	it("omits zones that carry no (or non-positive / non-finite) tokens", () => {
		const zones: ZoneOccupancy = { front: 0, middle: 5_000, back: Number.NaN };
		const result = decide({ ...overFull, zones });
		expect(result.trimZoneOrder).toEqual(["middle"]);
	});

	it("with a back+front only breakdown, trims back before front", () => {
		const zones: ZoneOccupancy = { front: 1_000, back: 8_000 };
		expect(decide({ ...overFull, zones }).trimZoneOrder).toEqual(["back", "front"]);
	});

	it("no per-zone breakdown on a compact → empty trim order, and the reason says middle-first", () => {
		const result = decide(overFull);
		expect(result.action).toBe("compact");
		expect(result.trimZoneOrder).toEqual([]);
		expect(result.reason).toMatch(/middle/i);
	});

	it("proceed / expand never emit a trim order (even with zones supplied)", () => {
		const zones: ZoneOccupancy = { front: 500, middle: 2_000, back: 1_000 };
		expect(decide({ usedTokens: 6_500, windowTokens: 10_000, zones }).trimZoneOrder).toEqual([]);
		expect(decide({ usedTokens: 3_000, windowTokens: 10_000, zones }).trimZoneOrder).toEqual([]);
	});
});

describe("decideContextOccupancy — degenerate inputs", () => {
	it("an unusable window (<= 0) yields a cautious compact with fraction 1 and no headroom", () => {
		const result = decide({ usedTokens: 1_000, windowTokens: 0 });
		expect(result.action).toBe("compact");
		expect(result.usedFraction).toBe(1);
		expect(result.headroomTokens).toBe(0);
		expect(decide({ usedTokens: 1_000, windowTokens: -5 }).action).toBe("compact");
	});

	it("an unusable window still surfaces the trim-zone order from any supplied zones", () => {
		const zones: ZoneOccupancy = { middle: 3_000, front: 500 };
		const result = decide({ usedTokens: 1_000, windowTokens: 0, zones });
		expect(result.trimZoneOrder).toEqual(["middle", "front"]);
	});

	it("treats non-finite / negative usedTokens as 0 (expands on a real window)", () => {
		expect(decide({ usedTokens: Number.NaN, windowTokens: 10_000 }).action).toBe("expand");
		expect(decide({ usedTokens: -500, windowTokens: 10_000 }).usedFraction).toBe(0);
	});

	it("a crossed expand>=compact input never double-claims: compact wins at the ceiling, expand covers just below", () => {
		// expandBelowFraction (0.9) exceeds compactAboveFraction (0.8): the expand floor is clamped to the ceiling and
		// pulled just under, so the two verdicts stay disjoint (the proceed band collapses — the caller's own doing).
		const opts = { compactAboveFraction: 0.8, expandBelowFraction: 0.9 } as const;
		expect(decide({ usedTokens: 8_100, windowTokens: 10_000, ...opts }).action).toBe("compact"); // >= ceiling
		expect(decide({ usedTokens: 7_990, windowTokens: 10_000, ...opts }).action).toBe("expand"); // just under → expand
	});

	it("clamps an out-of-range compact fraction into (0,1]", () => {
		// > 1 clamps to 1 (compact only at a truly full window); used 9500/10000 = 95% < 100% → proceed.
		expect(decide({ usedTokens: 9_500, windowTokens: 10_000, compactAboveFraction: 2 }).action).toBe("proceed");
		expect(decide({ usedTokens: 10_000, windowTokens: 10_000, compactAboveFraction: 2 }).action).toBe("compact");
	});

	it("is deterministic — identical inputs give identical decisions", () => {
		const input: OccupancyPressureInput = {
			usedTokens: 8_500,
			windowTokens: 10_000,
			zones: { front: 1_000, middle: 4_000, back: 3_500 },
		};
		expect(decide(input)).toEqual(decide(input));
	});

	it("does not mutate the input", () => {
		const zones: ZoneOccupancy = { front: 1_000, middle: 4_000, back: 4_000 };
		const input: OccupancyPressureInput = { usedTokens: 9_000, windowTokens: 10_000, zones };
		const snapshot = JSON.parse(JSON.stringify(input));
		decide(input);
		expect(input).toEqual(snapshot);
	});
});
