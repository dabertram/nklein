import { describe, expect, it } from "vitest";
import {
	assessCapabilityCeiling,
	ceilingHitRoles,
	type FleetModelFitness,
	type RoleQualityBar,
} from "../../../src/core/capability-ceiling-recommendation.js";

/** F3.35 — capability-ceiling recommendations: flag roles the loaded fleet cannot clear. */

const bars: RoleQualityBar[] = [
	{ role: "worker", minConfidence: 0.6 },
	{ role: "reviewer", minConfidence: 0.8 },
];

const fit = (modelKey: string, role: string, qualityConfidence: number, loaded = true): FleetModelFitness => ({
	modelKey,
	role,
	qualityConfidence,
	loaded,
});

describe("assessCapabilityCeiling", () => {
	it("marks a role sufficient when a loaded model clears the bar", () => {
		const v = assessCapabilityCeiling(bars, [fit("m", "worker", 0.7)]);
		expect(v.find((r) => r.role === "worker")?.status).toBe("sufficient");
	});

	it("flags ceiling_hit with shortfall + recommendation when no loaded model clears the bar", () => {
		const v = assessCapabilityCeiling(bars, [fit("weak", "reviewer", 0.55)]);
		const reviewer = v.find((r) => r.role === "reviewer");
		expect(reviewer?.status).toBe("ceiling_hit");
		expect(reviewer?.shortfall).toBeCloseTo(0.25);
		expect(reviewer?.recommendation).toContain("stronger model");
	});

	it("ignores unloaded models — a loaded weak model still hits the ceiling despite an unloaded strong one", () => {
		const v = assessCapabilityCeiling(bars, [
			fit("weak-loaded", "reviewer", 0.55, true),
			fit("strong-but-unloaded", "reviewer", 0.95, false),
		]);
		const reviewer = v.find((r) => r.role === "reviewer");
		expect(reviewer?.status).toBe("ceiling_hit"); // the unloaded 0.95 doesn't rescue it
		expect(reviewer?.bestLoaded?.modelKey).toBe("weak-loaded");
	});

	it("is no_evidence when no loaded model has been measured for the role", () => {
		const v = assessCapabilityCeiling(bars, [fit("m", "worker", 0.9)]);
		expect(v.find((r) => r.role === "reviewer")?.status).toBe("no_evidence");
	});

	it("ceilingHitRoles returns only hit roles, most-shortfall first", () => {
		const v = assessCapabilityCeiling(bars, [fit("w", "worker", 0.1), fit("r", "reviewer", 0.75)]);
		const hits = ceilingHitRoles(v);
		expect(hits.map((h) => h.role)).toEqual(["worker", "reviewer"]); // worker shortfall 0.5 > reviewer 0.05
	});
});
