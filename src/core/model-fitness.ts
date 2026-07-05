/**
 * The "best model for the job" brain (todo §5.AB): score each connected model's fitness per role/difficulty and pick
 * the best *available* model for a task — quality-gated, speed-weighted, with a wait-for-best vs attempt-with-available
 * policy. Pure + deterministic so the scheduler can call it and so it is fully unit-testable; the eval harness (§5.AB)
 * + real task outcomes populate the `ModelFitnessRecord`s, and this module turns them into an assignment decision.
 *
 * The metric is deliberately composite ("sufficient quality at the best speed", user 2026-06-26): quality is the
 * gate, then speed + reliability are weighted and the learned retry-count is a penalty. Difficulty is normalised 0..1.
 */

/** One model's measured fitness for one role, distilled from the eval matrix + online task outcomes. */
export interface ModelFitnessRecord {
	modelId: string;
	/** architect | worker | reviewer (free string so new roles don't break the type). */
	role: string;
	/** Hardest difficulty (0..1) this model RELIABLY clears for this role (from the eval matrix). */
	maxDifficultyCleared: number;
	/** Graded output quality (0..1) at/below `maxDifficultyCleared`. */
	qualityScore: number;
	/** Pass-rate stability across repeats (0..1) — stochastic reliability. */
	reliability: number;
	/** Average wall-clock latency for a representative task (ms); lower is better. */
	avgLatencyMs: number;
	/** Average §5.AA retries needed to get a passing result; higher is worse. */
	avgRetriesNeeded: number;
	/** How many observations back this record (for confidence; not used in the score directly). */
	samples: number;
}

export interface FitnessWeights {
	quality: number;
	speed: number;
	reliability: number;
	/** Penalty per unit of normalised retry-count. */
	retryPenalty: number;
}

/** Quality-dominant defaults: a fast wrong answer is worse than a slightly slower right one. */
export const DEFAULT_FITNESS_WEIGHTS: FitnessWeights = {
	quality: 1,
	speed: 0.35,
	reliability: 0.5,
	retryPenalty: 0.25,
};

/** Map a latency to a 0..1 speed score (0 ms → 1, ~1 s → 0.5, slower → →0). Bounded + monotonic. */
function speedScore(avgLatencyMs: number): number {
	const ms = Math.max(0, avgLatencyMs);
	return 1 / (1 + ms / 1000);
}

/**
 * Composite fitness in [~0, sum-of-weights]. Higher is better. Pure function of the record + weights — quality and
 * reliability are already 0..1, speed is normalised, and the retry-count is penalised after a soft normalisation.
 */
export function computeModelFitness(
	record: ModelFitnessRecord,
	weights: FitnessWeights = DEFAULT_FITNESS_WEIGHTS,
): number {
	const retriesNorm = record.avgRetriesNeeded / (1 + record.avgRetriesNeeded); // 0 retries → 0, →1 as retries grow
	return (
		weights.quality * clamp01(record.qualityScore) +
		weights.speed * speedScore(record.avgLatencyMs) +
		weights.reliability * clamp01(record.reliability) -
		weights.retryPenalty * retriesNorm
	);
}

export interface SelectionPolicy {
	/** Minimum graded quality (0..1) to count a model as "qualified" for a task. */
	qualityBar: number;
	/** When the best qualified model is busy: wait for it, or attempt with the best available now. */
	mode: "wait_for_best" | "attempt_with_available";
	weights: FitnessWeights;
}

export const DEFAULT_SELECTION_POLICY: SelectionPolicy = {
	qualityBar: 0.6,
	mode: "attempt_with_available",
	weights: DEFAULT_FITNESS_WEIGHTS,
};

export interface ModelSelectionInput {
	role: string;
	/** Estimated task difficulty (0..1). */
	difficulty: number;
	/** Model ids currently free to take work (not busy in the parallel swarm). */
	availableModelIds: ReadonlySet<string>;
	policy?: SelectionPolicy;
}

export type ModelSelectionOutcome =
	/** Assign `modelId` now. `belowBar` = no qualified model was available, so this is a best-effort attempt. */
	| { decision: "assign"; modelId: string; score: number; belowBar: boolean; reason: string }
	/** A qualified model exists but is busy; under `wait_for_best` the task should wait for it. */
	| { decision: "wait"; waitForModelId: string; reason: string }
	/** No candidate at all for this role (no eval data / no model) — escalate to the §5.AA/user path. */
	| { decision: "escalate"; reason: string };

/**
 * Pick the model for a task. Among records for the role that **clear the quality bar AND reach the task's difficulty**
 * ("qualified"), assign the best-scoring AVAILABLE one — reserving the strongest models for the hardest tasks falls out
 * naturally because an easy task qualifies many models (so the fastest qualified one wins) while a hard task qualifies
 * only the strong ones. If qualified models exist but are all busy, `wait_for_best` waits for the top one and
 * `attempt_with_available` falls back to the best available (qualified-but-busy → below-bar available). With no
 * qualified model anywhere, attempt the best available below-bar; with no candidate at all, escalate.
 */
export function selectModelForTask(
	records: readonly ModelFitnessRecord[],
	input: ModelSelectionInput,
): ModelSelectionOutcome {
	const policy = input.policy ?? DEFAULT_SELECTION_POLICY;
	const forRole = records.filter((record) => record.role === input.role);
	if (forRole.length === 0) {
		return { decision: "escalate", reason: `no fitness records for role "${input.role}"` };
	}
	const scored = forRole
		.map((record) => ({
			record,
			score: computeModelFitness(record, policy.weights),
			qualified: record.qualityScore >= policy.qualityBar && record.maxDifficultyCleared >= input.difficulty,
			available: input.availableModelIds.has(record.modelId),
		}))
		// Deterministic tiebreak on equal fitness (and NaN-safe): without it, `.sort` is only stable, so two equal-score
		// models are ordered by the CALLER's records array — violating the module's pure+deterministic contract (the same
		// evidence in a different order would assign a different model). modelId keeps it total + reproducible.
		.sort((a, b) => b.score - a.score || a.record.modelId.localeCompare(b.record.modelId));

	const qualified = scored.filter((entry) => entry.qualified);
	const qualifiedAvailable = qualified.find((entry) => entry.available);
	if (qualifiedAvailable) {
		return {
			decision: "assign",
			modelId: qualifiedAvailable.record.modelId,
			score: qualifiedAvailable.score,
			belowBar: false,
			reason: `best qualified+available model for ${input.role}@${input.difficulty.toFixed(2)}`,
		};
	}

	// Qualified models exist but none are free right now.
	if (qualified.length > 0 && policy.mode === "wait_for_best") {
		return {
			decision: "wait",
			waitForModelId: qualified[0].record.modelId,
			reason: `qualified model "${qualified[0].record.modelId}" is busy; policy waits for the best fit`,
		};
	}

	// attempt_with_available (or no qualified at all): take the best AVAILABLE model, flagged as a below-bar attempt.
	const bestAvailable = scored.find((entry) => entry.available);
	if (bestAvailable) {
		return {
			decision: "assign",
			modelId: bestAvailable.record.modelId,
			score: bestAvailable.score,
			belowBar: true,
			reason:
				qualified.length > 0
					? "no qualified model is free; attempting with the best available (below-bar)"
					: "no model clears the quality bar for this difficulty; best-effort with the best available",
		};
	}

	// Nothing is available at all right now — wait for the strongest candidate to free up.
	return {
		decision: "wait",
		waitForModelId: scored[0].record.modelId,
		reason: "no candidate model is currently available",
	};
}

function clamp01(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

export interface TaskDifficultyInput {
	/** The task objective/prompt text length in characters — longer/denser objectives tend to be harder. */
	promptLength: number;
	/** Expected number of files the task will touch (0/undefined if unknown) — more files = more coordination. */
	expectedFileCount?: number;
	/** Whether the task has an explicit acceptance check/command — a clear, verifiable target is slightly easier. */
	hasAcceptanceCheck?: boolean;
	/** Prior bounces (review rejections / restarts) for this task — each is strong evidence it is hard here. */
	bounceCount?: number;
}

/**
 * Estimate a task's difficulty as a 0..1 score — the key into the §5.AB fitness table (`ModelSelectionInput.difficulty`,
 * which gates which models qualify). CONSERVATIVE first-pass heuristic over cheap, always-available task signals; the
 * §5.AB eval harness + learned real outcomes refine the weighting later (the SHAPE — signals → 0..1 → model gate — is
 * the durable part; the constants are tunable). Higher = harder, so selection reserves stronger models for it.
 */
export function estimateTaskDifficulty(input: TaskDifficultyInput): number {
	let score = 0;
	// Objective size: a longer/denser prompt implies more to satisfy. Capped so size alone never dominates. The three
	// caps (0.4 + 0.3 + 0.3) sum to 1.0 so a maximally-large/bounced task can reach difficulty 1.0 (gating the strongest
	// models, which need maxDifficultyCleared ≥ difficulty).
	score += Math.min(0.4, Math.max(0, input.promptLength) / 6000);
	// File footprint: more files to touch = more coordination / cross-file reasoning.
	score += Math.min(0.3, Math.max(0, input.expectedFileCount ?? 0) / 26);
	// Each prior bounce is strong evidence the task is hard for the current approach.
	score += Math.min(0.3, Math.max(0, input.bounceCount ?? 0) * 0.15);
	// A clear acceptance target makes convergence + verification a little easier.
	if (input.hasAcceptanceCheck) {
		score -= 0.05;
	}
	return clamp01(score);
}
