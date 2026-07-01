/**
 * Lost-in-the-middle POSITION-salience-risk scorer (todo §5.AD) — quantify, per placement, how much attention a
 * fragment is likely to LOSE purely because of WHERE it sits in the assembled window.
 *
 * Research grounding (§5.AD): LLM attention over a long context is **U-shaped** — the **start** and **end** are used
 * best, the **middle** worst ("lost in the middle", Liu et al. 2023; present at init in causal decoders per "Lost in
 * the Middle at Birth" 2026). The user's "early ≠ smartest" point is the *causal* complement: because attention is
 * causal, the very earliest tokens can't attend to background that arrives later, so the model only holds the full
 * picture **near the end** → the end-zone is the single strongest position, marginally stronger than the front.
 *
 * §5.AD already has:
 *  - `context-smart-zone.ts` — ORDERS parts into front/middle/back bands and edge-loads the middle. It *acts on* the
 *    U-shape (placing critical items outward) but never EXPOSES a per-position risk NUMBER a caller can read, compare,
 *    threshold, or drive a re-anchor decision from.
 *  - `context-reanchor.ts` — decides WHEN to re-inject a task reminder (a turn-cadence gate); it does not look at any
 *    fragment's POSITION within the window.
 *  - `context-occupancy-pressure.ts` — decides compact/proceed/expand from window OCCUPANCY (a used-vs-window
 *    fraction) and which BAND to trim; it never scores an individual fragment's placement.
 *  - `distractor-pruning.ts` — ranks/prunes by RELEVANCE score, orthogonal to position.
 *
 * This module fills that gap: it is the pure POSITION → salience-loss-risk mapping (the quantitative U-curve) plus a
 * mismatch detector that flags fragments whose IMPORTANCE is high but whose PLACEMENT is risky — the concrete
 * candidates a caller should re-anchor (§5.AD `context-reanchor.ts`) or promote toward an edge (§5.AD
 * `context-smart-zone.ts`). It composes with those cores by import (reusing the `SmartZoneBand` label) and never edits
 * them. Pure + deterministic: no I/O, no model call, no tokenizer — placement is injected as an index/total (or a
 * caller-supplied normalized position), and importance/weights as plain numbers.
 *
 * **Boundary (no duplication):** `context-smart-zone.ts` CHOOSES an ordering to minimize this risk but returns no
 * score; this module SCORES a given (already-decided) ordering so a caller can decide whether to re-anchor/re-order.
 * They are producer/consumer, not overlapping — this one imports the band type and reorders nothing.
 */

import type { SmartZoneBand } from "./context-smart-zone";

/** A fragment's placement in the assembled window. */
export interface FragmentPlacement {
	/** 0-based index of this fragment among the assembled fragments (0 = very first, `total - 1` = very last). */
	index: number;
	/** Total number of assembled fragments. A single fragment (`total <= 1`) carries no positional risk. */
	total: number;
}

export interface PositionSalienceRiskOptions {
	/**
	 * How wide (as a fraction of the window on EACH side) the low-risk edge PLATEAU is — within the first/last
	 * `edgePlateauFraction` of positions, risk stays at its floor (the model reliably attends to the very start/end).
	 * Beyond the plateau, risk climbs toward the dead center. Default 0.1. Clamped to [0, 0.5).
	 */
	edgePlateauFraction?: number;
	/**
	 * End-zone advantage in [0, 1): how much STRONGER the end is than the front (causal-attention / "full picture near
	 * the end" finding). 0 = a symmetric U (front and end equally strong); higher shifts the risk PEAK toward the front
	 * and lowers end-side risk relative to the front side. Default 0.15. Clamped to [0, 1).
	 */
	endZoneAdvantage?: number;
	/**
	 * Curve sharpness (> 0): the exponent on the normalized distance-from-edge. 1 = a linear tent; > 1 = a flatter
	 * center with steeper shoulders; < 1 = a rounded peak. Default 1.6 (a moderately sharp mid dip). Clamped to
	 * (0, ∞); a non-finite / non-positive value falls back to the default.
	 */
	sharpness?: number;
}

export interface PositionSalienceRisk {
	/**
	 * Salience-loss risk in [0, 1] from POSITION alone: 0 = the strongest position (well-attended edge), 1 = the
	 * worst-attended point (the risk peak, at/near the dead center — shifted toward the front by `endZoneAdvantage`).
	 * Independent of the fragment's content/importance; it answers only "how attention-safe is THIS slot".
	 */
	risk: number;
	/** The fragment's position normalized to [0, 1] (`index / (total - 1)`); `0` when `total <= 1`. */
	normalizedPosition: number;
	/**
	 * Which coarse zone the position falls in, mirroring §5.AD `context-smart-zone.ts` bands: `front` (in the leading
	 * edge plateau), `back` (in the trailing edge plateau), or `middle` (the risky interior between them).
	 */
	zone: SmartZoneBand;
	/** True when the position is inside an edge plateau (`front`/`back`) — a low-risk, well-attended slot. */
	onEdge: boolean;
}

const DEFAULT_EDGE_PLATEAU_FRACTION = 0.1;
const DEFAULT_END_ZONE_ADVANTAGE = 0.15;
const DEFAULT_SHARPNESS = 1.6;

/** Clamp `value` into [lo, hi]; a non-finite input falls back to `fallback` (then clamped). */
function clamp(value: number | undefined, lo: number, hi: number, fallback: number): number {
	const raw = Number.isFinite(value) ? (value as number) : fallback;
	if (raw < lo) {
		return lo;
	}
	return raw > hi ? hi : raw;
}

/**
 * Score the position-only salience-loss risk of a single placement (pure).
 *
 * The curve: normalize the position to [0, 1], then measure the distance from the NEARER edge. Inside the
 * `edgePlateauFraction` edge zones risk is 0 (reliably attended). Beyond a plateau, risk rises with the normalized
 * distance-past-the-plateau raised to `sharpness`, peaking at the interior point furthest from BOTH plateaus. The
 * `endZoneAdvantage` makes the trailing edge stronger than the leading one: the front-side shoulder is scaled up and
 * the back-side shoulder scaled down, so an equidistant front slot scores HIGHER risk than its mirror at the back and
 * the peak sits ahead of the geometric center — the causal "full picture near the end" asymmetry.
 *
 * Degenerate inputs are handled without throwing: `total <= 1` (a lone fragment) has no positional risk (0); an index
 * outside `[0, total)` is clamped into range; a non-finite index reads as 0 (treated as the very front).
 */
export function scorePositionSalienceRisk(
	placement: FragmentPlacement,
	options: PositionSalienceRiskOptions = {},
): PositionSalienceRisk {
	const total = Number.isFinite(placement.total) ? Math.trunc(placement.total) : 0;
	// A single (or empty) window carries no positional risk — there is no "middle" to be lost in.
	if (total <= 1) {
		return { risk: 0, normalizedPosition: 0, zone: "front", onEdge: true };
	}

	const rawIndex = Number.isFinite(placement.index) ? Math.trunc(placement.index) : 0;
	const index = rawIndex < 0 ? 0 : rawIndex > total - 1 ? total - 1 : rawIndex;
	const normalizedPosition = index / (total - 1);

	const plateau = clamp(options.edgePlateauFraction, 0, 0.5 - Number.EPSILON, DEFAULT_EDGE_PLATEAU_FRACTION);
	const advantage = clamp(options.endZoneAdvantage, 0, 1 - Number.EPSILON, DEFAULT_END_ZONE_ADVANTAGE);
	// Sharpness must be strictly positive; a non-finite / non-positive input falls back to the default (not clamped to
	// a near-zero exponent, which would flatten the whole interior to ~1).
	const sharpness =
		Number.isFinite(options.sharpness) && (options.sharpness as number) > 0
			? (options.sharpness as number)
			: DEFAULT_SHARPNESS;

	// Distance (in normalized units) into the interior, measured past the plateau on whichever side is nearer.
	const distFromFrontEdge = normalizedPosition; // 0 at the very front
	const distFromBackEdge = 1 - normalizedPosition; // 0 at the very end
	const nearestEdgeIsBack = distFromBackEdge < distFromFrontEdge;
	const distFromNearestEdge = nearestEdgeIsBack ? distFromBackEdge : distFromFrontEdge;

	// On an edge plateau → floor risk, low-risk zone. `middle` otherwise.
	const onEdge = distFromNearestEdge <= plateau;
	const zone: SmartZoneBand = onEdge ? (nearestEdgeIsBack ? "back" : "front") : "middle";
	if (onEdge) {
		return { risk: 0, normalizedPosition, zone, onEdge: true };
	}

	// The interior spans (plateau, 0.5] from each side. Normalize the past-plateau distance so the deepest interior
	// point (the geometric center at 0.5) maps to 1 before the shoulder curve + asymmetry are applied.
	const interiorHalfWidth = 0.5 - plateau; // > 0 (plateau clamped strictly below 0.5)
	const depth = (distFromNearestEdge - plateau) / interiorHalfWidth; // (0, 1], 1 at the center
	const baseShoulder = depth ** sharpness; // the symmetric U shoulder in (0, 1]

	// Asymmetry: scale the front-side shoulder UP toward 1 and the back-side shoulder DOWN, so the end is stronger and
	// the peak shifts frontward. `advantage` in [0,1): 0 → symmetric; near 1 → the back side is nearly risk-free.
	const sideScale = nearestEdgeIsBack ? 1 - advantage : Math.min(1, 1 + advantage * (1 - baseShoulder));
	const risk = clamp(baseShoulder * sideScale, 0, 1, 0);

	return { risk, normalizedPosition, zone, onEdge: false };
}

/** A fragment with an importance weight, awaiting placement scoring. */
export interface WeightedFragment {
	/** Stable identifier for the fragment (echoed back on the mismatch report). */
	id: string;
	/**
	 * How important this fragment is to keep well-attended, on any real scale (e.g. §5.AE `skillRelevance` 0..1, or a
	 * retrieval score). Only RELATIVE magnitude matters. Non-finite reads as 0 (unimportant).
	 */
	importance: number;
}

export interface PlacementMismatch {
	/** The offending fragment's id. */
	id: string;
	/** Its placement index in the window. */
	index: number;
	/** Its position-only salience risk (from {@link scorePositionSalienceRisk}). */
	risk: number;
	/** Its importance, clamped to a finite non-negative number. */
	importance: number;
	/**
	 * The mismatch magnitude = `importance × risk` — high when an IMPORTANT fragment sits in a HIGH-risk slot. This is
	 * the priority signal: the larger it is, the more a caller should re-anchor the fragment (§5.AD
	 * `context-reanchor.ts`) or promote it toward an edge (§5.AD `context-smart-zone.ts`).
	 */
	mismatch: number;
}

export interface PlacementMismatchOptions extends PositionSalienceRiskOptions {
	/**
	 * Only report fragments whose position risk is at/above this threshold (default 0.5 — clearly into the risky
	 * interior). Clamped to [0, 1]. A fragment on an edge (risk 0) is never reported.
	 */
	riskThreshold?: number;
	/** Optional cap on how many mismatches to return (the worst-first). Non-positive / non-finite ⇒ no cap. */
	limit?: number;
}

const DEFAULT_MISMATCH_RISK_THRESHOLD = 0.5;

/** A finite, non-negative number (non-finite / negative → 0). */
function nonNegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Given fragments in their FINAL assembled order (index = array position), flag the ones whose importance is high but
 * whose placement is attention-risky — the concrete re-anchor / promote candidates (pure, non-mutating).
 *
 * Each fragment is scored by {@link scorePositionSalienceRisk} against its array index over the list length. Fragments
 * whose position risk clears `riskThreshold` are ranked by `mismatch = importance × risk` DESCENDING (ties broken by
 * higher raw risk, then by earlier index for stability) and returned worst-first, optionally capped by `limit`. A
 * fragment on an edge, or with zero importance, produces a zero mismatch and is filtered out by the threshold / never
 * ranks. The input array is never reordered or mutated.
 */
export function findPlacementMismatches(
	fragments: readonly WeightedFragment[],
	options: PlacementMismatchOptions = {},
): PlacementMismatch[] {
	const total = fragments.length;
	if (total <= 1) {
		return [];
	}
	const riskThreshold = clamp(options.riskThreshold, 0, 1, DEFAULT_MISMATCH_RISK_THRESHOLD);

	const scored: PlacementMismatch[] = [];
	fragments.forEach((fragment, index) => {
		const { risk } = scorePositionSalienceRisk({ index, total }, options);
		if (risk < riskThreshold) {
			return;
		}
		const importance = nonNegative(fragment.importance);
		const mismatch = importance * risk;
		if (mismatch <= 0) {
			return;
		}
		scored.push({ id: fragment.id, index, risk, importance, mismatch });
	});

	scored.sort((a, b) => b.mismatch - a.mismatch || b.risk - a.risk || a.index - b.index);

	const limit =
		Number.isFinite(options.limit) && (options.limit as number) > 0 ? Math.trunc(options.limit as number) : 0;
	return limit > 0 ? scored.slice(0, limit) : scored;
}
