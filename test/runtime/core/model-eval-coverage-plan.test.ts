import { describe, expect, it } from "vitest";
import type { EvalDifficultyTier } from "../../../src/core/model-eval-aggregation";
import {
	classifyEvalCoverage,
	type EvalCellCoverageEntry,
	type MeasuredEvalCell,
	type PlanEvalCoverageInput,
	planEvalCoverage,
} from "../../../src/core/model-eval-coverage-plan";
import type { ModelFitnessRecord } from "../../../src/core/model-fitness";
import {
	DEFAULT_FITNESS_FRESHNESS_POLICY,
	type ModelFitnessFingerprint,
} from "../../../src/core/model-fitness-freshness";

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Difficulty each tier represents on the `maxDifficultyCleared` axis (mirror of the module/aggregator ladder). */
const TIER_DIFFICULTY: Record<EvalDifficultyTier, number> = {
	trivial: 0.1,
	easy: 0.3,
	medium: 0.55,
	hard: 0.8,
	"very-hard": 1,
};

/** Build a measured eval cell (tier + fitness cell) for (model, role, tier). By default it CLEARS its tier, is
 * well-sampled, and just-measured. */
function cell(
	over: {
		modelId?: string;
		role?: string;
		tier?: EvalDifficultyTier;
		/** override the record's cleared ceiling; defaults to exactly this tier's difficulty (clears). */
		maxDifficultyCleared?: number;
		samples?: number;
		measuredAt?: number;
		fingerprint?: ModelFitnessFingerprint;
	} = {},
): MeasuredEvalCell {
	const tier = over.tier ?? "medium";
	const record: ModelFitnessRecord = {
		modelId: over.modelId ?? "m1",
		role: over.role ?? "worker",
		maxDifficultyCleared: over.maxDifficultyCleared ?? TIER_DIFFICULTY[tier],
		qualityScore: 0.9,
		reliability: 0.9,
		avgLatencyMs: 500,
		avgRetriesNeeded: 0,
		samples: over.samples ?? 5,
	};
	return {
		tier,
		cell: {
			record,
			measuredAt: over.measuredAt ?? NOW,
			fingerprint: over.fingerprint ?? { contextWindow: 32768 },
		},
	};
}

/** Convenience: base plan input over a single role/tier matrix. */
function input(over: Partial<PlanEvalCoverageInput> = {}): PlanEvalCoverageInput {
	return {
		modelId: "m1",
		existingCells: [],
		now: NOW,
		budget: 100,
		...over,
	};
}

/** Pull the coverage class of a (role, tier) from a classification list. */
function coverageOf(entries: EvalCellCoverageEntry[], role: string, tier: EvalDifficultyTier): string | undefined {
	return entries.find((e) => e.role === role && e.tier === tier)?.coverage;
}

describe("classifyEvalCoverage", () => {
	it("marks every target cell unmeasured for a brand-new model with no cells", () => {
		const entries = classifyEvalCoverage(input({ matrix: { roles: ["worker"], tiers: ["trivial", "easy"] } }));
		expect(entries).toHaveLength(2);
		expect(entries.every((e) => e.coverage === "unmeasured")).toBe(true);
	});

	it("classifies an existing fresh cell as reliable and a missing one as unmeasured", () => {
		const entries = classifyEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["trivial", "easy"] },
				existingCells: [cell({ tier: "trivial" })],
			}),
		);
		expect(coverageOf(entries, "worker", "trivial")).toBe("reliable");
		expect(coverageOf(entries, "worker", "easy")).toBe("unmeasured");
	});

	it("classifies a decayed (too old) cell as stale", () => {
		const entries = classifyEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["trivial"] },
				existingCells: [cell({ tier: "trivial", measuredAt: NOW - 10 * DAY })],
			}),
		);
		expect(coverageOf(entries, "worker", "trivial")).toBe("stale");
	});

	it("classifies a thin (under-sampled) cell as stale", () => {
		const entries = classifyEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["trivial"] },
				existingCells: [cell({ tier: "trivial", samples: 1 })],
			}),
		);
		expect(coverageOf(entries, "worker", "trivial")).toBe("stale");
	});

	it("ignores cells belonging to other models", () => {
		const entries = classifyEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["trivial"] },
				existingCells: [cell({ modelId: "OTHER", tier: "trivial" })],
			}),
		);
		expect(coverageOf(entries, "worker", "trivial")).toBe("unmeasured");
	});

	it("prunes unmeasured tiers strictly harder than a reliably-FAILED tier as above_ceiling", () => {
		// A reliable `medium` cell that does NOT clear medium (ceiling stuck at easy) → hard/very-hard are wasted probes.
		const failedMedium = cell({ tier: "medium", maxDifficultyCleared: TIER_DIFFICULTY.easy });
		const entries = classifyEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["trivial", "easy", "medium", "hard", "very-hard"] },
				existingCells: [failedMedium],
			}),
		);
		expect(coverageOf(entries, "worker", "trivial")).toBe("unmeasured"); // below the ceiling → still a gap
		expect(coverageOf(entries, "worker", "easy")).toBe("unmeasured");
		expect(coverageOf(entries, "worker", "medium")).toBe("reliable"); // measured (and failed) → keeps its class
		expect(coverageOf(entries, "worker", "hard")).toBe("above_ceiling"); // strictly harder → pruned
		expect(coverageOf(entries, "worker", "very-hard")).toBe("above_ceiling");
	});

	it("does NOT prune above a tier the model CLEARS (a passing ceiling is not a failure ceiling)", () => {
		const clearedMedium = cell({ tier: "medium", maxDifficultyCleared: TIER_DIFFICULTY.medium });
		const entries = classifyEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["medium", "hard", "very-hard"] },
				existingCells: [clearedMedium],
			}),
		);
		expect(coverageOf(entries, "worker", "hard")).toBe("unmeasured"); // it clears medium → keep exploring up
		expect(coverageOf(entries, "worker", "very-hard")).toBe("unmeasured");
	});

	it("does NOT prune from a STALE failed cell (decayed evidence can't anchor a ceiling)", () => {
		const staleFailedMedium = cell({
			tier: "medium",
			maxDifficultyCleared: TIER_DIFFICULTY.easy,
			measuredAt: NOW - 10 * DAY, // decayed → unknown → not reliable
		});
		const entries = classifyEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["medium", "hard"] },
				existingCells: [staleFailedMedium],
			}),
		);
		expect(coverageOf(entries, "worker", "medium")).toBe("stale");
		expect(coverageOf(entries, "worker", "hard")).toBe("unmeasured"); // NOT pruned — the failure was decayed
	});

	it("defaults the matrix to all swarm roles × all tiers when none supplied", () => {
		const entries = classifyEvalCoverage(input());
		// 3 roles × 5 tiers = 15 target cells.
		expect(entries).toHaveLength(15);
		expect(new Set(entries.map((e) => e.role))).toEqual(new Set(["architect", "worker", "reviewer"]));
	});

	it("keeps a deterministic order: role as given, then tier easiest→hardest", () => {
		const entries = classifyEvalCoverage(
			input({ matrix: { roles: ["reviewer", "architect"], tiers: ["hard", "trivial", "medium"] } }),
		);
		expect(entries.map((e) => `${e.role}/${e.tier}`)).toEqual([
			"reviewer/trivial",
			"reviewer/medium",
			"reviewer/hard",
			"architect/trivial",
			"architect/medium",
			"architect/hard",
		]);
	});
});

describe("planEvalCoverage", () => {
	it("returns nothing for a non-positive budget", () => {
		expect(planEvalCoverage(input({ budget: 0 }))).toEqual([]);
		expect(planEvalCoverage(input({ budget: -3, existingCells: [] }))).toEqual([]);
	});

	it("probes every gap for a new model, easiest tier first (floor-first)", () => {
		const probes = planEvalCoverage(
			input({ matrix: { roles: ["worker"], tiers: ["trivial", "easy", "medium", "hard", "very-hard"] } }),
		);
		expect(probes.map((p) => p.tier)).toEqual(["trivial", "easy", "medium", "hard", "very-hard"]);
		expect(probes.every((p) => p.coverage === "unmeasured")).toBe(true);
		// Priorities strictly descend easiest→hardest and all sit in the [0.5, 1] unmeasured band.
		for (let i = 1; i < probes.length; i++) {
			expect(probes[i - 1].priority).toBeGreaterThan(probes[i].priority);
		}
		expect(probes[0].priority).toBeCloseTo(1, 6); // easiest gap
		expect(probes.at(-1)?.priority).toBeCloseTo(0.5, 6); // hardest gap floors the band
	});

	it("respects the budget, keeping the highest-priority (easiest) gaps", () => {
		const probes = planEvalCoverage(
			input({ matrix: { roles: ["worker"], tiers: ["trivial", "easy", "medium", "hard"] }, budget: 2 }),
		);
		expect(probes.map((p) => p.tier)).toEqual(["trivial", "easy"]);
	});

	it("orders every coverage gap ahead of every stale refresh", () => {
		// worker: trivial reliable, easy MISSING (gap). architect: trivial STALE (decayed).
		const probes = planEvalCoverage(
			input({
				matrix: { roles: ["worker", "architect"], tiers: ["trivial", "easy"] },
				existingCells: [
					cell({ role: "worker", tier: "trivial" }), // reliable → not probed
					cell({ role: "architect", tier: "trivial", measuredAt: NOW - 10 * DAY }), // stale → refresh
					cell({ role: "architect", tier: "easy", measuredAt: NOW - 10 * DAY }), // stale → refresh
				],
			}),
		);
		// The single coverage gap (worker/easy) must come first, then the stale cells.
		expect(probes[0]).toMatchObject({ role: "worker", tier: "easy", coverage: "unmeasured" });
		expect(probes.slice(1).every((p) => p.coverage === "stale")).toBe(true);
		// Every gap priority ≥ 0.5 > every stale priority < 0.5.
		expect(probes[0].priority).toBeGreaterThanOrEqual(0.5);
		expect(probes.slice(1).every((p) => p.priority < 0.5)).toBe(true);
	});

	it("does not emit probes for reliable or above_ceiling cells", () => {
		const failedMedium = cell({ role: "worker", tier: "medium", maxDifficultyCleared: TIER_DIFFICULTY.easy });
		const probes = planEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["trivial", "medium", "hard", "very-hard"] },
				existingCells: [failedMedium, cell({ role: "worker", tier: "trivial" })],
			}),
		);
		// trivial = reliable (skip), medium = reliable/failed (skip), hard+very-hard = above_ceiling (pruned).
		expect(probes).toEqual([]);
	});

	it("ranks stale refreshes among themselves by the freshness priority (drift beats mere age)", () => {
		const live: ModelFitnessFingerprint = { contextWindow: 40000, quant: "q8_0" };
		// Both stale; the drifted cell (different context) must outrank the merely-old one.
		const driftedThin = cell({
			role: "worker",
			tier: "trivial",
			samples: 5,
			measuredAt: NOW - 3 * DAY, // aged into stale
			fingerprint: { contextWindow: 8192, quant: "q4_k_m" }, // drift vs live
		});
		const merelyOld = cell({
			role: "architect",
			tier: "trivial",
			samples: 5,
			measuredAt: NOW - (DEFAULT_FITNESS_FRESHNESS_POLICY.agingMaxAgeMs + HOUR), // just into stale, no drift
			fingerprint: live,
		});
		const probes = planEvalCoverage(
			input({
				matrix: { roles: ["worker", "architect"], tiers: ["trivial"] },
				existingCells: [driftedThin, merelyOld],
				live,
			}),
		);
		expect(probes).toHaveLength(2);
		expect(probes.every((p) => p.coverage === "stale")).toBe(true);
		expect(probes[0]).toMatchObject({ role: "worker" }); // the drifted cell first
		expect(probes[0].priority).toBeGreaterThan(probes[1].priority);
	});

	it("drift on a fresh existing cell makes it stale and thus a probe target", () => {
		const live: ModelFitnessFingerprint = { contextWindow: 40000 };
		// Recently measured (fresh by age) but at a DIFFERENT context than live → drifted → not reliable → probe it.
		const driftedButRecent = cell({
			role: "worker",
			tier: "trivial",
			measuredAt: NOW - HOUR,
			fingerprint: { contextWindow: 8192 },
		});
		const probes = planEvalCoverage(
			input({
				matrix: { roles: ["worker"], tiers: ["trivial"] },
				existingCells: [driftedButRecent],
				live,
			}),
		);
		expect(probes).toHaveLength(1);
		expect(probes[0]).toMatchObject({ role: "worker", tier: "trivial", coverage: "stale" });
	});

	it("is deterministic and stable on ties (same-tier gaps across roles order by role name)", () => {
		const probes = planEvalCoverage(
			input({ matrix: { roles: ["reviewer", "architect", "worker"], tiers: ["easy"] } }),
		);
		// All three are same-tier gaps ⇒ identical priority ⇒ tie broken by role name ascending.
		expect(probes.map((p) => p.role)).toEqual(["architect", "reviewer", "worker"]);
	});

	it("re-running the plan after filling the top gaps advances the frontier (climb behavior)", () => {
		const tiers: EvalDifficultyTier[] = ["trivial", "easy", "medium"];
		// Pass 1: nothing measured → plans trivial first.
		const pass1 = planEvalCoverage(input({ matrix: { roles: ["worker"], tiers } }));
		expect(pass1[0]).toMatchObject({ tier: "trivial" });
		// Pass 2: trivial now measured (and cleared) → easy is the next gap.
		const pass2 = planEvalCoverage(
			input({ matrix: { roles: ["worker"], tiers }, existingCells: [cell({ tier: "trivial" })] }),
		);
		expect(pass2[0]).toMatchObject({ tier: "easy" });
		expect(pass2.map((p) => p.tier)).toEqual(["easy", "medium"]);
	});
});
