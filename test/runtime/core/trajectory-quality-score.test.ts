import { describe, expect, it } from "vitest";
import {
	scoreTrajectoryQuality,
	summarizeTrajectoryQuality,
	type TrajectorySignals,
} from "../../../src/core/trajectory-quality-score";

const base: TrajectorySignals = {
	passed: true,
	stepsBeforeFirstEdit: 5,
	openingPatchIntensity: 0.1,
	validationEffortShare: 0.4,
	retryCount: 0,
	totalSteps: 20,
};

describe("scoreTrajectoryQuality", () => {
	it("classifies a disciplined win as ideal", () => {
		const score = scoreTrajectoryQuality(base);
		expect(score.classification).toBe("ideal");
		expect(score.qualityScore).toBeCloseTo(0.84, 2); // (0.68+0.702+0.20+0.40)/2.36
		expect(score.subScores.localization).toBe(1);
		expect(score.subScores.patchDiscipline).toBeCloseTo(0.9, 5);
	});

	it("classifies a passing-but-brittle attempt as LUCKY (the hidden case)", () => {
		const score = scoreTrajectoryQuality({
			passed: true,
			stepsBeforeFirstEdit: 0, // dove straight in
			openingPatchIntensity: 1, // dumped one big patch
			validationEffortShare: 0, // never validated
			retryCount: 4, // thrashed
			totalSteps: 12,
		});
		expect(score.classification).toBe("lucky");
		expect(score.qualityScore).toBeCloseTo(0, 5);
		expect(score.reason).toContain("LUCKY");
	});

	it("classifies a middling win as solid", () => {
		const score = scoreTrajectoryQuality({
			passed: true,
			stepsBeforeFirstEdit: 2, // loc 0.4
			openingPatchIntensity: 0.4, // patchDiscipline 0.6
			validationEffortShare: 0.3, // val 0.3
			retryCount: 1, // resilience 0.75
			totalSteps: 15,
		});
		expect(score.classification).toBe("solid");
		expect(score.qualityScore).toBeCloseTo(0.504, 2);
	});

	it("marks a failing attempt failed but still reports its process sub-scores", () => {
		const score = scoreTrajectoryQuality({ ...base, passed: false });
		expect(score.classification).toBe("failed");
		expect(score.subScores.localization).toBe(1); // process still measured
		expect(score.reason).toContain("failed");
	});

	it("clamps out-of-range signals into [0,1] sub-scores", () => {
		const score = scoreTrajectoryQuality({
			passed: true,
			stepsBeforeFirstEdit: 10, // saturates localization at 1
			openingPatchIntensity: 1.5, // clamps → patchDiscipline 0
			validationEffortShare: 2, // clamps → 1
			retryCount: 10, // resilience floored at 0
			totalSteps: 30,
		});
		expect(score.subScores.localization).toBe(1);
		expect(score.subScores.patchDiscipline).toBe(0);
		expect(score.subScores.validation).toBe(1);
		expect(score.subScores.resilience).toBe(0);
	});

	it("does NOT let raw length change the score (length is a confounded non-signal)", () => {
		const short = scoreTrajectoryQuality({ ...base, totalSteps: 5 });
		const long = scoreTrajectoryQuality({ ...base, totalSteps: 500 });
		expect(short.qualityScore).toBe(long.qualityScore);
	});
});

describe("summarizeTrajectoryQuality", () => {
	it("counts classes and reports the lucky-win rate as a share of WINS", () => {
		const ideal = scoreTrajectoryQuality(base);
		const solid = scoreTrajectoryQuality({
			passed: true,
			stepsBeforeFirstEdit: 2,
			openingPatchIntensity: 0.4,
			validationEffortShare: 0.3,
			retryCount: 1,
			totalSteps: 15,
		});
		const lucky = scoreTrajectoryQuality({
			passed: true,
			stepsBeforeFirstEdit: 0,
			openingPatchIntensity: 1,
			validationEffortShare: 0,
			retryCount: 4,
			totalSteps: 12,
		});
		const failed = scoreTrajectoryQuality({ ...base, passed: false });

		const summary = summarizeTrajectoryQuality([ideal, solid, lucky, failed]);
		expect(summary).toMatchObject({ total: 4, passed: 3, ideal: 1, solid: 1, lucky: 1, failed: 1 });
		expect(summary.luckyWinRate).toBeCloseTo(1 / 3, 4);
	});

	it("handles an empty batch without dividing by zero", () => {
		expect(summarizeTrajectoryQuality([])).toMatchObject({ total: 0, luckyWinRate: 0, meanQuality: 0 });
	});
});
