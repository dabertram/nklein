import { describe, expect, it } from "vitest";
import { assessTopicAwareFreshness } from "../../../src/core/topic-aware-freshness";

const now = new Date("2026-07-03T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("assessTopicAwareFreshness", () => {
	it("CENTERPIECE: a ~5-day-old source reads current for a moderate topic but stale for a realtime topic — same age, opposite verdict purely from topic volatility", () => {
		const publishedAt = daysAgo(5);

		// "our team roster and org chart" fires no volatility cue ⇒ default `moderate`
		// (thresholds current=30) ⇒ a 5-day-old source is comfortably `current`.
		const moderate = assessTopicAwareFreshness({ topic: "our team roster and org chart", publishedAt, now });
		expect(moderate.volatility).toBe("moderate");
		expect(moderate.freshness.verdict).toBe("current");

		// "the current stock price of Acme" fires the market-price cue ⇒ `realtime`
		// (thresholds current=0, recent=1, possiblyStale=3) ⇒ the SAME 5-day-old source is `stale`.
		const realtime = assessTopicAwareFreshness({ topic: "the current stock price of Acme", publishedAt, now });
		expect(realtime.volatility).toBe("realtime");
		expect(realtime.freshness.verdict).toBe("stale");

		// Same computed age, verdict differs ONLY because the topic's volatility differs.
		expect(realtime.freshness.ageDays).toBe(moderate.freshness.ageDays);
		expect(realtime.freshness.ageDays).toBe(5);
	});

	it("a ~5-day-old source stays current for a slow topic (standards/specs), same as moderate", () => {
		// "the ISO 8601 date format specification" fires the standard-spec cue ⇒ `slow` (current=180).
		const slow = assessTopicAwareFreshness({
			topic: "the ISO 8601 date format specification",
			publishedAt: daysAgo(5),
			now,
		});
		expect(slow.volatility).toBe("slow");
		expect(slow.freshness.verdict).toBe("current");
	});

	it("an explicit class override wins over what the topic would classify as", () => {
		const publishedAt = daysAgo(5);

		// The topic alone classifies as realtime (market-price cue) ⇒ would be `stale` at 5 days...
		const classified = assessTopicAwareFreshness({ topic: "the current stock price of Acme", publishedAt, now });
		expect(classified.volatility).toBe("realtime");
		expect(classified.freshness.verdict).toBe("stale");

		// ...but forcing `stable` (thresholds current=1825) overrides the topic ⇒ the same source reads `current`.
		const overridden = assessTopicAwareFreshness(
			{ topic: "the current stock price of Acme", publishedAt, now },
			{ class: "stable" },
		);
		expect(overridden.volatility).toBe("stable");
		expect(overridden.freshness.verdict).toBe("current");
	});

	it("an override can also make a normally-fresh topic read stale (override cuts both ways)", () => {
		// A moderate topic that would be `current` at 5 days, forced to `realtime` ⇒ `stale`.
		const overridden = assessTopicAwareFreshness(
			{ topic: "our team roster and org chart", publishedAt: daysAgo(5), now },
			{ class: "realtime" },
		);
		expect(overridden.volatility).toBe("realtime");
		expect(overridden.freshness.verdict).toBe("stale");
	});

	it("an undated source is unknown regardless of topic volatility (no age to band)", () => {
		const realtime = assessTopicAwareFreshness({ topic: "the current stock price of Acme", now });
		expect(realtime.volatility).toBe("realtime");
		expect(realtime.freshness.verdict).toBe("unknown");
		expect(realtime.freshness.ageDays).toBeNull();

		const moderate = assessTopicAwareFreshness({
			topic: "our team roster and org chart",
			publishedAt: "not a real date",
			now,
		});
		expect(moderate.volatility).toBe("moderate");
		expect(moderate.freshness.verdict).toBe("unknown");
		expect(moderate.freshness.ageDays).toBeNull();
	});

	it("is clock-free and deterministic: same inputs + injected now ⇒ identical result", () => {
		const input = { topic: "the current stock price of Acme", publishedAt: daysAgo(5), now } as const;
		expect(assessTopicAwareFreshness(input)).toEqual(assessTopicAwareFreshness(input));
	});
});
