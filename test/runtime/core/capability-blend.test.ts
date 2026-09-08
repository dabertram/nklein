import { describe, expect, it } from "vitest";
import { createCapabilityBlender } from "../../../src/core/capability-blend";
import { roleEvidenceKey } from "../../../src/core/ledger-evidence";

const emptyBlender = () =>
	createCapabilityBlender({
		successByKey: new Map(),
		roleSuccessByKey: new Map(),
		verdictRuns: [],
		selfObservationEvents: [],
	});

describe("createCapabilityBlender", () => {
	it("returns the base capability unchanged when there is no ledger evidence", () => {
		expect(emptyBlender().blendedCapabilityForKey("m", 70)).toBe(70);
	});

	it("blends a strong global success rate up into the base capability", () => {
		const blender = createCapabilityBlender({
			successByKey: new Map([["m", { successRate: 1, samples: 20 }]]),
			roleSuccessByKey: new Map(),
			verdictRuns: [],
			selfObservationEvents: [],
		});
		expect(blender.blendedCapabilityForKey("m", 50)).toBeGreaterThan(50);
	});

	it("prefers ROLE evidence over the global rollup when it has enough samples", () => {
		const blender = createCapabilityBlender({
			successByKey: new Map([["m", { successRate: 1.0, samples: 50 }]]), // great globally
			roleSuccessByKey: new Map([[roleEvidenceKey("m", "architect"), { successRate: 0.0, samples: 10 }]]), // bad as architect
			verdictRuns: [],
			selfObservationEvents: [],
		});
		expect(blender.blendedCapabilityForKey("m", 50, "architect")).toBeLessThan(
			blender.blendedCapabilityForKey("m", 50),
		);
	});

	it("falls back to the global rollup when role evidence is too thin (<3 samples)", () => {
		const blender = createCapabilityBlender({
			successByKey: new Map([["m", { successRate: 1.0, samples: 50 }]]),
			roleSuccessByKey: new Map([[roleEvidenceKey("m", "architect"), { successRate: 0.0, samples: 2 }]]), // too thin
			verdictRuns: [],
			selfObservationEvents: [],
		});
		// Thin role evidence is ignored, so the role-scoped blend equals the plain global blend.
		expect(blender.blendedCapabilityForKey("m", 50, "architect")).toBe(blender.blendedCapabilityForKey("m", 50));
	});

	it("applies no verdict penalty (x1) when there is no observation evidence", () => {
		expect(emptyBlender().verdictMultiplier("m")).toBe(1);
	});
});

describe("createCapabilityBlender — fitness (sweep) evidence tier", () => {
	it("uses fitness role evidence when the ledger has none (the freshly-swept-model case)", () => {
		const blender = createCapabilityBlender({
			successByKey: new Map(),
			roleSuccessByKey: new Map(),
			fitnessRoleSuccessByKey: new Map([
				[roleEvidenceKey("google/gemma-4-31b-qat", "reviewer"), { successRate: 1.0, samples: 6 }],
			]),
			verdictRuns: [],
			selfObservationEvents: [],
		});
		expect(blender.blendedCapabilityForKey("google/gemma-4-31b-qat", 50, "reviewer")).toBeGreaterThan(50);
	});

	it("resolves the fitness row for a CANONICAL router key (normalized lookup, key shapes can't miss)", () => {
		const blender = createCapabilityBlender({
			successByKey: new Map(),
			roleSuccessByKey: new Map(),
			fitnessRoleSuccessByKey: new Map([
				[roleEvidenceKey("google/gemma-4-31b-qat", "reviewer"), { successRate: 1.0, samples: 6 }],
			]),
			verdictRuns: [],
			selfObservationEvents: [],
		});
		expect(
			blender.blendedCapabilityForKey("lmstudio:google/gemma-4-31b-qat:http://localhost:1234/v1", 50, "reviewer"),
		).toBeGreaterThan(50);
	});

	it("lets real-task ROLE ledger evidence outrank fitness evidence (real tasks beat benchmarks)", () => {
		const blender = createCapabilityBlender({
			successByKey: new Map(),
			roleSuccessByKey: new Map([[roleEvidenceKey("m", "reviewer"), { successRate: 0.0, samples: 10 }]]),
			fitnessRoleSuccessByKey: new Map([[roleEvidenceKey("m", "reviewer"), { successRate: 1.0, samples: 12 }]]),
			verdictRuns: [],
			selfObservationEvents: [],
		});
		// The bad real-task evidence must drag the blend DOWN despite perfect sweep fitness.
		expect(blender.blendedCapabilityForKey("m", 50, "reviewer")).toBeLessThan(50);
	});

	it("lets fitness outrank the GLOBAL ledger rollup (benchmarks beat role-blind evidence)", () => {
		const blender = createCapabilityBlender({
			successByKey: new Map([["m", { successRate: 0.0, samples: 50 }]]), // bad globally
			roleSuccessByKey: new Map(),
			fitnessRoleSuccessByKey: new Map([[roleEvidenceKey("m", "reviewer"), { successRate: 1.0, samples: 6 }]]),
			verdictRuns: [],
			selfObservationEvents: [],
		});
		expect(blender.blendedCapabilityForKey("m", 50, "reviewer")).toBeGreaterThan(
			blender.blendedCapabilityForKey("m", 50), // role-blind call can't see fitness → global drags it down
		);
	});

	it("ignores thin fitness evidence (<3 samples) and stays byte-identical without the input", () => {
		const withThin = createCapabilityBlender({
			successByKey: new Map(),
			roleSuccessByKey: new Map(),
			fitnessRoleSuccessByKey: new Map([[roleEvidenceKey("m", "reviewer"), { successRate: 1.0, samples: 2 }]]),
			verdictRuns: [],
			selfObservationEvents: [],
		});
		expect(withThin.blendedCapabilityForKey("m", 50, "reviewer")).toBe(50);
	});
});

describe("observedEvidenceForKey — the SAME tier selection the blend consumes (P0.REVRANK)", () => {
	const blender = () =>
		createCapabilityBlender({
			successByKey: new Map([["m", { successRate: 0.5, samples: 40 }]]),
			roleSuccessByKey: new Map([
				[roleEvidenceKey("m", "reviewer"), { successRate: 0.9, samples: 10 }],
				[roleEvidenceKey("m", "architect"), { successRate: 0.1, samples: 2 }], // too thin to outrank
			]),
			fitnessRoleSuccessByKey: new Map([[roleEvidenceKey("m", "worker"), { successRate: 0.7, samples: 6 }]]),
			verdictRuns: [],
			selfObservationEvents: [],
		});

	it("reports null when no row exists at all — the caller must not read a prior as a measurement", () => {
		expect(emptyBlender().observedEvidenceForKey("m", "reviewer")).toBeNull();
	});

	it("reports the role ledger, the fitness sweep, then the global rollup — with the tier named", () => {
		expect(blender().observedEvidenceForKey("m", "reviewer")).toEqual({
			successRate: 0.9,
			samples: 10,
			source: "role_ledger",
		});
		expect(blender().observedEvidenceForKey("m", "worker")).toEqual({
			successRate: 0.7,
			samples: 6,
			source: "fitness_sweep",
		});
		// Role evidence under the floor falls through to the global rollup — exactly what the blend does.
		expect(blender().observedEvidenceForKey("m", "architect")).toEqual({
			successRate: 0.5,
			samples: 40,
			source: "global_ledger",
		});
	});

	it("agrees with the blend: the reported row is the one that moved the score", () => {
		const scored = blender();
		// Role evidence (0.9) pulls 50 up; the global rollup (0.5) would not have.
		expect(scored.blendedCapabilityForKey("m", 50, "reviewer")).toBeGreaterThan(
			scored.blendedCapabilityForKey("m", 50, "architect"),
		);
	});

	it("reports a row under the blend's floor rather than hiding it — `samples` is the caller's gate", () => {
		const thin = createCapabilityBlender({
			successByKey: new Map([["m", { successRate: 1, samples: 1 }]]),
			roleSuccessByKey: new Map(),
			verdictRuns: [],
			selfObservationEvents: [],
		});
		expect(thin.observedEvidenceForKey("m", "reviewer")).toEqual({
			successRate: 1,
			samples: 1,
			source: "global_ledger",
		});
		expect(thin.blendedCapabilityForKey("m", 50, "reviewer")).toBe(50); // …and it moved nothing.
	});
});
