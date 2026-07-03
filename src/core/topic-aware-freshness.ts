/**
 * Topic-aware freshness — the composition that makes source-age judgment SHELF-LIFE aware (todo §5.AC, the "knows
 * today" lighthouse).
 *
 * WHY. `retrieval-freshness.ts`'s {@link judgeRetrievedFreshness} bands a retrieved source purely by its publication
 * age against WHATEVER thresholds it is handed — but on its own it has no idea what thresholds a given topic deserves,
 * so a caller either passes the one-size-fits-all defaults (a 5-day-old stock price wrongly reads "current") or has to
 * hand-derive per-topic bands every time. `knowledge-volatility-ttl.ts` already knows how to turn a topic string into a
 * volatility class and the matching {@link FreshnessThresholdsDays} ({@link classifyTopicVolatility} /
 * {@link freshnessThresholdsForVolatility}) — but nothing WIRES the two together. This module is that one wire: classify
 * the topic (or honour an explicit class override), derive the volatility-tuned thresholds, and feed them straight into
 * the age-banding judge. The payoff is the whole point of the lighthouse — the SAME 5-day-old source reads `current` for
 * a moderate/slow topic yet `stale` for a realtime/fast one, purely from what the question is ABOUT, not from a blanket
 * day count.
 *
 * PRIME DIRECTIVE #1 boundary: composes only PURE cores by import and adds no capability of its own — no retrieval /
 * egress / I/O / model / UI / fs. Every input is INJECTED as a plain value; the `now` clock is passed in (never
 * `Date.now()`), inheriting the clock-freedom of both composed cores. Deterministic → fully unit-testable.
 */

import {
	classifyTopicVolatility,
	freshnessThresholdsForVolatility,
	type VolatilityClass,
} from "./knowledge-volatility-ttl";
import { type FreshnessJudgment, judgeRetrievedFreshness } from "./retrieval-freshness";

/** A dated (or undated) source whose freshness is being judged against a topic's volatility. */
export interface TopicAwareFreshnessInput {
	/** The topic/question the source answers — classified for volatility unless {@link TopicAwareFreshnessOptions.class} overrides. */
	topic: string;
	/** The source's publication/update date in any form {@link judgeRetrievedFreshness} tolerates. Absent/unparseable ⇒ `unknown`. */
	publishedAt?: Date | string | number | null;
	/** The authoritative current time (§5.AC temporal core), INJECTED so this stays clock-free and deterministic. */
	now: Date;
}

/** Options for {@link assessTopicAwareFreshness}. */
export interface TopicAwareFreshnessOptions {
	/** Force this volatility class verbatim, skipping topic classification — for when the caller already knows the topic's nature. */
	class?: VolatilityClass;
}

/** Result of a topic-aware freshness assessment: the volatility that drove the thresholds, plus the age-banded verdict. */
export interface TopicAwareFreshness {
	/** The volatility class used to derive the freshness thresholds — from the explicit override, or classified from `topic`. */
	volatility: VolatilityClass;
	/** The full age-banding judgment from {@link judgeRetrievedFreshness}, computed against the volatility-tuned thresholds. */
	freshness: FreshnessJudgment;
}

/**
 * Judge a source's freshness through the lens of its TOPIC's volatility. Steps, all deterministic:
 *   1. Resolve the volatility class — `options.class` wins verbatim when given, else classify `input.topic`.
 *   2. Derive the volatility-tuned {@link FreshnessThresholdsDays} for that class.
 *   3. Band the source's publication age against those thresholds via {@link judgeRetrievedFreshness}, using the injected
 *      `now`.
 *
 * The consequence a caller relies on: identical source ages produce DIFFERENT verdicts across topics — a realtime price
 * goes `stale` in days while a moderate doc of the same age stays `current`. An undated/unparseable source is `unknown`
 * regardless of class (there is no age to band). Composes existing pure cores by import only; adds no I/O or clock.
 */
export function assessTopicAwareFreshness(
	input: TopicAwareFreshnessInput,
	options?: TopicAwareFreshnessOptions,
): TopicAwareFreshness {
	const volatility = options?.class ?? classifyTopicVolatility(input.topic).volatility;
	const thresholds = freshnessThresholdsForVolatility(volatility);
	const freshness = judgeRetrievedFreshness({ publishedAt: input.publishedAt }, input.now, { thresholds });
	return { volatility, freshness };
}
