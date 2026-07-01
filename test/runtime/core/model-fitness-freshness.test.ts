import { describe, expect, it } from "vitest";
import type { ModelFitnessRecord } from "../../../src/core/model-fitness";
import {
	DEFAULT_FITNESS_FRESHNESS_POLICY,
	type FitnessCell,
	type FitnessFreshnessPolicy,
	fingerprintDrifted,
	fitnessRefreshPriority,
	isFitnessCellReliable,
	judgeFitnessFreshness,
	type ModelFitnessFingerprint,
	selectFitnessCellsToReeval,
} from "../../../src/core/model-fitness-freshness";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_000 * DAY; // an arbitrary fixed clock well past epoch so "age ago" stays positive

function record(overrides: Partial<ModelFitnessRecord> = {}): ModelFitnessRecord {
	return {
		modelId: "m",
		role: "worker",
		maxDifficultyCleared: 0.5,
		qualityScore: 0.8,
		reliability: 0.9,
		avgLatencyMs: 500,
		avgRetriesNeeded: 0,
		samples: 10,
		...overrides,
	};
}

function cell(
	overrides: {
		modelId?: string;
		role?: string;
		samples?: number;
		ageMs?: number;
		fingerprint?: ModelFitnessFingerprint;
	} = {},
): FitnessCell {
	return {
		record: record({
			modelId: overrides.modelId ?? "m",
			role: overrides.role ?? "worker",
			samples: overrides.samples ?? 10,
		}),
		measuredAt: NOW - (overrides.ageMs ?? 0),
		fingerprint: overrides.fingerprint ?? { contextWindow: 40_000, quant: "q4_k_m" },
	};
}

describe("fingerprintDrifted", () => {
	it("is false when context + quant match", () => {
		expect(
			fingerprintDrifted({ contextWindow: 40_000, quant: "q4_k_m" }, { contextWindow: 40_000, quant: "q4_k_m" }),
		).toBe(false);
	});

	it("is true when the loaded context window differs (a re-load at another window is a different subject)", () => {
		expect(
			fingerprintDrifted({ contextWindow: 8_000, quant: "q4_k_m" }, { contextWindow: 40_000, quant: "q4_k_m" }),
		).toBe(true);
	});

	it("is true when a KNOWN quant differs, case-insensitively equal counts as same", () => {
		expect(
			fingerprintDrifted({ contextWindow: 40_000, quant: "q8_0" }, { contextWindow: 40_000, quant: "q4_k_m" }),
		).toBe(true);
		expect(
			fingerprintDrifted({ contextWindow: 40_000, quant: "Q4_K_M" }, { contextWindow: 40_000, quant: "q4_k_m" }),
		).toBe(false);
	});

	it("does not claim drift when a quant is unknown on either side (only known-vs-known mismatches count)", () => {
		expect(fingerprintDrifted({ contextWindow: 40_000 }, { contextWindow: 40_000, quant: "q4_k_m" })).toBe(false);
		expect(fingerprintDrifted({ contextWindow: 40_000, quant: "q4_k_m" }, { contextWindow: 40_000 })).toBe(false);
	});

	it("is false when there is no live fingerprint (model not currently loaded ⇒ cannot claim drift)", () => {
		expect(fingerprintDrifted({ contextWindow: 40_000, quant: "q4_k_m" }, undefined)).toBe(false);
	});
});

describe("judgeFitnessFreshness", () => {
	const live: ModelFitnessFingerprint = { contextWindow: 40_000, quant: "q4_k_m" };

	it("bands a well-sampled matching cell by age: fresh → aging → stale", () => {
		expect(judgeFitnessFreshness(cell({ ageMs: 1 * HOUR }), NOW, live)).toBe("fresh");
		expect(judgeFitnessFreshness(cell({ ageMs: 24 * HOUR }), NOW, live)).toBe("aging");
		expect(judgeFitnessFreshness(cell({ ageMs: 3 * DAY }), NOW, live)).toBe("stale");
	});

	it("decays fully to `unknown` past the decay horizon regardless of samples", () => {
		expect(judgeFitnessFreshness(cell({ ageMs: 8 * DAY, samples: 100 }), NOW, live)).toBe("unknown");
	});

	it("returns `thin` for a fresh-but-undersampled cell (a lucky single run is not evidence)", () => {
		expect(judgeFitnessFreshness(cell({ ageMs: 1 * HOUR, samples: 2 }), NOW, live)).toBe("thin");
	});

	it("returns `drifted` when the live fingerprint no longer matches, even if fresh + well-sampled", () => {
		const fresh = cell({ ageMs: 1 * HOUR, samples: 50, fingerprint: { contextWindow: 8_000, quant: "q4_k_m" } });
		expect(judgeFitnessFreshness(fresh, NOW, live)).toBe("drifted");
	});

	it("precedence: full-decay age beats drift beats thin beats age-band", () => {
		// decayed age wins over a drifted fingerprint
		const old = cell({ ageMs: 9 * DAY, samples: 1, fingerprint: { contextWindow: 8_000 } });
		expect(judgeFitnessFreshness(old, NOW, live)).toBe("unknown");
		// drift wins over thin
		const driftedThin = cell({ ageMs: 1 * HOUR, samples: 1, fingerprint: { contextWindow: 8_000 } });
		expect(judgeFitnessFreshness(driftedThin, NOW, live)).toBe("drifted");
	});

	it("clamps a future/invalid measuredAt to age 0 (treated as just-measured → fresh)", () => {
		const future = cell({ ageMs: -5 * DAY });
		expect(judgeFitnessFreshness(future, NOW, live)).toBe("fresh");
	});

	it("without a live fingerprint, still bands by age/samples (drift is simply not asserted)", () => {
		expect(judgeFitnessFreshness(cell({ ageMs: 3 * DAY }), NOW, undefined)).toBe("stale");
		expect(judgeFitnessFreshness(cell({ ageMs: 1 * HOUR, samples: 1 }), NOW, undefined)).toBe("thin");
	});

	it("respects a custom policy", () => {
		const strict: FitnessFreshnessPolicy = {
			freshMaxAgeMs: 1 * HOUR,
			agingMaxAgeMs: 2 * HOUR,
			minSamples: 5,
			decayToUnknownAgeMs: 3 * HOUR,
		};
		expect(judgeFitnessFreshness(cell({ ageMs: 30 * 60 * 1000 }), NOW, live, strict)).toBe("fresh");
		expect(judgeFitnessFreshness(cell({ ageMs: 90 * 60 * 1000 }), NOW, live, strict)).toBe("aging");
		expect(judgeFitnessFreshness(cell({ ageMs: 4 * HOUR }), NOW, live, strict)).toBe("unknown");
		expect(judgeFitnessFreshness(cell({ ageMs: 30 * 60 * 1000, samples: 4 }), NOW, live, strict)).toBe("thin");
	});
});

describe("isFitnessCellReliable", () => {
	it("treats only fresh + aging as reliable; everything else needs re-measurement", () => {
		expect(isFitnessCellReliable("fresh")).toBe(true);
		expect(isFitnessCellReliable("aging")).toBe(true);
		expect(isFitnessCellReliable("stale")).toBe(false);
		expect(isFitnessCellReliable("thin")).toBe(false);
		expect(isFitnessCellReliable("drifted")).toBe(false);
		expect(isFitnessCellReliable("unknown")).toBe(false);
	});
});

describe("fitnessRefreshPriority", () => {
	const live: ModelFitnessFingerprint = { contextWindow: 40_000, quant: "q4_k_m" };

	it("is bounded to [0,1]", () => {
		for (const ageMs of [0, 1 * DAY, 8 * DAY]) {
			for (const samples of [0, 3, 100]) {
				const p = fitnessRefreshPriority(cell({ ageMs, samples }), NOW, live);
				expect(p).toBeGreaterThanOrEqual(0);
				expect(p).toBeLessThanOrEqual(1);
			}
		}
	});

	it("is near 0 for a just-measured well-sampled matching cell", () => {
		expect(fitnessRefreshPriority(cell({ ageMs: 0, samples: 100 }), NOW, live)).toBeLessThan(0.05);
	});

	it("increases monotonically with age (all else equal)", () => {
		const young = fitnessRefreshPriority(cell({ ageMs: 1 * HOUR }), NOW, live);
		const mid = fitnessRefreshPriority(cell({ ageMs: 2 * DAY }), NOW, live);
		const old = fitnessRefreshPriority(cell({ ageMs: 6 * DAY }), NOW, live);
		expect(mid).toBeGreaterThan(young);
		expect(old).toBeGreaterThan(mid);
	});

	it("increases as samples fall (confidence gap), all else equal", () => {
		const many = fitnessRefreshPriority(cell({ ageMs: 1 * DAY, samples: 100 }), NOW, live);
		const few = fitnessRefreshPriority(cell({ ageMs: 1 * DAY, samples: 0 }), NOW, live);
		expect(few).toBeGreaterThan(many);
	});

	it("floors HIGH (≥0.9) when the fingerprint has drifted, even for a fresh well-sampled cell", () => {
		const drifted = cell({ ageMs: 1 * HOUR, samples: 100, fingerprint: { contextWindow: 8_000, quant: "q4_k_m" } });
		expect(fitnessRefreshPriority(drifted, NOW, live)).toBeGreaterThanOrEqual(0.9);
	});
});

describe("selectFitnessCellsToReeval", () => {
	const live = new Map<string, ModelFitnessFingerprint>([
		["a", { contextWindow: 40_000, quant: "q4_k_m" }],
		["b", { contextWindow: 40_000, quant: "q4_k_m" }],
		["c", { contextWindow: 40_000, quant: "q4_k_m" }],
	]);

	it("returns nothing when the budget is ≤ 0", () => {
		const cells = [cell({ modelId: "a", ageMs: 8 * DAY })];
		expect(selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 0 })).toEqual([]);
		expect(selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: -1 })).toEqual([]);
	});

	it("skips reliable (fresh/aging) cells — only unreliable ones are candidates", () => {
		const cells = [
			cell({ modelId: "a", ageMs: 1 * HOUR }), // fresh
			cell({ modelId: "b", ageMs: 24 * HOUR }), // aging
		];
		expect(selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 10 })).toEqual([]);
	});

	it("excludes cells whose model is not currently loaded by default, includes them with includeUnloaded", () => {
		const cells = [cell({ modelId: "gone", ageMs: 3 * DAY })];
		expect(selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 10 })).toEqual([]);
		const included = selectFitnessCellsToReeval({
			cells,
			now: NOW,
			liveByModelId: live,
			budget: 10,
			includeUnloaded: true,
		});
		expect(included).toHaveLength(1);
		expect(included[0].freshness).toBe("stale");
	});

	it("ranks by priority desc, and a drifted cell outranks a merely-stale one", () => {
		const cells = [
			cell({ modelId: "a", ageMs: 3 * DAY }), // stale
			cell({ modelId: "b", ageMs: 1 * HOUR, fingerprint: { contextWindow: 8_000, quant: "q4_k_m" } }), // drifted
		];
		const picked = selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 10 });
		expect(picked.map((p) => p.cell.record.modelId)).toEqual(["b", "a"]);
		expect(picked[0].freshness).toBe("drifted");
	});

	it("honours the budget, returning the highest-priority cells first (age dominates among well-sampled cells)", () => {
		const cells = [
			cell({ modelId: "a", ageMs: 3 * DAY }), // stale, well-sampled
			cell({ modelId: "b", ageMs: 6 * DAY }), // stale, well-sampled, older ⇒ higher priority
			cell({ modelId: "c", ageMs: 5 * DAY }), // stale, well-sampled, between a and b
		];
		const picked = selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 2 });
		expect(picked).toHaveLength(2);
		expect(picked.map((p) => p.cell.record.modelId)).toEqual(["b", "c"]);
	});

	it("prioritizes a barely-sampled fresh-age cell above a well-sampled stale one (thin evidence is urgent)", () => {
		const cells = [
			cell({ modelId: "a", ageMs: 3 * DAY, samples: 10 }), // stale but well-grounded
			cell({ modelId: "c", ageMs: 1 * HOUR, samples: 1 }), // thin: almost no evidence ⇒ more urgent
		];
		const picked = selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 10 });
		expect(picked.map((p) => p.cell.record.modelId)).toEqual(["c", "a"]);
		expect(picked[0].freshness).toBe("thin");
	});

	it("breaks priority ties by OLDER measuredAt, then modelId, then role (stable + deterministic)", () => {
		// Two undersampled cells, identical age ⇒ identical priority ⇒ tie-break by modelId then role.
		const cells = [
			cell({ modelId: "b", role: "worker", ageMs: 2 * DAY, samples: 0 }),
			cell({ modelId: "a", role: "reviewer", ageMs: 2 * DAY, samples: 0 }),
			cell({ modelId: "a", role: "architect", ageMs: 2 * DAY, samples: 0 }),
		];
		const picked = selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 10 });
		expect(picked.map((p) => `${p.cell.record.modelId}/${p.cell.record.role}`)).toEqual([
			"a/architect",
			"a/reviewer",
			"b/worker",
		]);
	});

	it("puts an older measurement ahead of a newer one at equal priority-from-samples", () => {
		// Same samples (well-sampled), so priority is driven by age; older wins both on priority and the tie-break.
		const cells = [cell({ modelId: "a", ageMs: 3 * DAY }), cell({ modelId: "b", ageMs: 5 * DAY })];
		const picked = selectFitnessCellsToReeval({ cells, now: NOW, liveByModelId: live, budget: 10 });
		expect(picked[0].cell.record.modelId).toBe("b");
	});
});

describe("DEFAULT_FITNESS_FRESHNESS_POLICY", () => {
	it("is internally ordered (fresh ≤ aging ≤ decay) and has a sane minimum", () => {
		const p = DEFAULT_FITNESS_FRESHNESS_POLICY;
		expect(p.freshMaxAgeMs).toBeLessThanOrEqual(p.agingMaxAgeMs);
		expect(p.agingMaxAgeMs).toBeLessThanOrEqual(p.decayToUnknownAgeMs);
		expect(p.minSamples).toBeGreaterThanOrEqual(1);
	});
});
