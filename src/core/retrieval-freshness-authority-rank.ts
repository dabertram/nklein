/**
 * Recency×authority COMBINER for the §5.AC "knows today" retrieval loop — the step that FUSES the two freshness halves
 * the lighthouse already built into ONE rankable score, so a retrieved source list can be ordered by "how much should I
 * trust this, given both how RECENT and how AUTHORITATIVE it is?".
 *
 * WHY. §5.AC ships the two halves separately and BOTH of their headers name the missing join:
 *   • `retrieval-freshness.ts` bands a source's AGE vs the authoritative now (`judgeRetrievedFreshness` → a
 *     {@link FreshnessVerdict} + `ageDays`) — the RECENCY half; its header says it is "date-based only".
 *   • `retrieval-source-trust.ts` scores a source's ORIGIN (`scoreSourceTrust` → a {@link SourceTrust} tier + a
 *     `weight` in [0,1]) — the AUTHORITY half; its header literally says it is "the AUTHORITY half a recency×authority
 *     ranker needs (freshness is already built)".
 * `retrieval-rerank.ts` orders by query RELEVANCE, and `retrieval-sufficiency.ts` decides when to STOP — but nothing
 * COMBINES recency and authority into a single scalar a caller can sort on. A fresh-but-random forum post and a slightly
 * older standards-body page cannot be compared with either half alone: recency alone ranks the forum post above the
 * standards page; authority alone ranks a 10-year-old `.gov` doc above yesterday's vendor blog. This module is that
 * missing join: `scoreFreshnessAuthority` composes the two cores BY IMPORT (it imports and calls them; it re-implements
 * neither and mutates neither) into a combined score in [0,1] + a full breakdown, and `rankByFreshnessAuthority` sorts a
 * batch of sources DESC on that score (stable ties) so the retrieval loop can prefer the best-grounded evidence first.
 *
 * The recency scalar is derived from the freshness verdict (a coarse, monotone band ladder — `current` > `recent` >
 * `possibly_stale` > `stale`, with `unknown` on a deliberate low floor because an undated source is weak evidence, not
 * no evidence) rather than from raw `ageDays`, so it inherits the volatility-tunable thresholds a caller can pass
 * straight through to `judgeRetrievedFreshness` (e.g. from `knowledge-volatility-ttl.ts`'s
 * `freshnessThresholdsForVolatility`) — a realtime topic and an evergreen one then score the same 5-day source
 * differently, and the combiner follows for free. The combine is a WEIGHTED GEOMETRIC MEAN by default: geometric (not
 * linear) so a source that is fully rotten on EITHER axis (recency→0 or authority→0) is dragged toward the bottom
 * instead of being rescued by a strong other axis — a `low`-trust source can't ride its freshness to the top, and a
 * `stale` source can't ride its authority to the top. An optional third factor — an INJECTED query-RELEVANCE score
 * (typically from `rerankByRelevance`) — folds into the same mean when supplied, so a caller can rank on all three of
 * relevance × recency × authority through one call; omit it and the combiner is pure recency×authority as named.
 *
 * PRIME DIRECTIVE #1 boundary: this DECIDES only — NO retrieval/egress/I/O/model/UI/fs. Every input (each source's
 * `publishedAt`/URL/kind, the authoritative `now`, the optional per-source relevance, the axis weights + thresholds) is
 * INJECTED as a plain value; the `now` clock is passed in (never `Date.now()`), exactly as the two composed cores
 * require. PURE + deterministic → fully unit-testable. It ADDS a combiner over the two §5.AC halves; it does not
 * duplicate or edit either.
 */

import { type FreshnessThresholdsDays, type FreshnessVerdict, judgeRetrievedFreshness } from "./retrieval-freshness";
import {
	type ScoreSourceTrustOptions,
	type SourceKind,
	type SourceTrust,
	type SourceTrustTier,
	scoreSourceTrust,
} from "./retrieval-source-trust";

// ---------------------------------------------------------------------------
// Recency scalar (from the freshness verdict)
// ---------------------------------------------------------------------------

/**
 * Map a {@link FreshnessVerdict} onto a recency scalar in [0,1] — the RECENCY axis of the combined score. A coarse
 * monotone ladder (`current` = 1 … `stale` = 0.1), matching the verdict's own bands, so the combiner inherits the
 * verdict's thresholds instead of re-binning raw `ageDays`. `unknown` sits on a low-but-nonzero floor (0.2): an undated
 * source is weak evidence, not zero — it should sink below any dated-and-recent source yet still be rankable above a
 * KNOWN-stale one. `unknown` > `stale` deliberately mirrors `retrieval-source-trust.ts`'s `unknown` > `low` ordering
 * (an un-datable source beats a datably-rotten one, all else equal).
 */
export const DEFAULT_RECENCY_WEIGHT: Readonly<Record<FreshnessVerdict, number>> = {
	current: 1,
	recent: 0.75,
	possibly_stale: 0.4,
	unknown: 0.2,
	stale: 0.1,
};

// ---------------------------------------------------------------------------
// Axis weights
// ---------------------------------------------------------------------------

/**
 * Relative importance of each axis in the weighted geometric mean (exponents; need not sum to 1 — they are normalised
 * internally). Recency and authority are weighted EQUALLY by default (this is a recency×authority combiner). `relevance`
 * defaults to the same, but only participates when a per-source relevance score is supplied.
 */
export interface FreshnessAuthorityWeights {
	/** Exponent on the recency axis. Higher ⇒ freshness matters more. */
	recency: number;
	/** Exponent on the authority axis. Higher ⇒ source trust matters more. */
	authority: number;
	/** Exponent on the (optional) query-relevance axis. Ignored for sources with no injected relevance. */
	relevance: number;
}

const DEFAULT_WEIGHTS: FreshnessAuthorityWeights = { recency: 1, authority: 1, relevance: 1 };

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One retrieved source to score — the union of what the freshness + trust halves each need, plus optional relevance. */
export interface RankableSource {
	/** A stable id for the source (echoed back on the ranked result; used only for identity, never for scoring). */
	id: string;
	/** The source URL or bare host — fed to `scoreSourceTrust` for the AUTHORITY axis. */
	url?: string;
	/** The declared source kind — fed to `scoreSourceTrust` as a prior for a hostless source (`doc`/`repo`). */
	sourceType?: SourceKind;
	/** The source's publication/update date — fed to `judgeRetrievedFreshness` for the RECENCY axis. Absent ⇒ `unknown`. */
	publishedAt?: Date | string | number | null;
	/**
	 * OPTIONAL pre-computed query-relevance score in [0,1] (e.g. from `rerankByRelevance`'s `score`). When present it
	 * folds in as a third axis; when absent the score is pure recency×authority. Values are clamped to [0,1].
	 */
	relevance?: number;
}

/** Options for {@link scoreFreshnessAuthority} / {@link rankByFreshnessAuthority}. All optional; every value INJECTED. */
export interface FreshnessAuthorityOptions {
	/** Per-axis weights (exponents in the geometric mean). Partial — unspecified axes keep {@link DEFAULT_WEIGHTS}. */
	weights?: Partial<FreshnessAuthorityWeights>;
	/** Verdict→recency-scalar overrides. Partial — unspecified verdicts keep {@link DEFAULT_RECENCY_WEIGHT}. */
	recencyWeights?: Partial<Record<FreshnessVerdict, number>>;
	/**
	 * Freshness-band thresholds passed straight through to `judgeRetrievedFreshness` — supply
	 * `freshnessThresholdsForVolatility(class)` (§5.AC `knowledge-volatility-ttl.ts`) to make the recency axis
	 * topic-appropriate (a realtime topic bands a 5-day source `stale`, an evergreen one bands it `current`).
	 */
	freshnessThresholds?: Partial<FreshnessThresholdsDays>;
	/** Extra source-trust lexicon/weights forwarded to `scoreSourceTrust` (custom TLDs / hosts / label cues / weights). */
	trust?: Pick<ScoreSourceTrustOptions, "extraTldRules" | "extraHostRules" | "extraLabelCues" | "weights">;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** The combined recency×authority score for one source, with the full breakdown for transparency + auditability. */
export interface FreshnessAuthorityScore {
	/** The source id echoed back. */
	id: string;
	/** The fused score in [0,1] — the value {@link rankByFreshnessAuthority} sorts on (higher = better-grounded). */
	score: number;
	/** The RECENCY axis scalar in [0,1] (from the freshness verdict via {@link DEFAULT_RECENCY_WEIGHT}). */
	recency: number;
	/** The AUTHORITY axis scalar in [0,1] (`SourceTrust.weight`). */
	authority: number;
	/** The RELEVANCE axis scalar in [0,1], or null when no relevance was supplied for this source. */
	relevance: number | null;
	/** The freshness verdict the recency axis came from (`retrieval-freshness.ts`). */
	freshnessVerdict: FreshnessVerdict;
	/** The trust tier the authority axis came from (`retrieval-source-trust.ts`). */
	trustTier: SourceTrustTier;
	/** Whole-day age of the source vs `now`, or null when undated (mirrors `FreshnessJudgment.ageDays`). */
	ageDays: number | null;
}

// ---------------------------------------------------------------------------
// Combine
// ---------------------------------------------------------------------------

/** Clamp a number to [0,1]; a non-finite value (NaN/±∞) clamps to 0 (a missing/garbage factor cannot boost the score). */
function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Weighted GEOMETRIC mean of the supplied (factor, weight) pairs, all factors already in [0,1] and all weights ≥ 0.
 * Geometric (∏ fᵢ^(wᵢ/Σw)) so a factor at 0 pulls the whole score to 0 — no single strong axis rescues a source that is
 * fully rotten on another. Pairs with weight ≤ 0 are dropped (that axis is switched off). When every remaining weight is
 * 0 (or no pairs remain) the result is 0. Implemented in log-space for numeric stability; a 0 factor short-circuits to 0
 * (its log is −∞).
 */
function weightedGeometricMean(pairs: readonly { factor: number; weight: number }[]): number {
	const active = pairs.filter((p) => p.weight > 0);
	const totalWeight = active.reduce((sum, p) => sum + p.weight, 0);
	if (totalWeight <= 0) {
		return 0;
	}
	let logSum = 0;
	for (const { factor, weight } of active) {
		if (factor <= 0) {
			return 0; // a zero factor annihilates a geometric mean.
		}
		logSum += (weight / totalWeight) * Math.log(factor);
	}
	return clamp01(Math.exp(logSum));
}

/**
 * Score ONE retrieved source into a combined recency×authority scalar by COMPOSING the two §5.AC halves:
 *   1. RECENCY — `judgeRetrievedFreshness({publishedAt}, now, {thresholds})` → a verdict, mapped to a [0,1] recency
 *      scalar via the (optionally overridden) verdict→weight ladder.
 *   2. AUTHORITY — `scoreSourceTrust(url, {sourceType, …})` → a trust tier + a [0,1] `weight` (the authority scalar).
 *   3. (optional) RELEVANCE — the injected per-source `relevance`, clamped to [0,1], if present.
 * These are fused by a weighted geometric mean (see {@link weightedGeometricMean}) so a source that is rotten on any
 * active axis sinks. The full breakdown (both scalars, the verdict, the tier, the age) is returned for transparency.
 * PURE: the only "clock" is the INJECTED `now`, forwarded to the freshness half exactly as it requires.
 */
export function scoreFreshnessAuthority(
	source: RankableSource,
	now: Date,
	options?: FreshnessAuthorityOptions,
): FreshnessAuthorityScore {
	const weights = { ...DEFAULT_WEIGHTS, ...options?.weights };
	const recencyLadder = { ...DEFAULT_RECENCY_WEIGHT, ...options?.recencyWeights };

	// RECENCY half — compose retrieval-freshness.ts (never re-implemented here).
	const freshness = judgeRetrievedFreshness(
		{ publishedAt: source.publishedAt },
		now,
		options?.freshnessThresholds ? { thresholds: options.freshnessThresholds } : undefined,
	);
	const recency = clamp01(recencyLadder[freshness.verdict]);

	// AUTHORITY half — compose retrieval-source-trust.ts (never re-implemented here).
	const trust: SourceTrust = scoreSourceTrust(source.url ?? "", {
		sourceType: source.sourceType,
		extraTldRules: options?.trust?.extraTldRules,
		extraHostRules: options?.trust?.extraHostRules,
		extraLabelCues: options?.trust?.extraLabelCues,
		weights: options?.trust?.weights,
	});
	const authority = clamp01(trust.weight);

	// Optional RELEVANCE axis (only participates when a value was injected for this source).
	const hasRelevance = source.relevance !== undefined && source.relevance !== null;
	const relevance = hasRelevance ? clamp01(source.relevance as number) : null;

	const pairs: { factor: number; weight: number }[] = [
		{ factor: recency, weight: weights.recency },
		{ factor: authority, weight: weights.authority },
	];
	if (relevance !== null) {
		pairs.push({ factor: relevance, weight: weights.relevance });
	}

	return {
		id: source.id,
		score: weightedGeometricMean(pairs),
		recency,
		authority,
		relevance,
		freshnessVerdict: freshness.verdict,
		trustTier: trust.tier,
		ageDays: freshness.ageDays,
	};
}

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

/**
 * Score every source (via {@link scoreFreshnessAuthority}) and return them sorted by combined score DESC. Ties preserve
 * the original input order (STABLE) — so a caller can pre-sort by a secondary key (e.g. relevance rank) and have it
 * survive an equal freshness-authority score. Inputs are never mutated; the returned array is new. The authoritative
 * `now` is INJECTED and forwarded to the composed freshness half.
 */
export function rankByFreshnessAuthority(
	sources: readonly RankableSource[],
	now: Date,
	options?: FreshnessAuthorityOptions,
): FreshnessAuthorityScore[] {
	const scored = sources.map((source, index) => ({
		result: scoreFreshnessAuthority(source, now, options),
		index,
	}));
	scored.sort((a, b) => {
		const diff = b.result.score - a.result.score;
		return diff !== 0 ? diff : a.index - b.index;
	});
	return scored.map((s) => s.result);
}
