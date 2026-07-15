/**
 * F3.33 — confidence- and resource-aware routing (pure). The live machine-aware loader (`device-load-routing.ts`)
 * decides WHERE a model fits; this decides WHICH loaded candidate to prefer by folding the quality + resource signals
 * into one score: quality confidence (the Wilson-lower-bound fitness), endpoint queue depth + occupancy, free vs
 * required RAM (a model that doesn't fit is infeasible), cold-load time, and warm-cache value (reuse a hot rail).
 * It also records PREDICTED vs REALIZED so routing can learn ({@link routingPredictionError}).
 *
 * Pure + deterministic — the caller gathers the live signals (fitness store, `lms ps` queue/occupancy, host RAM) and
 * ranks; the effectful dispatcher takes the top feasible candidate.
 */

export interface RoutingCandidate {
	readonly modelKey: string;
	readonly endpoint: string;
	/** 0..1 quality confidence for the role/difficulty (e.g. the Wilson lower bound). */
	readonly qualityConfidence: number;
	/** Pending requests queued at this endpoint (0 = free). */
	readonly queueDepth: number;
	/** Free RAM on the host (GB). */
	readonly freeRamGb: number;
	/** The model's RAM footprint (GB) — infeasible when it exceeds free RAM. */
	readonly requiredRamGb: number;
	/** Estimated cold-load time (ms); 0 when already warm. */
	readonly estimatedLoadMs: number;
	/** 0..1 how busy the endpoint is (a spill/thrash guard). */
	readonly endpointOccupancy: number;
	/** 0..1 value of reusing this candidate's warm cache/rail (higher = more benefit to staying warm). */
	readonly warmCacheValue: number;
}

export interface RoutingScoreConfig {
	/** Queue depth at which the queue penalty saturates. Default 4. */
	readonly queueSaturation: number;
	/** Load time (ms) at which the cold-load penalty saturates. Default 60_000 (a 60s cold load). */
	readonly loadSaturationMs: number;
	/** Weights (need not sum to 1; the score normalizes by the positive-weight sum). */
	readonly weights: {
		readonly quality: number;
		readonly queue: number;
		readonly load: number;
		readonly occupancy: number;
		readonly warmCache: number;
	};
}

export const DEFAULT_ROUTING_SCORE_CONFIG: RoutingScoreConfig = {
	queueSaturation: 4,
	loadSaturationMs: 60_000,
	weights: { quality: 0.45, queue: 0.2, load: 0.15, occupancy: 0.1, warmCache: 0.1 },
};

export interface RoutingScore {
	readonly modelKey: string;
	readonly endpoint: string;
	/** True when the model fits in free RAM; infeasible candidates are never dispatched. */
	readonly feasible: boolean;
	/** 0..1 preference; higher = route here first. 0 when infeasible. */
	readonly score: number;
	readonly reasons: readonly string[];
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function scoreRoutingCandidate(
	candidate: RoutingCandidate,
	config: RoutingScoreConfig = DEFAULT_ROUTING_SCORE_CONFIG,
): RoutingScore {
	const reasons: string[] = [];
	const feasible = candidate.freeRamGb >= candidate.requiredRamGb;
	if (!feasible) {
		return {
			modelKey: candidate.modelKey,
			endpoint: candidate.endpoint,
			feasible: false,
			score: 0,
			reasons: [`infeasible: needs ${candidate.requiredRamGb}GB, only ${candidate.freeRamGb}GB free`],
		};
	}

	const quality = clamp01(candidate.qualityConfidence);
	const queuePenalty = clamp01(candidate.queueDepth / Math.max(1, config.queueSaturation));
	const loadPenalty = clamp01(candidate.estimatedLoadMs / Math.max(1, config.loadSaturationMs));
	const occupancy = clamp01(candidate.endpointOccupancy);
	const warm = clamp01(candidate.warmCacheValue);

	const { quality: wq, queue: wqu, load: wl, occupancy: wo, warmCache: ww } = config.weights;
	// Positive contributions (quality, warm-cache) minus penalties (queue, load, occupancy), normalized to 0..1.
	const positiveMax = wq + ww;
	const raw = wq * quality + ww * warm - (wqu * queuePenalty + wl * loadPenalty + wo * occupancy);
	const score = clamp01((raw + (wqu + wl + wo)) / (positiveMax + wqu + wl + wo));

	if (quality >= 0.7) reasons.push(`high confidence ${quality.toFixed(2)}`);
	if (candidate.estimatedLoadMs === 0) reasons.push("warm (no load)");
	if (queuePenalty > 0.5) reasons.push(`busy queue (${candidate.queueDepth})`);
	return { modelKey: candidate.modelKey, endpoint: candidate.endpoint, feasible: true, score, reasons };
}

/**
 * Rank candidates best-first; INFEASIBLE candidates are dropped (a model that doesn't fit can't be routed to). Ties
 * break by modelKey+endpoint for determinism.
 */
export function rankRoutingCandidates(
	candidates: readonly RoutingCandidate[],
	config: RoutingScoreConfig = DEFAULT_ROUTING_SCORE_CONFIG,
): RoutingScore[] {
	return candidates
		.map((candidate) => scoreRoutingCandidate(candidate, config))
		.filter((scored) => scored.feasible)
		.sort((a, b) => b.score - a.score || `${a.modelKey}${a.endpoint}`.localeCompare(`${b.modelKey}${b.endpoint}`));
}

/** Predicted-vs-realized error for learning: |predicted score − realized quality|, 0..1. Lower = better-calibrated. */
export function routingPredictionError(predictedScore: number, realizedQuality: number): number {
	return Math.abs(clamp01(predictedScore) - clamp01(realizedQuality));
}
