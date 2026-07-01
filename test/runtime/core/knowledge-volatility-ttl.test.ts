import { describe, expect, it } from "vitest";
import {
	classifyTopicVolatility,
	DEFAULT_TTL_DAYS,
	freshnessThresholdsForVolatility,
	isKnowledgeStale,
	knowledgeTtlDays,
	planKnowledgeRefresh,
	type VolatilityClass,
} from "../../../src/core/knowledge-volatility-ttl";
import { judgeRetrievedFreshness } from "../../../src/core/retrieval-freshness";

describe("classifyTopicVolatility — cue-based", () => {
	it("classifies realtime topics (live values / prices / scores)", () => {
		expect(classifyTopicVolatility("what is the live price of AAPL stock?").volatility).toBe("realtime");
		expect(classifyTopicVolatility("current NBA leaderboard standings").volatility).toBe("realtime");
		expect(classifyTopicVolatility("bitcoin exchange rate right now").volatility).toBe("realtime");
	});

	it("classifies fast-moving topics (latest version / breaking news / incidents / today)", () => {
		expect(classifyTopicVolatility("what is the latest version of Node.js?").volatility).toBe("fast");
		expect(classifyTopicVolatility("breaking news about the merger").volatility).toBe("fast");
		expect(classifyTopicVolatility("is the API status page showing an outage?").volatility).toBe("fast");
		expect(classifyTopicVolatility("what happened today in the release notes?").volatility).toBe("fast");
	});

	it("classifies slow-moving topics (standards / established practice)", () => {
		expect(classifyTopicVolatility("what does the HTTP specification say about caching?").volatility).toBe("slow");
		expect(classifyTopicVolatility("best practice for structuring a monorepo").volatility).toBe("slow");
		expect(classifyTopicVolatility("RFC 9110 semantics").volatility).toBe("slow");
	});

	it("classifies stable / evergreen topics (history / definitions / math)", () => {
		expect(classifyTopicVolatility("who invented the printing press?").volatility).toBe("stable");
		expect(classifyTopicVolatility("what is the definition of a monoid?").volatility).toBe("stable");
		expect(classifyTopicVolatility("the Pythagorean theorem proof").volatility).toBe("stable");
		expect(classifyTopicVolatility("what is the capital of France?").volatility).toBe("stable");
	});

	it("defaults to moderate when no cue matches (basis=default, no signals)", () => {
		const v = classifyTopicVolatility("how do I configure the widget layout?");
		expect(v.volatility).toBe("moderate");
		expect(v.basis).toBe("default");
		expect(v.matchedSignals).toEqual([]);
	});

	it("picks the MOST volatile class when cues of different classes both fire (safe-toward-fresher)", () => {
		// mentions both a historical framing (stable) AND a live price (realtime) → realtime wins
		const v = classifyTopicVolatility("history of the live stock price of this company");
		expect(v.volatility).toBe("realtime");
		expect(v.basis).toBe("cue");
		// both signals are recorded
		expect(v.matchedSignals).toContain("historical");
		expect(v.matchedSignals).toContain("market-price");
	});

	it("records distinct matched signals in lexicon order, deduped", () => {
		const v = classifyTopicVolatility("live price and live score readout");
		// "live/real-time", "market-price", "live-score" — each once
		expect(v.matchedSignals).toEqual(["live/real-time", "market-price", "live-score"]);
	});

	it("uses word boundaries — 'priced' does not fire the 'price' cue, 'historically' does fire 'history'? no", () => {
		// "priced" should NOT match \bprice\b
		expect(classifyTopicVolatility("how are the seats priced in the venue layout?").volatility).toBe("moderate");
		// "historian" should NOT match \bhistory\b / \bhistorical\b
		expect(classifyTopicVolatility("who is the team historian for the project?").volatility).toBe("moderate");
	});

	it("is case-insensitive", () => {
		expect(classifyTopicVolatility("LIVE PRICE OF GOLD").volatility).toBe("realtime");
		expect(classifyTopicVolatility("Latest Version Of Python").volatility).toBe("fast");
	});

	it("handles an empty topic gracefully → moderate default", () => {
		const v = classifyTopicVolatility("");
		expect(v.volatility).toBe("moderate");
		expect(v.basis).toBe("default");
	});
});

describe("classifyTopicVolatility — options", () => {
	it("honours an explicit class verbatim (basis=explicit, skips cue scanning)", () => {
		// topic text says 'live price' (would be realtime) but the explicit override wins
		const v = classifyTopicVolatility("live price of AAPL", { class: "stable" });
		expect(v.volatility).toBe("stable");
		expect(v.basis).toBe("explicit");
		expect(v.matchedSignals).toEqual([]);
	});

	it("accepts extra cues appended to the lexicon; most-volatile still wins", () => {
		const v = classifyTopicVolatility("the foobar reading", {
			extraCues: [{ pattern: /\bfoobar\b/i, cls: "realtime", signal: "custom-foobar" }],
		});
		expect(v.volatility).toBe("realtime");
		expect(v.matchedSignals).toContain("custom-foobar");
	});

	it("applies a partial TTL override; unspecified classes keep defaults", () => {
		const v = classifyTopicVolatility("what is the latest version of Rust?", { ttlDays: { fast: 1 } });
		expect(v.volatility).toBe("fast");
		expect(v.ttlDays).toBe(1);
		// slow untouched
		expect(classifyTopicVolatility("the ISO 8601 standard", { ttlDays: { fast: 1 } }).ttlDays).toBe(
			DEFAULT_TTL_DAYS.slow,
		);
	});
});

describe("TTL + thresholds tables", () => {
	it("orders TTLs realtime < fast < moderate < slow < stable", () => {
		const order: VolatilityClass[] = ["realtime", "fast", "moderate", "slow", "stable"];
		for (let i = 1; i < order.length; i++) {
			expect(knowledgeTtlDays(order[i])).toBeGreaterThan(knowledgeTtlDays(order[i - 1]));
		}
	});

	it("realtime TTL is 0 and stable TTL is the large evergreen sentinel", () => {
		expect(knowledgeTtlDays("realtime")).toBe(0);
		expect(knowledgeTtlDays("stable")).toBe(DEFAULT_TTL_DAYS.stable);
		expect(DEFAULT_TTL_DAYS.stable).toBeGreaterThanOrEqual(3650);
	});

	it("freshnessThresholdsForVolatility returns monotonically widening bands per class", () => {
		for (const cls of ["realtime", "fast", "moderate", "slow", "stable"] as VolatilityClass[]) {
			const t = freshnessThresholdsForVolatility(cls);
			expect(t.current).toBeLessThanOrEqual(t.recent);
			expect(t.recent).toBeLessThan(t.possiblyStale);
		}
	});

	it("realtime bands treat any non-zero age as past-current", () => {
		expect(freshnessThresholdsForVolatility("realtime").current).toBe(0);
	});
});

describe("thresholds FEED judgeRetrievedFreshness (§5.AC integration)", () => {
	const now = new Date("2026-06-27T00:00:00.000Z");
	const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

	it("a 5-day-old source is 'current' for a moderate topic but 'stale' for a realtime topic", () => {
		const moderate = judgeRetrievedFreshness({ publishedAt: daysAgo(5) }, now, {
			thresholds: freshnessThresholdsForVolatility("moderate"),
		});
		const realtime = judgeRetrievedFreshness({ publishedAt: daysAgo(5) }, now, {
			thresholds: freshnessThresholdsForVolatility("realtime"),
		});
		expect(moderate.verdict).toBe("current");
		expect(realtime.verdict).toBe("stale");
	});

	it("a 2-year-old source is 'stale' for moderate but 'current' for a stable topic", () => {
		const moderate = judgeRetrievedFreshness({ publishedAt: daysAgo(730) }, now, {
			thresholds: freshnessThresholdsForVolatility("moderate"),
		});
		const stable = judgeRetrievedFreshness({ publishedAt: daysAgo(730) }, now, {
			thresholds: freshnessThresholdsForVolatility("stable"),
		});
		expect(moderate.verdict).toBe("stale");
		expect(stable.verdict).toBe("current");
	});

	it("the classifier's thresholds field is the same object judgeRetrievedFreshness expects", () => {
		const v = classifyTopicVolatility("latest version of the SDK");
		const judged = judgeRetrievedFreshness({ publishedAt: daysAgo(10) }, now, { thresholds: v.thresholds });
		// fast: current=3, recent=14 → 10 days → recent
		expect(judged.verdict).toBe("recent");
	});
});

describe("isKnowledgeStale — re-fetch decider", () => {
	it("a fact within its TTL is not stale, with headroom reported", () => {
		const r = isKnowledgeStale({ volatility: "moderate", ageDays: 10 });
		expect(r.stale).toBe(false);
		expect(r.ttlDays).toBe(DEFAULT_TTL_DAYS.moderate);
		expect(r.remainingDays).toBe(DEFAULT_TTL_DAYS.moderate - 10);
	});

	it("a fact older than its TTL is stale, with zero headroom", () => {
		const r = isKnowledgeStale({ volatility: "fast", ageDays: 10 });
		expect(r.stale).toBe(true);
		expect(r.remainingDays).toBe(0);
	});

	it("age exactly equal to the TTL is NOT stale (trustable through the end of the TTL day)", () => {
		expect(isKnowledgeStale({ volatility: "fast", ageDays: DEFAULT_TTL_DAYS.fast }).stale).toBe(false);
		expect(isKnowledgeStale({ volatility: "fast", ageDays: DEFAULT_TTL_DAYS.fast + 1 }).stale).toBe(true);
	});

	it("realtime is stale at any non-zero age, but a just-fetched (age 0) fact is current", () => {
		expect(isKnowledgeStale({ volatility: "realtime", ageDays: 1 }).stale).toBe(true);
		expect(isKnowledgeStale({ volatility: "realtime", ageDays: 0 }).stale).toBe(false);
	});

	it("stable knowledge is not stale even after years, with an evergreen reason", () => {
		const r = isKnowledgeStale({ volatility: "stable", ageDays: 1000 });
		expect(r.stale).toBe(false);
		expect(r.reason).toMatch(/evergreen/i);
	});

	it("clamps a negative/skewed-ahead age to 0 (a fact fetched 'now' is current)", () => {
		expect(isKnowledgeStale({ volatility: "fast", ageDays: -5 }).stale).toBe(false);
	});

	it("a non-finite age is treated as 0 (not stale by age math) rather than NaN-propagating", () => {
		expect(isKnowledgeStale({ volatility: "moderate", ageDays: Number.NaN }).stale).toBe(false);
	});

	it("honours a caller-provided ttlDays override", () => {
		expect(isKnowledgeStale({ volatility: "stable", ageDays: 5, ttlDays: 3 }).stale).toBe(true);
	});
});

describe("planKnowledgeRefresh — classify + decide in one call", () => {
	it("reuses a still-fresh cached fact for a moderate topic", () => {
		const plan = planKnowledgeRefresh({ topic: "how the config resolver works", ageDays: 5 });
		expect(plan.volatility).toBe("moderate");
		expect(plan.refetch).toBe(false);
		expect(plan.remainingDays).toBeGreaterThan(0);
	});

	it("re-fetches a cached fact that has rotted past its class TTL", () => {
		const plan = planKnowledgeRefresh({ topic: "latest version of the framework", ageDays: 30 });
		expect(plan.volatility).toBe("fast");
		expect(plan.refetch).toBe(true);
		expect(plan.remainingDays).toBe(0);
	});

	it("re-fetches a realtime topic even for a 1-day-old cached fact", () => {
		const plan = planKnowledgeRefresh({ topic: "live price of gold", ageDays: 1 });
		expect(plan.volatility).toBe("realtime");
		expect(plan.refetch).toBe(true);
	});

	it("keeps an evergreen fact without re-fetching", () => {
		const plan = planKnowledgeRefresh({ topic: "who discovered penicillin", ageDays: 2000 });
		expect(plan.volatility).toBe("stable");
		expect(plan.refetch).toBe(false);
	});

	it("fails safe to refetch when the cached fact has no known age", () => {
		const plan = planKnowledgeRefresh({ topic: "who discovered penicillin" });
		expect(plan.volatility).toBe("stable");
		expect(plan.refetch).toBe(true);
		expect(plan.decisionReason).toMatch(/no known age/i);
	});

	it("carries the classification through (thresholds, guidance, signals) for downstream freshness judging", () => {
		const plan = planKnowledgeRefresh({ topic: "latest release notes for the driver", ageDays: 1 });
		expect(plan.thresholds).toEqual(freshnessThresholdsForVolatility("fast"));
		expect(plan.guidance).toMatch(/fast-moving/i);
		expect(plan.matchedSignals.length).toBeGreaterThan(0);
		expect(plan.decisionReason).toContain(plan.guidance);
	});

	it("respects an explicit class override end-to-end", () => {
		const plan = planKnowledgeRefresh({ topic: "live price of gold", ageDays: 400 }, { class: "stable" });
		expect(plan.volatility).toBe("stable");
		expect(plan.basis).toBe("explicit");
		expect(plan.refetch).toBe(false);
	});
});
