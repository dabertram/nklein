import { describe, expect, it } from "vitest";
import { type CitedSource, hasStaleCitedSource, stampSourceFreshness } from "../../../src/core/cited-source-freshness";

const NOW = new Date("2026-07-05T00:00:00Z");

describe("stampSourceFreshness", () => {
	it("stamps each cited source with a freshness verdict", () => {
		const sources: CitedSource[] = [
			{ ref: "[1]", publishedAt: "2026-07-01" }, // days old ⇒ current
			{ ref: "[2]", publishedAt: "2019-01-01" }, // years old ⇒ stale
			{ ref: "[3]" }, // no date ⇒ unknown
		];
		const stamped = stampSourceFreshness(sources, NOW);
		expect(stamped[0]?.freshness.verdict).toBe("current");
		expect(stamped[1]?.freshness.verdict).toBe("stale");
		expect(stamped[2]?.freshness.verdict).toBe("unknown");
		expect(stamped[2]?.freshness.ageDays).toBeNull();
	});

	it("carries the source fields through + a guidance rail", () => {
		const [only] = stampSourceFreshness(
			[{ ref: "[1]", url: "http://x", title: "T", publishedAt: "2026-06-30" }],
			NOW,
		);
		expect(only).toMatchObject({ ref: "[1]", url: "http://x", title: "T" });
		expect(only?.freshness.guidance.length ?? 0).toBeGreaterThan(0);
	});
});

describe("hasStaleCitedSource", () => {
	it("is true when any source is possibly-stale or stale", () => {
		const stamped = stampSourceFreshness(
			[
				{ ref: "a", publishedAt: "2026-07-01" },
				{ ref: "b", publishedAt: "2015-01-01" },
			],
			NOW,
		);
		expect(hasStaleCitedSource(stamped)).toBe(true);
	});

	it("is false when all sources are current/recent/unknown", () => {
		const stamped = stampSourceFreshness([{ ref: "a", publishedAt: "2026-07-01" }, { ref: "b" }], NOW);
		expect(hasStaleCitedSource(stamped)).toBe(false);
	});
});
