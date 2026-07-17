/**
 * Trajectory-quality scorer — Ideal / Solid / Lucky (F12.42, todo §5.AF / Phase 12).
 *
 * Pass/fail hides ~11% "lucky" wins — an attempt that resolved the card through a brittle, undisciplined process that will
 * not generalize. Research (AgentLens, "Beyond Resolution Rates") found the discriminating signals are about PROCESS, not
 * length (raw step count is a CONFOUNDED non-signal), with these correlations to success:
 *   - steps-before-first-edit  ρ ≈ +0.68  (look before you leap — localize, then edit)
 *   - opening-patch intensity  ρ ≈ −0.78  (dumping a big early patch predicts failure)
 *   - validation-effort share  ρ ≈ +0.50  (running tests / checks as you go)
 *   - retry / backtrack count   (brittleness — a modest negative process signal)
 *
 * This is the PURE scorer over those per-attempt ledger signals: it maps each to a 0–1 "goodness" sub-score, combines them
 * weighted by |ρ|, and classifies a PASSING attempt as ideal / solid / lucky (a failing attempt is "failed"). No I/O, no
 * clock — the caller projects the signals off the step ledger and feeds them in. Composes with the F12.94 tournament
 * (rank/prune candidates by process quality) and the Model-Performance dialog (surface the lucky-win rate per model).
 */

/** Per-attempt process signals projected from the step ledger. Counts are ≥0; shares are fractions in [0,1]. */
export interface TrajectorySignals {
	readonly passed: boolean;
	/** How many steps the agent took before its FIRST edit (localization discipline; more is better, saturating). */
	readonly stepsBeforeFirstEdit: number;
	/** Fraction of all edits concentrated in the opening patch (0–1; lower is better — no premature big dump). */
	readonly openingPatchIntensity: number;
	/** Share of steps that were validation (test/typecheck/run) actions (0–1; higher is better). */
	readonly validationEffortShare: number;
	/** Number of retries / backtracks (brittleness; fewer is better). */
	readonly retryCount: number;
	/** Total steps — used only for context/aggregation, NEVER as a quality signal (length is confounded). */
	readonly totalSteps: number;
}

export type TrajectoryClass = "ideal" | "solid" | "lucky" | "failed";

export interface TrajectorySubScores {
	/** From steps-before-first-edit (ρ=+0.68). */
	readonly localization: number;
	/** From opening-patch intensity (ρ=−0.78). */
	readonly patchDiscipline: number;
	/** From validation-effort share (ρ=+0.50). */
	readonly validation: number;
	/** From retry/backtrack count (brittleness). */
	readonly resilience: number;
}

export interface TrajectoryQualityScore {
	readonly passed: boolean;
	/** Weighted process quality in [0,1]. */
	readonly qualityScore: number;
	readonly classification: TrajectoryClass;
	readonly subScores: TrajectorySubScores;
	readonly reason: string;
}

// Weights from the |ρ| magnitudes above; resilience is a modest judgment weight (no published ρ).
const W_LOCALIZATION = 0.68;
const W_PATCH_DISCIPLINE = 0.78;
const W_VALIDATION = 0.5;
const W_RESILIENCE = 0.4;

/** Steps of investigation before the first edit that earn full localization credit. */
const LOCALIZATION_SATURATION = 5;
/** Retry count at which the resilience sub-score reaches 0. */
const RETRY_ZERO_AT = 4;

/** Passing-attempt thresholds on the weighted process score. */
const IDEAL_THRESHOLD = 0.7;
const SOLID_THRESHOLD = 0.45;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Score one attempt's trajectory quality. A failing attempt is classified "failed" but STILL carries its process
 * sub-scores (a disciplined near-miss reads very differently from a flailing one). A passing attempt is ideal / solid /
 * lucky by its weighted process score — "lucky" being the passing-but-brittle case pass/fail alone cannot see.
 */
export function scoreTrajectoryQuality(signals: TrajectorySignals): TrajectoryQualityScore {
	const localization = clamp01(Math.max(0, signals.stepsBeforeFirstEdit) / LOCALIZATION_SATURATION);
	const patchDiscipline = 1 - clamp01(signals.openingPatchIntensity);
	const validation = clamp01(signals.validationEffortShare);
	const resilience = clamp01(1 - Math.max(0, signals.retryCount) / RETRY_ZERO_AT);

	const totalWeight = W_LOCALIZATION + W_PATCH_DISCIPLINE + W_VALIDATION + W_RESILIENCE;
	const qualityScore =
		(W_LOCALIZATION * localization +
			W_PATCH_DISCIPLINE * patchDiscipline +
			W_VALIDATION * validation +
			W_RESILIENCE * resilience) /
		totalWeight;

	const subScores: TrajectorySubScores = { localization, patchDiscipline, validation, resilience };

	if (!signals.passed) {
		return {
			passed: false,
			qualityScore,
			classification: "failed",
			subScores,
			reason: `failed (process quality ${qualityScore.toFixed(2)}).`,
		};
	}
	const classification: TrajectoryClass =
		qualityScore >= IDEAL_THRESHOLD ? "ideal" : qualityScore >= SOLID_THRESHOLD ? "solid" : "lucky";
	const reason =
		classification === "lucky"
			? `LUCKY win: passed but process quality ${qualityScore.toFixed(2)} < ${SOLID_THRESHOLD} (brittle — unlikely to generalize).`
			: `${classification} win: process quality ${qualityScore.toFixed(2)}.`;
	return { passed: true, qualityScore, classification, subScores, reason };
}

export interface TrajectoryQualitySummary {
	readonly total: number;
	readonly passed: number;
	readonly ideal: number;
	readonly solid: number;
	readonly lucky: number;
	readonly failed: number;
	/** Share of PASSING attempts that were lucky (brittle wins) — the headline hidden by pass/fail. */
	readonly luckyWinRate: number;
	/** Mean process quality across all attempts. */
	readonly meanQuality: number;
}

/**
 * Aggregate a batch of scored trajectories (e.g. all attempts of a model×role in the fitness sweep). The lucky-win rate is
 * the fraction of WINS that were brittle — a model with a high resolve rate but a high lucky-win rate is over-credited by
 * pass/fail alone.
 */
export function summarizeTrajectoryQuality(scores: readonly TrajectoryQualityScore[]): TrajectoryQualitySummary {
	const total = scores.length;
	const counts = { ideal: 0, solid: 0, lucky: 0, failed: 0 };
	let qualitySum = 0;
	for (const score of scores) {
		counts[score.classification] += 1;
		qualitySum += score.qualityScore;
	}
	const passed = counts.ideal + counts.solid + counts.lucky;
	return {
		total,
		passed,
		ideal: counts.ideal,
		solid: counts.solid,
		lucky: counts.lucky,
		failed: counts.failed,
		luckyWinRate: passed === 0 ? 0 : counts.lucky / passed,
		meanQuality: total === 0 ? 0 : qualitySum / total,
	};
}
