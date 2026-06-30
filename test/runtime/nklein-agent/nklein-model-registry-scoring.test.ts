import { describe, expect, it } from "vitest";

import type {
	NKleinModelRegistryCapabilityStats,
	NKleinModelRegistryWindowStats,
} from "../../../src/nklein-agent/nklein-model-registry";
import {
	calculateEffectiveCapability,
	calculateEffectiveContextWindow,
	DEFAULT_CAPABILITY_PRIOR,
	ewma,
} from "../../../src/nklein-agent/nklein-model-registry-scoring";

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

const capability = (partial: Partial<NKleinModelRegistryCapabilityStats>): NKleinModelRegistryCapabilityStats =>
	({
		evalScore: null,
		externalScore: null,
		observedPassRate: null,
		staticPrior: DEFAULT_CAPABILITY_PRIOR,
		samples: 0,
		lastObservedAt: null,
		...partial,
	}) as NKleinModelRegistryCapabilityStats;

const windowStats = (partial: Partial<NKleinModelRegistryWindowStats>): NKleinModelRegistryWindowStats =>
	({ userOverride: null, observed: null, advertised: null, ...partial }) as NKleinModelRegistryWindowStats;

describe("ewma", () => {
	it("returns the next value verbatim when there is no previous", () => {
		expect(ewma(null, 20, 0.25)).toBe(20);
	});

	it("blends previous and next by alpha", () => {
		expect(ewma(10, 20, 0.25)).toBe(12.5); // 10*0.75 + 20*0.25
	});
});

describe("calculateEffectiveContextWindow", () => {
	it("prefers userOverride, then observed, then advertised", () => {
		expect(calculateEffectiveContextWindow(windowStats({ userOverride: 100, observed: 50, advertised: 10 }))).toBe(
			100,
		);
		expect(calculateEffectiveContextWindow(windowStats({ observed: 50, advertised: 10 }))).toBe(50);
		expect(calculateEffectiveContextWindow(windowStats({ advertised: 10 }))).toBe(10);
	});

	it("returns null when nothing is set", () => {
		expect(calculateEffectiveContextWindow(windowStats({}))).toBeNull();
	});
});

describe("calculateEffectiveCapability", () => {
	it("returns the static prior when there is no observed signal", () => {
		expect(calculateEffectiveCapability(capability({ staticPrior: 35, samples: 0 }))).toBe(35);
	});

	it("blends an observed eval score with the prior (undecayed when no clock given)", () => {
		// observed [75], priorWeight 1/(1+0)=1 → (75 + 35)/2 = 55
		expect(calculateEffectiveCapability(capability({ evalScore: 75, staticPrior: 35, samples: 0 }))).toBe(55);
	});

	it("decays the observed score toward the prior by age (one half-life halves the gap)", () => {
		// at one half-life: eval 75 decays to 35 + (75-35)*0.5 = 55, then (55 + 35)/2 = 45
		const cap = capability({ evalScore: 75, staticPrior: 35, samples: 0, lastObservedAt: 0 });
		expect(calculateEffectiveCapability(cap, HALF_LIFE_MS)).toBe(45);
	});

	it("lets the prior weight shrink as samples accrue", () => {
		// samples 3 → priorWeight 1/4=0.25 → (75 + 35*0.25)/(1+0.25) = 83.75/1.25 = 67
		expect(calculateEffectiveCapability(capability({ evalScore: 75, staticPrior: 35, samples: 3 }))).toBe(67);
	});
});
