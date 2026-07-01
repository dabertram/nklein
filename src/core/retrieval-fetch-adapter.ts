/**
 * §5.AC retrieval-loop FETCH adapter — plugs the §5.M `browse_url` tool's SSRF-safe page fetcher into the retrieval
 * loop's injected `fetch` dep ({@link runRetrievalLoop}). PRIME DIRECTIVE #1: the actual egress is the INJECTED
 * `fetchPage` (already host-gated by browse_url's SSRF checks + the §5.M host-access gate); this adapter performs NO
 * egress itself — it only maps a fetched page into a `RetrievalEvidence` and carries the hit's `publishedAt` /
 * `sourceType` through (the rendered page has no publication date, so the freshness axis relies on the search hit's).
 */

import type { RetrievalEvidence, RetrievalHit } from "./retrieval-loop-driver";

/** The page-fetch capability this adapter needs — structurally the browse_url tool's `BrowserDeps.fetchPage`. */
export type PageFetcher = (url: string) => Promise<{ url: string; title: string; text: string }>;

/**
 * Build a retrieval-loop `fetch` dep from an SSRF-safe page fetcher. The returned function fetches the hit's URL and
 * maps it to evidence: the page title (when present) is prepended to the body so the synthesiser/extractor sees it, and
 * the final (post-redirect) URL is preferred. A hit with no URL rejects (the driver treats a rejected fetch as a skip).
 */
export function browserFetchAdapter(fetchPage: PageFetcher): (hit: RetrievalHit) => Promise<RetrievalEvidence> {
	return async (hit) => {
		if (!hit.url || hit.url.trim().length === 0) {
			throw new Error(`retrieval fetch: hit "${hit.id}" has no URL to fetch`);
		}
		const page = await fetchPage(hit.url);
		const title = page.title?.trim() ?? "";
		const text = title.length > 0 ? `${title}\n\n${page.text}` : page.text;
		return {
			id: hit.id,
			url: page.url && page.url.length > 0 ? page.url : hit.url,
			text,
			...(hit.sourceType !== undefined ? { sourceType: hit.sourceType } : {}),
			...(hit.publishedAt !== undefined ? { publishedAt: hit.publishedAt } : {}),
		};
	};
}
