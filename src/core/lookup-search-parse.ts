/**
 * `lookup` search-result parsing — PURE. The general web search behind the fact-check tool uses DuckDuckGo's HTML
 * endpoint (`https://html.duckduckgo.com/html/?q=…`): no API key, no JavaScript, a stable server-rendered result
 * list. This module turns that HTML into `{ title, url, snippet }` rows and nothing else — the fetch itself lives
 * in the client (egress-proxied), so the parser is testable against fixture HTML with no network.
 *
 * Result links on the HTML endpoint are redirect URLs of the form `//duckduckgo.com/l/?uddg=<encoded target>&…`;
 * `decodeResultUrl` unwraps them so the receipt records the REAL destination (the page that would be fetched), not
 * the redirector. Ads (`result--ad`) are dropped. The page's own text is untrusted content: titles and snippets are
 * entity-decoded and tag-stripped, bounded, and never interpreted.
 */

export interface LookupSearchResult {
	title: string;
	url: string;
	snippet: string;
}

export const MAX_LOOKUP_SEARCH_RESULTS = 8;
const MAX_TITLE_CHARS = 200;
const MAX_SNIPPET_CHARS = 400;

const ENTITY_MAP: Readonly<Record<string, string>> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&#x27;": "'",
	"&nbsp;": " ",
};

export function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (entity) => ENTITY_MAP[entity] ?? entity)
		.replace(/&#(\d+);/g, (_match, code: string) => {
			const point = Number.parseInt(code, 10);
			return Number.isFinite(point) && point > 0 && point < 0x110000 ? String.fromCodePoint(point) : "";
		});
}

/** Inline formatting tags vanish without leaving a space ("an <b>AbortSignal</b>." must not become "an AbortSignal ."). */
export const INLINE_HTML_TAG =
	/<\/?(b|i|em|strong|a|span|code|small|sup|sub|u|mark|abbr|kbd|var|cite|q|s|del|ins|tt)\b[^>]*>/gi;

export function stripTags(html: string): string {
	return decodeHtmlEntities(html.replace(INLINE_HTML_TAG, "").replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

/** Unwrap a DuckDuckGo redirect link to its target; a plain http(s) URL passes through; anything else is null. */
export function decodeResultUrl(href: string): string | null {
	const raw = decodeHtmlEntities(href.trim());
	const normalized = raw.startsWith("//") ? `https:${raw}` : raw;
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		return null;
	}
	if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
		const target = parsed.searchParams.get("uddg");
		if (!target) {
			return null;
		}
		try {
			const targetUrl = new URL(target);
			return targetUrl.protocol === "http:" || targetUrl.protocol === "https:" ? targetUrl.toString() : null;
		} catch {
			return null;
		}
	}
	return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
}

const RESULT_BLOCK =
	/<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bresult\b[^"]*"[^>]*>|<\/div>\s*<\/div>\s*<\/div>|$)/g;
const RESULT_LINK = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
const RESULT_SNIPPET =
	/<a[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)(?:<\/div>|$)/;

/** Parse the DuckDuckGo HTML endpoint's result list. Unknown markup yields `[]`, never a throw. */
export function parseDuckDuckGoHtmlResults(html: string): LookupSearchResult[] {
	const results: LookupSearchResult[] = [];
	const seen = new Set<string>();
	for (const match of html.matchAll(RESULT_BLOCK)) {
		const block = match[0];
		if (/class="[^"]*\bresult--ad\b/.test(block.slice(0, 200))) {
			continue;
		}
		const link = RESULT_LINK.exec(block);
		if (!link) {
			continue;
		}
		const url = decodeResultUrl(link[1]);
		if (!url || seen.has(url)) {
			continue;
		}
		const title = stripTags(link[2]).slice(0, MAX_TITLE_CHARS);
		if (!title) {
			continue;
		}
		const snippetMatch = RESULT_SNIPPET.exec(block);
		const snippet = stripTags(snippetMatch?.[1] ?? snippetMatch?.[2] ?? "").slice(0, MAX_SNIPPET_CHARS);
		seen.add(url);
		results.push({ title, url, snippet });
		if (results.length >= MAX_LOOKUP_SEARCH_RESULTS) {
			break;
		}
	}
	return results;
}

/** The search URL for a query on the HTML endpoint (the ONE host the search leg ever contacts). */
export const LOOKUP_SEARCH_HOST = "html.duckduckgo.com";

export function buildDuckDuckGoSearchUrl(query: string): string {
	const url = new URL(`https://${LOOKUP_SEARCH_HOST}/html/`);
	url.searchParams.set("q", query.trim());
	return url.toString();
}
