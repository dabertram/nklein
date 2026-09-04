/**
 * F3.41 — numeric card-difficulty → model-capability mapping by MODEL SIZE TIER (David 2026-09-04: "find out
 * which cards can be done by a 9b model .. which by maybe even smaller .. or maybe bigger .. focus on the best
 * in class .. properly take dense/moe into account .. the idea is to improve how fine grained the cards end up").
 *
 * Two halves, both PURE:
 *  1. A RESEARCHED reference table: the best-in-class open-weights agentic-coding model per size tier, with
 *     the vendor/press-reported agentic scores that anchor a capability PRIOR on !Klein's existing 0-100
 *     capability scale (the catalog `effectiveScore` the router already ranks on). Priors are exactly that —
 *     the fitness store's measured per-class capability REPLACES them the moment a class has evidence
 *     (`FleetModelClassInput.workerCapability`); this module only fills the unmeasured gap with something
 *     better than "size in billions".
 *  2. The mapping from a CARD's difficulty facts (decomposition complexity 0-100, likely-file count, the
 *     difficulty label) to a REQUIRED capability floor, and the smallest tier whose best-in-class prior clears
 *     it — the number the decomposer is steered by ("split until every child fits tier T").
 *
 * Dense vs MoE (the multidimensional part, handled deliberately): a model has a SIZE tier (total parameters —
 * what it knows / how much RAM it needs) and a COMPUTE tier (ACTIVE parameters — what a token costs). A dense
 * 27B is l/l; Qwen3.6-35B-A3B is xl by size but xs by compute. Routing COST follows the compute tier; QUALITY
 * follows the measured score, which for the strong MoEs sits at the l/xl level. So the "cheapest tier that can
 * do this card" answer is different for a fleet with an A3B MoE loaded than for a dense-only fleet — and the
 * fleet-aware decomposition guidance names the class it is targeting, not just a size.
 *
 * Research snapshot 2026-09-04 (vendor/press-reported, NOT harness-matched across vendors — directional):
 *  - <5B  : Qwen3.5-4B, Gemma 4 E4B (4.5B eff.) — no published SWE-bench/Terminal-Bench; generic 7-13B dense
 *           models score <5% SWE-bench Verified. Trivial/small edits only.
 *  - <10B : Ornith-1.0-9B (agentic-coding specialized): SWE-bench Verified 69.4, Terminal-Bench 2.1 43.1 —
 *           vs Qwen3.5-9B Terminal-Bench 21.3. Specialization beats size at this tier by ~2×.
 *  - <15B : Gemma 4 12B: LiveCodeBench v6 72.0 (vendor); no strong agentic numbers — mid tier is thin.
 *  - <30B : Qwen3.6-27B: SWE-bench Verified 77.2, SWE-bench Pro 53.5, Terminal-Bench 2.0 59.3, LCB v6 83.9;
 *           Qwen3.8-27B: SWE-bench Pro 61.7, LCB v6 90.3, NL2Repo 42.3, CoWorkBench 70.7.
 *  - <35B : Qwen3.6-35B-A3B (MoE, 3B active): SWE-bench Verified 73.4, Terminal-Bench 2.0 51.5;
 *           Gemma 4-31B (dense): Terminal-Bench 2.0 42.9; Gemma 4 26B-A4B: SWE-bench Verified 17.4 (weak).
 *  - ≥35B : reference only (Qwen3.8-Flash-Next 125B-A6B etc.) — outside the "small compute" question.
 */

export type ModelSizeTier = "xs" | "s" | "m" | "l" | "xl" | "beyond";

/** Ordered smallest → largest. */
export const MODEL_SIZE_TIERS: readonly ModelSizeTier[] = ["xs", "s", "m", "l", "xl", "beyond"];

/** Upper bound (INCLUSIVE) in billions of parameters per tier — "<35B" in David's framing includes the 35B-A3B MoE. */
export const MODEL_SIZE_TIER_MAX_PARAM_B: Readonly<Record<ModelSizeTier, number>> = {
	xs: 5,
	s: 10,
	m: 15,
	l: 30,
	xl: 35,
	beyond: Number.POSITIVE_INFINITY,
};

export interface TierReferenceModel {
	readonly name: string;
	readonly architecture: "dense" | "moe";
	readonly totalParamB: number;
	readonly activeParamB: number;
	/** Agentic-coding anchors as reported (see the header for provenance); null = not published. */
	readonly swebenchVerified: number | null;
	readonly terminalBench: number | null;
	readonly liveCodeBench: number | null;
}

export interface TierReference {
	readonly tier: ModelSizeTier;
	readonly label: string;
	/** Best-in-class capability prior (0-100) — what the STRONGEST known model of this size can do. */
	readonly bestInClassCapability: number;
	/** Typical capability prior (0-100) — what an UNMEASURED, unspecialized model of this size likely does. */
	readonly typicalCapability: number;
	readonly bestInClass: readonly TierReferenceModel[];
}

/**
 * Capability priors are anchored on SWE-bench-Verified-class agentic success where published, tempered by
 * Terminal-Bench (the closer analogue to !Klein's tool-driving worker) and by what the fleet has actually shown
 * (the 27B q6 clears medium cards; the 9B Ornith reviews well but walls on multi-file work; sub-5B is untested).
 */
export const MODEL_SIZE_TIER_REFERENCE: readonly TierReference[] = [
	{
		tier: "xs",
		label: "<5B",
		bestInClassCapability: 30,
		typicalCapability: 18,
		bestInClass: [
			{
				name: "Qwen3.5-4B",
				architecture: "dense",
				totalParamB: 4,
				activeParamB: 4,
				swebenchVerified: null,
				terminalBench: null,
				liveCodeBench: null,
			},
			{
				name: "Gemma 4 E4B",
				architecture: "dense",
				totalParamB: 4.5,
				activeParamB: 4.5,
				swebenchVerified: null,
				terminalBench: null,
				liveCodeBench: null,
			},
		],
	},
	{
		tier: "s",
		label: "<10B",
		bestInClassCapability: 58,
		typicalCapability: 34,
		bestInClass: [
			{
				name: "Ornith-1.0-9B",
				architecture: "dense",
				totalParamB: 9,
				activeParamB: 9,
				swebenchVerified: 69.4,
				terminalBench: 43.1,
				liveCodeBench: null,
			},
			{
				name: "Qwen3.5-9B",
				architecture: "dense",
				totalParamB: 9,
				activeParamB: 9,
				swebenchVerified: null,
				terminalBench: 21.3,
				liveCodeBench: null,
			},
		],
	},
	{
		tier: "m",
		label: "<15B",
		bestInClassCapability: 55,
		typicalCapability: 44,
		bestInClass: [
			{
				name: "Gemma 4 12B",
				architecture: "dense",
				totalParamB: 12,
				activeParamB: 12,
				swebenchVerified: null,
				terminalBench: null,
				liveCodeBench: 72.0,
			},
		],
	},
	{
		tier: "l",
		label: "<30B",
		bestInClassCapability: 74,
		typicalCapability: 58,
		bestInClass: [
			{
				name: "Qwen3.6-27B",
				architecture: "dense",
				totalParamB: 27,
				activeParamB: 27,
				swebenchVerified: 77.2,
				terminalBench: 59.3,
				liveCodeBench: 83.9,
			},
			{
				name: "Qwen3.8-27B",
				architecture: "dense",
				totalParamB: 28,
				activeParamB: 28,
				swebenchVerified: null,
				terminalBench: null,
				liveCodeBench: 90.3,
			},
		],
	},
	{
		tier: "xl",
		label: "<35B",
		bestInClassCapability: 72,
		typicalCapability: 60,
		bestInClass: [
			{
				name: "Qwen3.6-35B-A3B",
				architecture: "moe",
				totalParamB: 35,
				activeParamB: 3,
				swebenchVerified: 73.4,
				terminalBench: 51.5,
				liveCodeBench: null,
			},
			{
				name: "Gemma 4-31B",
				architecture: "dense",
				totalParamB: 31,
				activeParamB: 31,
				swebenchVerified: null,
				terminalBench: 42.9,
				liveCodeBench: null,
			},
		],
	},
	{
		tier: "beyond",
		label: "≥35B",
		bestInClassCapability: 86,
		typicalCapability: 70,
		bestInClass: [
			{
				name: "Qwen3.8-Flash-Next",
				architecture: "moe",
				totalParamB: 125,
				activeParamB: 6,
				swebenchVerified: null,
				terminalBench: null,
				liveCodeBench: null,
			},
		],
	},
];

export function tierForParamB(paramB: number): ModelSizeTier {
	for (const tier of MODEL_SIZE_TIERS) {
		if (paramB <= MODEL_SIZE_TIER_MAX_PARAM_B[tier]) {
			return tier;
		}
	}
	return "beyond";
}

export interface ModelSizeClassification {
	/** By TOTAL parameters — knowledge / RAM footprint. */
	readonly sizeTier: ModelSizeTier;
	/** By ACTIVE parameters — per-token compute cost (== sizeTier for dense models). */
	readonly computeTier: ModelSizeTier;
	readonly isMoe: boolean;
}

/** Classify a model by its parameter counts; `activeParamB` absent/equal ⇒ dense. */
export function classifyModelSize(input: {
	totalParamB: number;
	activeParamB?: number | null;
}): ModelSizeClassification {
	const active = input.activeParamB ?? input.totalParamB;
	const isMoe = active < input.totalParamB * 0.9;
	return { sizeTier: tierForParamB(input.totalParamB), computeTier: tierForParamB(active), isMoe };
}

export function tierReference(tier: ModelSizeTier): TierReference {
	const found = MODEL_SIZE_TIER_REFERENCE.find((entry) => entry.tier === tier);
	if (!found) {
		throw new Error(`unknown model size tier: ${tier}`);
	}
	return found;
}

/**
 * Capability PRIOR for an unmeasured model class from its size — the fleet snapshot's fallback when the fitness
 * store has no evidence yet. `typical`, not best-in-class: an unknown 9B is not assumed to be Ornith. A MoE is
 * scored by its SIZE tier for knowledge but discounted toward its compute tier (a sparse model with 3B active is
 * usually below a dense model of its total size on agentic loops — Qwen3.6-35B-A3B 51.5 vs Qwen3.6-27B 59.3
 * Terminal-Bench is the reference gap).
 */
export function fleetClassCapabilityPrior(input: { totalParamB: number; activeParamB?: number | null }): number {
	const { sizeTier, computeTier, isMoe } = classifyModelSize(input);
	const sizePrior = tierReference(sizeTier).typicalCapability;
	if (!isMoe) {
		return sizePrior;
	}
	const computePrior = tierReference(computeTier).typicalCapability;
	// 70% knowledge tier, 30% compute tier — the measured gap above, not a guess at MoE folklore.
	return Math.round(sizePrior * 0.7 + computePrior * 0.3);
}

export type CardDifficultyLabel = "trivial" | "easy" | "medium" | "hard" | "very-hard";

const DIFFICULTY_LABEL_BUMP: Readonly<Record<CardDifficultyLabel, number>> = {
	trivial: 0,
	easy: 4,
	medium: 12,
	hard: 24,
	"very-hard": 38,
};

export interface CardDifficultyFacts {
	/** Decomposition sizing complexity 0-100 (`NKleinPlanTask.complexity`). */
	readonly complexity: number;
	/** Files the card is likely to touch (`filesLikelyTouched.length`); 1 when unknown. */
	readonly likelyFileCount?: number | null;
	/** §5.AB difficulty label when estimated. */
	readonly difficulty?: CardDifficultyLabel | string | null;
}

function isDifficultyLabel(value: unknown): value is CardDifficultyLabel {
	return value === "trivial" || value === "easy" || value === "medium" || value === "hard" || value === "very-hard";
}

/**
 * The capability floor (0-100) a model must clear to complete this card alone. Monotone in every input:
 * complexity carries 75% of its weight (a 100-complexity card needs ~75 before file/label effects), every
 * likely file beyond the first adds 5 (multi-file changes are where small models lose the thread — the fleet's
 * own weak-worker walls were multi-file), and the difficulty label adds its bump. Clamped to 0-100. These are
 * PRIORS — the fitness-store calibration loop (observed pass/fail per complexity band per class) is what turns
 * them into measured floors.
 */
export function requiredCapabilityForCard(facts: CardDifficultyFacts): number {
	const complexity = Math.min(100, Math.max(0, facts.complexity));
	const files = Math.max(1, Math.floor(facts.likelyFileCount ?? 1));
	const bump = isDifficultyLabel(facts.difficulty) ? DIFFICULTY_LABEL_BUMP[facts.difficulty] : 0;
	return Math.round(Math.min(100, Math.max(0, complexity * 0.75 + (files - 1) * 5 + bump)));
}

/**
 * The maximum decomposition complexity a card may carry and still fit a class of the given capability, holding
 * file count and label fixed — the INVERSE of {@link requiredCapabilityForCard}, what the decomposer is told
 * ("keep every child at complexity ≤ N for this fleet").
 */
export function maxComplexityForCapability(
	capability: number,
	options: { likelyFileCount?: number | null; difficulty?: CardDifficultyLabel | string | null } = {},
): number {
	const files = Math.max(1, Math.floor(options.likelyFileCount ?? 1));
	const bump = isDifficultyLabel(options.difficulty) ? DIFFICULTY_LABEL_BUMP[options.difficulty] : 0;
	return Math.max(0, Math.min(100, Math.floor((capability - (files - 1) * 5 - bump) / 0.75)));
}

/**
 * The SMALLEST tier whose best-in-class prior clears the required capability — "which cards can a 9B do".
 * Null when no tier's best-in-class prior reaches it (the card is beyond the known open-weights landscape and
 * must be split regardless of fleet).
 */
export function smallestTierClearing(requiredCapability: number): ModelSizeTier | null {
	for (const tier of MODEL_SIZE_TIERS) {
		if (tierReference(tier).bestInClassCapability >= requiredCapability) {
			return tier;
		}
	}
	return null;
}
