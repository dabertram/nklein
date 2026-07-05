/**
 * §5.AC — stamp CITED sources with a freshness judgment (pure). The retrieval loop synthesizes a cited answer; each
 * cited source should carry whether it's still CURRENT so the answer can flag "this may be outdated" and the agent can
 * prefer a newer source. This reuses {@link ./retrieval-freshness.judgeRetrievedFreshness} over each source's publish
 * date — no new freshness logic, just the projection onto a citation list. Pure; the clock (`now`) is injected.
 */

import {
	type FreshnessJudgment,
	type FreshnessThresholdsDays,
	judgeRetrievedFreshness,
} from "./retrieval-freshness.js";

/** A cited source in a synthesized answer, with an optional publish date. */
export interface CitedSource {
	/** The citation ref — the `[n]` marker, url, or id used in the answer. */
	ref: string;
	url?: string;
	title?: string;
	/** When the source was published (any parseable form); absent ⇒ freshness `unknown`. */
	publishedAt?: Date | string | number | null;
}

/** A cited source annotated with its freshness judgment (verdict + age + guidance rail). */
export interface FreshnessStampedSource extends CitedSource {
	freshness: FreshnessJudgment;
}

/** Stamp each cited source with a freshness judgment (reuses §5.AC judgeRetrievedFreshness). Pure, clock injected. */
export function stampSourceFreshness(
	sources: readonly CitedSource[],
	now: Date,
	options?: { thresholds?: Partial<FreshnessThresholdsDays> },
): FreshnessStampedSource[] {
	return sources.map((source) => ({
		...source,
		freshness: judgeRetrievedFreshness({ publishedAt: source.publishedAt ?? null }, now, options),
	}));
}

/**
 * True when ANY cited source is possibly-stale or stale — the signal for the synthesized answer to surface a
 * "some sources may be outdated" caveat and for the agent to consider a fresher search.
 */
export function hasStaleCitedSource(stamped: readonly FreshnessStampedSource[]): boolean {
	return stamped.some(
		(source) => source.freshness.verdict === "possibly_stale" || source.freshness.verdict === "stale",
	);
}
