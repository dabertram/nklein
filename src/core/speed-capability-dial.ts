/**
 * §5.I#4 — the per-role SPEED-vs-CAPABILITY dial applied to a fit-ranked candidate list. Mirrors the
 * `applyDiversityPreference` doctrine (margin-bounded HARD preference, decided 2026-07-02): the dial never forces a
 * badly-weaker model — it only re-orders candidates whose fit is within `marginPts` of the top pick.
 *
 * - `"capability"` (or omitted): the input order stands — byte-identical to today's most-capable-first routing.
 * - `"speed"`: within the fit margin, the FASTEST measured candidate (tok/s desc) is promoted; unmeasured (null
 *   tok/s) candidates keep fit order after the measured ones. Outside the margin nothing moves.
 * - `"balanced"`: within the margin, order by the mean of the normalized fit and speed ranks (stable on ties), so a
 *   near-equally-capable-but-much-faster model wins without letting speed dominate.
 *
 * Pure + total; returns the ORIGINAL array when nothing changes so callers can cheaply detect a no-op.
 */

import type { RuntimeSpeedVsCapability } from "./runtime-config-api-contract";

export interface SpeedCapabilityCandidate {
	/** Blended fit score (higher is better) — the same points the router ranked on. */
	fitScore: number;
	/** Measured decode tok/s (EWMA), or null when the model has no speed samples yet. */
	tokensPerSecond: number | null;
}

const DEFAULT_MARGIN_PTS = 15;

export interface SpeedCapabilityDialResult<T extends SpeedCapabilityCandidate> {
	ranked: T[];
	/** True when the dial actually re-ordered the list (for the caller's observation line). */
	reordered: boolean;
}

export function applySpeedCapabilityDial<T extends SpeedCapabilityCandidate>(input: {
	/** Fit-ranked candidates, best-first. */
	ranked: readonly T[];
	dial: RuntimeSpeedVsCapability | undefined;
	/** Max fit-point deficit a faster candidate may have vs the top pick and still be promoted. */
	marginPts?: number;
}): SpeedCapabilityDialResult<T> {
	const dial = input.dial ?? "capability";
	if (dial === "capability" || input.ranked.length < 2) {
		return { ranked: [...input.ranked], reordered: false };
	}
	const margin = input.marginPts ?? DEFAULT_MARGIN_PTS;
	const topFit = input.ranked[0]?.fitScore ?? 0;
	// Split into the margin pool (eligible for re-ordering) and the tail (fit order preserved verbatim).
	const poolSize = input.ranked.findIndex((candidate) => topFit - candidate.fitScore > margin);
	const pool = poolSize === -1 ? [...input.ranked] : input.ranked.slice(0, poolSize);
	const tail = poolSize === -1 ? [] : input.ranked.slice(poolSize);
	if (pool.length < 2) {
		return { ranked: [...input.ranked], reordered: false };
	}

	const indexed = pool.map((candidate, index) => ({ candidate, fitRank: index }));
	if (dial === "speed") {
		// Fastest measured first; unmeasured keep fit order after every measured candidate.
		indexed.sort((left, right) => {
			const lt = left.candidate.tokensPerSecond;
			const rt = right.candidate.tokensPerSecond;
			if (lt !== null && rt !== null) {
				return rt - lt || left.fitRank - right.fitRank;
			}
			if (lt !== null) {
				return -1;
			}
			if (rt !== null) {
				return 1;
			}
			return left.fitRank - right.fitRank;
		});
	} else {
		// balanced: mean of normalized fit + speed ranks. Speed rank: measured sorted desc; unmeasured share the
		// worst measured rank + 1 (no information ≠ slowest, but it must not beat a measured-fast model).
		const measured = indexed
			.filter((entry) => entry.candidate.tokensPerSecond !== null)
			.sort((left, right) => (right.candidate.tokensPerSecond ?? 0) - (left.candidate.tokensPerSecond ?? 0));
		const speedRankByEntry = new Map<(typeof indexed)[number], number>();
		measured.forEach((entry, rank) => {
			speedRankByEntry.set(entry, rank);
		});
		const unmeasuredRank = measured.length;
		indexed.sort((left, right) => {
			const leftScore = left.fitRank + (speedRankByEntry.get(left) ?? unmeasuredRank);
			const rightScore = right.fitRank + (speedRankByEntry.get(right) ?? unmeasuredRank);
			return leftScore - rightScore || left.fitRank - right.fitRank;
		});
	}

	const ranked = [...indexed.map((entry) => entry.candidate), ...tail];
	const reordered = ranked.some((candidate, index) => candidate !== input.ranked[index]);
	return { ranked, reordered };
}
