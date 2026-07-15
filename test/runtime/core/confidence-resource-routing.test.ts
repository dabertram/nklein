import { describe, expect, it } from "vitest";
import {
	type RoutingCandidate,
	rankRoutingCandidates,
	routingPredictionError,
	scoreRoutingCandidate,
} from "../../../src/core/confidence-resource-routing.js";

/** F3.33 — confidence + resource-aware routing scoring. */

const cand = (over: Partial<RoutingCandidate> & { modelKey: string }): RoutingCandidate => ({
	endpoint: "http://localhost:1234/v1",
	qualityConfidence: 0.8,
	queueDepth: 0,
	freeRamGb: 64,
	requiredRamGb: 8,
	estimatedLoadMs: 0,
	endpointOccupancy: 0,
	warmCacheValue: 0.5,
	...over,
});

describe("scoreRoutingCandidate", () => {
	it("marks a model that does not fit as infeasible with score 0", () => {
		const s = scoreRoutingCandidate(cand({ modelKey: "big", requiredRamGb: 96, freeRamGb: 32 }));
		expect(s.feasible).toBe(false);
		expect(s.score).toBe(0);
		expect(s.reasons[0]).toContain("infeasible");
	});

	it("rewards quality + warm cache, penalizes queue + cold load + occupancy", () => {
		const ideal = scoreRoutingCandidate(
			cand({ modelKey: "a", qualityConfidence: 0.95, queueDepth: 0, estimatedLoadMs: 0 }),
		);
		const busy = scoreRoutingCandidate(
			cand({ modelKey: "b", qualityConfidence: 0.95, queueDepth: 4, estimatedLoadMs: 60000, endpointOccupancy: 1 }),
		);
		expect(ideal.score).toBeGreaterThan(busy.score);
		const lowQ = scoreRoutingCandidate(cand({ modelKey: "c", qualityConfidence: 0.2 }));
		expect(ideal.score).toBeGreaterThan(lowQ.score);
	});
});

describe("rankRoutingCandidates", () => {
	it("drops infeasible candidates and orders the rest best-first", () => {
		const ranked = rankRoutingCandidates([
			cand({ modelKey: "fits-weak", qualityConfidence: 0.3 }),
			cand({ modelKey: "too-big", requiredRamGb: 200 }),
			cand({ modelKey: "fits-strong", qualityConfidence: 0.95 }),
		]);
		expect(ranked.map((r) => r.modelKey)).toEqual(["fits-strong", "fits-weak"]); // too-big dropped
	});

	it("prefers a warm free endpoint over a cold busy one at equal quality", () => {
		const ranked = rankRoutingCandidates([
			cand({ modelKey: "cold-busy", estimatedLoadMs: 60000, queueDepth: 4 }),
			cand({ modelKey: "warm-free", estimatedLoadMs: 0, queueDepth: 0 }),
		]);
		expect(ranked[0].modelKey).toBe("warm-free");
	});
});

describe("routingPredictionError", () => {
	it("is the absolute gap between predicted score and realized quality", () => {
		expect(routingPredictionError(0.9, 0.9)).toBe(0);
		expect(routingPredictionError(0.9, 0.4)).toBeCloseTo(0.5);
		expect(routingPredictionError(1.2, -0.2)).toBe(1); // clamped
	});
});
