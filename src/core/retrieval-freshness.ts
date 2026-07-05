/**
 * Freshness judgment for retrieved info (todo §5.AC, the "knows today" lighthouse). Given a source that carries a
 * publication/update date, compare it to the authoritative current time (§5.AC temporal core) and return a verdict +
 * an agent-facing rail: rely on it, or prefer a newer source and search further. This is what lets a temporally-grounded
 * agent decide whether what it retrieved (or recalls) is current enough — instead of trusting a stale doc.
 *
 * Pure + clock-injected (never reads `Date.now()`), so it is deterministic + fully testable. Date-based only: VERSION
 * freshness ("is v3.1 the latest?") needs an external "known latest" the retrieval loop supplies, so it is out of scope
 * here. Computed in whole UTC days.
 */

export type FreshnessVerdict = "current" | "recent" | "possibly_stale" | "stale" | "unknown";

/** Age thresholds (in days) for the verdict bands. A source older than `stale` is treated as likely outdated. */
export interface FreshnessThresholdsDays {
	/** ≤ this → `current`. */
	current: number;
	/** ≤ this → `recent`. */
	recent: number;
	/** ≤ this → `possibly_stale`; beyond it → `stale`. */
	possiblyStale: number;
}

const DEFAULT_THRESHOLDS: FreshnessThresholdsDays = { current: 30, recent: 180, possiblyStale: 365 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface FreshnessJudgment {
	verdict: FreshnessVerdict;
	/** Whole UTC days between the source date and now; null when no usable date. Future-dated sources clamp to 0. */
	ageDays: number | null;
	/** The parsed source date as `YYYY-MM-DD`, or null when unparseable/absent. */
	publishedIso: string | null;
	/** A short rail to hand the agent: whether to trust the source or search for something newer. */
	guidance: string;
}

function parseSourceDate(value: Date | string | number | null | undefined): Date | null {
	if (value === null || value === undefined) {
		return null;
	}
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function guidanceFor(verdict: FreshnessVerdict, ageDays: number | null): string {
	const age = ageDays === null ? "" : ` (~${ageDays} day${ageDays === 1 ? "" : "s"} old)`;
	switch (verdict) {
		case "current":
			return `This source is current${age} — safe to rely on against today's date.`;
		case "recent":
			return `This source is fairly recent${age}; rely on it, but check for a newer version if precision matters.`;
		case "possibly_stale":
			return `This source is${age} and may be outdated — prefer a newer source and search for the latest before relying on it.`;
		case "stale":
			return `This source is${age} and is LIKELY outdated — search for current information before relying on it; treat its claims as historical.`;
		default:
			return "This source has no detectable date — treat its freshness as unknown and prefer a dated, clearly-current source.";
	}
}

/**
 * Judge how fresh a retrieved source is relative to `now`. The verdict bands come from `thresholds` (days). A source
 * dated in the future (clock skew / a dated-ahead doc) clamps to age 0 = `current`. No usable date → `unknown`.
 */
export function judgeRetrievedFreshness(
	input: { publishedAt?: Date | string | number | null },
	now: Date,
	options?: { thresholds?: Partial<FreshnessThresholdsDays> },
): FreshnessJudgment {
	const published = parseSourceDate(input.publishedAt);
	if (published === null) {
		return { verdict: "unknown", ageDays: null, publishedIso: null, guidance: guidanceFor("unknown", null) };
	}
	// Do NOT round to whole days: with a realtime band (current threshold 0), Math.round collapses any sub-12h age to 0
	// and mis-judges an 11h-old source as `current`. Keep the age FRACTIONAL so the band comparison is exact (mirrors
	// the sibling isKnowledgeStale, fixed for exactly this case).
	const ageDays = Math.max(0, (now.getTime() - published.getTime()) / MS_PER_DAY);
	const t = { ...DEFAULT_THRESHOLDS, ...options?.thresholds };
	const verdict: FreshnessVerdict =
		ageDays <= t.current
			? "current"
			: ageDays <= t.recent
				? "recent"
				: ageDays <= t.possiblyStale
					? "possibly_stale"
					: "stale";
	return {
		verdict,
		ageDays,
		publishedIso: published.toISOString().slice(0, 10),
		guidance: guidanceFor(verdict, ageDays),
	};
}

/** Whether a verdict means the agent should actively look for something newer (drives the §5.AC retrieval loop). */
export function shouldSearchForFresher(verdict: FreshnessVerdict): boolean {
	return verdict === "possibly_stale" || verdict === "stale" || verdict === "unknown";
}

/**
 * The explicit POSITIVE form of {@link shouldSearchForFresher}: true when the source is fresh enough to STOP and rely on
 * it. This is the value `retrieval-sufficiency.ts`'s `freshnessSatisfied` expects — exposed by name so a driver writes
 * `freshnessSatisfied: isFreshnessSatisfied(verdict)` rather than the easily-inverted `!shouldSearchForFresher(verdict)`.
 * Invariant: `isFreshnessSatisfied(v) === !shouldSearchForFresher(v)` for every verdict.
 */
export function isFreshnessSatisfied(verdict: FreshnessVerdict): boolean {
	return !shouldSearchForFresher(verdict);
}

/**
 * Project the 5-value {@link FreshnessVerdict} onto the 3-value enum `RetrievedEvidence.freshnessVerdict` stores
 * (`"fresh" | "stale" | "unknown"`). `current`/`recent` ⇒ `"fresh"`; `possibly_stale`/`stale` ⇒ `"stale"`; `unknown` ⇒
 * `"unknown"`. The explicit adapter prevents a driver from guessing where `possibly_stale` maps.
 */
export function toEvidenceFreshnessVerdict(verdict: FreshnessVerdict): "fresh" | "stale" | "unknown" {
	switch (verdict) {
		case "current":
		case "recent":
			return "fresh";
		case "possibly_stale":
		case "stale":
			return "stale";
		default:
			return "unknown";
	}
}
