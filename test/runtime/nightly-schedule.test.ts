import { describe, expect, it } from "vitest";
import {
	CoverageWeakenedError,
	detectDurationRegressions,
	type NightlyCell,
	planNightlySchedule,
} from "../../src/core/nightly-schedule";

const CELLS: NightlyCell[] = [
	{ id: "slow", lastDurationMs: 90_000 },
	{ id: "fast", lastDurationMs: 2_000 },
	{ id: "mid", lastDurationMs: 20_000 },
];

describe("planNightlySchedule", () => {
	it("orders fastest-first, for early failure signal rather than throughput", () => {
		const plan = planNightlySchedule({ cells: CELLS });
		expect(plan.scheduledCells).toEqual(["fast", "mid", "slow"]);
	});

	it("sorts an UNMEASURED cell last, not first", () => {
		// An unknown duration could be the longest in the suite; scheduling it early would defeat the early-signal
		// purpose it is supposed to serve.
		const plan = planNightlySchedule({ cells: [{ id: "new", lastDurationMs: null }, ...CELLS] });
		expect(plan.scheduledCells[plan.scheduledCells.length - 1]).toBe("new");
	});

	it("pins HEAVY cells sequential even when parallelism is allowed", () => {
		// These false-timeout under contention: a false red looks exactly like a real regression and costs more
		// than the parallelism saves.
		const plan = planNightlySchedule({
			cells: [...CELLS, { id: "huge", lastDurationMs: 300_000, heavy: true }],
			maxParallel: 3,
		});
		const heavyGroup = plan.groups.find((group) => group.cells.includes("huge"));
		expect(heavyGroup?.sequential).toBe(true);
		expect(heavyGroup?.cells).toEqual(["huge"]);
		expect(heavyGroup?.reason).toContain("false red");
	});

	it("batches parallel-safe cells up to the cap", () => {
		const plan = planNightlySchedule({ cells: CELLS, maxParallel: 2 });
		expect(plan.groups[0]?.cells).toEqual(["fast", "mid"]);
		expect(plan.groups[1]?.cells).toEqual(["slow"]);
	});

	it("covers EVERY cell exactly once at any parallelism", () => {
		for (const maxParallel of [1, 2, 3, 10]) {
			const plan = planNightlySchedule({ cells: CELLS, maxParallel });
			expect([...plan.scheduledCells].sort()).toEqual(["fast", "mid", "slow"]);
		}
	});

	it("REFUSES a duplicate cell rather than running it twice", () => {
		expect(() => planNightlySchedule({ cells: [...CELLS, { id: "fast", lastDurationMs: 1 }] })).toThrow(
			CoverageWeakenedError,
		);
	});

	it("handles an empty suite", () => {
		expect(planNightlySchedule({ cells: [] }).scheduledCells).toEqual([]);
	});
});

describe("detectDurationRegressions", () => {
	it("flags a cell that got materially slower", () => {
		const found = detectDurationRegressions([{ cellId: "worker", baselineMs: 20_000, currentMs: 80_000 }]);
		expect(found).toHaveLength(1);
		expect(found[0]?.detail).toContain("the product regressing");
	});

	it("ignores a large RATIO on a tiny cell — otherwise the report fills with noise", () => {
		// 0.2s → 0.7s is 3.5× and means nothing. A report full of these stops being read, which is how a real 5×
		// gets missed.
		expect(detectDurationRegressions([{ cellId: "tiny", baselineMs: 200, currentMs: 700 }])).toEqual([]);
	});

	it("ignores a large ABSOLUTE delta that is not a meaningful ratio", () => {
		expect(detectDurationRegressions([{ cellId: "big", baselineMs: 600_000, currentMs: 640_000 }])).toEqual([]);
	});

	it("reports nothing for a cell with NO baseline — a first observation is not a comparison", () => {
		// Treating it as one would manufacture a regression on every newly-added cell.
		expect(detectDurationRegressions([{ cellId: "new", baselineMs: null, currentMs: 999_999 }])).toEqual([]);
	});

	it("ignores a zero or negative baseline rather than dividing by it", () => {
		expect(detectDurationRegressions([{ cellId: "weird", baselineMs: 0, currentMs: 50_000 }])).toEqual([]);
	});

	it("sorts worst-first", () => {
		const found = detectDurationRegressions([
			{ cellId: "a", baselineMs: 10_000, currentMs: 40_000 },
			{ cellId: "b", baselineMs: 10_000, currentMs: 100_000 },
		]);
		expect(found.map((r) => r.cellId)).toEqual(["b", "a"]);
	});
});
