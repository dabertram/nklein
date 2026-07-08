import { describe, expect, it } from "vitest";
import {
	type EvalCellOutcome,
	foldEvalOutcomeIntoFitness,
	foldEvalOutcomes,
} from "../../../src/core/eval-fitness-fold";

function outcome(over: Partial<EvalCellOutcome> = {}): EvalCellOutcome {
	return { modelId: "m", role: "architect", difficulty: 0.66, score: 1, latencyMs: 100, passed: true, ...over };
}

describe("foldEvalOutcomeIntoFitness", () => {
	it("seeds a fresh record from the first observation", () => {
		const rec = foldEvalOutcomeIntoFitness(null, outcome({ difficulty: 0.66, score: 0.8, latencyMs: 200 }));
		expect(rec).toEqual({
			modelId: "m",
			role: "architect",
			maxDifficultyCleared: 0.66,
			qualityScore: 0.8,
			reliability: 1,
			avgLatencyMs: 200,
			avgRetriesNeeded: 0,
			samples: 1,
		});
	});

	it("a seeding FAIL clears no difficulty and sets reliability 0", () => {
		const rec = foldEvalOutcomeIntoFitness(null, outcome({ passed: false, score: 0.2, difficulty: 1 }));
		expect(rec.maxDifficultyCleared).toBe(0);
		expect(rec.reliability).toBe(0);
		expect(rec.qualityScore).toBe(0.2);
	});

	it("running-means quality, reliability, and latency across observations", () => {
		let rec = foldEvalOutcomeIntoFitness(null, outcome({ score: 1, latencyMs: 100, passed: true }));
		rec = foldEvalOutcomeIntoFitness(rec, outcome({ score: 0, latencyMs: 300, passed: false }));
		expect(rec.qualityScore).toBeCloseTo(0.5);
		expect(rec.reliability).toBeCloseTo(0.5);
		expect(rec.avgLatencyMs).toBeCloseTo(200);
		expect(rec.samples).toBe(2);
	});

	it("maxDifficultyCleared ratchets UP only on a pass and never lowers on a later fail", () => {
		let rec = foldEvalOutcomeIntoFitness(null, outcome({ difficulty: 0.66, passed: true }));
		rec = foldEvalOutcomeIntoFitness(rec, outcome({ difficulty: 1, passed: true })); // pass at harder → raise
		expect(rec.maxDifficultyCleared).toBe(1);
		rec = foldEvalOutcomeIntoFitness(rec, outcome({ difficulty: 0.33, passed: true })); // pass at easier → keep
		expect(rec.maxDifficultyCleared).toBe(1);
		rec = foldEvalOutcomeIntoFitness(rec, outcome({ difficulty: 1, passed: false })); // fail at hard → keep
		expect(rec.maxDifficultyCleared).toBe(1);
	});

	it("does not fold a retry signal (eval runs no retry ladder)", () => {
		let rec = foldEvalOutcomeIntoFitness(null, outcome());
		rec = { ...rec, avgRetriesNeeded: 3 }; // pretend a prior source set it
		const next = foldEvalOutcomeIntoFitness(rec, outcome());
		expect(next.avgRetriesNeeded).toBe(3); // carried through unchanged
	});

	it("clamps out-of-range score/difficulty and guards a bad latency", () => {
		const rec = foldEvalOutcomeIntoFitness(null, outcome({ score: 1.5, difficulty: -1, latencyMs: -5 }));
		expect(rec.qualityScore).toBe(1);
		expect(rec.maxDifficultyCleared).toBe(0); // difficulty clamped to 0
		expect(rec.avgLatencyMs).toBe(0);
	});

	it("does not mutate the prior record", () => {
		const prev = foldEvalOutcomeIntoFitness(null, outcome({ score: 1 }));
		const snapshot = { ...prev };
		foldEvalOutcomeIntoFitness(prev, outcome({ score: 0 }));
		expect(prev).toEqual(snapshot);
	});
});

describe("foldEvalOutcomes", () => {
	it("folds a sequence oldest-first into one record", () => {
		const rec = foldEvalOutcomes(null, [
			outcome({ score: 1, difficulty: 0.33, passed: true }),
			outcome({ score: 1, difficulty: 0.66, passed: true }),
			outcome({ score: 0, difficulty: 1, passed: false }),
		]);
		expect(rec?.samples).toBe(3);
		expect(rec?.qualityScore).toBeCloseTo(2 / 3);
		expect(rec?.maxDifficultyCleared).toBe(0.66); // hardest PASS, not the failed 1.0
	});

	it("returns the prior unchanged for an empty sequence", () => {
		const prev = foldEvalOutcomeIntoFitness(null, outcome());
		expect(foldEvalOutcomes(prev, [])).toBe(prev);
		expect(foldEvalOutcomes(null, [])).toBeNull();
	});
});
