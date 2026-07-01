import { describe, expect, it } from "vitest";
import {
	aggregateModelEvalRuns,
	DEFAULT_AGGREGATE_MODEL_EVAL_POLICY,
	DIFFICULTY_TIER_SCORE,
	EVAL_DIFFICULTY_TIERS,
	type EvalDifficultyTier,
	type ModelEvalRun,
	summarizeModelEvalCells,
} from "../../../src/core/model-eval-aggregation";
import { computeModelFitness } from "../../../src/core/model-fitness";

/** Build `count` identical runs for a (model, role, tier) cell, overriding pass/quality/latency/retries. */
function runs(
	count: number,
	over: Partial<ModelEvalRun> & Pick<ModelEvalRun, "modelId" | "role" | "difficulty">,
): ModelEvalRun[] {
	return Array.from({ length: count }, () => ({
		passed: true,
		qualityScore: 0.9,
		latencyMs: 1000,
		retries: 0,
		...over,
	}));
}

describe("EVAL_DIFFICULTY_TIERS / DIFFICULTY_TIER_SCORE", () => {
	it("spans the full [0,1] axis, monotone increasing, hardest tier = 1.0", () => {
		const scores = EVAL_DIFFICULTY_TIERS.map((tier) => DIFFICULTY_TIER_SCORE[tier]);
		for (let i = 1; i < scores.length; i += 1) {
			expect(scores[i]).toBeGreaterThan(scores[i - 1]);
		}
		expect(scores[0]).toBeGreaterThan(0);
		expect(scores.at(-1)).toBe(1);
	});
});

describe("summarizeModelEvalCells", () => {
	it("rolls runs up per (model, role, tier): pass-rate, mean quality/latency/retries", () => {
		const cells = summarizeModelEvalCells([
			...runs(2, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.8 }),
			...runs(2, { modelId: "m", role: "worker", difficulty: "easy", passed: false, qualityScore: 0.4 }),
		]);
		expect(cells).toHaveLength(1);
		const cell = cells[0];
		expect(cell.runs).toBe(4);
		expect(cell.passes).toBe(2);
		expect(cell.passRate).toBe(0.5);
		expect(cell.meanQuality).toBeCloseTo(0.6, 10);
		expect(cell.meanLatencyMs).toBe(1000);
		expect(cell.meanRetries).toBe(0);
	});

	it("marks a cell `cleared` only when well-sampled AND pass-rate ≥ the reliability bar", () => {
		// 1 pass, 1 fail = 0.5 pass-rate < 0.75 default bar ⇒ not cleared.
		const notReliable = summarizeModelEvalCells([
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", passed: true }),
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", passed: false }),
		]);
		expect(notReliable[0].cleared).toBe(false);

		// 3/3 passes ≥ 0.75 and ≥ minRuns ⇒ cleared.
		const reliable = summarizeModelEvalCells(
			runs(3, { modelId: "m", role: "worker", difficulty: "easy", passed: true }),
		);
		expect(reliable[0].cleared).toBe(true);
	});

	it("treats a single lucky pass as NOT cleared (below minRunsPerCell)", () => {
		const cells = summarizeModelEvalCells(
			runs(1, { modelId: "m", role: "worker", difficulty: "easy", passed: true }),
		);
		expect(cells[0].runs).toBe(1);
		expect(cells[0].passRate).toBe(1);
		expect(cells[0].cleared).toBe(false); // one run < minRunsPerCell (2)
	});

	it("orders cells by model, then role, then difficulty rank (easiest→hardest)", () => {
		const cells = summarizeModelEvalCells([
			...runs(2, { modelId: "b", role: "worker", difficulty: "trivial" }),
			...runs(2, { modelId: "a", role: "worker", difficulty: "hard" }),
			...runs(2, { modelId: "a", role: "worker", difficulty: "easy" }),
			...runs(2, { modelId: "a", role: "architect", difficulty: "medium" }),
		]);
		expect(cells.map((c) => [c.modelId, c.role, c.difficulty])).toEqual([
			["a", "architect", "medium"],
			["a", "worker", "easy"],
			["a", "worker", "hard"],
			["b", "worker", "trivial"],
		]);
	});
});

describe("aggregateModelEvalRuns — maxDifficultyCleared", () => {
	it("is the score of the hardest reliably-cleared tier (monotone from the floor)", () => {
		const [record] = aggregateModelEvalRuns([
			...runs(3, { modelId: "m", role: "worker", difficulty: "trivial", passed: true }),
			...runs(3, { modelId: "m", role: "worker", difficulty: "easy", passed: true }),
			...runs(3, { modelId: "m", role: "worker", difficulty: "medium", passed: true }),
			// hard: only 1/3 pass ⇒ not cleared, so the ceiling is `medium`.
			...runs(1, { modelId: "m", role: "worker", difficulty: "hard", passed: true }),
			...runs(2, { modelId: "m", role: "worker", difficulty: "hard", passed: false }),
		]);
		expect(record.maxDifficultyCleared).toBe(DIFFICULTY_TIER_SCORE.medium);
	});

	it("does NOT credit a harder cleared tier past a GAP (conservative monotone support)", () => {
		// Clears `trivial` and `hard`, but flunks `easy` in between ⇒ credited only through the gap = trivial.
		const [record] = aggregateModelEvalRuns([
			...runs(3, { modelId: "m", role: "worker", difficulty: "trivial", passed: true }),
			...runs(3, { modelId: "m", role: "worker", difficulty: "easy", passed: false }),
			...runs(3, { modelId: "m", role: "worker", difficulty: "hard", passed: true }),
		]);
		expect(record.maxDifficultyCleared).toBe(DIFFICULTY_TIER_SCORE.trivial);
	});

	it("is 0 when even the easiest present tier is not reliably cleared", () => {
		const [record] = aggregateModelEvalRuns(
			runs(4, { modelId: "m", role: "worker", difficulty: "easy", passed: false }),
		);
		expect(record.maxDifficultyCleared).toBe(0);
	});

	it("credits the hardest tier (score 1.0) when the whole ladder is cleared", () => {
		const all: ModelEvalRun[] = EVAL_DIFFICULTY_TIERS.flatMap((difficulty) =>
			runs(3, { modelId: "m", role: "worker", difficulty, passed: true }),
		);
		const [record] = aggregateModelEvalRuns(all);
		expect(record.maxDifficultyCleared).toBe(1);
	});
});

describe("aggregateModelEvalRuns — qualityScore / reliability", () => {
	it("qualityScore averages graded quality AT OR BELOW the cleared ceiling (ignores harder failed cells)", () => {
		const [record] = aggregateModelEvalRuns([
			// cleared through `easy` at quality 0.8
			...runs(2, { modelId: "m", role: "worker", difficulty: "trivial", passed: true, qualityScore: 0.8 }),
			...runs(2, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.8 }),
			// `medium` fails at low quality — must NOT drag the at/below-ceiling quality down.
			...runs(2, { modelId: "m", role: "worker", difficulty: "medium", passed: false, qualityScore: 0.1 }),
		]);
		expect(record.maxDifficultyCleared).toBe(DIFFICULTY_TIER_SCORE.easy);
		expect(record.qualityScore).toBeCloseTo(0.8, 10);
	});

	it("reliability is the pass-rate AT the deepest cleared tier", () => {
		const [record] = aggregateModelEvalRuns([
			...runs(4, { modelId: "m", role: "worker", difficulty: "trivial", passed: true }),
			// easy: 3/4 pass = 0.75 (meets the bar ⇒ cleared) ⇒ reliability should be 0.75.
			...runs(3, { modelId: "m", role: "worker", difficulty: "easy", passed: true }),
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", passed: false }),
		]);
		expect(record.maxDifficultyCleared).toBe(DIFFICULTY_TIER_SCORE.easy);
		expect(record.reliability).toBeCloseTo(0.75, 10);
	});

	it("when nothing is cleared, falls back to graded quality + pass-rate over ALL runs (not a hollow zero)", () => {
		const [record] = aggregateModelEvalRuns([
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 0.6 }),
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", passed: false, qualityScore: 0.4 }),
		]);
		expect(record.maxDifficultyCleared).toBe(0); // 0.5 pass-rate < bar AND < minRuns handling ⇒ not cleared
		expect(record.qualityScore).toBeCloseTo(0.5, 10); // mean of 0.6 + 0.4 over ALL runs
		expect(record.reliability).toBeCloseTo(0.5, 10); // 1 pass / 2 runs
	});
});

describe("aggregateModelEvalRuns — real aggregates + shape", () => {
	it("avgLatencyMs / avgRetriesNeeded / samples aggregate over ALL of the (model, role)'s runs", () => {
		const [record] = aggregateModelEvalRuns([
			...runs(2, { modelId: "m", role: "worker", difficulty: "easy", latencyMs: 1000, retries: 1 }),
			...runs(2, { modelId: "m", role: "worker", difficulty: "medium", latencyMs: 3000, retries: 3 }),
		]);
		expect(record.samples).toBe(4);
		expect(record.avgLatencyMs).toBe(2000); // (1000+1000+3000+3000)/4
		expect(record.avgRetriesNeeded).toBe(2); // (1+1+3+3)/4
	});

	it("ignores non-finite/negative latency in the latency mean and clamps retries at 0", () => {
		const [record] = aggregateModelEvalRuns([
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", latencyMs: 2000, retries: 2 }),
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", latencyMs: -1, retries: -5 }),
		]);
		expect(record.avgLatencyMs).toBe(2000); // only the valid 2000 ms counts
		expect(record.avgRetriesNeeded).toBe(1); // (2 + 0)/2 — the negative retry clamps to 0
	});

	it("clamps out-of-range graded quality into [0,1]", () => {
		const [record] = aggregateModelEvalRuns([
			...runs(2, { modelId: "m", role: "worker", difficulty: "easy", passed: true, qualityScore: 5 }),
		]);
		expect(record.qualityScore).toBe(1);
	});

	it("produces one record per (model, role); splits roles apart", () => {
		const records = aggregateModelEvalRuns([
			...runs(2, { modelId: "m", role: "worker", difficulty: "easy" }),
			...runs(2, { modelId: "m", role: "architect", difficulty: "easy" }),
		]);
		expect(records).toHaveLength(2);
		expect(new Set(records.map((r) => r.role))).toEqual(new Set(["worker", "architect"]));
		expect(records.every((r) => r.modelId === "m")).toBe(true);
	});

	it("orders records most-sampled first, then by modelId, then role (mirrors buildModelFitnessFromLedger)", () => {
		const records = aggregateModelEvalRuns([
			...runs(2, { modelId: "b", role: "worker", difficulty: "easy" }),
			...runs(5, { modelId: "a", role: "worker", difficulty: "easy" }),
			...runs(2, { modelId: "a", role: "architect", difficulty: "easy" }),
		]);
		expect(records.map((r) => [r.modelId, r.role, r.samples])).toEqual([
			["a", "worker", 5],
			["a", "architect", 2],
			["b", "worker", 2],
		]);
	});

	it("returns [] for no runs", () => {
		expect(aggregateModelEvalRuns([])).toEqual([]);
	});
});

describe("aggregateModelEvalRuns — composes with the selector metric", () => {
	it("a model that clears harder tiers at high quality outranks a shallow one via computeModelFitness", () => {
		const strong = aggregateModelEvalRuns(
			EVAL_DIFFICULTY_TIERS.flatMap((difficulty) =>
				runs(3, {
					modelId: "strong",
					role: "worker",
					difficulty,
					passed: true,
					qualityScore: 0.95,
					latencyMs: 800,
				}),
			),
		)[0];
		const shallow = aggregateModelEvalRuns([
			...runs(3, { modelId: "shallow", role: "worker", difficulty: "trivial", passed: true, qualityScore: 0.6 }),
			...runs(3, { modelId: "shallow", role: "worker", difficulty: "easy", passed: false, qualityScore: 0.5 }),
		])[0];
		expect(strong.maxDifficultyCleared).toBe(1);
		expect(shallow.maxDifficultyCleared).toBe(DIFFICULTY_TIER_SCORE.trivial);
		expect(computeModelFitness(strong)).toBeGreaterThan(computeModelFitness(shallow));
	});

	it("respects a stricter reliabilityBar / minRunsPerCell policy", () => {
		const evalRuns: ModelEvalRun[] = [
			...runs(3, { modelId: "m", role: "worker", difficulty: "easy", passed: true }),
			...runs(1, { modelId: "m", role: "worker", difficulty: "easy", passed: false }), // easy = 3/4 = 0.75
		];
		// Default bar 0.75 ⇒ easy clears.
		expect(aggregateModelEvalRuns(evalRuns)[0].maxDifficultyCleared).toBe(DIFFICULTY_TIER_SCORE.easy);
		// Stricter 0.9 bar ⇒ 0.75 no longer clears ⇒ ceiling drops to 0.
		expect(
			aggregateModelEvalRuns(evalRuns, { ...DEFAULT_AGGREGATE_MODEL_EVAL_POLICY, reliabilityBar: 0.9 })[0]
				.maxDifficultyCleared,
		).toBe(0);
	});

	it("accepts every declared difficulty tier as a valid key", () => {
		const tiers: EvalDifficultyTier[] = [...EVAL_DIFFICULTY_TIERS];
		const evalRuns = tiers.flatMap((difficulty) => runs(2, { modelId: "m", role: "worker", difficulty }));
		const cells = summarizeModelEvalCells(evalRuns);
		expect(cells).toHaveLength(tiers.length);
	});
});
