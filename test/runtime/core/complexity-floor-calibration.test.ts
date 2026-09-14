import { describe, expect, it } from "vitest";
import {
	COMPLEXITY_FLOOR_MIN_SAMPLE,
	type ComplexityOutcomeRow,
	calibrateComplexityFloors,
	joinComplexityOutcomeRows,
} from "../../../src/core/complexity-floor-calibration";

/**
 * F3.41 (c): the researched complexity→capability prior is replaced, class by class, by what the fleet's own
 * judged cards show — the highest complexity band a class still passes at 70% with a defensible sample.
 */
const rows = (classKey: string, complexity: number, passes: number, fails: number): ComplexityOutcomeRow[] => [
	...Array.from({ length: passes }, () => ({ classKey, complexity, passed: true })),
	...Array.from({ length: fails }, () => ({ classKey, complexity, passed: false })),
];

describe("calibrateComplexityFloors", () => {
	it("credits the highest band the class passes, walking up from the easiest", () => {
		const floors = calibrateComplexityFloors({
			rows: [...rows("9b", 15, 5, 0), ...rows("9b", 30, 4, 1), ...rows("9b", 45, 1, 4), ...rows("9b", 80, 5, 0)],
		});
		const floor = floors.get("9b");
		expect(floor?.basis).toBe("measured");
		// ≤20 passes (5/5), ≤35 passes (4/5 = 0.8), ≤50 FAILS (1/5) — the >50 band's 5/5 is not credited past it.
		expect(floor?.measuredMaxComplexity).toBe(35);
		expect(floor?.sample).toBe(20);
		expect(floor?.bands.map((band) => [band.band, band.sample, band.passRate])).toEqual([
			["≤20", 5, 1],
			["≤35", 5, 0.8],
			["≤50", 5, 0.2],
			[">50", 5, 1],
		]);
	});

	it("skips a thin band rather than inferring from it, and stays insufficient with no defensible band", () => {
		const thin = calibrateComplexityFloors({
			rows: [...rows("27b", 15, 5, 0), ...rows("27b", 30, 1, 1), ...rows("27b", 45, 5, 0)],
		});
		// ≤35 has 2 samples: skipped; ≤50 passes → 50.
		expect(thin.get("27b")?.measuredMaxComplexity).toBe(50);
		const nothing = calibrateComplexityFloors({ rows: rows("2b", 15, 2, 0) });
		expect(nothing.get("2b")).toMatchObject({ basis: "insufficient", measuredMaxComplexity: null, sample: 2 });
		expect(COMPLEXITY_FLOOR_MIN_SAMPLE).toBe(5);
	});

	it("credits nothing when the easiest defensible band already fails", () => {
		const floors = calibrateComplexityFloors({ rows: rows("tiny", 10, 1, 4) });
		expect(floors.get("tiny")).toMatchObject({ basis: "measured", measuredMaxComplexity: 0 });
	});

	it("ignores malformed rows and honours the caller's thresholds", () => {
		const floors = calibrateComplexityFloors({
			rows: [
				...rows("x", 30, 3, 0),
				{ classKey: "", complexity: 30, passed: true },
				{ classKey: "x", complexity: Number.NaN, passed: true },
			],
			minSample: 3,
			passRateFloor: 1,
		});
		expect(floors.get("x")).toMatchObject({ measuredMaxComplexity: 35, sample: 3 });
		expect(floors.has("")).toBe(false);
	});
});

describe("joinComplexityOutcomeRows", () => {
	it("joins a card's judgment, its newest worker attempt and its persisted complexity by task id", () => {
		const joined = joinComplexityOutcomeRows({
			outcomes: [
				{ taskId: "t1", outcome: "delivered" },
				{ taskId: "t2", outcome: "bounced" },
				{ taskId: "t3", outcome: "parked" },
				{ taskId: "t4", outcome: "delivered" }, // no complexity → dropped
				{ taskId: "t5", outcome: "delivered" }, // no attempt → dropped
				{ taskId: "t1", outcome: "bounced" }, // older duplicate judgment → ignored
			],
			attempts: [
				{ taskId: "t1", modelId: "small-9b", recordedAt: 1 },
				{ taskId: "t1", modelId: "big-27b", recordedAt: 2 }, // newest wins
				{ taskId: "t2", modelId: "small-9b", recordedAt: 1 },
				{ taskId: "t3", modelId: "small-9b", recordedAt: 1 },
				{ taskId: "t4", modelId: "small-9b", recordedAt: 1 },
			],
			complexityByTaskId: new Map([
				["t1", 40],
				["t2", 30],
				["t3", 60],
				["t5", 10],
			]),
			classKeyByModelId: new Map([["small-9b", "lmstudio/small-9b"]]),
		});
		expect(joined).toEqual([
			{ classKey: "big-27b", complexity: 40, passed: true },
			{ classKey: "lmstudio/small-9b", complexity: 30, passed: false },
			{ classKey: "lmstudio/small-9b", complexity: 60, passed: false },
		]);
	});

	it("treats an outcome that is not a judgment as no row", () => {
		expect(
			joinComplexityOutcomeRows({
				outcomes: [{ taskId: "t1", outcome: "pending" }],
				attempts: [{ taskId: "t1", modelId: "m", recordedAt: 1 }],
				complexityByTaskId: new Map([["t1", 10]]),
			}),
		).toEqual([]);
	});
});
