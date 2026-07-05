import { describe, expect, it } from "vitest";
import { rankFitnessCandidatesForCell } from "../../../src/core/fitness-projections";
import {
	emptyFitnessRow,
	type FitnessKey,
	type FitnessRow,
	recordFitnessOutcome,
} from "../../../src/core/fitness-table-schema";
import {
	emptyModelBehaviorProfile,
	learnedQualityEffectiveBudget,
	type ModelAttemptOutcome,
	recordModelBehaviorOutcome,
} from "../../../src/core/model-behavior-profile";
import { type ModelFitnessRecord, selectModelForTask } from "../../../src/core/model-fitness";
import { type SwarmRouteCandidate, selectSwarmRouteForTask } from "../../../src/core/model-swarm-route";
import { assessRuntimeModelVerdict, type RuntimeRunOutcome } from "../../../src/core/runtime-model-verdict";

// Regression tests for the 7 defects the selection/fitness bug-hunt confirmed (2026-07-05).

const event = (modelId: string, signal: string, runId: string | null = null) =>
	({ modelId, signal, runId, severity: "warning", message: "", createdAt: 1 }) as never;

describe("bug #1 — a chronic staller whose stalls carry NO runId is TOOL_UNSUITABLE, not TOOL_CAPABLE", () => {
	it("counts runId-less stalls against the ledger run denominator (the production CLI path)", () => {
		// 3 runs from the ledger; the model stalled on all 3, but the self-observation stalls carry no runId (production
		// reality). The old deduped stalledRunIds was empty ⇒ stallRate 0 ⇒ TOOL_CAPABLE. Now the runId-less stalls count.
		const runs: RuntimeRunOutcome[] = ["r1", "r2", "r3"].map((runId) => ({ runId, modelId: "m" }));
		const events = [event("m", "model_stalled"), event("m", "model_stalled"), event("m", "model_stalled")];
		const v = assessRuntimeModelVerdict({ modelId: "m", events, runs });
		expect(v.sampleCount).toBe(3);
		expect(v.stallRate).toBeCloseTo(1);
		expect(v.verdict).toBe("TOOL_UNSUITABLE");
	});
});

describe("bug #5 — no run-id evidence ⇒ UNKNOWN, not a denominator fabricated from failure events", () => {
	it("does not treat failure-event count as a run count (which inflated the stall rate)", () => {
		// 3 stall events, no runIds, no runs array (the start-task-session path). Old code set sampleCount=3, stallRate=100%
		// ⇒ TOOL_UNSUITABLE (mislabelling a possibly-capable model). Now there is no honest denominator ⇒ UNKNOWN.
		const events = [event("m", "model_stalled"), event("m", "model_stalled"), event("m", "model_stalled")];
		const v = assessRuntimeModelVerdict({ modelId: "m", events });
		expect(v.sampleCount).toBe(0);
		expect(v.verdict).toBe("UNKNOWN");
	});
});

describe("bug #2 — learnedQualityEffectiveBudget never targets ABOVE the observed degradation point", () => {
	it("caps at just-below-degraded even when a good sample was observed at a LARGER context (crossed state)", () => {
		let profile = emptyModelBehaviorProfile("m");
		const fold = (o: ModelAttemptOutcome) => {
			profile = recordModelBehaviorOutcome(profile, o, { now: () => 1 });
		};
		fold({ kind: "success", contextTokens: 100_000, qualityOk: true }); // good ratchets to 100k
		fold({ kind: "success", contextTokens: 60_000, qualityOk: false }); // degraded ratchets to 60k (crosses)
		const budget = learnedQualityEffectiveBudget(profile);
		expect(budget).toBe(Math.floor(60_000 * 0.9)); // 54_000 — just below degradation
		expect(budget).toBeLessThan(60_000); // never at/above where quality failed
	});
});

describe("bug #3 — a pool whose strongest model can't hold the required context is not counted capable", () => {
	const cand = (over: Partial<SwarmRouteCandidate> & { modelKey: string; poolId: string }): SwarmRouteCandidate => ({
		capability: 80,
		contextWindow: 131_072,
		predictedWallTimeMs: 1_000,
		isFree: true,
		facts: { kind: "code", toolUse: "TOOL_NATIVE" },
		...over,
	});

	it("routes to the context-feasible pool instead of blocking on a smaller-sufficient but context-infeasible one", () => {
		const decision = selectSwarmRouteForTask({
			role: "worker",
			difficulty: 60,
			requiredContextTokens: 32_768,
			weighting: "efficient",
			candidates: [
				cand({ modelKey: "weak", poolId: "poolA", capability: 65, contextWindow: 8_000 }),
				cand({ modelKey: "strong", poolId: "poolB", capability: 90, contextWindow: 131_072 }),
			],
			poolFreeSlots: { poolA: 1, poolB: 1 },
		});
		expect(decision.poolId).toBe("poolB");
		expect(decision.model?.selection.type).toBe("assign");
		if (decision.model?.selection.type === "assign") {
			expect(decision.model.selection.modelKey).toBe("strong");
		}
	});
});

describe("bug #4 — rankFitnessCandidatesForCell is deterministic when tied rows both lack a wall time", () => {
	const row = (modelKey: string): FitnessRow => {
		const key: FitnessKey = { modelKey, role: "worker", difficultyTier: "medium" };
		return { ...emptyFitnessRow(key), sampleCount: 5, successCount: 3 }; // equal rate + samples, meanWallTimeMs null
	};

	it("orders by modelKey (not caller order) when success rate, sample count, and null wall times all tie", () => {
		const forward = rankFitnessCandidatesForCell([row("bbb"), row("aaa")], {
			role: "worker",
			difficultyTier: "medium",
		});
		const reverse = rankFitnessCandidatesForCell([row("aaa"), row("bbb")], {
			role: "worker",
			difficultyTier: "medium",
		});
		expect(forward.map((r) => r.modelKey)).toEqual(["aaa", "bbb"]);
		expect(reverse.map((r) => r.modelKey)).toEqual(["aaa", "bbb"]);
	});
});

describe("bug #6 — foldMean blends a migrated historical mean instead of discarding it", () => {
	it("a row with a mean but a lost sample count (samples=0) blends the next value, not overwrite", () => {
		const key: FitnessKey = { modelKey: "m", role: "worker", difficultyTier: "easy" };
		// Simulate a forward-migrated v0 row: a real historical mean, but the *-Samples count defaulted to 0.
		const migrated: FitnessRow = {
			...emptyFitnessRow(key),
			meanWallTimeMs: 5_000,
			meanWallTimeSamples: 0,
			sampleCount: 10,
		};
		const next = recordFitnessOutcome(migrated, { success: true, wallTimeMs: 9_000 });
		expect(next.meanWallTimeMs).toBe(7_000); // (5000 + 9000) / 2 — blended, NOT reset to 9000
		expect(next.meanWallTimeSamples).toBe(2);
	});
});

describe("bug #7 — selectModelForTask breaks equal-fitness ties deterministically", () => {
	const record = (modelId: string): ModelFitnessRecord => ({
		modelId,
		role: "worker",
		maxDifficultyCleared: 1,
		qualityScore: 0.9,
		reliability: 0.9,
		avgLatencyMs: 1_000,
		avgRetriesNeeded: 0,
		samples: 5,
	});

	it("picks the same (modelId-min) model regardless of the caller's records order", () => {
		const available = new Set(["z-model", "a-model"]);
		const forward = selectModelForTask([record("z-model"), record("a-model")], {
			role: "worker",
			difficulty: 0.5,
			availableModelIds: available,
		});
		const reverse = selectModelForTask([record("a-model"), record("z-model")], {
			role: "worker",
			difficulty: 0.5,
			availableModelIds: available,
		});
		expect(forward).toMatchObject({ decision: "assign", modelId: "a-model" });
		expect(reverse).toMatchObject({ decision: "assign", modelId: "a-model" });
	});
});
