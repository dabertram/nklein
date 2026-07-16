import { describe, expect, it } from "vitest";
import {
	assessCapabilityCeiling,
	buildUpgradeCandidatesFromFitness,
	type CatalogModelCandidate,
	ceilingHitRoles,
	computeFleetCapabilityUpgrades,
	type FleetModelFitness,
	type MachineMemory,
	type RoleQualityBar,
	recommendCeilingUpgrades,
} from "../../../src/core/capability-ceiling-recommendation.js";

/** F3.35 — capability-ceiling recommendations: flag roles the loaded fleet cannot clear. */

const bars: RoleQualityBar[] = [
	{ role: "worker", minConfidence: 0.6 },
	{ role: "reviewer", minConfidence: 0.8 },
];

const mkFit = (modelKey: string, role: string, qualityConfidence: number, loaded = true): FleetModelFitness => ({
	modelKey,
	role,
	qualityConfidence,
	loaded,
});

describe("assessCapabilityCeiling", () => {
	it("marks a role sufficient when a loaded model clears the bar", () => {
		const v = assessCapabilityCeiling(bars, [mkFit("m", "worker", 0.7)]);
		expect(v.find((r) => r.role === "worker")?.status).toBe("sufficient");
	});

	it("flags ceiling_hit with shortfall + recommendation when no loaded model clears the bar", () => {
		const v = assessCapabilityCeiling(bars, [mkFit("weak", "reviewer", 0.55)]);
		const reviewer = v.find((r) => r.role === "reviewer");
		expect(reviewer?.status).toBe("ceiling_hit");
		expect(reviewer?.shortfall).toBeCloseTo(0.25);
		expect(reviewer?.recommendation).toContain("stronger model");
	});

	it("ignores unloaded models — a loaded weak model still hits the ceiling despite an unloaded strong one", () => {
		const v = assessCapabilityCeiling(bars, [
			mkFit("weak-loaded", "reviewer", 0.55, true),
			mkFit("strong-but-unloaded", "reviewer", 0.95, false),
		]);
		const reviewer = v.find((r) => r.role === "reviewer");
		expect(reviewer?.status).toBe("ceiling_hit"); // the unloaded 0.95 doesn't rescue it
		expect(reviewer?.bestLoaded?.modelKey).toBe("weak-loaded");
	});

	it("is no_evidence when no loaded model has been measured for the role", () => {
		const v = assessCapabilityCeiling(bars, [mkFit("m", "worker", 0.9)]);
		expect(v.find((r) => r.role === "reviewer")?.status).toBe("no_evidence");
	});

	it("ceilingHitRoles returns only hit roles, most-shortfall first", () => {
		const v = assessCapabilityCeiling(bars, [mkFit("w", "worker", 0.1), mkFit("r", "reviewer", 0.75)]);
		const hits = ceilingHitRoles(v);
		expect(hits.map((h) => h.role)).toEqual(["worker", "reviewer"]); // worker shortfall 0.5 > reviewer 0.05
	});
});

describe("recommendCeilingUpgrades (F3.35 enrichment — name the exact model/machine/fit)", () => {
	const machines: MachineMemory[] = [
		{ machine: "m5max", usableGB: 95 },
		{ machine: "legion5pro", usableGB: 8 },
	];
	const mkCand = (
		over: Partial<CatalogModelCandidate> & Pick<CatalogModelCandidate, "modelKey">,
	): CatalogModelCandidate => ({
		role: "reviewer",
		measuredCapability: 0.95,
		machine: "m5max",
		sizeGB: 20,
		samples: 12,
		loaded: false,
		...over,
	});

	it("recommends the best not-loaded catalog model that fits its home machine", () => {
		const verdicts = assessCapabilityCeiling(bars, [mkFit("weak", "reviewer", 0.55)]);
		const recs = recommendCeilingUpgrades(verdicts, [mkCand({ modelKey: "strong-reviewer" })], machines);
		expect(recs).toHaveLength(1);
		expect(recs[0]?.candidateModelKey).toBe("strong-reviewer");
		expect(recs[0]?.targetMachine).toBe("m5max");
		expect(recs[0]?.fitsTargetMachine).toBe(true);
		expect(recs[0]?.projectedGain).toBeCloseTo(0.4);
		expect(recs[0]?.confidence).toBe("high");
		expect(recs[0]?.recommendation).toContain("Propose-only");
	});

	it("prefers a fitting candidate over a higher-capability one that does not fit", () => {
		const verdicts = assessCapabilityCeiling(bars, [mkFit("weak", "reviewer", 0.55)]);
		const recs = recommendCeilingUpgrades(
			verdicts,
			[
				mkCand({ modelKey: "huge-best", measuredCapability: 0.99, machine: "legion5pro", sizeGB: 40 }), // doesn't fit 8GB
				mkCand({ modelKey: "fits-ok", measuredCapability: 0.9, machine: "m5max", sizeGB: 20 }),
			],
			machines,
		);
		expect(recs[0]?.candidateModelKey).toBe("fits-ok");
		expect(recs[0]?.fitsTargetMachine).toBe(true);
	});

	it("excludes measurement-unreliable (VRAM-constrained) candidates", () => {
		const verdicts = assessCapabilityCeiling(bars, [mkFit("weak", "reviewer", 0.55)]);
		const recs = recommendCeilingUpgrades(
			verdicts,
			[mkCand({ modelKey: "vram-degraded", measurementUnreliable: true })],
			machines,
		);
		expect(recs).toHaveLength(0);
	});

	it("omits a role when no not-loaded candidate beats the best loaded model by minGain", () => {
		const verdicts = assessCapabilityCeiling(bars, [mkFit("weak", "reviewer", 0.55)]);
		// candidate only marginally better than 0.55 → below default minGain 0.02
		const recs = recommendCeilingUpgrades(
			verdicts,
			[mkCand({ modelKey: "barely", measuredCapability: 0.56 })],
			machines,
		);
		expect(recs).toHaveLength(0);
	});

	it("labels low confidence for thin sample counts and marks a non-fitting recommendation honestly", () => {
		const verdicts = assessCapabilityCeiling(bars, [mkFit("weak", "reviewer", 0.55)]);
		const recs = recommendCeilingUpgrades(
			verdicts,
			[mkCand({ modelKey: "thin-and-big", samples: 2, machine: "legion5pro", sizeGB: 40 })],
			machines,
		);
		expect(recs[0]?.confidence).toBe("low");
		expect(recs[0]?.fitsTargetMachine).toBe(false);
		expect(recs[0]?.recommendation).toContain("does NOT fit");
	});

	it("treats an unknown-memory machine as non-fitting (never claims an unverifiable fit)", () => {
		const verdicts = assessCapabilityCeiling(bars, [mkFit("weak", "reviewer", 0.55)]);
		const recs = recommendCeilingUpgrades(
			verdicts,
			[mkCand({ modelKey: "on-mystery-box", machine: "unknown-machine" })],
			machines,
		);
		expect(recs[0]?.fitsTargetMachine).toBe(false);
	});
});

describe("buildUpgradeCandidatesFromFitness", () => {
	const catalog = [
		{ modelKey: "big-strong", device: "m5max", sizeGB: 20 },
		{ modelKey: "no-catalog-entry-ignored", device: "m5max", sizeGB: 5 },
	];

	it("aggregates fitness samples per (model, role) and joins the catalog for machine + size", () => {
		const cands = buildUpgradeCandidatesFromFitness(
			[
				{ modelKey: "big-strong", role: "reviewer", successCount: 2, sampleCount: 2 }, // easy+medium
				{ modelKey: "big-strong", role: "reviewer", successCount: 1, sampleCount: 2 }, // hard tier
			],
			catalog,
			() => false,
		);
		expect(cands).toHaveLength(1);
		expect(cands[0]).toMatchObject({
			modelKey: "big-strong",
			role: "reviewer",
			machine: "m5max",
			sizeGB: 20,
			samples: 4,
		});
		expect(cands[0]?.measuredCapability).toBeCloseTo(0.75); // (2+1)/(2+2)
	});

	it("drops models absent from the catalog (no machine/size to check fit) and zero-sample aggregates", () => {
		const cands = buildUpgradeCandidatesFromFitness(
			[
				{ modelKey: "ghost", role: "worker", successCount: 3, sampleCount: 3 }, // not in catalog
				{ modelKey: "big-strong", role: "worker", successCount: 0, sampleCount: 0 }, // zero samples
			],
			catalog,
			() => false,
		);
		expect(cands).toHaveLength(0);
	});

	it("carries the loaded flag from the predicate", () => {
		const cands = buildUpgradeCandidatesFromFitness(
			[{ modelKey: "big-strong", role: "worker", successCount: 1, sampleCount: 1 }],
			catalog,
			(k) => k === "big-strong",
		);
		expect(cands[0]?.loaded).toBe(true);
	});
});

describe("computeFleetCapabilityUpgrades (shared CLI+API orchestrator)", () => {
	it("detects a ceiling from loaded fitness and names a fitting not-loaded upgrade end-to-end", () => {
		const upgrades = computeFleetCapabilityUpgrades({
			fitnessSamples: [
				// loaded weak reviewer: 1/2 = 0.50, below the 0.7 bar → ceiling hit
				{ modelKey: "weak-loaded", role: "reviewer", successCount: 1, sampleCount: 2 },
				// not-loaded strong reviewer: 10/10 = 1.0 → the upgrade
				{ modelKey: "strong-shelf", role: "reviewer", successCount: 10, sampleCount: 10 },
			],
			catalog: [
				{ modelKey: "weak-loaded", device: "m5max", sizeGB: 5 },
				{ modelKey: "strong-shelf", device: "m5max", sizeGB: 20 },
			],
			deviceRamGB: { m5max: 95 },
			isLoaded: (k) => k === "weak-loaded",
			bars: [{ role: "reviewer", minConfidence: 0.7 }],
		});
		expect(upgrades).toHaveLength(1);
		expect(upgrades[0]?.candidateModelKey).toBe("strong-shelf");
		expect(upgrades[0]?.fitsTargetMachine).toBe(true);
		expect(upgrades[0]?.confidence).toBe("high");
	});

	it("returns nothing when the loaded fleet already clears the bar", () => {
		const upgrades = computeFleetCapabilityUpgrades({
			fitnessSamples: [{ modelKey: "good-loaded", role: "worker", successCount: 9, sampleCount: 10 }],
			catalog: [{ modelKey: "good-loaded", device: "m5max", sizeGB: 5 }],
			deviceRamGB: { m5max: 95 },
			isLoaded: () => true,
			bars: [{ role: "worker", minConfidence: 0.6 }],
		});
		expect(upgrades).toHaveLength(0);
	});
});
