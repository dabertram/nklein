import { describe, expect, it } from "vitest";

import {
	createEmptyCapabilityStats,
	createEmptySpeedStats,
	normalizeCapabilityStats,
	normalizeConstraints,
	normalizeSpeedStats,
	normalizeWindowStats,
} from "../../../src/nklein-agent/nklein-model-registry-stats";

describe("createEmptySpeedStats", () => {
	it("returns a zeroed block", () => {
		const stats = createEmptySpeedStats();
		expect(stats.samples).toBe(0);
		expect(stats.promptTokensEwma).toBeNull();
		expect(stats.lastObservedAt).toBeNull();
	});
});

describe("createEmptyCapabilityStats", () => {
	it("seeds the static prior (35) as the effective score with no observations", () => {
		const stats = createEmptyCapabilityStats();
		expect(stats.samples).toBe(0);
		expect(stats.staticPrior).toBe(35);
		expect(stats.effectiveScore).toBe(35);
	});
});

describe("normalizeWindowStats", () => {
	it("parses the window values and computes effective = userOverride ?? observed ?? advertised", () => {
		expect(normalizeWindowStats({ advertised: 4000, observed: 8000 }).effective).toBe(8000);
		expect(normalizeWindowStats({ advertised: 4000, observed: 8000, userOverride: 16000 }).effective).toBe(16000);
		expect(normalizeWindowStats({ advertised: 4000 }).effective).toBe(4000);
	});

	it("drops invalid (non-positive-integer) values", () => {
		expect(normalizeWindowStats({ advertised: -1, observed: "x" }).effective).toBeNull();
	});
});

describe("normalizeSpeedStats", () => {
	it("defaults samples to 0 and unknown fields to null", () => {
		const stats = normalizeSpeedStats({});
		expect(stats.samples).toBe(0);
		expect(stats.promptTokensEwma).toBeNull();
	});

	it("parses present numeric fields", () => {
		const stats = normalizeSpeedStats({ samples: 5, promptTokensEwma: 12.5, decodeTokensPerSecondEwma: 40 });
		expect(stats.samples).toBe(5);
		expect(stats.promptTokensEwma).toBe(12.5);
		expect(stats.decodeTokensPerSecondEwma).toBe(40);
	});
});

describe("normalizeCapabilityStats", () => {
	it("defaults the static prior and computes the effective score", () => {
		// evalScore 75, prior 35, samples 0 → (75 + 35)/2 = 55
		const stats = normalizeCapabilityStats({ evalScore: 75 }, 1000);
		expect(stats.staticPrior).toBe(35);
		expect(stats.effectiveScore).toBe(55);
	});

	it("clamps the eval score to [0,100] and rejects an out-of-range pass rate", () => {
		const stats = normalizeCapabilityStats({ evalScore: 250, observedPassRate: 2 }, 1000);
		expect(stats.evalScore).toBe(100); // normalizeScore clamps; it does not reject
		expect(stats.observedPassRate).toBeNull(); // normalizePassRate rejects >1
	});
});

describe("normalizeConstraints", () => {
	const fallback = {
		sharedEndpointId: "fallback-endpoint",
		inputCostPerMillionTokens: null,
		outputCostPerMillionTokens: null,
		maxConcurrentRequests: 1,
	};

	it("parses present values and falls back for missing ones", () => {
		const constraints = normalizeConstraints({ sharedEndpointId: " ep ", maxConcurrentRequests: 4 }, fallback);
		expect(constraints.sharedEndpointId).toBe("ep");
		expect(constraints.maxConcurrentRequests).toBe(4);
	});

	it("uses the fallback for blank/invalid fields", () => {
		const constraints = normalizeConstraints({ sharedEndpointId: "   ", maxConcurrentRequests: -1 }, fallback);
		expect(constraints.sharedEndpointId).toBe("fallback-endpoint");
		expect(constraints.maxConcurrentRequests).toBe(1);
	});
});
