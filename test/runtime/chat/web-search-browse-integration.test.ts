import { describe, expect, it } from "vitest";
import { createBrowserTools } from "../../../src/chat/chat-browser-tool";
import { createWebSearchTools } from "../../../src/chat/chat-web-search-tool";
import type { WebSearchResponse } from "../../../src/core/web-search-contract";

/**
 * §5.AC fetch-after-search integration (todo `web_search` leaf): the two tools must COMPOSE — a URL surfaced by
 * `web_search`'s rendered output is directly consumable by `browse_url` in the same turn. Deterministic fakes at
 * both capability seams (search backend + page fetcher); the agent-loop chaining itself is model-driven.
 */
describe("web_search → browse_url fetch-after-search flow", () => {
	it("a searched URL feeds browse_url and the page content comes back", async () => {
		const searchResponse: WebSearchResponse = {
			query: "qwen 3.6 review",
			results: [
				{
					title: "Qwen 3.6 deep dive",
					url: "https://models.example/qwen-3.6",
					snippet: "benchmarks",
					source: "blog",
				},
			],
		};
		const { tools: searchTools } = createWebSearchTools({ search: async () => searchResponse });
		const rendered = String(await searchTools[0]?.run({ query: "qwen 3.6 review" }));
		// The rendered search output carries the URL verbatim — the agent copies it into browse_url.
		const urlFromSearch = rendered.match(/https:\/\/\S+/)?.[0];
		expect(urlFromSearch).toBe("https://models.example/qwen-3.6");

		const fetched: string[] = [];
		const { tools: browseTools } = createBrowserTools({
			browser: {
				fetchPage: async (url) => {
					fetched.push(url);
					return { url, title: "Qwen 3.6 deep dive", text: "Benchmarks show strong tool-calling." };
				},
			},
		});
		const page = String(await browseTools[0]?.run({ url: urlFromSearch }));
		expect(fetched).toEqual(["https://models.example/qwen-3.6"]);
		expect(page).toContain("Benchmarks show strong tool-calling.");
	});

	it("both tools share the egress_read/web-taint capability class (the same §5.L gate governs the whole flow)", () => {
		const { tools: searchTools } = createWebSearchTools({ search: async () => ({ query: "q", results: [] }) });
		const { tools: browseTools } = createBrowserTools({
			browser: { fetchPage: async (url) => ({ url, title: "", text: "" }) },
		});
		for (const tool of [searchTools[0], browseTools[0]]) {
			expect(tool?.actionKind).toBe("egress_read");
			expect(tool?.taint).toEqual(["web"]);
		}
	});
});
