/**
 * §5.AC retrieval-loop SEARCH adapter — maps a web_search backend's response into the retrieval loop's injected
 * `search` dep ({@link runRetrievalLoop}). Like the fetch adapter, this performs NO egress itself: the actual
 * outbound request lives in the injected `search` fn (the egress-gated SearXNG client). This only shapes the
 * response into `RetrievalHit`s and fails soft (a `WebSearchError` or a throw ⇒ an empty hit list, which the loop
 * treats as "no hits this round").
 */

import type { RetrievalHit } from "./retrieval-loop-driver";
import type { WebSearchError, WebSearchResponse } from "./web-search-contract";

/** The search capability this adapter needs — structurally the SearXNG client's `search`. */
export type WebSearch = (query: string) => Promise<WebSearchResponse | WebSearchError>;

function isWebSearchError(value: WebSearchResponse | WebSearchError): value is WebSearchError {
	return "code" in value;
}

/**
 * Build a retrieval-loop `search` dep from a web_search backend. Each result maps to a hit: a stable id (the URL,
 * falling back to a query+index key), the URL/title/snippet, and the publication date (carried onto the freshness
 * axis). A backend error or a throw yields `[]` — the loop's sufficiency check then decides whether to stop.
 */
export function searchHitsAdapter(search: WebSearch): (query: string) => Promise<readonly RetrievalHit[]> {
	return async (query) => {
		let response: WebSearchResponse | WebSearchError;
		try {
			response = await search(query);
		} catch {
			return [];
		}
		if (isWebSearchError(response)) {
			return [];
		}
		return response.results.map((result, index) => {
			const hit: RetrievalHit = {
				id: result.url && result.url.length > 0 ? result.url : `${query}#${index}`,
				sourceType: "web",
			};
			if (result.url) {
				hit.url = result.url;
			}
			if (result.title) {
				hit.title = result.title;
			}
			if (result.snippet) {
				hit.snippet = result.snippet;
			}
			if (result.publishedDate) {
				hit.publishedAt = result.publishedDate;
			}
			return hit;
		});
	};
}
