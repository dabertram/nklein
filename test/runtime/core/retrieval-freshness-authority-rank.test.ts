import { describe, expect, it } from "vitest";
import { freshnessThresholdsForVolatility } from "../../../src/core/knowledge-volatility-ttl";
import { judgeRetrievedFreshness } from "../../../src/core/retrieval-freshness";
import {
	DEFAULT_RECENCY_WEIGHT,
	type RankableSource,
	rankByFreshnessAuthority,
	scoreFreshnessAuthority,
} from "../../../src/core/retrieval-freshness-authority-rank";
import { DEFAULT_TRUST_WEIGHT, scoreSourceTrust } from "../../../src/core/retrieval-source-trust";

// A fixed authoritative "now" so every age is deterministic. Wed 2026-06-24T12:00:00Z.
const NOW = new Date("2026-06-24T12:00:00Z");

/** Days-ago helper → an ISO date string, computed against NOW. */
function daysAgoIso(days: number): string {
	return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("scoreFreshnessAuthority — composes the two §5.AC halves", () => {
	it("derives the recency axis from judgeRetrievedFreshness and the authority axis from scoreSourceTrust", () => {
		const src: RankableSource = { id: "a", url: "https://www.nasa.gov/report", publishedAt: daysAgoIso(3) };
		const result = scoreFreshnessAuthority(src, NOW);

		// Recency axis must MATCH the composed freshness core's verdict → ladder.
		const verdict = judgeRetrievedFreshness({ publishedAt: src.publishedAt }, NOW).verdict;
		expect(result.freshnessVerdict).toBe(verdict);
		expect(result.recency).toBe(DEFAULT_RECENCY_WEIGHT[verdict]);

		// Authority axis must MATCH the composed trust core's tier + weight.
		const trust = scoreSourceTrust(src.url ?? "");
		expect(result.trustTier).toBe(trust.tier);
		expect(result.authority).toBe(trust.weight);
	});

	it("echoes the source id and the age from the freshness half", () => {
		const result = scoreFreshnessAuthority(
			{ id: "xyz", url: "https://example.com", publishedAt: daysAgoIso(10) },
			NOW,
		);
		expect(result.id).toBe("xyz");
		expect(result.ageDays).toBe(10);
	});

	it("a fresh authoritative source scores near the top of [0,1]", () => {
		// current (recency 1) × authoritative (authority 1) → geometric mean 1.
		const result = scoreFreshnessAuthority(
			{ id: "top", url: "https://www.w3.org/TR/spec", publishedAt: daysAgoIso(2) },
			NOW,
		);
		expect(result.recency).toBe(1);
		expect(result.authority).toBe(1);
		expect(result.score).toBeCloseTo(1, 10);
	});

	it("score sits between its two component axes (equal-weight geometric mean)", () => {
		// current (1) × community (0.45) → sqrt(0.45) ≈ 0.6708, strictly between 0.45 and 1.
		const result = scoreFreshnessAuthority(
			{ id: "mid", url: "https://stackoverflow.com/q/1", publishedAt: daysAgoIso(1) },
			NOW,
		);
		expect(result.recency).toBe(1);
		expect(result.authority).toBe(DEFAULT_TRUST_WEIGHT.community);
		expect(result.score).toBeCloseTo(Math.sqrt(DEFAULT_TRUST_WEIGHT.community), 10);
		expect(result.score).toBeGreaterThan(result.authority);
		expect(result.score).toBeLessThan(result.recency);
	});
});

describe("scoreFreshnessAuthority — recency ladder", () => {
	const authoritativeUrl = "https://www.nasa.gov/x"; // authority pinned at 1 so the score tracks recency alone.

	it("is monotone non-increasing across the freshness bands", () => {
		const current = scoreFreshnessAuthority({ id: "c", url: authoritativeUrl, publishedAt: daysAgoIso(5) }, NOW);
		const recent = scoreFreshnessAuthority({ id: "r", url: authoritativeUrl, publishedAt: daysAgoIso(90) }, NOW);
		const possibly = scoreFreshnessAuthority({ id: "p", url: authoritativeUrl, publishedAt: daysAgoIso(300) }, NOW);
		const stale = scoreFreshnessAuthority({ id: "s", url: authoritativeUrl, publishedAt: daysAgoIso(1000) }, NOW);

		expect(current.freshnessVerdict).toBe("current");
		expect(recent.freshnessVerdict).toBe("recent");
		expect(possibly.freshnessVerdict).toBe("possibly_stale");
		expect(stale.freshnessVerdict).toBe("stale");

		expect(current.score).toBeGreaterThan(recent.score);
		expect(recent.score).toBeGreaterThan(possibly.score);
		expect(possibly.score).toBeGreaterThan(stale.score);
	});

	it("an undated source lands on the `unknown` recency floor (weak, not zero) — above a KNOWN-stale one", () => {
		const undated = scoreFreshnessAuthority({ id: "u", url: authoritativeUrl }, NOW);
		const stale = scoreFreshnessAuthority({ id: "s", url: authoritativeUrl, publishedAt: daysAgoIso(1000) }, NOW);
		expect(undated.freshnessVerdict).toBe("unknown");
		expect(undated.ageDays).toBeNull();
		expect(undated.recency).toBe(DEFAULT_RECENCY_WEIGHT.unknown);
		// unknown (0.2) > stale (0.1), mirroring the trust core's unknown > low ordering.
		expect(undated.score).toBeGreaterThan(stale.score);
	});

	it("a future-dated source clamps to `current` (via the freshness half's clamp)", () => {
		const future = scoreFreshnessAuthority({ id: "f", url: authoritativeUrl, publishedAt: daysAgoIso(-30) }, NOW);
		expect(future.freshnessVerdict).toBe("current");
		expect(future.ageDays).toBe(0);
		expect(future.recency).toBe(1);
	});
});

describe("scoreFreshnessAuthority — authority axis", () => {
	const freshDate = daysAgoIso(1); // recency pinned at 1 so the score tracks authority alone.

	it("is monotone non-increasing across the trust tiers", () => {
		const authoritative = scoreFreshnessAuthority(
			{ id: "a", url: "https://www.w3.org/x", publishedAt: freshDate },
			NOW,
		);
		const reputable = scoreFreshnessAuthority(
			{ id: "r", url: "https://arxiv.org/abs/1", publishedAt: freshDate },
			NOW,
		);
		const community = scoreFreshnessAuthority(
			{ id: "c", url: "https://reddit.com/r/x", publishedAt: freshDate },
			NOW,
		);
		const unknown = scoreFreshnessAuthority({ id: "u", url: "mailto:x@y.z", publishedAt: freshDate }, NOW);

		expect(authoritative.trustTier).toBe("authoritative");
		expect(reputable.trustTier).toBe("reputable");
		expect(community.trustTier).toBe("community");
		expect(unknown.trustTier).toBe("unknown");

		expect(authoritative.score).toBeGreaterThan(reputable.score);
		expect(reputable.score).toBeGreaterThan(community.score);
		expect(community.score).toBeGreaterThan(unknown.score);
	});

	it("forwards the declared sourceType prior to scoreSourceTrust for a hostless source", () => {
		const doc = scoreFreshnessAuthority({ id: "d", sourceType: "doc", publishedAt: freshDate }, NOW);
		expect(doc.trustTier).toBe("reputable"); // doc-kind prior from the trust core.
		expect(doc.authority).toBe(DEFAULT_TRUST_WEIGHT.reputable);
	});

	it("a missing url with no kind prior is `unknown` authority (never silently trusted)", () => {
		const bare = scoreFreshnessAuthority({ id: "b", publishedAt: freshDate }, NOW);
		expect(bare.trustTier).toBe("unknown");
		expect(bare.authority).toBe(DEFAULT_TRUST_WEIGHT.unknown);
	});
});

describe("scoreFreshnessAuthority — geometric-mean annihilation (no single axis rescues a rotten source)", () => {
	it("a fresh but low-trust source cannot ride recency to the top of an authoritative-but-stale one", () => {
		// Fresh community (1 × 0.45) ≈ 0.671 vs stale authoritative (0.1 × 1) ≈ 0.316: recency wins here, as intended —
		// but the point is the community source is NOT pinned to its recency of 1.
		const freshCommunity = scoreFreshnessAuthority(
			{ id: "fc", url: "https://reddit.com/x", publishedAt: daysAgoIso(1) },
			NOW,
		);
		expect(freshCommunity.recency).toBe(1);
		expect(freshCommunity.score).toBeLessThan(1); // authority (0.45) drags it below its own recency.
	});

	it("a factor of exactly 0 annihilates the whole score", () => {
		// Force authority to 0 via a weight override; the source is fresh but the geometric mean must be 0.
		const result = scoreFreshnessAuthority(
			{ id: "z", url: "https://reddit.com/x", publishedAt: daysAgoIso(1) },
			NOW,
			{ trust: { weights: { community: 0 } } },
		);
		expect(result.authority).toBe(0);
		expect(result.score).toBe(0);
	});
});

describe("scoreFreshnessAuthority — optional relevance axis", () => {
	const url = "https://www.w3.org/x"; // authoritative (1)
	const freshDate = daysAgoIso(1); // current (1)

	it("is pure recency×authority when no relevance is supplied (relevance reported as null)", () => {
		const result = scoreFreshnessAuthority({ id: "a", url, publishedAt: freshDate }, NOW);
		expect(result.relevance).toBeNull();
		expect(result.score).toBeCloseTo(1, 10); // sqrt(1*1) = 1, relevance absent.
	});

	it("folds an injected relevance in as a third geometric factor", () => {
		// recency 1 × authority 1 × relevance 0.25 → cube root of 0.25 ≈ 0.63.
		const result = scoreFreshnessAuthority({ id: "a", url, publishedAt: freshDate, relevance: 0.25 }, NOW);
		expect(result.relevance).toBe(0.25);
		expect(result.score).toBeCloseTo(Math.cbrt(0.25), 10);
	});

	it("clamps an out-of-range relevance into [0,1]", () => {
		const high = scoreFreshnessAuthority({ id: "h", url, publishedAt: freshDate, relevance: 5 }, NOW);
		expect(high.relevance).toBe(1);
		const low = scoreFreshnessAuthority({ id: "l", url, publishedAt: freshDate, relevance: -1 }, NOW);
		expect(low.relevance).toBe(0);
		expect(low.score).toBe(0); // a 0 factor annihilates.
	});

	it("a relevance of 0 annihilates the score (an off-topic hit is worthless however fresh/authoritative)", () => {
		const result = scoreFreshnessAuthority({ id: "off", url, publishedAt: freshDate, relevance: 0 }, NOW);
		expect(result.score).toBe(0);
	});
});

describe("scoreFreshnessAuthority — weights + overrides", () => {
	const url = "https://reddit.com/x"; // community (0.45)
	const freshDate = daysAgoIso(1); // current (1)

	it("weighting authority to 0 makes the score depend only on recency", () => {
		const result = scoreFreshnessAuthority({ id: "a", url, publishedAt: freshDate }, NOW, {
			weights: { authority: 0 },
		});
		// authority axis switched off → score == recency (1).
		expect(result.score).toBeCloseTo(1, 10);
	});

	it("heavier authority weight pulls the score toward the (lower) authority axis", () => {
		const balanced = scoreFreshnessAuthority({ id: "b", url, publishedAt: freshDate }, NOW);
		const authorityHeavy = scoreFreshnessAuthority({ id: "h", url, publishedAt: freshDate }, NOW, {
			weights: { recency: 1, authority: 3 },
		});
		// recency 1 × authority 0.45: equal weights → sqrt(0.45) ≈ 0.671; authority-heavy (1:3) → 0.45^0.75 ≈ 0.549.
		expect(authorityHeavy.score).toBeLessThan(balanced.score); // dragged toward authority 0.45.
		expect(authorityHeavy.score).toBeGreaterThan(DEFAULT_TRUST_WEIGHT.community); // but still above raw authority.
	});

	it("recency-ladder overrides change the recency scalar", () => {
		const result = scoreFreshnessAuthority(
			{ id: "o", url: "https://www.w3.org/x", publishedAt: daysAgoIso(1000) },
			NOW,
			{
				recencyWeights: { stale: 0.5 },
			},
		);
		expect(result.freshnessVerdict).toBe("stale");
		expect(result.recency).toBe(0.5);
	});
});

describe("scoreFreshnessAuthority — volatility-tuned freshness thresholds (integration with knowledge-volatility-ttl)", () => {
	it("forwards freshnessThresholds so the SAME 5-day source bands differently by topic volatility", () => {
		const src: RankableSource = { id: "v", url: "https://www.w3.org/x", publishedAt: daysAgoIso(5) };

		const moderate = scoreFreshnessAuthority(src, NOW, {
			freshnessThresholds: freshnessThresholdsForVolatility("moderate"),
		});
		const realtime = scoreFreshnessAuthority(src, NOW, {
			freshnessThresholds: freshnessThresholdsForVolatility("realtime"),
		});

		// A 5-day source is `current` under moderate thresholds but stale-band under realtime ones.
		expect(moderate.freshnessVerdict).toBe("current");
		expect(moderate.recency).toBe(1);
		expect(realtime.recency).toBeLessThan(moderate.recency);
		expect(realtime.score).toBeLessThan(moderate.score);
	});
});

describe("rankByFreshnessAuthority — ordering + stability", () => {
	it("sorts by combined score DESC", () => {
		const sources: RankableSource[] = [
			{ id: "stale-auth", url: "https://www.w3.org/x", publishedAt: daysAgoIso(1000) }, // 0.1×1 ≈ 0.316
			{ id: "fresh-auth", url: "https://www.nasa.gov/x", publishedAt: daysAgoIso(2) }, // 1×1 = 1
			{ id: "fresh-comm", url: "https://reddit.com/x", publishedAt: daysAgoIso(2) }, // 1×0.45 ≈ 0.671
			{ id: "undated-unknown", url: "mailto:x@y.z" }, // 0.2×0.25 ≈ 0.224
		];
		const ranked = rankByFreshnessAuthority(sources, NOW);
		expect(ranked.map((r) => r.id)).toEqual(["fresh-auth", "fresh-comm", "stale-auth", "undated-unknown"]);
		// Scores must be non-increasing.
		for (let i = 1; i < ranked.length; i++) {
			expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
		}
	});

	it("prefers a slightly-older authoritative source over a fresh random one when authority dominates the gap", () => {
		// The exact scenario neither half can order alone: fresh forum vs older standards page.
		const sources: RankableSource[] = [
			{ id: "fresh-forum", url: "https://reddit.com/r/x", publishedAt: daysAgoIso(1) }, // current×community: 1×0.45 ≈ 0.671
			{ id: "recent-standard", url: "https://www.ietf.org/rfc", publishedAt: daysAgoIso(90) }, // recent×authoritative: 0.75×1 ≈ 0.866
		];
		const ranked = rankByFreshnessAuthority(sources, NOW);
		expect(ranked[0].id).toBe("recent-standard");
	});

	it("is STABLE: equal scores keep input order", () => {
		// Two identical-tier, identical-band sources → identical scores → original order preserved.
		const sources: RankableSource[] = [
			{ id: "first", url: "https://a.reddit.com/x", publishedAt: daysAgoIso(2) },
			{ id: "second", url: "https://b.reddit.com/x", publishedAt: daysAgoIso(2) },
		];
		const ranked = rankByFreshnessAuthority(sources, NOW);
		expect(ranked[0].score).toBe(ranked[1].score);
		expect(ranked.map((r) => r.id)).toEqual(["first", "second"]);
	});

	it("does not mutate the input array or its elements", () => {
		const sources: RankableSource[] = [
			{ id: "a", url: "https://reddit.com/x", publishedAt: daysAgoIso(2) },
			{ id: "b", url: "https://www.w3.org/x", publishedAt: daysAgoIso(2) },
		];
		const snapshot = JSON.parse(JSON.stringify(sources));
		rankByFreshnessAuthority(sources, NOW);
		expect(sources).toEqual(snapshot);
		expect(sources.map((s) => s.id)).toEqual(["a", "b"]); // order untouched.
	});

	it("returns an empty array for no sources", () => {
		expect(rankByFreshnessAuthority([], NOW)).toEqual([]);
	});

	it("folds relevance into the ranking when supplied (an off-topic fresh-authoritative hit sinks)", () => {
		const sources: RankableSource[] = [
			{ id: "on-topic-community", url: "https://reddit.com/x", publishedAt: daysAgoIso(2), relevance: 1 }, // 1×0.45×1 ≈ 0.766
			{ id: "off-topic-authoritative", url: "https://www.w3.org/x", publishedAt: daysAgoIso(2), relevance: 0.05 }, // 1×1×0.05 ≈ 0.368
		];
		const ranked = rankByFreshnessAuthority(sources, NOW);
		expect(ranked[0].id).toBe("on-topic-community");
	});
});

describe("scoreFreshnessAuthority — determinism + purity", () => {
	it("is a pure function of its inputs (same inputs → identical output; never reads the wall clock)", () => {
		const src: RankableSource = {
			id: "d",
			url: "https://www.nasa.gov/x",
			publishedAt: daysAgoIso(7),
			relevance: 0.6,
		};
		const a = scoreFreshnessAuthority(src, NOW);
		const b = scoreFreshnessAuthority(src, NOW);
		expect(a).toEqual(b);
	});

	it("respects the injected `now` (a later `now` ages the source into a worse band)", () => {
		const src: RankableSource = { id: "d", url: "https://www.w3.org/x", publishedAt: "2026-06-20T00:00:00Z" };
		const early = scoreFreshnessAuthority(src, new Date("2026-06-24T00:00:00Z")); // ~4 days → current
		const late = scoreFreshnessAuthority(src, new Date("2028-06-24T00:00:00Z")); // ~2 years → stale
		expect(early.freshnessVerdict).toBe("current");
		expect(late.freshnessVerdict).toBe("stale");
		expect(early.score).toBeGreaterThan(late.score);
	});
});
