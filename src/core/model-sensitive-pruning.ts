/**
 * F4.13 — model-sensitive retrieval pruning (pure). Different models tolerate distractors differently: a robust model
 * shrugs off marginally-relevant repo-map/index/web evidence, while a distraction-prone one degrades when the prompt
 * carries noise. This core (1) estimates a model's DISTRACTOR SENSITIVITY from observed quality-vs-noise data, and
 * (2) prunes evidence accordingly — the more sensitive the model, the harder it prunes low-relevance items — while
 * ALWAYS preserving required facts and citations (correctness must never be pruned to fit a budget).
 *
 * Pure + deterministic. The effectful retrieval path supplies the scored evidence + the model's profile; this decides
 * what to keep.
 */

/** One observation of how added distractor noise affected a model's answer quality. */
export interface DistractorObservation {
	/** Fraction of the context that was distractor/noise (0..1). */
	readonly noiseFraction: number;
	/** Answer quality WITHOUT the added noise (0..1). */
	readonly baselineQuality: number;
	/** Answer quality WITH the added noise (0..1). */
	readonly noisyQuality: number;
}

/**
 * Estimate 0..1 distractor sensitivity: the average quality DROP per unit of noise, clamped. 0 = robust (noise doesn't
 * hurt), 1 = highly sensitive (noise collapses quality). Observations with no noise are ignored (no signal).
 */
export function estimateDistractorSensitivity(observations: readonly DistractorObservation[]): number {
	const slopes: number[] = [];
	for (const obs of observations) {
		const noise = Math.max(0, Math.min(1, obs.noiseFraction));
		if (noise <= 0) {
			continue;
		}
		const drop = Math.max(0, obs.baselineQuality - obs.noisyQuality);
		slopes.push(Math.min(1, drop / noise));
	}
	if (slopes.length === 0) {
		return 0;
	}
	return Math.max(0, Math.min(1, slopes.reduce((sum, s) => sum + s, 0) / slopes.length));
}

export interface EvidenceItem {
	readonly id: string;
	readonly kind: "repo_map" | "index" | "web";
	/** 0..1 relevance to the task. */
	readonly relevance: number;
	/** A required fact — NEVER pruned regardless of relevance/sensitivity. */
	readonly required: boolean;
	/** A citation — preserved so the answer stays attributable. */
	readonly isCitation: boolean;
}

export interface ModelSensitivePruneConfig {
	/** The relevance threshold when sensitivity is 0 (keep almost everything). Default 0.15. */
	readonly baseKeepThreshold: number;
	/** How much the threshold rises at sensitivity 1 (prune hard). Default 0.6 → threshold up to 0.75. */
	readonly sensitivitySpan: number;
	/** Never prune below this many prunable items when any exist (avoid over-pruning a small set). Default 1. */
	readonly minPrunableKept: number;
}

export const DEFAULT_MODEL_SENSITIVE_PRUNE_CONFIG: ModelSensitivePruneConfig = {
	baseKeepThreshold: 0.15,
	sensitivitySpan: 0.6,
	minPrunableKept: 1,
};

export interface PruneResult {
	readonly kept: readonly EvidenceItem[];
	readonly pruned: readonly EvidenceItem[];
	/** The relevance threshold applied to prunable (non-required, non-citation) items. */
	readonly appliedThreshold: number;
}

/**
 * Prune evidence for a model of the given `sensitivity` (0..1). Required facts + citations are always kept; among the
 * rest, an item is kept iff its relevance ≥ the sensitivity-scaled threshold. To avoid over-pruning, at least
 * `minPrunableKept` of the highest-relevance prunable items are retained when any exist.
 */
export function pruneEvidenceForModel(
	items: readonly EvidenceItem[],
	sensitivity: number,
	config: ModelSensitivePruneConfig = DEFAULT_MODEL_SENSITIVE_PRUNE_CONFIG,
): PruneResult {
	const clampedSensitivity = Math.max(0, Math.min(1, sensitivity));
	const appliedThreshold = config.baseKeepThreshold + clampedSensitivity * config.sensitivitySpan;

	const preserved: EvidenceItem[] = [];
	const prunable: EvidenceItem[] = [];
	for (const item of items) {
		if (item.required || item.isCitation) {
			preserved.push(item);
		} else {
			prunable.push(item);
		}
	}

	const keptPrunable: EvidenceItem[] = [];
	const pruned: EvidenceItem[] = [];
	for (const item of prunable) {
		if (item.relevance >= appliedThreshold) {
			keptPrunable.push(item);
		} else {
			pruned.push(item);
		}
	}

	// Anti-over-prune floor: if we'd drop everything prunable, keep the top-N by relevance.
	if (keptPrunable.length < config.minPrunableKept && prunable.length > 0) {
		const rescued = [...pruned]
			.sort((a, b) => b.relevance - a.relevance)
			.slice(0, config.minPrunableKept - keptPrunable.length);
		const rescuedIds = new Set(rescued.map((item) => item.id));
		keptPrunable.push(...rescued);
		return {
			kept: [...preserved, ...keptPrunable],
			pruned: pruned.filter((item) => !rescuedIds.has(item.id)),
			appliedThreshold,
		};
	}

	return { kept: [...preserved, ...keptPrunable], pruned, appliedThreshold };
}
