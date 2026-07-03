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
});
