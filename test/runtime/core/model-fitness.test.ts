import { describe, expect, it } from "vitest";
import {
	computeModelFitness,
	type ModelFitnessRecord,
	type SelectionPolicy,
	selectModelForTask,
} from "../../../src/core/model-fitness";

function record(over: Partial<ModelFitnessRecord> & Pick<ModelFitnessRecord, "modelId">): ModelFitnessRecord {
	return {
		role: "worker",
		maxDifficultyCleared: 1,
		qualityScore: 0.9,
		reliability: 0.9,
		avgLatencyMs: 1000,
		avgRetriesNeeded: 0,
		samples: 10,
		...over,
	};
}

const ALL = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe("computeModelFitness", () => {
	it("ranks a faster, more reliable, fewer-retries model higher", () => {
		const fast = record({ modelId: "fast", avgLatencyMs: 200, avgRetriesNeeded: 0, reliability: 0.95 });
		const slow = record({ modelId: "slow", avgLatencyMs: 5000, avgRetriesNeeded: 3, reliability: 0.6 });
		expect(computeModelFitness(fast)).toBeGreaterThan(computeModelFitness(slow));
	});

	it("quality dominates speed by default (a fast wrong answer loses to a slower right one)", () => {
		const fastLowQuality = record({ modelId: "fast", avgLatencyMs: 100, qualityScore: 0.3 });
		const slowHighQuality = record({ modelId: "slow", avgLatencyMs: 3000, qualityScore: 0.95 });
		expect(computeModelFitness(slowHighQuality)).toBeGreaterThan(computeModelFitness(fastLowQuality));
	});
});

describe("selectModelForTask", () => {
	const policy: SelectionPolicy = {
		qualityBar: 0.6,
		mode: "attempt_with_available",
		weights: { quality: 1, speed: 0.35, reliability: 0.5, retryPenalty: 0.25 },
	};

	it("escalates when there are no records for the role", () => {
		const out = selectModelForTask([record({ modelId: "a", role: "worker" })], {
			role: "reviewer",
			difficulty: 0.5,
			availableModelIds: ALL("a"),
		});
		expect(out.decision).toBe("escalate");
	});

	it("assigns the best qualified + available model (above-bar)", () => {
		const records = [
			record({ modelId: "strong", avgLatencyMs: 2000, qualityScore: 0.95 }),
			record({ modelId: "fast", avgLatencyMs: 200, qualityScore: 0.8 }),
		];
		const out = selectModelForTask(records, {
			role: "worker",
			difficulty: 0.5,
			availableModelIds: ALL("strong", "fast"),
			policy,
		});
		// Both qualify; the fast one wins on the composite (speed) since quality clears the bar.
		expect(out).toMatchObject({ decision: "assign", modelId: "fast", belowBar: false });
	});

	it("reserves the strong model for a hard task (only it clears the difficulty)", () => {
		const records = [
			record({ modelId: "strong", maxDifficultyCleared: 0.95, qualityScore: 0.95, avgLatencyMs: 3000 }),
			record({ modelId: "weak", maxDifficultyCleared: 0.4, qualityScore: 0.9, avgLatencyMs: 200 }),
		];
		const out = selectModelForTask(records, {
			role: "worker",
			difficulty: 0.8,
			availableModelIds: ALL("strong", "weak"),
			policy,
		});
		expect(out).toMatchObject({ decision: "assign", modelId: "strong", belowBar: false });
	});

	it("waits for the qualified model when it is busy under wait_for_best", () => {
		const records = [record({ modelId: "strong", qualityScore: 0.95 })];
		const out = selectModelForTask(records, {
			role: "worker",
			difficulty: 0.5,
			availableModelIds: ALL("other"),
			policy: { ...policy, mode: "wait_for_best" },
		});
		expect(out).toEqual({ decision: "wait", waitForModelId: "strong", reason: expect.any(String) });
	});

	it("attempts with the best available below-bar model when the qualified one is busy (attempt_with_available)", () => {
		const records = [
			record({ modelId: "strong", qualityScore: 0.95 }),
			record({ modelId: "weak", qualityScore: 0.4 }),
		];
		const out = selectModelForTask(records, {
			role: "worker",
			difficulty: 0.5,
			availableModelIds: ALL("weak"),
			policy,
		});
		expect(out).toMatchObject({ decision: "assign", modelId: "weak", belowBar: true });
	});

	it("best-effort assigns when nothing clears the bar but a model is available", () => {
		const records = [record({ modelId: "weak", qualityScore: 0.3 })];
		const out = selectModelForTask(records, {
			role: "worker",
			difficulty: 0.5,
			availableModelIds: ALL("weak"),
			policy,
		});
		expect(out).toMatchObject({ decision: "assign", modelId: "weak", belowBar: true });
	});

	it("waits for the strongest candidate when nothing is available right now", () => {
		const records = [
			record({ modelId: "strong", qualityScore: 0.95 }),
			record({ modelId: "weak", qualityScore: 0.5 }),
		];
		const out = selectModelForTask(records, { role: "worker", difficulty: 0.5, availableModelIds: ALL(), policy });
		expect(out.decision).toBe("wait");
	});
});
