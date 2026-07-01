/**
 * Learned quality-effective context-budget ESTIMATOR — the "quality knee" fit (todo §5.AD).
 *
 * §5.AD treats context SIZE as a capability lever in BOTH directions: too small a budget hurts, but over-filling a large
 * window ALSO degrades output ("context rot"; effective ≪ advertised per RULER/NoLiMa). So !Klein should target a
 * **learned quality-effective budget** — the token count past which more context stops meaningfully improving (and can
 * start HURTING) a given model on a given task — rather than filling the window.
 *
 * This module fits that budget from a scatter of raw {@link QualityObservation}s (each = a context size and the quality
 * it produced). It walks the quality-vs-tokens curve low→high and returns the **knee**: the smallest context past which
 * mean quality plateaus (never rises by more than `plateauEpsilon`) or begins to decline (the rot onset). Pure +
 * deterministic — no I/O, no model call, no tokenizer: token COUNTS + quality SCORES are injected as plain numbers.
 *
 * **Boundary vs. §5.AA `model-behavior-profile.ts`:** `recordModelBehaviorOutcome` folds a per-attempt BOOLEAN
 * (`qualityOk`) into two ratcheted scalars (best-good / first-degraded), and `learnedQualityEffectiveBudget` reads those
 * SCALARS. That discards the SHAPE of the curve, so it cannot see a plateau (where quality stops rising though it never
 * "fails") or a rot decline. This estimator is the complementary curve FIT over the RAW observations; a caller can seed
 * `learnedQualityEffectiveBudget`'s inputs from this fit, but the two computations are distinct (this module does not
 * import or mutate the profile). Boundary also noted vs. §5.AE `jit-fragment-budget.ts` (selection WITHIN a budget) and
 * §5.AD `context-smart-zone.ts` (ordering) — this decides the BUDGET; those consume it.
 */

/** One observation of the quality a model produced at a given context size. */
export interface QualityObservation {
	/** Context tokens in play for this observation. Non-finite / non-positive observations are ignored. */
	contextTokens: number;
	/**
	 * Observed output quality at that size — any real scale (a 0..1 score, a pass rate, a graded rubric). Only RELATIVE
	 * comparison matters, so the unit is the caller's; non-finite scores are ignored.
	 */
	qualityScore: number;
}

export interface QualityBudgetKneeOptions {
	/**
	 * The ≥32k capability FLOOR (invariant #3): the returned budget is never below this, even if the fit lands lower — the
	 * floor is a minimum-capability gate, not a fill target. Default 32_000.
	 */
	floorTokens?: number;
	/**
	 * How much mean quality must RISE from one context level to the next to count as "still improving" (same unit as
	 * `qualityScore`). Once the gain drops below this, the curve is treated as plateaued (the knee). Default 0.01.
	 */
	plateauEpsilon?: number;
	/**
	 * Observations within this many tokens of each other are treated as the SAME context level and their quality averaged
	 * (denoises repeated probes at "the same" size — e.g. 8000 vs 8003). Default 0 (exact token match). Clamped to ≥0.
	 */
	binTolerance?: number;
	/**
	 * Minimum distinct context levels required before the fit is trusted (`confident`). Below this the knee is still
	 * computed from what exists but flagged low-confidence, so a caller can fall back to the model's window. Default 3.
	 */
	minLevels?: number;
}

export interface QualityBudgetKnee {
	/**
	 * The learned quality-effective budget in tokens — the knee, floored at `floorTokens`. `null` when there is no usable
	 * observation at all (nothing to fit; the caller should use the model's window).
	 */
	budgetTokens: number | null;
	/** The context level (tokens) at which mean quality PEAKED across the observations, or `null` when none are usable. */
	peakTokens: number | null;
	/** The peak mean quality value (same unit as `qualityScore`), or `null` when no usable observations. */
	peakQuality: number | null;
	/**
	 * Why the knee was chosen:
	 * - `plateau` — quality stopped rising by ≥ `plateauEpsilon` past this level (more context stops helping).
	 * - `decline` — quality peaked then fell (context-rot onset); the budget targets the peak, not the larger sizes.
	 * - `monotonic` — quality kept rising across every level; the knee is the largest observed level (no plateau seen yet).
	 * - `insufficient` — no usable observations; `budgetTokens` is null.
	 */
	basis: "plateau" | "decline" | "monotonic" | "insufficient";
	/**
	 * True once at least `minLevels` distinct context levels back the fit. When false, the budget is still returned but a
	 * caller should prefer the model's window (too few points to trust the knee) — mirrors the cold-start caution §5.AD/§5.AB use.
	 */
	confident: boolean;
	/** Distinct context levels the fit was computed over (after binning). */
	levelCount: number;
}

const DEFAULT_FLOOR_TOKENS = 32_000;
const DEFAULT_PLATEAU_EPSILON = 0.01;
const DEFAULT_MIN_LEVELS = 3;

interface QualityLevel {
	/** Representative token count for the level (the mean of the binned observations' token counts, rounded). */
	tokens: number;
	/** Mean quality across the observations in this level. */
	quality: number;
}

function isUsable(observation: QualityObservation): boolean {
	return (
		Number.isFinite(observation.contextTokens) &&
		observation.contextTokens > 0 &&
		Number.isFinite(observation.qualityScore)
	);
}

/**
 * Collapse the raw observations into distinct, quality-averaged context LEVELS, ascending by tokens. Observations within
 * `binTolerance` of the running bin's anchor are merged (denoises near-identical sizes); each level reports the mean
 * token count + the mean quality of its members.
 */
function toLevels(observations: readonly QualityObservation[], binTolerance: number): QualityLevel[] {
	const usable = observations.filter(isUsable).sort((a, b) => a.contextTokens - b.contextTokens);
	const levels: QualityLevel[] = [];

	let bin: QualityObservation[] = [];
	let anchor = 0;
	const flush = () => {
		if (bin.length === 0) {
			return;
		}
		const tokens = bin.reduce((sum, o) => sum + o.contextTokens, 0) / bin.length;
		const quality = bin.reduce((sum, o) => sum + o.qualityScore, 0) / bin.length;
		levels.push({ tokens: Math.round(tokens), quality });
		bin = [];
	};

	for (const observation of usable) {
		if (bin.length === 0) {
			anchor = observation.contextTokens;
			bin.push(observation);
			continue;
		}
		if (observation.contextTokens - anchor <= binTolerance) {
			bin.push(observation);
		} else {
			flush();
			anchor = observation.contextTokens;
			bin.push(observation);
		}
	}
	flush();
	return levels;
}

/**
 * Estimate the learned quality-effective context budget from raw quality-vs-tokens observations (pure).
 *
 * The fit: bin the observations into distinct context levels (quality-averaged), then walk them low→high. The KNEE is
 * the first level after which mean quality no longer rises by at least `plateauEpsilon` — i.e. more context stops
 * helping (`plateau`), or the first level where it starts to fall (`decline`, the context-rot onset). If quality keeps
 * rising across every level, the knee is the largest observed level (`monotonic`). The returned budget is the knee's
 * token count, never below `floorTokens` (invariant #3). Never mutates the input.
 */
export function estimateQualityEffectiveBudget(
	observations: readonly QualityObservation[],
	options: QualityBudgetKneeOptions = {},
): QualityBudgetKnee {
	const floor = Math.max(0, options.floorTokens ?? DEFAULT_FLOOR_TOKENS);
	const epsilon = Math.max(0, options.plateauEpsilon ?? DEFAULT_PLATEAU_EPSILON);
	const binTolerance = Math.max(0, options.binTolerance ?? 0);
	const minLevels = Math.max(1, Math.trunc(options.minLevels ?? DEFAULT_MIN_LEVELS));

	const levels = toLevels(observations, binTolerance);
	if (levels.length === 0) {
		return {
			budgetTokens: null,
			peakTokens: null,
			peakQuality: null,
			basis: "insufficient",
			confident: false,
			levelCount: 0,
		};
	}

	// Peak: the level with the highest mean quality (earliest on a tie — the cheapest context that reaches the peak).
	let peakIndex = 0;
	for (let i = 1; i < levels.length; i += 1) {
		if (levels[i].quality > levels[peakIndex].quality) {
			peakIndex = i;
		}
	}
	const peak = levels[peakIndex];

	// Walk low→high for the knee: the first level after which quality neither rises by ≥ epsilon (plateau) nor holds
	// without a meaningful drop (decline). We stop at the level whose successor fails to improve.
	let kneeIndex = levels.length - 1;
	let basis: QualityBudgetKnee["basis"] = "monotonic";
	for (let i = 0; i < levels.length - 1; i += 1) {
		const gain = levels[i + 1].quality - levels[i].quality;
		if (gain < -epsilon) {
			// Quality fell past level i → rot onset. Target the better of (this level, the observed peak) — never chase a
			// larger context that scored worse.
			kneeIndex = Math.min(i, peakIndex);
			basis = "decline";
			break;
		}
		if (gain < epsilon) {
			// Flat within epsilon → the plateau begins at level i; more context is not buying quality.
			kneeIndex = i;
			basis = "plateau";
			break;
		}
	}

	const kneeTokens = levels[kneeIndex].tokens;
	return {
		budgetTokens: Math.max(floor, kneeTokens),
		peakTokens: peak.tokens,
		peakQuality: peak.quality,
		basis,
		confident: levels.length >= minLevels,
		levelCount: levels.length,
	};
}
