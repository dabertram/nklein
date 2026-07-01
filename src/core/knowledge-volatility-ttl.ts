/**
 * Knowledge-TTL / topic-volatility policy — the "how long does a fact stay trustable?" gate of the "knows today"
 * lighthouse (todo §5.AC).
 *
 * WHY. §5.AC's `retrieval-freshness.ts` bands a retrieved source purely by its publication AGE against fixed day
 * thresholds ({@link FreshnessThresholdsDays} with defaults current=30 / recent=180 / possiblyStale=365 days). But a
 * *day count is not the same as a shelf life*: a fact about a live metric (a stock price, a leaderboard, breaking news)
 * goes stale in MINUTES, a library's "latest version" in WEEKS, and a settled historical or mathematical fact is
 * effectively EVERGREEN. Feeding one-size-fits-all thresholds means the agent either re-fetches evergreen facts
 * needlessly (wasted egress + tokens) or trusts a fast-moving fact days after it rotted. That freshness module's own
 * header even scopes "different topics" out — so nothing upstream DERIVES the right thresholds. This module is that
 * missing policy: classify a topic's VOLATILITY, then turn the class into (a) a knowledge TTL in days, (b) a re-fetch
 * decision for a cached fact of a given age, and (c) volatility-tuned {@link FreshnessThresholdsDays} that FEED
 * `judgeRetrievedFreshness` so the freshness band is topic-appropriate instead of blanket.
 *
 * The classifier is deterministic and CUE-BASED (not a model): an injected topic/question string is scanned against a
 * small volatility lexicon, or an explicit `class` is honoured verbatim. Higher-volatility cues win over lower ones
 * (an unfetched-latest-version topic that also mentions a live price is treated as `realtime`), so the policy fails
 * SAFE toward fresher (re-fetch sooner) rather than trusting a stale fact. No cue match ⇒ `moderate` (a cautious
 * middle: re-fetch on a sane cadence rather than assuming evergreen).
 *
 * PRIME DIRECTIVE #1 boundary: this DECIDES only — it performs NO retrieval/egress/I/O/model/UI/fs. Every input (the
 * topic text, an optional explicit class, a cached fact's age in days, the current lexicon) is INJECTED as a plain
 * value; it never fetches to "check" a topic and never reads `Date.now()` (callers derive `ageDays` from the §5.AC
 * authoritative now). PURE + deterministic → fully unit-testable. Complements — does not duplicate —
 * `retrieval-freshness.ts` (SOURCE age → band, and it CONSUMES the thresholds this produces),
 * `temporal-claim-consistency.ts` (a dated claim's asserted validity horizon), and `stale-while-revalidate-cache.ts`
 * (an EFFECTFUL runtime cache; this is the pure policy that would tell it *what TTL a knowledge topic deserves*).
 */

import type { FreshnessThresholdsDays } from "./retrieval-freshness";

/**
 * How fast knowledge about a topic decays, coarsest → finest shelf life:
 *   • `realtime` — live/continuously-changing values (price, score, weather-now, "current"/"live" readouts). Minutes.
 *   • `fast`     — actively-moving facts (latest release/version, breaking news, active incidents, prices "today"). Days.
 *   • `moderate` — facts that drift on a normal cadence (docs, APIs, org/roster/roadmap state). Weeks. The safe default.
 *   • `slow`     — facts that change rarely (standards, specifications, well-established best practice). Months.
 *   • `stable`   — settled/evergreen facts (history, definitions, mathematics, physical constants). Effectively forever.
 */
export type VolatilityClass = "realtime" | "fast" | "moderate" | "slow" | "stable";

/** Ordering realtime(0) … stable(4), so "more volatile than" is a numeric comparison and the safe-toward-fresher pick is a `Math.min`. */
const VOLATILITY_ORDER: readonly VolatilityClass[] = ["realtime", "fast", "moderate", "slow", "stable"];

/** Rank of a class in {@link VOLATILITY_ORDER} (0 = most volatile). */
function volatilityRank(cls: VolatilityClass): number {
	return VOLATILITY_ORDER.indexOf(cls);
}

/**
 * Knowledge TTL in whole days per class: how long a fact of this class stays trustable before it should be re-fetched.
 * `realtime` is 0 (any cached age is already suspect — re-fetch), and `stable` is a large sentinel (evergreen; a
 * re-fetch is effectively never forced by age alone). Deliberately coarse; a caller may override per-class.
 */
export const DEFAULT_TTL_DAYS: Readonly<Record<VolatilityClass, number>> = {
	realtime: 0,
	fast: 3,
	moderate: 30,
	slow: 180,
	stable: 3650,
};

/**
 * Volatility-tuned freshness bands per class, shaped for {@link FreshnessThresholdsDays} so the output drops straight
 * into `judgeRetrievedFreshness(source, now, { thresholds })`. Each band scales with the TTL: `current` ≈ the TTL,
 * with `recent`/`possiblyStale` widening from there. `realtime`'s zero-width `current` means anything with a non-zero
 * age already reads past-current — exactly the intent for a live value.
 */
const THRESHOLDS_BY_CLASS: Readonly<Record<VolatilityClass, FreshnessThresholdsDays>> = {
	realtime: { current: 0, recent: 1, possiblyStale: 3 },
	fast: { current: 3, recent: 14, possiblyStale: 45 },
	moderate: { current: 30, recent: 120, possiblyStale: 365 },
	slow: { current: 180, recent: 540, possiblyStale: 1095 },
	stable: { current: 1825, recent: 3650, possiblyStale: 7300 },
};

/** A word-boundary cue mapped to the volatility class its presence implies. Matched case-insensitively against the topic. */
interface VolatilityCue {
	readonly pattern: RegExp;
	readonly cls: VolatilityClass;
	/** Human-readable signal name recorded in {@link TopicVolatility.matchedSignals}. */
	readonly signal: string;
}

/**
 * The built-in volatility lexicon. Order does NOT matter for the verdict (the most-volatile matched cue always wins);
 * it exists only to make `matchedSignals` deterministic. Patterns use `\b…\b` so "priced" doesn't match "price" and
 * "historically" doesn't match "history" — each cue is a whole word/phrase. Callers may pass extra cues.
 */
const DEFAULT_CUES: readonly VolatilityCue[] = [
	// realtime — live, continuously-updating readouts
	{ pattern: /\b(?:live|real[- ]?time|streaming)\b/i, cls: "realtime", signal: "live/real-time" },
	{ pattern: /\b(?:price|prices|quote|ticker|exchange rate|market cap)\b/i, cls: "realtime", signal: "market-price" },
	{ pattern: /\b(?:score|scores|leaderboard|standings|odds)\b/i, cls: "realtime", signal: "live-score" },
	{
		pattern: /\b(?:right now|as we speak|currently trending|weather now)\b/i,
		cls: "realtime",
		signal: "instantaneous",
	},
	// fast — actively moving, days-scale
	{
		pattern: /\b(?:latest|newest|most recent|current) (?:version|release|build)\b/i,
		cls: "fast",
		signal: "latest-version",
	},
	{ pattern: /\b(?:release notes|changelog|patch notes)\b/i, cls: "fast", signal: "release-notes" },
	{ pattern: /\b(?:breaking|just announced|developing|unfolding)\b/i, cls: "fast", signal: "breaking-news" },
	{ pattern: /\b(?:outage|incident|down(?:time)?|status page)\b/i, cls: "fast", signal: "incident-status" },
	{ pattern: /\b(?:today|tonight|this morning|this week)\b/i, cls: "fast", signal: "today-scoped" },
	// slow — rarely changing references
	{ pattern: /\b(?:standard|specification|spec|rfc|iso \d+|protocol)\b/i, cls: "slow", signal: "standard-spec" },
	{ pattern: /\b(?:best practice|convention|guideline|methodology)\b/i, cls: "slow", signal: "established-practice" },
	// stable — settled / evergreen
	{
		pattern: /\b(?:history|historical|founded|invented|discovered|origin of)\b/i,
		cls: "stable",
		signal: "historical",
	},
	{
		pattern: /\b(?:definition|means|theorem|proof|formula|equation|constant)\b/i,
		cls: "stable",
		signal: "definition/math",
	},
	{ pattern: /\b(?:physics|chemistry|biology|geography|capital of)\b/i, cls: "stable", signal: "evergreen-fact" },
];

/** Result of classifying a topic's knowledge volatility. */
export interface TopicVolatility {
	/** The chosen class — the MOST volatile among matched cues, or an explicit override, or `moderate` when nothing matched. */
	volatility: VolatilityClass;
	/** How long a fact about this topic stays trustable before re-fetch, in whole days (from the TTL table). */
	ttlDays: number;
	/** Freshness bands tuned to this class — pass straight to `judgeRetrievedFreshness(..., { thresholds })`. */
	thresholds: FreshnessThresholdsDays;
	/** Distinct cue signals that fired, in lexicon order (deterministic). Empty when classified by override or defaulted. */
	matchedSignals: string[];
	/** How the class was reached: `explicit` (override), `cue` (≥1 signal fired), or `default` (no signal → moderate). */
	basis: "explicit" | "cue" | "default";
	/** A short rail the agent can surface: what shelf life this topic has and when to re-fetch. */
	guidance: string;
}

/** Options for {@link classifyTopicVolatility}. All optional; every value is INJECTED (no I/O). */
export interface ClassifyOptions {
	/** Force this class verbatim (skips cue scanning) — for when the caller already knows the topic's nature. */
	class?: VolatilityClass;
	/** Extra cues appended to the built-in lexicon (e.g. a domain vocabulary). The most-volatile match still wins. */
	extraCues?: readonly VolatilityCue[];
	/** Override the TTL table (partial — unspecified classes keep {@link DEFAULT_TTL_DAYS}). */
	ttlDays?: Partial<Record<VolatilityClass, number>>;
}

function guidanceFor(cls: VolatilityClass, ttlDays: number): string {
	const horizon =
		ttlDays <= 0
			? "always re-fetch (it may already be stale)"
			: ttlDays >= DEFAULT_TTL_DAYS.stable
				? "effectively evergreen — re-fetch is rarely needed"
				: `re-fetch after ~${ttlDays} day${ttlDays === 1 ? "" : "s"}`;
	switch (cls) {
		case "realtime":
			return `Realtime topic (live values) — a fact here goes stale within minutes; ${horizon}.`;
		case "fast":
			return `Fast-moving topic (versions / news / incidents) — trustable for days; ${horizon}.`;
		case "slow":
			return `Slow-moving topic (standards / established practice) — trustable for months; ${horizon}.`;
		case "stable":
			return `Stable / evergreen topic (history / definitions / math) — trustable indefinitely; ${horizon}.`;
		default:
			return `Moderate-volatility topic — trustable for weeks; ${horizon}.`;
	}
}

/**
 * Classify how volatile knowledge about `topic` is, and derive its TTL + freshness thresholds. Deterministic:
 *   1. If `options.class` is given, it wins verbatim (`basis: "explicit"`).
 *   2. Otherwise scan `topic` against the lexicon (+ `extraCues`); the MOST volatile matched class wins
 *      (safe-toward-fresher), recording every distinct signal that fired (`basis: "cue"`).
 *   3. No cue matches ⇒ `moderate` (`basis: "default"`) — a cautious middle, never assume evergreen.
 * The topic is INJECTED as a plain string; nothing is fetched to "check" it.
 */
export function classifyTopicVolatility(topic: string, options?: ClassifyOptions): TopicVolatility {
	const ttlTable = { ...DEFAULT_TTL_DAYS, ...options?.ttlDays };
	const build = (cls: VolatilityClass, matchedSignals: string[], basis: TopicVolatility["basis"]): TopicVolatility => {
		const ttlDays = ttlTable[cls];
		return {
			volatility: cls,
			ttlDays,
			thresholds: THRESHOLDS_BY_CLASS[cls],
			matchedSignals,
			basis,
			guidance: guidanceFor(cls, ttlDays),
		};
	};

	if (options?.class) {
		return build(options.class, [], "explicit");
	}

	const text = topic ?? "";
	const cues = options?.extraCues ? [...DEFAULT_CUES, ...options.extraCues] : DEFAULT_CUES;
	let winner: VolatilityClass | null = null;
	const signals: string[] = [];
	for (const cue of cues) {
		if (cue.pattern.test(text)) {
			if (!signals.includes(cue.signal)) {
				signals.push(cue.signal);
			}
			if (winner === null || volatilityRank(cue.cls) < volatilityRank(winner)) {
				winner = cue.cls;
			}
		}
	}
	if (winner === null) {
		return build("moderate", [], "default");
	}
	return build(winner, signals, "cue");
}

/** The freshness bands for a class on their own — for a caller that already has the class and only wants thresholds. */
export function freshnessThresholdsForVolatility(cls: VolatilityClass): FreshnessThresholdsDays {
	return THRESHOLDS_BY_CLASS[cls];
}

/** The knowledge TTL (whole days before re-fetch) for a class on its own. */
export function knowledgeTtlDays(cls: VolatilityClass): number {
	return DEFAULT_TTL_DAYS[cls];
}

/** Verdict of the re-fetch decider for a cached fact of a known age. */
export interface KnowledgeStaleness {
	/** True when the cached fact is older than its class TTL and should be re-fetched before it is relied on / cited. */
	stale: boolean;
	/** The class TTL used for the decision, in whole days. */
	ttlDays: number;
	/** Whole days of headroom left before the fact goes stale (0 when already stale). */
	remainingDays: number;
	/** A short rail: re-fetch now, or keep using the cached fact (and for roughly how much longer). */
	reason: string;
}

/**
 * Decide whether a CACHED fact must be re-fetched, purely from its age and its topic's volatility class. The age is
 * INJECTED (`ageDays` — a caller derives it from the §5.AC authoritative now minus the fact's fetch/measure date);
 * this function never reads a clock. `realtime` (TTL 0) is stale at any non-zero age; a negative/zero age is never
 * stale (a fact fetched "now" or clock-skewed-ahead is current). Ties (age exactly == TTL) are NOT stale — the fact
 * is trustable through the end of its TTL day.
 */
export function isKnowledgeStale(input: {
	volatility: VolatilityClass;
	ageDays: number;
	ttlDays?: number;
}): KnowledgeStaleness {
	const ttlDays = input.ttlDays ?? DEFAULT_TTL_DAYS[input.volatility];
	const age = Number.isFinite(input.ageDays) ? Math.max(0, Math.round(input.ageDays)) : 0;
	const stale = age > ttlDays;
	const remainingDays = stale ? 0 : ttlDays - age;
	const reason = stale
		? `Cached ${input.volatility} knowledge is ~${age} day${age === 1 ? "" : "s"} old, past its ~${ttlDays}-day TTL — re-fetch before relying on it.`
		: ttlDays >= DEFAULT_TTL_DAYS.stable
			? `Cached ${input.volatility} knowledge is effectively evergreen — safe to reuse without re-fetching.`
			: `Cached ${input.volatility} knowledge is ~${age} day${age === 1 ? "" : "s"} old, within its ~${ttlDays}-day TTL — reuse it (~${remainingDays} day${remainingDays === 1 ? "" : "s"} of headroom).`;
	return { stale, ttlDays, remainingDays, reason };
}

/** A cached fact + its topic, for the one-call refresh planner. */
export interface KnowledgeRefreshQuery {
	/** The topic/question the cached fact answers — classified for volatility when no explicit `class` is given. */
	topic: string;
	/** Age of the cached fact in whole days (authoritative-now minus fetch date), INJECTED. Absent ⇒ treated as unknown → re-fetch. */
	ageDays?: number;
}

/** Everything a retrieval loop needs to decide whether to reuse a cached fact or search again. */
export interface KnowledgeRefreshPlan extends TopicVolatility {
	/** Whether the cached fact should be re-fetched (true also when `ageDays` was absent — freshness unknown). */
	refetch: boolean;
	/** Days of headroom before the cached fact goes stale (0 when re-fetching or when age was unknown). */
	remainingDays: number;
	/** A combined rail: the topic's shelf life AND the reuse/re-fetch decision for this specific cached fact. */
	decisionReason: string;
}

/**
 * One call that combines {@link classifyTopicVolatility} with {@link isKnowledgeStale}: classify the topic, then decide
 * whether the cached fact of the given age must be re-fetched. This is the policy a §5.AC retrieval loop consults
 * before spending an online search — reuse a still-trustable cached fact, or re-fetch a rotted one. When `ageDays` is
 * absent the fact's freshness is unknown, so it fails safe to `refetch: true`. DECIDES only — no fetch happens here.
 */
export function planKnowledgeRefresh(query: KnowledgeRefreshQuery, options?: ClassifyOptions): KnowledgeRefreshPlan {
	const classified = classifyTopicVolatility(query.topic, options);
	if (query.ageDays === undefined || query.ageDays === null || !Number.isFinite(query.ageDays)) {
		return {
			...classified,
			refetch: true,
			remainingDays: 0,
			decisionReason: `${classified.guidance} The cached fact has no known age — re-fetch to be safe.`,
		};
	}
	const staleness = isKnowledgeStale({
		volatility: classified.volatility,
		ageDays: query.ageDays,
		ttlDays: classified.ttlDays,
	});
	return {
		...classified,
		refetch: staleness.stale,
		remainingDays: staleness.remainingDays,
		decisionReason: `${classified.guidance} ${staleness.reason}`,
	};
}
