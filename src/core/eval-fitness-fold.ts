/**
 * Fold an eval-cell OUTCOME into a §5.AB {@link ModelFitnessRecord} (todo §5.AB — "run a model through the matrix →
 * fitness"). The eval harness (`scripts/eval-harness.mts`) scores each (model, role, difficulty) cell; this pure online
 * update turns those scores into the persisted fitness record that `computeModelFitness` / `selectModelForTask` rank by,
 * so measured eval results actually steer routing instead of only being printed.
 *
 * Pure + non-mutating (returns a NEW record), mirroring `recordModelBehaviorOutcome`: running means for graded quality,
 * pass-rate reliability, and latency; `maxDifficultyCleared` ratchets up ONLY on a passing cell (a fail at a hard tier
 * must not lower a previously-cleared bar, and a pass at an easy tier must not claim a hard one). `avgRetriesNeeded` is
 * carried through unchanged — the eval harness doesn't run the §5.AA retry ladder, so it has no retry signal to fold.
 */

import type { ModelFitnessRecord } from "./model-fitness.js";

/** One eval-cell result to fold into a model's fitness for a role. */
export interface EvalCellOutcome {
	modelId: string;
	/** architect | worker | reviewer (free string, matching ModelFitnessRecord.role). */
	role: string;
	/** The cell's difficulty as a 0..1 number (easy/medium/hard → e.g. 0.33/0.66/1.0; caller maps the tier). */
	difficulty: number;
	/** Graded output quality in [0, 1] from the deterministic scorer. */
	score: number;
	/** Wall-clock latency for the cell (ms). */
	latencyMs: number;
	/** Whether the cell counts as a PASS (clears the bar) — drives reliability + the maxDifficultyCleared ratchet. */
	passed: boolean;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

/**
 * Fold `outcome` into the model's prior fitness record for its role (pure). `prev` is the existing record, or `null` to
 * SEED a fresh one from this first observation. The caller is responsible for keying by (modelId, role) — a `prev` whose
 * modelId/role disagree with `outcome` is a wiring bug; this function trusts `outcome`'s identity and folds the numbers.
 */
export function foldEvalOutcomeIntoFitness(
	prev: ModelFitnessRecord | null,
	outcome: EvalCellOutcome,
): ModelFitnessRecord {
	const score = clamp01(outcome.score);
	const difficulty = clamp01(outcome.difficulty);
	const latencyMs = Number.isFinite(outcome.latencyMs) && outcome.latencyMs >= 0 ? outcome.latencyMs : 0;
	const passBit = outcome.passed ? 1 : 0;

	if (prev === null) {
		return {
			modelId: outcome.modelId,
			role: outcome.role,
			maxDifficultyCleared: outcome.passed ? difficulty : 0,
			qualityScore: score,
			reliability: passBit,
			avgLatencyMs: latencyMs,
			avgRetriesNeeded: 0,
			samples: 1,
		};
	}

	const n = prev.samples > 0 ? prev.samples : 0;
	const n1 = n + 1;
	const runningMean = (priorMean: number, next: number): number => (priorMean * n + next) / n1;

	return {
		modelId: outcome.modelId,
		role: outcome.role,
		// Ratchet up only on a pass; a fail never lowers a previously-cleared difficulty.
		maxDifficultyCleared: outcome.passed
			? Math.max(prev.maxDifficultyCleared, difficulty)
			: prev.maxDifficultyCleared,
		qualityScore: clamp01(runningMean(prev.qualityScore, score)),
		reliability: clamp01(runningMean(prev.reliability, passBit)),
		avgLatencyMs: runningMean(prev.avgLatencyMs, latencyMs),
		avgRetriesNeeded: prev.avgRetriesNeeded, // the eval harness runs no retry ladder — no signal to fold
		samples: n1,
	};
}

/** Fold a whole sequence of eval outcomes for ONE (model, role) into a single record, oldest-first. */
export function foldEvalOutcomes(
	prev: ModelFitnessRecord | null,
	outcomes: readonly EvalCellOutcome[],
): ModelFitnessRecord | null {
	return outcomes.reduce<ModelFitnessRecord | null>(
		(record, outcome) => foldEvalOutcomeIntoFitness(record, outcome),
		prev,
	);
}
