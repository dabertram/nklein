import { describe, expect, it } from "vitest";
import {
	type FragmentPlacement,
	findPlacementMismatches,
	type PositionSalienceRiskOptions,
	scorePositionSalienceRisk,
	type WeightedFragment,
} from "../../../src/core/context-position-salience-risk";

function score(placement: FragmentPlacement, options?: PositionSalienceRiskOptions) {
	return scorePositionSalienceRisk(placement, options);
}

describe("scorePositionSalienceRisk — U-shape (edges safe, middle risky)", () => {
	it("the very first and very last positions carry zero risk (strong edges)", () => {
		const first = score({ index: 0, total: 21 });
		const last = score({ index: 20, total: 21 });
		expect(first.risk).toBe(0);
		expect(first.onEdge).toBe(true);
		expect(first.zone).toBe("front");
		expect(last.risk).toBe(0);
		expect(last.onEdge).toBe(true);
		expect(last.zone).toBe("back");
	});

	it("the dead center is the highest-risk region", () => {
		const center = score({ index: 10, total: 21 }); // normalizedPosition 0.5
		const nearFront = score({ index: 3, total: 21 });
		const nearBack = score({ index: 17, total: 21 });
		expect(center.zone).toBe("middle");
		expect(center.risk).toBeGreaterThan(nearFront.risk);
		expect(center.risk).toBeGreaterThan(nearBack.risk);
		expect(center.risk).toBeGreaterThan(0.5);
	});

	it("risk rises monotonically from an edge toward the center (front half)", () => {
		// Walk the interior from just past the front plateau to the center; risk must never decrease.
		const risks: number[] = [];
		for (let index = 3; index <= 10; index += 1) {
			risks.push(score({ index, total: 21 }).risk);
		}
		for (let i = 1; i < risks.length; i += 1) {
			expect(risks[i]).toBeGreaterThanOrEqual(risks[i - 1]);
		}
	});

	it("reports normalizedPosition = index / (total - 1)", () => {
		expect(score({ index: 0, total: 5 }).normalizedPosition).toBeCloseTo(0, 10);
		expect(score({ index: 2, total: 5 }).normalizedPosition).toBeCloseTo(0.5, 10);
		expect(score({ index: 4, total: 5 }).normalizedPosition).toBeCloseTo(1, 10);
	});

	it("all risks stay within [0, 1]", () => {
		for (let index = 0; index < 40; index += 1) {
			const { risk } = score({ index, total: 40 });
			expect(risk).toBeGreaterThanOrEqual(0);
			expect(risk).toBeLessThanOrEqual(1);
		}
	});
});

describe("scorePositionSalienceRisk — edge plateau", () => {
	it("positions inside the leading/trailing plateau are on-edge, zero risk", () => {
		// Default plateau 0.1 over 101 positions ⇒ the first/last ~10 positions are on-edge.
		expect(score({ index: 0, total: 101 }).onEdge).toBe(true);
		expect(score({ index: 10, total: 101 }).onEdge).toBe(true);
		expect(score({ index: 100, total: 101 }).onEdge).toBe(true);
		expect(score({ index: 90, total: 101 }).onEdge).toBe(true);
		// Just past the plateau is interior.
		expect(score({ index: 11, total: 101 }).onEdge).toBe(false);
		expect(score({ index: 11, total: 101 }).zone).toBe("middle");
	});

	it("a wider plateau makes more slots safe", () => {
		const idx = 12; // normalizedPosition 0.12 over 101 positions
		expect(score({ index: idx, total: 101 }).onEdge).toBe(false);
		expect(score({ index: idx, total: 101 }, { edgePlateauFraction: 0.2 }).onEdge).toBe(true);
	});

	it("a zero plateau leaves only the exact endpoints at zero risk", () => {
		const opts = { edgePlateauFraction: 0 } as const;
		expect(score({ index: 0, total: 51 }, opts).risk).toBe(0);
		expect(score({ index: 50, total: 51 }, opts).risk).toBe(0);
		// One step in from the front is already interior (non-zero risk).
		expect(score({ index: 1, total: 51 }, opts).risk).toBeGreaterThan(0);
	});
});

describe("scorePositionSalienceRisk — end-zone asymmetry (causal 'full picture near the end')", () => {
	it("an equidistant front slot is riskier than its back mirror by default", () => {
		const front = score({ index: 4, total: 21 }); // normalizedPosition 0.2
		const back = score({ index: 16, total: 21 }); // normalizedPosition 0.8 (mirror)
		expect(front.risk).toBeGreaterThan(back.risk);
	});

	it("zero end-zone advantage yields a symmetric U (mirror slots equal)", () => {
		const opts = { endZoneAdvantage: 0 } as const;
		const front = score({ index: 4, total: 21 }, opts);
		const back = score({ index: 16, total: 21 }, opts);
		expect(front.risk).toBeCloseTo(back.risk, 10);
	});

	it("a larger advantage lowers back-side risk relative to the front", () => {
		const backLow = score({ index: 16, total: 21 }, { endZoneAdvantage: 0.1 });
		const backHigh = score({ index: 16, total: 21 }, { endZoneAdvantage: 0.5 });
		expect(backHigh.risk).toBeLessThan(backLow.risk);
	});

	it("the risk peak sits ahead of the geometric center under asymmetry", () => {
		// With an end-zone advantage the front-of-center slot should out-risk the equally-central back-of-center slot.
		const frontOfCenter = score({ index: 9, total: 21 }); // 0.45
		const backOfCenter = score({ index: 11, total: 21 }); // 0.55
		expect(frontOfCenter.risk).toBeGreaterThan(backOfCenter.risk);
	});
});

describe("scorePositionSalienceRisk — sharpness", () => {
	it("higher sharpness flattens the center and steepens the shoulders", () => {
		// Just past the plateau, a sharper exponent should give LOWER risk (flatter shoulder near the edge).
		const soft = score({ index: 12, total: 101 }, { sharpness: 1 });
		const sharp = score({ index: 12, total: 101 }, { sharpness: 3 });
		expect(sharp.risk).toBeLessThan(soft.risk);
	});

	it("a non-finite / non-positive sharpness falls back to the default", () => {
		const def = score({ index: 12, total: 101 });
		expect(score({ index: 12, total: 101 }, { sharpness: Number.NaN }).risk).toBeCloseTo(def.risk, 10);
		expect(score({ index: 12, total: 101 }, { sharpness: 0 }).risk).toBeCloseTo(def.risk, 10);
		expect(score({ index: 12, total: 101 }, { sharpness: -5 }).risk).toBeCloseTo(def.risk, 10);
	});
});

describe("scorePositionSalienceRisk — degenerate inputs", () => {
	it("a lone fragment (total <= 1) carries no positional risk", () => {
		expect(score({ index: 0, total: 1 })).toEqual({ risk: 0, normalizedPosition: 0, zone: "front", onEdge: true });
		expect(score({ index: 0, total: 0 }).risk).toBe(0);
		expect(score({ index: 5, total: -3 }).risk).toBe(0);
	});

	it("an out-of-range index is clamped into [0, total)", () => {
		expect(score({ index: -10, total: 11 }).normalizedPosition).toBe(0);
		expect(score({ index: 999, total: 11 }).normalizedPosition).toBe(1);
		expect(score({ index: 999, total: 11 }).zone).toBe("back");
	});

	it("a non-finite index reads as the very front", () => {
		expect(score({ index: Number.NaN, total: 11 }).normalizedPosition).toBe(0);
		expect(score({ index: Number.POSITIVE_INFINITY, total: 11 }).risk).toBe(0);
	});

	it("a fractional index is truncated", () => {
		expect(score({ index: 5.9, total: 11 }).normalizedPosition).toBeCloseTo(0.5, 10);
	});

	it("clamps extreme option values without throwing", () => {
		// plateau >= 0.5 would collapse the interior — it is clamped strictly below 0.5.
		const r = score({ index: 5, total: 11 }, { edgePlateauFraction: 5, endZoneAdvantage: 2 });
		expect(r.risk).toBeGreaterThanOrEqual(0);
		expect(r.risk).toBeLessThanOrEqual(1);
	});
});

describe("findPlacementMismatches — high-importance-in-risky-slot detector", () => {
	const frags = (importances: readonly number[]): WeightedFragment[] =>
		importances.map((importance, i) => ({ id: `f${i}`, importance }));

	it("flags an important fragment stranded in the middle", () => {
		// 11 fragments; the critical one (importance 1) sits dead center at index 5.
		const importances = [0.1, 0.1, 0.1, 0.1, 0.1, 1, 0.1, 0.1, 0.1, 0.1, 0.1];
		const mismatches = findPlacementMismatches(frags(importances));
		expect(mismatches.length).toBeGreaterThan(0);
		expect(mismatches[0].id).toBe("f5");
		expect(mismatches[0].mismatch).toBeGreaterThan(0);
		expect(mismatches[0].importance).toBe(1);
	});

	it("does NOT flag an important fragment placed on an edge", () => {
		// The important fragment is first (index 0, front edge) — well-attended, no mismatch.
		const importances = [1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
		const mismatches = findPlacementMismatches(frags(importances));
		expect(mismatches.find((m) => m.id === "f0")).toBeUndefined();
	});

	it("ranks worst-first by importance × risk", () => {
		// Two mid fragments: index 5 (higher risk, importance 0.6) vs index 3 (lower risk, importance 0.6).
		const importances = [0, 0, 0, 0.6, 0, 0.6, 0, 0, 0, 0, 0];
		const mismatches = findPlacementMismatches(
			importances.map((imp, i) => ({ id: `f${i}`, importance: imp })),
			{
				riskThreshold: 0,
			},
		);
		const ids = mismatches.map((m) => m.id);
		expect(ids.indexOf("f5")).toBeLessThan(ids.indexOf("f3"));
	});

	it("honors the risk threshold (near-edge risky-but-below-threshold slots excluded)", () => {
		const importances = Array.from({ length: 21 }, () => 1);
		const strict = findPlacementMismatches(frags(importances), { riskThreshold: 0.9 });
		const lenient = findPlacementMismatches(frags(importances), { riskThreshold: 0.1 });
		expect(strict.length).toBeLessThan(lenient.length);
		// Every reported slot clears its threshold.
		for (const m of strict) {
			expect(m.risk).toBeGreaterThanOrEqual(0.9);
		}
	});

	it("respects the limit (worst-first)", () => {
		const importances = Array.from({ length: 21 }, () => 1);
		const all = findPlacementMismatches(frags(importances), { riskThreshold: 0 });
		const top2 = findPlacementMismatches(frags(importances), { riskThreshold: 0, limit: 2 });
		expect(top2).toHaveLength(2);
		expect(top2[0].mismatch).toBe(all[0].mismatch);
		expect(top2[1].mismatch).toBe(all[1].mismatch);
	});

	it("treats non-finite / negative importance as zero (never flagged)", () => {
		const fragments: WeightedFragment[] = [
			{ id: "nan", importance: Number.NaN },
			{ id: "neg", importance: -5 },
			{ id: "mid", importance: 1 },
			{ id: "z", importance: 0 },
			{ id: "e", importance: 1 },
		];
		const mismatches = findPlacementMismatches(fragments, { riskThreshold: 0 });
		const ids = mismatches.map((m) => m.id);
		expect(ids).not.toContain("nan");
		expect(ids).not.toContain("neg");
		expect(ids).not.toContain("z");
	});

	it("returns nothing for 0 or 1 fragments", () => {
		expect(findPlacementMismatches([])).toEqual([]);
		expect(findPlacementMismatches([{ id: "only", importance: 1 }])).toEqual([]);
	});

	it("does not mutate or reorder the input array", () => {
		const input: WeightedFragment[] = frags([0.1, 1, 0.1, 1, 0.1]);
		const snapshot = input.map((f) => ({ ...f }));
		findPlacementMismatches(input, { riskThreshold: 0 });
		expect(input).toEqual(snapshot);
	});
});
