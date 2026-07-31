/**
 * §5.AB EVAL-HARNESS result aggregator (pure) — the missing step between the eval harness and the selector. The harness
 * runs each connected model through the role × difficulty × size matrix, REPEATING each cell N× (for stochastic
 * stability), producing a flat stream of graded per-run results; the {@link selectModelForTask} brain, however, consumes
 * a distilled {@link ModelFitnessRecord} per (model, role). THIS module folds the raw runs into those records — it is
 * exactly the "Capture + compute quality score, speed, and retry-count metrics per model/role/difficulty" +
 * "Emit `ModelFitnessRecord`" step the §5.AB Evaluation-harness backlog leaves unbuilt.
 *
 * It is DELIBERATELY DISTINCT from {@link ./agent-ledger-projections.ts} `buildModelFitnessFromLedger`, which derives a
 * COARSE record from LIVE-task ledger events (that writer has no graded quality and no difficulty, so it sets
 * `maxDifficultyCleared: 0` and proxies quality/reliability by the success rate — its own JSDoc defers "the §5.AB eval
 * harness fills graded quality + difficulty later"). THIS is that eval harness's aggregator: because eval runs ARE
 * graded and difficulty-tagged, it computes the REAL `maxDifficultyCleared` (the hardest difficulty tier the model
 * RELIABLY clears, monotone), a graded `qualityScore`, and a repeat-derived `reliability`.
 *
 * Pure + deterministic (no clock, no I/O, no store) so the whole harness→fitness fold is unit-testable; the effectful
 * harness (`nklein-eval-harness` / the model-lab sweep) produces the {@link ModelEvalRun}s and persists the resulting
 * records into the §5.AB fitness store, where {@link ./model-fitness-freshness.ts} then stamps freshness/decay onto them.
 */

import type { ModelFitnessRecord } from "./model-fitness";

/**
 * The canonical difficulty tiers the eval corpus spans (todo §5.AB "trivial → very-hard"). Ordered EASIEST→HARDEST;
 * each maps to a 0..1 scalar (`DIFFICULTY_TIER_SCORE`) so a cleared tier lands on the same axis as
 * {@link ModelFitnessRecord.maxDifficultyCleared} / `ModelSelectionInput.difficulty`.
 */
export const EVAL_DIFFICULTY_TIERS = ["trivial", "easy", "medium", "hard", "very-hard"] as const;

export type EvalDifficultyTier = (typeof EVAL_DIFFICULTY_TIERS)[number];

/** Rank (0 = easiest) of each tier — the monotone order clearing walks up. */
const DIFFICULTY_TIER_RANK: Record<EvalDifficultyTier, number> = {
	trivial: 0,
	easy: 1,
	medium: 2,
	hard: 3,
	"very-hard": 4,
};

/**
 * The 0..1 difficulty scalar a CLEARED tier contributes to `maxDifficultyCleared`. Chosen so the tiers span the full
 * [0,1] axis the selector gates on (`maxDifficultyCleared >= difficulty`): clearing the hardest tier ⇒ 1.0 (qualifies
 * for any task); clearing only `trivial` ⇒ 0.1 (a very easy floor). Monotone increasing in tier rank.
 */
export const DIFFICULTY_TIER_SCORE: Record<EvalDifficultyTier, number> = {
	trivial: 0.1,
	easy: 0.3,
	medium: 0.55,
	hard: 0.8,
	"very-hard": 1,
};

/** One graded eval-task RUN: a single attempt of one model at one role × difficulty tier (repeats share these keys). */
export interface ModelEvalRun {
	modelId: string;
	/** architect | worker | reviewer (free string so a new role doesn't break the type — mirrors `ModelFitnessRecord`). */
	role: string;
	difficulty: EvalDifficultyTier;
	/** Did the run clear the cell's acceptance bar (valid DAG / passing code / defect-catching review)? */
	passed: boolean;
	/** Graded output quality in [0,1] for THIS run (clamped). Distinct from `passed`: a run can pass yet score < 1. */
	qualityScore: number;
	/** Wall-clock latency of the run (ms). Negative/NaN are ignored in the latency mean. */
	latencyMs: number;
	/** §5.AA retries this run needed to reach its outcome (0 = first try). Negative/NaN treated as 0. */
	retries: number;
	/**
	 * P22.2 — the context this run actually put in front of the model, so fitness can be recorded AT DEPTH.
	 *
	 * A property of the PROMPT, not the response: a depth-padded row expands at run time, so this is known before
	 * the call. Optional because a caller that cannot determine it must leave the measurement depth-UNKNOWN rather
	 * than defaulting to a number — filing an unmeasured run as shallow would manufacture shallow evidence.
	 */
	contextTokens?: number;
}

export interface AggregateModelEvalPolicy {
	/**
	 * Minimum runs at a (model, role, tier) cell before the cell counts as evidence AT ALL. Below this the tier is
	 * treated as UN-cleared (too few repeats to trust) — a single lucky pass is not a cleared tier. Default 2.
	 */
	minRunsPerCell: number;
	/**
	 * Pass-rate (0..1) at/above which a well-sampled tier cell is "cleared". This is the stochastic-reliability bar the
	 * §5.AB metric wants ("does it RELIABLY clear the bar"). Default 0.75.
	 */
	reliabilityBar: number;
}

export const DEFAULT_AGGREGATE_MODEL_EVAL_POLICY: AggregateModelEvalPolicy = {
	minRunsPerCell: 2,
	reliabilityBar: 0.75,
};

/** Per-(model, role, tier) rollup — the intermediate the record fold is built on; also useful for an operator surface. */
export interface ModelEvalCellSummary {
	modelId: string;
	role: string;
	difficulty: EvalDifficultyTier;
	runs: number;
	passes: number;
	/** passes ÷ runs in [0,1]. */
	passRate: number;
	/** Mean graded quality across the cell's runs (0..1). */
	meanQuality: number;
	/** Mean latency across the cell's runs with a valid latency (ms); 0 when none. */
	meanLatencyMs: number;
	/** Mean retries across the cell's runs. */
	meanRetries: number;
	/** True when `runs >= minRunsPerCell && passRate >= reliabilityBar` (well-sampled AND reliable). */
	cleared: boolean;
	/**
	 * P22.2 — the LARGEST context any run in this cell used, or null when no run reported one.
	 *
	 * MAX rather than mean: the question a fitness consumer asks is "has this model been measured at the depth my
	 * card needs?", and an average over a deep and a shallow run answers neither. Null (not 0) when unknown, so
	 * absence stays absence.
	 */
	maxContextTokens: number | null;
}

interface CellAccumulator {
	modelId: string;
	role: string;
	difficulty: EvalDifficultyTier;
	runs: number;
	passes: number;
	qualitySum: number;
	latencySum: number;
	latencyCount: number;
	retriesSum: number;
	/** P22.2 — deepest context any run in this cell reported; null while no run has reported one. */
	maxContextTokens: number | null;
}

function clamp01(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

function nonNegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

const CELL_KEY_SEP = "\u0000";

/**
 * Roll the raw runs up per (model, role, difficulty) cell — pass-rate, mean graded quality, mean latency/retries, and
 * whether the cell is `cleared` (well-sampled AND reliable) under the policy. Deterministic order: model, then role,
 * then difficulty rank (easiest→hardest). Exposed on its own so an operator/debug surface can inspect the cells the
 * record fold is built from (the §5.Z matrix per model), not just the distilled record.
 */
export function summarizeModelEvalCells(
	runs: readonly ModelEvalRun[],
	policy: AggregateModelEvalPolicy = DEFAULT_AGGREGATE_MODEL_EVAL_POLICY,
): ModelEvalCellSummary[] {
	const minRuns = Math.max(1, Math.floor(policy.minRunsPerCell));
	const reliabilityBar = clamp01(policy.reliabilityBar);

	const cells = new Map<string, CellAccumulator>();
	for (const run of runs) {
		const key = `${run.modelId}${CELL_KEY_SEP}${run.role}${CELL_KEY_SEP}${run.difficulty}`;
		const cell = cells.get(key) ?? {
			modelId: run.modelId,
			role: run.role,
			difficulty: run.difficulty,
			runs: 0,
			passes: 0,
			qualitySum: 0,
			latencySum: 0,
			latencyCount: 0,
			retriesSum: 0,
			maxContextTokens: null,
		};
		cell.runs += 1;
		// P22.2: track the deepest run in the cell. A run that reported no context leaves this untouched, so an
		// unmeasured run cannot drag a cell's recorded depth down to zero.
		if (typeof run.contextTokens === "number" && Number.isFinite(run.contextTokens)) {
			cell.maxContextTokens = Math.max(cell.maxContextTokens ?? 0, run.contextTokens);
		}
		if (run.passed) {
			cell.passes += 1;
		}
		cell.qualitySum += clamp01(run.qualityScore);
		const latency = nonNegative(run.latencyMs);
		if (latency > 0) {
			cell.latencySum += latency;
			cell.latencyCount += 1;
		}
		cell.retriesSum += nonNegative(run.retries);
		cells.set(key, cell);
	}

	return [...cells.values()]
		.map((cell): ModelEvalCellSummary => {
			const passRate = cell.runs > 0 ? cell.passes / cell.runs : 0;
			return {
				modelId: cell.modelId,
				role: cell.role,
				difficulty: cell.difficulty,
				maxContextTokens: cell.maxContextTokens,
				runs: cell.runs,
				passes: cell.passes,
				passRate,
				meanQuality: cell.runs > 0 ? cell.qualitySum / cell.runs : 0,
				meanLatencyMs: cell.latencyCount > 0 ? cell.latencySum / cell.latencyCount : 0,
				meanRetries: cell.runs > 0 ? cell.retriesSum / cell.runs : 0,
				cleared: cell.runs >= minRuns && passRate >= reliabilityBar,
			};
		})
		.sort(
			(left, right) =>
				left.modelId.localeCompare(right.modelId) ||
				left.role.localeCompare(right.role) ||
				DIFFICULTY_TIER_RANK[left.difficulty] - DIFFICULTY_TIER_RANK[right.difficulty],
		);
}

/**
 * The hardest tier a model RELIABLY clears WITH MONOTONE SUPPORT: walk the tiers easiest→hardest, crediting a cleared
 * tier only while no EASIER *evaluated* tier was failed. Precisely:
 *   - a tier with NO runs is UN-evaluated (no evidence either way) ⇒ SKIPPED, it neither credits nor breaks the chain
 *     (the eval corpus need not run every tier);
 *   - a tier WITH runs that is `cleared` advances the ceiling;
 *   - a tier WITH runs that is NOT cleared BREAKS the climb — a harder cleared tier PAST that failure does NOT count
 *     (conservative: a model that clears `hard` but flunks the evaluated `medium` is credited only up to `medium-1`).
 * Returns the 0..1 score of the deepest reliably-cleared tier + that tier's rank (or `{0, -1}` when no evaluated tier is
 * cleared, or the easiest evaluated tier is failed, or there are no cells).
 */
function maxDifficultyClearedFrom(cellsForModelRole: readonly ModelEvalCellSummary[]): {
	score: number;
	deepestRank: number;
} {
	const byRank = new Map<number, ModelEvalCellSummary>();
	for (const cell of cellsForModelRole) {
		byRank.set(DIFFICULTY_TIER_RANK[cell.difficulty], cell);
	}
	let score = 0;
	let deepestRank = -1;
	for (const tier of EVAL_DIFFICULTY_TIERS) {
		const cell = byRank.get(DIFFICULTY_TIER_RANK[tier]);
		if (!cell) {
			continue; // un-evaluated tier — skip it, don't break the chain (an incomplete corpus is not a failure)
		}
		if (!cell.cleared) {
			break; // an EVALUATED-but-un-cleared tier stops the climb — don't credit any harder tier past it
		}
		score = DIFFICULTY_TIER_SCORE[tier];
		deepestRank = DIFFICULTY_TIER_RANK[tier];
	}
	return { score, deepestRank };
}

/**
 * Aggregate the eval harness's graded, repeated, difficulty-tagged runs into a §5.AB {@link ModelFitnessRecord} per
 * (model, role) — the durable input to {@link ./model-fitness.ts} `selectModelForTask` / `computeModelFitness`. Per
 * (model, role):
 *   - `maxDifficultyCleared` = the 0..1 score of the hardest tier reliably cleared WITH MONOTONE support
 *     ({@link maxDifficultyClearedFrom}) — the gate the selector uses to reserve strong models for hard tasks.
 *   - `qualityScore` = run-count-weighted mean graded quality over the runs AT OR BELOW the deepest cleared tier (the
 *     "quality at/below `maxDifficultyCleared`" the record documents); when NOTHING is cleared, over ALL the runs (so a
 *     below-bar model still carries an informative, non-zero graded quality rather than a hollow 0).
 *   - `reliability` = the pass-rate at the deepest cleared tier (the stochastic-stability signal at the model's ceiling);
 *     when nothing is cleared, the overall pass-rate.
 *   - `avgLatencyMs` / `avgRetriesNeeded` / `samples` = real aggregates over ALL of the (model, role)'s runs.
 * Deterministic order (most-sampled first, then modelId, then role) mirrors `buildModelFitnessFromLedger` so the two
 * sources sort alike. A (model, role) with zero runs contributes nothing.
 */
export function aggregateModelEvalRuns(
	runs: readonly ModelEvalRun[],
	policy: AggregateModelEvalPolicy = DEFAULT_AGGREGATE_MODEL_EVAL_POLICY,
): ModelFitnessRecord[] {
	const cells = summarizeModelEvalCells(runs, policy);

	// Group the raw runs + the cell summaries by (model, role) for the record fold.
	const runsByModelRole = new Map<string, ModelEvalRun[]>();
	for (const run of runs) {
		const key = `${run.modelId}${CELL_KEY_SEP}${run.role}`;
		const bucket = runsByModelRole.get(key);
		if (bucket) {
			bucket.push(run);
		} else {
			runsByModelRole.set(key, [run]);
		}
	}
	const cellsByModelRole = new Map<string, ModelEvalCellSummary[]>();
	for (const cell of cells) {
		const key = `${cell.modelId}${CELL_KEY_SEP}${cell.role}`;
		const bucket = cellsByModelRole.get(key);
		if (bucket) {
			bucket.push(cell);
		} else {
			cellsByModelRole.set(key, [cell]);
		}
	}

	const records: ModelFitnessRecord[] = [];
	for (const [key, groupRuns] of runsByModelRole) {
		const [modelId, role] = key.split(CELL_KEY_SEP);
		const groupCells = cellsByModelRole.get(key) ?? [];
		const { score: maxDifficultyCleared, deepestRank } = maxDifficultyClearedFrom(groupCells);

		// Real latency/retries aggregate over ALL the (model, role)'s runs; graded quality + reliability are taken
		// AT OR BELOW the reliably-cleared ceiling (the record documents "quality at/below `maxDifficultyCleared`"),
		// falling back to ALL runs when NOTHING is cleared so a below-bar model still gets a graded quality + a real
		// reliability rather than a hollow zero.
		const cleared = deepestRank >= 0;
		let qualitySum = 0;
		let qualityCount = 0;
		let latencySum = 0;
		let latencyCount = 0;
		let retriesSum = 0;
		let deepestClearedPasses = 0;
		let deepestClearedRuns = 0;
		let overallPasses = 0;
		for (const run of groupRuns) {
			const rank = DIFFICULTY_TIER_RANK[run.difficulty];
			const latency = nonNegative(run.latencyMs);
			if (latency > 0) {
				latencySum += latency;
				latencyCount += 1;
			}
			retriesSum += nonNegative(run.retries);
			if (run.passed) {
				overallPasses += 1;
			}
			// Graded quality: over the runs at/below the ceiling when cleared, else over ALL runs (fallback).
			if (!cleared || rank <= deepestRank) {
				qualitySum += clamp01(run.qualityScore);
				qualityCount += 1;
			}
			if (cleared && rank === deepestRank) {
				deepestClearedRuns += 1;
				if (run.passed) {
					deepestClearedPasses += 1;
				}
			}
		}

		const qualityScore = qualityCount > 0 ? qualitySum / qualityCount : 0;
		const reliability =
			deepestRank >= 0
				? deepestClearedRuns > 0
					? deepestClearedPasses / deepestClearedRuns
					: 0
				: groupRuns.length > 0
					? overallPasses / groupRuns.length
					: 0;

		records.push({
			modelId,
			role,
			maxDifficultyCleared,
			qualityScore: clamp01(qualityScore),
			reliability: clamp01(reliability),
			avgLatencyMs: latencyCount > 0 ? latencySum / latencyCount : 0,
			avgRetriesNeeded: groupRuns.length > 0 ? retriesSum / groupRuns.length : 0,
			samples: groupRuns.length,
		});
	}

	return records.sort(
		(left, right) =>
			right.samples - left.samples ||
			left.modelId.localeCompare(right.modelId) ||
			left.role.localeCompare(right.role),
	);
}
