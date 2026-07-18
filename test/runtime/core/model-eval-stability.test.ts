import { describe, expect, it } from "vitest";
import type { AggregateModelEvalPolicy, ModelEvalRun } from "../../../src/core/model-eval-aggregation";
import { summarizeModelEvalCells } from "../../../src/core/model-eval-aggregation";
import {
	computePassPowerK,
	DEFAULT_EVAL_STABILITY_POLICY,
	type EvalStabilityPolicy,
	judgeCellStability,
	scoreModelEvalStability,
	summarizeModelRoleStability,
} from "../../../src/core/model-eval-stability";

/** Build `count` runs for a (model, role, tier) cell; each run's fields overridable via `over` or a per-index builder. */
function runs(
	count: number,
	over: Partial<ModelEvalRun> & Pick<ModelEvalRun, "modelId" | "role" | "difficulty">,
	perIndex?: (i: number) => Partial<ModelEvalRun>,
): ModelEvalRun[] {
	return Array.from({ length: count }, (_unused, i) => ({
		passed: true,
		qualityScore: 0.9,
		latencyMs: 1000,
		retries: 0,
		...over,
		...(perIndex ? perIndex(i) : {}),
	}));
}

/** Judge a single homogeneous cell end-to-end (summarize → spread → judge) for the given runs. */
function judgeOneCell(runList: ModelEvalRun[], policy?: EvalStabilityPolicy, aggregate?: AggregateModelEvalPolicy) {
	const scored = scoreModelEvalStability(runList, policy ?? DEFAULT_EVAL_STABILITY_POLICY, aggregate);
	expect(scored).toHaveLength(1);
	return scored[0];
}

describe("scoreModelEvalStability — thin cells", () => {
	it("marks a cell with fewer than minSettledRuns runs as `thin` with confidence 0", () => {
		// 3 runs < default minSettledRuns (4).
		const cell = judgeOneCell(runs(3, { modelId: "m", role: "worker", difficulty: "easy", passed: true }));
		expect(cell.verdict).toBe("thin");
		expect(cell.confidence).toBe(0);
		expect(cell.runs).toBe(3);
	});

	it("owes exactly enough runs to reach targetSettledRuns", () => {
		const cell = judgeOneCell(runs(2, { modelId: "m", role: "worker", difficulty: "medium" }));
		// target 6 − 2 present = 4 owed.
		expect(cell.runsOwed).toBe(4);
	});

	it("owes 0 when a thin cell already has >= target runs (impossible for thin, but the arithmetic never goes negative)", () => {
		// Force minSettledRuns above the run count while target is below it — runsOwed must clamp at 0, never negative.
		const cell = judgeOneCell(runs(5, { modelId: "m", role: "worker", difficulty: "easy" }), {
			...DEFAULT_EVAL_STABILITY_POLICY,
			minSettledRuns: 8,
			targetSettledRuns: 3, // raised to 8 internally, but 8 − 5 = 3 owed
		});
		expect(cell.verdict).toBe("thin");
		expect(cell.runsOwed).toBe(3);
	});
});

describe("scoreModelEvalStability — settled cells", () => {
	it("a well-sampled, all-pass, low-spread cell is `settled_pass` with 0 owed and high confidence", () => {
		const cell = judgeOneCell(
			runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.9 }),
		);
		expect(cell.verdict).toBe("settled_pass");
		expect(cell.runsOwed).toBe(0);
		expect(cell.confidence).toBeGreaterThan(0.5);
		expect(cell.qualitySpread).toBe(0); // identical qualities ⇒ no spread
	});

	it("a well-sampled, all-fail, low-spread cell is `settled_fail`", () => {
		const cell = judgeOneCell(
			runs(6, { modelId: "m", role: "worker", difficulty: "hard", passed: false, qualityScore: 0.2 }),
		);
		expect(cell.verdict).toBe("settled_fail");
		expect(cell.runsOwed).toBe(0);
		expect(cell.confidence).toBeGreaterThan(0.5);
	});

	it("settled confidence rises with sample count (more repeats ⇒ firmer verdict)", () => {
		const few = judgeOneCell(runs(4, { modelId: "m", role: "worker", difficulty: "easy", passed: true }));
		const many = judgeOneCell(runs(12, { modelId: "m", role: "worker", difficulty: "easy", passed: true }));
		expect(few.verdict).toBe("settled_pass");
		expect(many.verdict).toBe("settled_pass");
		expect(many.confidence).toBeGreaterThan(few.confidence);
	});
});

describe("scoreModelEvalStability — flaky via borderline pass-rate", () => {
	it("a pass-rate inside the margin band around the reliability bar is `flaky`", () => {
		// 4 of 6 pass = 0.667 pass-rate. Default bar 0.75, margin 0.15 ⇒ band (0.60, 0.90). 0.667 is inside ⇒ flaky.
		const cell = judgeOneCell(
			runs(6, { modelId: "m", role: "worker", difficulty: "medium", qualityScore: 0.7 }, (i) => ({
				passed: i < 4,
			})),
		);
		expect(cell.verdict).toBe("flaky");
		expect(cell.passRate).toBeCloseTo(0.667, 2);
		expect(cell.runsOwed).toBe(0); // already at target 6, but still flaky (owed measures distance to target only)
		expect(cell.confidence).toBeLessThanOrEqual(0.5); // a flaky cell caps at 0.5 trust
	});

	it("a pass-rate exactly at the decisive upper edge (bar + margin) is settled, not flaky", () => {
		// bar 0.75 + margin 0.15 = 0.90. 9 of 10 pass = 0.90 ⇒ passRate >= upper ⇒ settled_pass (band is open above).
		const cell = judgeOneCell(
			runs(10, { modelId: "m", role: "worker", difficulty: "easy", qualityScore: 0.9 }, (i) => ({
				passed: i < 9,
			})),
		);
		expect(cell.passRate).toBeCloseTo(0.9, 5);
		expect(cell.verdict).toBe("settled_pass");
	});
});

describe("scoreModelEvalStability — flaky via graded-quality spread (the pass-rate hides it)", () => {
	it("a cell that PASSES every run but swings wildly in quality is `flaky`, not settled", () => {
		// All 6 pass (pass-rate 1.0, decisive) but quality alternates 0.95/0.35 ⇒ spread 0.6 > 0.4 max ⇒ flaky.
		const cell = judgeOneCell(
			runs(6, { modelId: "m", role: "worker", difficulty: "hard", passed: true }, (i) => ({
				qualityScore: i % 2 === 0 ? 0.95 : 0.35,
			})),
		);
		expect(cell.passRate).toBe(1);
		expect(cell.qualitySpread).toBeCloseTo(0.6, 5);
		expect(cell.verdict).toBe("flaky");
		expect(cell.reason).toContain("quality swings");
	});

	it("a low quality spread within the max keeps a decisive cell settled", () => {
		// All pass, quality 0.9/0.7 ⇒ spread 0.2 <= 0.4 ⇒ settled_pass.
		const cell = judgeOneCell(
			runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true }, (i) => ({
				qualityScore: i % 2 === 0 ? 0.9 : 0.7,
			})),
		);
		expect(cell.qualitySpread).toBeCloseTo(0.2, 5);
		expect(cell.verdict).toBe("settled_pass");
	});

	it("NaN qualities are floored to 0 in the spread (a 0.9/NaN cell reads spread 0.9)", () => {
		const cell = judgeOneCell(
			runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true }, (i) => ({
				qualityScore: i % 2 === 0 ? 0.9 : Number.NaN,
			})),
		);
		expect(cell.qualitySpread).toBeCloseTo(0.9, 5);
		expect(cell.verdict).toBe("flaky");
	});
});

describe("judgeCellStability — high-bar clamp edge", () => {
	it("does not make settled_pass impossible when bar + margin would exceed 1", () => {
		// A cell summarized under a bar of 1.0; the upper threshold clamps to 1 so an all-pass cell can still settle.
		const [summary] = summarizeModelEvalCells(
			runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.9 }),
			{ minRunsPerCell: 2, reliabilityBar: 1 },
		);
		const stability = judgeCellStability(summary, 0, DEFAULT_EVAL_STABILITY_POLICY, {
			minRunsPerCell: 2,
			reliabilityBar: 1,
		});
		expect(stability.verdict).toBe("settled_pass");
	});
});

describe("judgeCellStability — regression (bug-hunt 2026-07-04)", () => {
	it("a dead-center (coin-flip) flaky cell is LESS confident than a near-decisive-edge flaky cell", () => {
		// Default bar 0.75, margin 0.15 ⇒ band (0.60, 0.90). Both are flaky-via-borderline, low spread.
		// Center: 6/8 = 0.75 (exactly the bar — maximally ambiguous). Edge: 5/8 = 0.625 (a hair above the fail edge).
		// Regression: the old passRateDoubt formula (1 - min/…) INVERTED this — it rated the coin-flip as the MOST
		// trustworthy flaky cell and the near-decisive one as the LEAST. Confidence must fall toward the center.
		const center = judgeOneCell(
			runs(8, { modelId: "m", role: "worker", difficulty: "medium", qualityScore: 0.7 }, (i) => ({ passed: i < 6 })),
		);
		const edge = judgeOneCell(
			runs(8, { modelId: "m", role: "worker", difficulty: "medium", qualityScore: 0.7 }, (i) => ({ passed: i < 5 })),
		);
		expect(center.verdict).toBe("flaky");
		expect(edge.verdict).toBe("flaky");
		expect(center.passRate).toBeCloseTo(0.75, 5);
		expect(edge.passRate).toBeCloseTo(0.625, 5);
		expect(center.confidence).toBeLessThan(edge.confidence);
		expect(center.confidence).toBeLessThan(0.05); // the exact coin-flip earns ~zero trust
	});

	it("a maximally-decisive settled_fail at a degenerate (clamped-to-0) fail floor is HIGH confidence", () => {
		// A non-default bar ≤ margin clamps `lower` to 0, so the only reachable settled_fail is passRate 0 (all failed) —
		// the most decisive fail possible. Regression: the old `(lower - passRate)/max(lower, EPSILON)` gave 0/EPSILON = 0
		// decisiveness there, deflating confidence. It must be fully decisive.
		const cell = judgeOneCell(
			runs(5, { modelId: "m", role: "worker", difficulty: "easy", passed: false, qualityScore: 0.1 }),
			DEFAULT_EVAL_STABILITY_POLICY,
			{ minRunsPerCell: 2, reliabilityBar: 0.05 },
		);
		expect(cell.verdict).toBe("settled_fail");
		expect(cell.passRate).toBe(0);
		expect(cell.confidence).toBeGreaterThan(0.8); // old (degenerate decisiveness 0) gave ~0.625
	});
});

describe("scoreModelEvalStability — ordering", () => {
	it("lists worst-first: thin → flaky → settled, then more-owed first", () => {
		const scored = scoreModelEvalStability([
			// settled_pass (6 pass, low spread)
			...runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.9 }),
			// flaky (borderline pass-rate on medium)
			...runs(6, { modelId: "m", role: "worker", difficulty: "medium", qualityScore: 0.7 }, (i) => ({
				passed: i < 4,
			})),
			// thin (2 runs on hard)
			...runs(2, { modelId: "m", role: "worker", difficulty: "hard", passed: false }),
		]);
		expect(scored.map((c) => c.verdict)).toEqual(["thin", "flaky", "settled_pass"]);
	});
});

describe("summarizeModelRoleStability — rollup", () => {
	it("aggregates settled/flaky/thin counts, settledFraction, total owed, and mean confidence per (model, role)", () => {
		const rollup = summarizeModelRoleStability([
			// worker: one settled + one thin
			...runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.9 }),
			...runs(2, { modelId: "m", role: "worker", difficulty: "hard", passed: false }),
		]);
		expect(rollup).toHaveLength(1);
		const worker = rollup[0];
		expect(worker.cells).toBe(2);
		expect(worker.settledCells).toBe(1);
		expect(worker.thinCells).toBe(1);
		expect(worker.flakyCells).toBe(0);
		expect(worker.settledFraction).toBe(0.5);
		expect(worker.totalRunsOwed).toBe(4); // the thin cell owes 6 − 2
		expect(worker.meanConfidence).toBeGreaterThan(0);
	});

	it("sorts least-settled (shakiest) model first", () => {
		const rollup = summarizeModelRoleStability([
			// solid: 2 settled cells
			...runs(6, { modelId: "solid", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.9 }),
			...runs(6, { modelId: "solid", role: "worker", difficulty: "medium", passed: true, qualityScore: 0.9 }),
			// shaky: 1 thin cell
			...runs(2, { modelId: "shaky", role: "worker", difficulty: "easy", passed: false }),
		]);
		expect(rollup.map((r) => r.modelId)).toEqual(["shaky", "solid"]);
		expect(rollup[0].settledFraction).toBe(0); // shaky
		expect(rollup[1].settledFraction).toBe(1); // solid
	});

	it("splits distinct (model, role) pairs into separate rollups", () => {
		const rollup = summarizeModelRoleStability([
			...runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.9 }),
			...runs(6, { modelId: "m", role: "reviewer", difficulty: "easy", passed: true, qualityScore: 0.9 }),
		]);
		expect(rollup).toHaveLength(2);
		expect(new Set(rollup.map((r) => r.role))).toEqual(new Set(["worker", "reviewer"]));
	});
});

describe("scoreModelEvalStability — determinism + empty", () => {
	it("returns [] for no runs", () => {
		expect(scoreModelEvalStability([])).toEqual([]);
		expect(summarizeModelRoleStability([])).toEqual([]);
	});

	it("is deterministic for the same input", () => {
		const input = [
			...runs(6, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.9 }),
			...runs(6, { modelId: "m", role: "worker", difficulty: "medium", qualityScore: 0.7 }, (i) => ({
				passed: i < 4,
			})),
		];
		expect(scoreModelEvalStability(input)).toEqual(scoreModelEvalStability(input));
	});
});
describe("computePassPowerK (F12.43)", () => {
	it("reports the plug-in pass^k and the Wilson-floor pass^k", () => {
		// 7/10 pass: pass@1 hides that all-3-pass is a coin flip.
		const r = computePassPowerK(7, 10, 3);
		expect(r.estimate).toBeCloseTo(0.343, 3);
		expect(r.wilsonLower).toBeGreaterThan(0.35);
		expect(r.wilsonLower).toBeLessThan(0.5);
		expect(r.lowerBoundPowerK).toBeCloseTo(r.wilsonLower ** 3, 6);
		expect(r.wilsonUpper).toBeGreaterThan(0.85);
	});

	it("handles the edges: zero runs, perfect, and total failure", () => {
		expect(computePassPowerK(0, 0)).toMatchObject({ estimate: 0, wilsonLower: 0, lowerBoundPowerK: 0 });
		const perfect = computePassPowerK(5, 5, 3);
		expect(perfect.estimate).toBe(1);
		expect(perfect.wilsonLower).toBeLessThan(1); // small-n honesty: 5/5 is not certainty
		const zero = computePassPowerK(0, 5, 3);
		expect(zero.estimate).toBe(0);
		expect(zero.wilsonUpper).toBeGreaterThan(0);
	});

	it("rides judgeCellStability onto every measured cell and the rollup's weakest link", () => {
		const cells = summarizeModelRoleStability([
			...runs(2, { modelId: "m1", role: "worker", difficulty: "easy" }),
			...runs(1, { modelId: "m1", role: "worker", difficulty: "easy", passed: false, qualityScore: 0.2 }),
			...runs(3, { modelId: "m1", role: "worker", difficulty: "medium" }),
		]);
		const row = cells.find((candidate) => candidate.modelId === "m1");
		expect(row?.minLowerBoundPassPowerK).not.toBeNull();
		// The weakest link is the 2/3 easy cell, whose Wilson floor is far below the 3/3 medium cell's.
		expect(row?.minLowerBoundPassPowerK ?? 1).toBeLessThan(0.2);
	});
});
