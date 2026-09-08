import { describe, expect, it, vi } from "vitest";
import { createCapabilityBlender } from "../../../src/core/capability-blend";
import { roleEvidenceKey } from "../../../src/core/ledger-evidence";
import type {
	NKleinModelRegistryEntry,
	NKleinModelRegistrySnapshot,
} from "../../../src/nklein-agent/nklein-model-registry";
import { buildNKleinModelRegistryKey } from "../../../src/nklein-agent/nklein-model-registry-key";
import {
	createReviewerCapabilityEvidenceSource,
	loadReviewerCapabilityEvidence,
} from "../../../src/nklein-agent/nklein-reviewer-capability-evidence";

const PROVIDER = "lmstudio";
const ENDPOINT = "http://127.0.0.1:1234/v1";

const key = (modelId: string) => buildNKleinModelRegistryKey({ providerId: PROVIDER, modelId, endpoint: ENDPOINT });

/** A registry entry whose capability carries REAL eval signal (samples/evalScore) unless told otherwise. */
const registryEntry = (modelId: string, capability: Partial<NKleinModelRegistryEntry["capability"]>) =>
	({
		key: key(modelId),
		providerId: PROVIDER,
		modelId,
		endpoint: ENDPOINT,
		contextWindow: {},
		speed: {},
		capability: {
			samples: 0,
			staticPrior: 35,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: 35,
			lastObservedAt: null,
			...capability,
		},
		constraints: {},
		createdAt: 0,
		updatedAt: 0,
	}) as unknown as NKleinModelRegistryEntry;

const snapshot = (entries: NKleinModelRegistryEntry[]): NKleinModelRegistrySnapshot => ({
	schemaVersion: 1,
	updatedAt: 0,
	models: Object.fromEntries(entries.map((entry) => [entry.key, entry])),
});

function source(input: {
	registry?: NKleinModelRegistrySnapshot;
	roleSuccess?: [string, { successRate: number; samples: number }][];
	globalSuccess?: [string, { successRate: number; samples: number }][];
	verdictRuns?: { runId: string; modelId: string }[];
	selfObservationEvents?: { signal: string; modelId: string }[];
	catalogPriors?: Record<string, number>;
	stableIds?: Record<string, string>;
}) {
	return createReviewerCapabilityEvidenceSource({
		providerId: PROVIDER,
		endpoint: ENDPOINT,
		registry: input.registry ?? snapshot([]),
		blender: createCapabilityBlender({
			successByKey: new Map(input.globalSuccess ?? []),
			roleSuccessByKey: new Map(input.roleSuccess ?? []),
			verdictRuns: (input.verdictRuns ?? []) as never,
			selfObservationEvents: (input.selfObservationEvents ?? []) as never,
		}),
		resolveStableModelId: (runtimeId) => input.stableIds?.[runtimeId] ?? runtimeId,
		lookupCatalogPrior: (realKey) => input.catalogPriors?.[realKey] ?? null,
	});
}

const model = (runtimeId: string, modelKey = runtimeId) => ({ runtimeId, modelKey });

describe("createReviewerCapabilityEvidenceSource — evidence or nothing (P0.REVRANK / §4A green-signal rule)", () => {
	it("returns NULL for a model that is uncatalogued AND unobserved — no flat prior stands in for a measurement", () => {
		expect(source({}).resolve(model("mystery-27b"), "reviewer")).toBeNull();
	});

	it("returns a PRIOR when only the curated catalog knows the family (no observation anywhere)", () => {
		const evidence = source({ catalogPriors: { "publisher/known-27b": 68 } }).resolve(
			model("known-rt", "publisher/known-27b"),
			"reviewer",
		);
		expect(evidence).toEqual({ score: 68, basis: "prior", samples: 0, detail: "catalog prior 68" });
	});

	it("returns an OBSERVED blend when the role ledger has evidence past the blend's floor", () => {
		const evidence = source({
			catalogPriors: { "publisher/known-27b": 60 },
			roleSuccess: [[roleEvidenceKey(key("known-rt"), "reviewer"), { successRate: 0.9, samples: 10 }]],
		}).resolve(model("known-rt", "publisher/known-27b"), "reviewer");
		expect(evidence?.basis).toBe("observed");
		expect(evidence?.samples).toBe(10);
		expect(evidence?.detail).toContain("reviewer role ledger 10 samples (90% ok)");
		// 60 + (90-60)*(10/20) = 75 — the SAME blend the worker router applies, not a reviewer-only invention.
		expect(evidence?.score).toBe(75);
	});

	it("a row UNDER the blend's sample floor is not an observation — with no catalog prior it stays NULL", () => {
		// The blend returns the base unchanged below its floor, so such a row moved no number: reporting it as a
		// capability would be a score the evidence never supported.
		expect(
			source({
				roleSuccess: [[roleEvidenceKey(key("thin-rt"), "reviewer"), { successRate: 1, samples: 2 }]],
			}).resolve(model("thin-rt"), "reviewer"),
		).toBeNull();
	});

	it("counts REGISTRY eval signal as observed and blends from its effective score", () => {
		const evidence = source({
			registry: snapshot([registryEntry("eval-rt", { samples: 4, evalScore: 88, effectiveScore: 82 })]),
		}).resolve(model("eval-rt"), "reviewer");
		expect(evidence).toMatchObject({ score: 82, basis: "observed", samples: 4 });
		expect(evidence?.detail).toContain("registry 4 eval samples (effective 82)");
	});

	it("a registry entry with a bare seeded prior (no samples, no scores) is NOT observed", () => {
		expect(
			source({ registry: snapshot([registryEntry("seeded-rt", { staticPrior: 35, effectiveScore: 35 })]) }).resolve(
				model("seeded-rt"),
				"reviewer",
			),
		).toBeNull();
	});

	it("finds the ledger row written under the STABLE routing id when the runtime id has none (key drift)", () => {
		const evidence = source({
			catalogPriors: { "publisher/aliased": 50 },
			stableIds: { "alias-rt": "publisher/aliased" },
			roleSuccess: [[roleEvidenceKey(key("publisher/aliased"), "reviewer"), { successRate: 0.8, samples: 20 }]],
		}).resolve(model("alias-rt", "publisher/aliased"), "reviewer");
		expect(evidence?.basis).toBe("observed");
		expect(evidence?.samples).toBe(20);
		expect(evidence?.score).toBe(80); // 50 + (80-50)×1, exactly at the blend's 30-pt max shift
	});

	it("keeps the evidence ROLE-scoped — a worker-role row does not become reviewer evidence", () => {
		const worker = [[roleEvidenceKey(key("rt"), "worker"), { successRate: 1, samples: 10 }]] as [
			string,
			{ successRate: number; samples: number },
		][];
		expect(source({ roleSuccess: worker }).resolve(model("rt"), "reviewer")).toBeNull();
		expect(source({ roleSuccess: worker }).resolve(model("rt"), "worker")?.basis).toBe("observed");
	});

	it("applies the runtime-verdict penalty and names it, so a chronic staller cannot rank as strong", () => {
		const stalls = Array.from({ length: 4 }, () => ({ signal: "model_stalled", modelId: "staller-rt" }));
		const evidence = source({
			catalogPriors: { "publisher/staller": 80 },
			verdictRuns: Array.from({ length: 4 }, (_, index) => ({ runId: `r${index}`, modelId: "staller-rt" })),
			selfObservationEvents: stalls,
		}).resolve(model("staller-rt", "publisher/staller"), "reviewer");
		expect(evidence?.score).toBeCloseTo(8, 5); // 80 × 0.1 (TOOL_UNSUITABLE)
		expect(evidence?.detail).toContain("runtime verdict ×0.1");
	});
});

describe("loadReviewerCapabilityEvidence", () => {
	const io = () => ({
		readRegistrySnapshot: vi.fn(async () => snapshot([])),
		readLedger: vi.fn(async () => []),
		readFitnessRows: vi.fn(async () => []),
		readSelfObservationEvents: vi.fn(async () => []),
	});

	it("the kill switch returns the knows-nothing source and performs NO store reads", async () => {
		const readers = io();
		const evidence = await loadReviewerCapabilityEvidence({
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			io: readers,
			env: { NKLEIN_REVIEWER_CAPABILITY_RANKING: "0" },
		});
		expect(evidence.enabled).toBe(false);
		expect(evidence.resolve(model("anything"), "reviewer")).toBeNull();
		for (const reader of Object.values(readers)) {
			expect(reader).not.toHaveBeenCalled();
		}
	});

	it("is ON by default and consults the real catalog for the prior (uncatalogued ⇒ still null)", async () => {
		const evidence = await loadReviewerCapabilityEvidence({
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			io: io(),
			env: {},
		});
		expect(evidence.enabled).toBe(true);
		expect(evidence.resolve(model("no-such-model-anywhere-xyz"), "reviewer")).toBeNull();
		// A catalogued family resolves to its curated prior — a real number, sourced, not a default.
		const catalogued = evidence.resolve(model("phi-rt", "phi-4-reasoning-plus"), "reviewer");
		expect(catalogued?.basis).toBe("prior");
		expect(catalogued?.score).toBeGreaterThan(0);
	});

	it("degrades to fewer facts instead of throwing when a store read fails", async () => {
		const readers = { ...io(), readLedger: vi.fn(async () => Promise.reject(new Error("ledger unreadable"))) };
		const evidence = await loadReviewerCapabilityEvidence({
			providerId: PROVIDER,
			endpoint: ENDPOINT,
			io: readers,
			env: {},
		});
		expect(evidence.enabled).toBe(true);
		expect(evidence.resolve(model("mystery-27b"), "reviewer")).toBeNull();
	});
});
