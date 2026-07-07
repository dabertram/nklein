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
