import { describe, expect, it } from "vitest";
import { extractReadableText } from "../../../src/core/lookup-page-text";
import {
	buildLookupReceipt,
	lookupCacheKey,
	normalizeLookupUrl,
	receiptUrlSet,
	sha256Hex,
} from "../../../src/core/lookup-receipt";
import {
	buildDuckDuckGoSearchUrl,
	decodeResultUrl,
	MAX_LOOKUP_SEARCH_RESULTS,
	parseDuckDuckGoHtmlResults,
} from "../../../src/core/lookup-search-parse";

const DDG_FIXTURE = `
<html><body><div id="links" class="results">
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi%2Fglobals.html&amp;rut=abc">Global objects | Node.js v22 &amp; docs</a></h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2Fapi%2Fglobals.html">The <b>fetch</b> API accepts an <b>AbortSignal</b>.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result result--ad">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a" href="https://ads.example/x">Buy now</a></h2>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a" href="https://developer.mozilla.org/en-US/docs/Web/API/fetch">fetch() - Web APIs | MDN</a></h2>
    <div class="result__snippet">The global fetch() method starts the process of fetching a resource.</div>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a class="result__a" href="https://developer.mozilla.org/en-US/docs/Web/API/fetch">duplicate</a></h2>
  </div>
</div>
</div></body></html>`;

describe("parseDuckDuckGoHtmlResults", () => {
	it("extracts title/url/snippet, unwraps the redirector, drops ads and duplicates, decodes entities", () => {
		const results = parseDuckDuckGoHtmlResults(DDG_FIXTURE);
		expect(results).toEqual([
			{
				title: "Global objects | Node.js v22 & docs",
				url: "https://nodejs.org/api/globals.html",
				snippet: "The fetch API accepts an AbortSignal.",
			},
			{
				title: "fetch() - Web APIs | MDN",
				url: "https://developer.mozilla.org/en-US/docs/Web/API/fetch",
				snippet: "The global fetch() method starts the process of fetching a resource.",
			},
		]);
	});

	it("returns [] on unknown markup instead of throwing, and caps the result count", () => {
		expect(parseDuckDuckGoHtmlResults("<html>nothing here</html>")).toEqual([]);
		const many = Array.from(
			{ length: MAX_LOOKUP_SEARCH_RESULTS + 3 },
			(_v, i) => `<div class="result web-result"><a class="result__a" href="https://e.org/${i}">t${i}</a></div>`,
		).join("\n");
		expect(parseDuckDuckGoHtmlResults(many)).toHaveLength(MAX_LOOKUP_SEARCH_RESULTS);
	});

	it("decodeResultUrl rejects non-http targets and keeps plain URLs", () => {
		expect(decodeResultUrl("//duckduckgo.com/l/?uddg=javascript%3Aalert(1)")).toBeNull();
		expect(decodeResultUrl("//duckduckgo.com/l/?rut=only")).toBeNull();
		expect(decodeResultUrl("ftp://x.org/a")).toBeNull();
		expect(decodeResultUrl("https://x.org/a?b=1")).toBe("https://x.org/a?b=1");
	});

	it("builds the search URL on the single search host", () => {
		expect(buildDuckDuckGoSearchUrl("node fetch signal")).toBe(
			"https://html.duckduckgo.com/html/?q=node+fetch+signal",
		);
	});
});

describe("extractReadableText", () => {
	it("drops chrome/scripts, keeps block breaks, decodes entities and reads the title", () => {
		const html = `<html><head><title>Docs &amp; Guides</title><style>.x{}</style></head><body>
<nav>skip me</nav><script>alert(1)</script>
<h1>fetch()</h1><p>Starts   a <b>request</b>.</p><ul><li>signal: AbortSignal</li></ul><footer>foot</footer></body></html>`;
		const page = extractReadableText(html, { contentType: "text/html; charset=utf-8" });
		expect(page.title).toBe("Docs & Guides");
		expect(page.text).toBe("fetch()\nStarts a request.\nsignal: AbortSignal");
		expect(page.truncated).toBe(false);
	});

	it("passes plain text through and caps with a truncation note", () => {
		const page = extractReadableText("a".repeat(50), { contentType: "text/plain", maxChars: 10 });
		expect(page.text).toBe("aaaaaaaaaa\n[truncated: 40 more characters]");
		expect(page.truncated).toBe(true);
	});
});

describe("lookup receipts", () => {
	it("hashes the body, records size/ids, and defaults finalUrl to url", () => {
		const receipt = buildLookupReceipt({
			kind: "fetch",
			url: "https://x.org/a",
			body: "hello",
			cardId: "c1",
			stepId: "s1",
			served: "network",
			status: 200,
			at: 1000,
			contentType: "text/plain",
		});
		expect(receipt).toMatchObject({
			kind: "fetch",
			url: "https://x.org/a",
			finalUrl: "https://x.org/a",
			query: null,
			bytes: 5,
			cardId: "c1",
			stepId: "s1",
			served: "network",
			status: 200,
			at: 1000,
		});
		expect(receipt.sha256).toBe(sha256Hex("hello"));
		expect(receipt.id).toMatch(/^lookup-/);
	});

	it("keys the cache on kind + normalized URL (host case and fragment do not matter; the query does)", () => {
		expect(normalizeLookupUrl("https://EXAMPLE.org/a?q=1#frag")).toBe("https://example.org/a?q=1");
		expect(lookupCacheKey("fetch", "https://EXAMPLE.org/a#x")).toBe(lookupCacheKey("fetch", "https://example.org/a"));
		expect(lookupCacheKey("fetch", "https://example.org/a?q=1")).not.toBe(
			lookupCacheKey("fetch", "https://example.org/a?q=2"),
		);
		expect(lookupCacheKey("search", "https://example.org/a")).not.toBe(
			lookupCacheKey("fetch", "https://example.org/a"),
		);
	});

	it("collects the URLs a card's receipts vouch for, scoped to that card", () => {
		const r1 = buildLookupReceipt({
			kind: "fetch",
			url: "https://x.org/a",
			finalUrl: "https://x.org/b",
			body: "",
			cardId: "c1",
			served: "cache",
			at: 1,
		});
		const r2 = buildLookupReceipt({
			kind: "fetch",
			url: "https://y.org/",
			body: "",
			cardId: "c2",
			served: "network",
			at: 2,
		});
		expect([...receiptUrlSet([r1, r2], "c1")]).toEqual(["https://x.org/a", "https://x.org/b"]);
	});
});
