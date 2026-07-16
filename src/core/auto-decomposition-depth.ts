/**
 * F4.38 — feed REAL budget + complexity into AUTO decomposition depth (pure). When decomposition depth is `AUTO`, the
 * chosen depth should reflect (a) how hard the task is — harder tasks warrant finer breakdown — and (b) how much the
 * model can actually hold WELL (its quality-effective context, not the advertised window) — a small effective budget
 * means each subtask must be smaller, so decompose DEEPER; a large one lets the model handle more per piece, so
 * decompose SHALLOWER. The decision carries a human-readable `reason` (the "visible reason" the spec requires) and never
 * silently falls back — an unknown difficulty is treated as `medium`.
 *
 * PURE + deterministic; no I/O. Composes with `task-difficulty-estimate` (difficulty) + `context-budget-knee`
 * (quality-effective context) at the call site.
 */

export type DifficultyTier = "trivial" | "easy" | "medium" | "hard" | "very-hard";

/** Base decomposition depth per difficulty tier (before the context adjustment). */
const BASE_DEPTH_BY_DIFFICULTY: Readonly<Record<DifficultyTier, number>> = {
	trivial: 0,
	easy: 0,
	medium: 1,
	hard: 2,
	"very-hard": 3,
};

export interface AutoDecompositionDepthInput {
	difficulty: DifficultyTier | string;
	/** The model's QUALITY-effective context (tokens it handles without degrading), NOT the advertised window. */
	qualityEffectiveContextTokens: number;
}

export interface AutoDecompositionDepthDecision {
	/** Recommended decomposition depth (0 = one-shot, no decomposition). */
	depth: number;
	reason: string;
}

/** Below this effective budget, decompose one level FINER (each subtask must be smaller). */
const SMALL_CONTEXT_TOKENS = 8_000;
/** Above this effective budget, decompose one level COARSER (the model holds more per piece). */
const LARGE_CONTEXT_TOKENS = 32_000;
/** Never recommend deeper than this regardless of inputs. */
const MAX_DEPTH = 4;

/** Resolve the AUTO decomposition depth from difficulty + the model's quality-effective context budget. */
export function resolveAutoDecompositionDepth(input: AutoDecompositionDepthInput): AutoDecompositionDepthDecision {
	const tier: DifficultyTier = tierOf(input.difficulty);
	const base = BASE_DEPTH_BY_DIFFICULTY[tier];
	const tokens = Number.isFinite(input.qualityEffectiveContextTokens)
		? Math.max(0, input.qualityEffectiveContextTokens)
		: LARGE_CONTEXT_TOKENS;

	let contextAdjustment = 0;
	let contextNote = "context neutral";
	if (tokens < SMALL_CONTEXT_TOKENS) {
		contextAdjustment = 1;
		contextNote = `small effective context (${tokens} < ${SMALL_CONTEXT_TOKENS}) → +1 finer`;
	} else if (tokens > LARGE_CONTEXT_TOKENS) {
		contextAdjustment = -1;
		contextNote = `large effective context (${tokens} > ${LARGE_CONTEXT_TOKENS}) → -1 coarser`;
	}

	const depth = Math.min(MAX_DEPTH, Math.max(0, base + contextAdjustment));
	return {
		depth,
		reason: `${tier} base ${base}, ${contextNote} → depth ${depth}`,
	};
}

function tierOf(value: DifficultyTier | string): DifficultyTier {
	return value in BASE_DEPTH_BY_DIFFICULTY ? (value as DifficultyTier) : "medium";
}

/**
 * Map the routing difficulty SCORE (the 5–100 number from `estimateNKleinStartDifficulty`) to the auto-depth tier.
 * Thresholds anchored on the swarm's own low-difficulty cutoff (≤30 disables thinking — "low"): ≤15 trivial, ≤30 easy,
 * ≤55 medium, ≤75 hard, else very-hard. Pure. Lets the decompose route feed its existing difficulty estimate straight
 * into {@link resolveAutoDecompositionDepth} without a second estimator.
 */
export function difficultyTierFromScore(score: number): DifficultyTier {
	if (!Number.isFinite(score)) {
		return "medium";
	}
	if (score <= 15) return "trivial";
	if (score <= 30) return "easy";
	if (score <= 55) return "medium";
	if (score <= 75) return "hard";
	return "very-hard";
}
