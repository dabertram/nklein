import { describe, expect, it } from "vitest";
import { judgeRetrievedFreshness, shouldSearchForFresher } from "../../../src/core/retrieval-freshness";

const now = new Date("2026-06-27T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("judgeRetrievedFreshness", () => {
	it("bands a source by age relative to now (current → recent → possibly_stale → stale)", () => {
		expect(judgeRetrievedFreshness({ publishedAt: daysAgo(5) }, now).verdict).toBe("current");
		expect(judgeRetrievedFreshness({ publishedAt: daysAgo(90) }, now).verdict).toBe("recent");
		expect(judgeRetrievedFreshness({ publishedAt: daysAgo(300) }, now).verdict).toBe("possibly_stale");
		expect(judgeRetrievedFreshness({ publishedAt: daysAgo(800) }, now).verdict).toBe("stale");
	});

	it("reports whole-day age + the parsed ISO date, and accepts a string date", () => {
		const judgment = judgeRetrievedFreshness({ publishedAt: "2026-06-20" }, now);
		expect(judgment.ageDays).toBe(7);
		expect(judgment.publishedIso).toBe("2026-06-20");
		expect(judgment.verdict).toBe("current");
	});

	it("clamps a future-dated source to age 0 = current (clock skew / dated-ahead doc)", () => {
		const judgment = judgeRetrievedFreshness({ publishedAt: daysAgo(-30) }, now);
		expect(judgment.ageDays).toBe(0);
		expect(judgment.verdict).toBe("current");
	});

	it("returns unknown (and search-for-fresher) when there is no usable date", () => {
		expect(judgeRetrievedFreshness({}, now).verdict).toBe("unknown");
		expect(judgeRetrievedFreshness({ publishedAt: "not a date" }, now).verdict).toBe("unknown");
		expect(judgeRetrievedFreshness({ publishedAt: null }, now).ageDays).toBeNull();
	});

	it("honors custom thresholds", () => {
		const judgment = judgeRetrievedFreshness({ publishedAt: daysAgo(40) }, now, { thresholds: { current: 7 } });
		expect(judgment.verdict).toBe("recent"); // 40d > custom current=7 but <= default recent=180
	});

	it("the guidance rail tells the agent to search newer only when warranted", () => {
		expect(judgeRetrievedFreshness({ publishedAt: daysAgo(5) }, now).guidance).toMatch(/safe to rely/i);
		expect(judgeRetrievedFreshness({ publishedAt: daysAgo(800) }, now).guidance).toMatch(
			/outdated|search for current/i,
		);
	});
});

describe("shouldSearchForFresher", () => {
	it("is true for stale/possibly_stale/unknown, false for current/recent", () => {
		expect(shouldSearchForFresher("current")).toBe(false);
		expect(shouldSearchForFresher("recent")).toBe(false);
		expect(shouldSearchForFresher("possibly_stale")).toBe(true);
		expect(shouldSearchForFresher("stale")).toBe(true);
		expect(shouldSearchForFresher("unknown")).toBe(true);
	});
});

describe("freshness adapters (isFreshnessSatisfied, toEvidenceFreshnessVerdict)", () => {
	const verdicts = ["current", "recent", "possibly_stale", "stale", "unknown"] as const;
	it("isFreshnessSatisfied is the exact complement of shouldSearchForFresher", async () => {
		const { isFreshnessSatisfied, shouldSearchForFresher } = await import("../../../src/core/retrieval-freshness");
		for (const v of verdicts) {
			expect(isFreshnessSatisfied(v)).toBe(!shouldSearchForFresher(v));
		}
		expect(isFreshnessSatisfied("current")).toBe(true);
		expect(isFreshnessSatisfied("stale")).toBe(false);
	});
	it("toEvidenceFreshnessVerdict projects the 5 verdicts onto the 3-value evidence enum", async () => {
		const { toEvidenceFreshnessVerdict } = await import("../../../src/core/retrieval-freshness");
		expect(toEvidenceFreshnessVerdict("current")).toBe("fresh");
		expect(toEvidenceFreshnessVerdict("recent")).toBe("fresh");
		expect(toEvidenceFreshnessVerdict("possibly_stale")).toBe("stale");
		expect(toEvidenceFreshnessVerdict("stale")).toBe("stale");
		expect(toEvidenceFreshnessVerdict("unknown")).toBe("unknown");
	});
});
