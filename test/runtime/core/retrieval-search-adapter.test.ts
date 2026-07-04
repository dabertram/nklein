import { describe, expect, it } from "vitest";
import { searchHitsAdapter } from "../../../src/core/retrieval-search-adapter";
import type { WebSearchError, WebSearchResponse } from "../../../src/core/web-search-contract";

describe("searchHitsAdapter (§5.AC)", () => {
	it("maps web results to retrieval hits (url/title/snippet/publishedAt + web sourceType)", async () => {
		const response: WebSearchResponse = {
			query: "vite 6",
			results: [
				{
					title: "Vite 6 release",
					url: "https://vite.dev/6",
					snippet: "new config API",
					publishedDate: "2025-11-01",
				},
				{ title: "Blog", url: "https://blog/x", snippet: "notes" },
			],
		};
		const hits = await searchHitsAdapter(async () => response)("vite 6");
		expect(hits).toEqual([
			{
				id: "https://vite.dev/6",
				sourceType: "web",
				url: "https://vite.dev/6",
				title: "Vite 6 release",
				snippet: "new config API",
				publishedAt: "2025-11-01",
			},
			{ id: "https://blog/x", sourceType: "web", url: "https://blog/x", title: "Blog", snippet: "notes" },
		]);
	});

	it("fails soft to [] on a backend error verdict", async () => {
		const error: WebSearchError = { code: "blocked_by_egress", message: "off" };
		const hits = await searchHitsAdapter(async () => error)("q");
		expect(hits).toEqual([]);
	});

	it("fails soft to [] when the search fn throws", async () => {
		const hits = await searchHitsAdapter(async () => {
			throw new Error("network");
		})("q");
		expect(hits).toEqual([]);
	});

	it("falls back to a query#index id when a result has no url", async () => {
		const hits = await searchHitsAdapter(async () => ({
			query: "q",
			results: [{ title: "no-url", url: "", snippet: "s" }],
		}))("q");
		expect(hits[0]?.id).toBe("q#0");
	});

	it("flag OFF (default) ⇒ hits carry NO relevance field (byte-identical to today)", async () => {
		const hits = await searchHitsAdapter(async () => ({
			query: "vite 6",
			results: [{ title: "Vite 6", url: "https://v/6", snippet: "s" }],
		}))("vite 6");
		expect(hits[0]).not.toHaveProperty("relevance");
	});

	it("flag ON ⇒ annotates each hit with a lexical relevance score, preserving hit ORDER", async () => {
		const response: WebSearchResponse = {
			query: "vite 6",
			results: [
				{ title: "Blog", url: "https://blog/x", snippet: "notes" }, // matches neither term → relevance 0
				{ title: "Vite 6 release", url: "https://vite.dev/6", snippet: "new config API" }, // both terms → 1
			],
		};
		const hits = await searchHitsAdapter(async () => response, { rerankByRelevance: true })("vite 6");
		// Order is UNCHANGED (input order) — the adapter only annotates; the driver's freshness×authority×relevance
		// ranker owns the actual ordering.
		expect(hits.map((h) => h.id)).toEqual(["https://blog/x", "https://vite.dev/6"]);
		expect(hits[0]?.relevance).toBe(0);
		expect(hits[1]?.relevance).toBe(1);
	});

	it("flag ON ⇒ a partial term match yields a fractional relevance in (0,1)", async () => {
		const hits = await searchHitsAdapter(
			async () => ({
				query: "vite 7 release",
				results: [{ title: "Vite 6 release", url: "https://v/6", snippet: "" }],
			}),
			{ rerankByRelevance: true },
		)("vite 7 release");
		// "vite" + "release" match; "7" does not ⇒ 2/3.
		expect(hits[0]?.relevance).toBeCloseTo(2 / 3, 5);
	});

	it("flag ON ⇒ still keys relevance onto a url-less (query#index) hit", async () => {
		const hits = await searchHitsAdapter(
			async () => ({ query: "q", results: [{ title: "q matches", url: "", snippet: "" }] }),
			{ rerankByRelevance: true },
		)("q");
		expect(hits[0]?.id).toBe("q#0");
		expect(hits[0]?.relevance).toBe(1); // "q" appears in "q matches"
	});

	it("flag ON ⇒ fail-soft paths still return [] (no rerank on an error verdict or a throw)", async () => {
		const err: WebSearchError = { code: "blocked_by_egress", message: "off" };
		expect(await searchHitsAdapter(async () => err, { rerankByRelevance: true })("q")).toEqual([]);
		expect(
			await searchHitsAdapter(
				async () => {
					throw new Error("net");
				},
				{ rerankByRelevance: true },
			)("q"),
		).toEqual([]);
	});
});
