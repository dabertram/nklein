import { describe, expect, it } from "vitest";
import {
	buildCurrencyEvidenceFromSource,
	evidenceTrustFromRef,
	evidenceTrustFromTier,
	extractPublicationDate,
} from "../../../src/core/evidence-currency-capture";

describe("evidence-currency-capture", () => {
	describe("extractPublicationDate", () => {
		it("reads article:published_time (either attribute order)", () => {
			const a = `<meta property="article:published_time" content="2024-01-15T08:00:00Z">`;
			const b = `<meta content="2024-01-15T08:00:00Z" property="article:published_time">`;
			expect(extractPublicationDate(a)).toBe(Date.parse("2024-01-15T08:00:00Z"));
			expect(extractPublicationDate(b)).toBe(Date.parse("2024-01-15T08:00:00Z"));
		});

		it("reads JSON-LD datePublished and a date meta and a <time datetime>", () => {
			expect(extractPublicationDate('{"datePublished":"2023-06-01"}')).toBe(Date.parse("2023-06-01"));
			expect(extractPublicationDate(`<meta name="date" content="2022-03-04">`)).toBe(Date.parse("2022-03-04"));
			expect(extractPublicationDate(`<time datetime="2021-12-31">Dec 31</time>`)).toBe(Date.parse("2021-12-31"));
		});

		it("prefers the most-specific signal (article:published_time over a bare <time>)", () => {
			const html = `<time datetime="2000-01-01"></time><meta property="article:published_time" content="2024-09-09">`;
			expect(extractPublicationDate(html)).toBe(Date.parse("2024-09-09"));
		});

		it("returns null for an undated page or an unparseable date (never fabricates a date)", () => {
			expect(extractPublicationDate("<html><body>no date here</body></html>")).toBeNull();
			expect(extractPublicationDate(`<meta name="date" content="not-a-date">`)).toBeNull();
		});
	});

	describe("evidenceTrust mapping", () => {
		it("maps tiers onto the currency trust enum", () => {
			expect(evidenceTrustFromTier("authoritative")).toBe("high");
			expect(evidenceTrustFromTier("reputable")).toBe("high");
			expect(evidenceTrustFromTier("community")).toBe("medium");
			expect(evidenceTrustFromTier("low")).toBe("low");
			expect(evidenceTrustFromTier("unknown")).toBe("unknown");
		});

		it("derives trust from a URL — a gov TLD is high, an unplaceable origin is unknown", () => {
			expect(evidenceTrustFromRef("https://www.nist.gov/spec")).toBe("high");
			expect(evidenceTrustFromRef("not a url")).toBe("unknown");
		});
	});

	describe("buildCurrencyEvidenceFromSource", () => {
		it("composes id + parsed date + derived trust with cited-supports defaults", () => {
			const evidence = buildCurrencyEvidenceFromSource({
				id: "src-1",
				ref: "https://www.nist.gov/doc",
				html: `<meta property="article:published_time" content="2024-02-02T00:00:00Z">`,
			});
			expect(evidence).toEqual({
				id: "src-1",
				sourceDateMs: Date.parse("2024-02-02T00:00:00Z"),
				trust: "high",
				supports: true,
				conflictsWithIds: [],
			});
		});

		it("leaves sourceDateMs null for an undated source and honors explicit supports/conflicts", () => {
			const evidence = buildCurrencyEvidenceFromSource({
				id: "src-2",
				ref: "https://random-blog.example/post",
				html: "<p>no date</p>",
				supports: false,
				conflictsWithIds: ["src-1"],
			});
			expect(evidence.sourceDateMs).toBeNull();
			expect(evidence.supports).toBe(false);
			expect(evidence.conflictsWithIds).toEqual(["src-1"]);
		});
	});
});
