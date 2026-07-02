import { describe, expect, it, vi } from "vitest";
import type { WebSearchError, WebSearchResponse } from "../../../src/core/web-search-contract";
import {
	createSearxngWebSearchClient,
	type SearxngWebSearchClientOptions,
} from "../../../src/server/web-search-searxng";

/** A SearXNG-shaped payload (`content` / `engine` are SearXNG's names for snippet / source). */
const searxngPayload = {
	results: [
		{
			title: "Result one",
			url: "https://example.com/one",
			content: "First snippet",
			publishedDate: "2026-06-30",
			engine: "duckduckgo",
		},
		{ title: "Result two", url: "https://example.com/two", content: "Second snippet" },
		{ title: "Result three", url: "https://example.com/three", content: "Third snippet", engine: "brave" },
	],
};

/** Stub fetch that resolves with a real Response and records the (url, init) it was called with. */
function jsonFetchStub(body: unknown, status = 200) {
	return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
		return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	}) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function makeClient(overrides: Partial<SearxngWebSearchClientOptions> = {}) {
	return createSearxngWebSearchClient({
		backendBaseUrl: "http://searx.lan:8080",
		egressEnabled: true,
		...overrides,
	});
}

function isError(value: WebSearchResponse | WebSearchError): value is WebSearchError {
	return "code" in value;
}

describe("createSearxngWebSearchClient", () => {
	it("returns the empty_query error for a whitespace-only query without calling fetch", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ fetchImpl });

		const result = await client.search("   \t ");

		expect(result).toMatchObject({ code: "empty_query" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("fails closed with blocked_by_egress BEFORE any fetch when egress is disabled", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ egressEnabled: false, fetchImpl });

		const result = await client.search("current rust release");

		expect(result).toMatchObject({ code: "blocked_by_egress" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("blocks even when a backend URL is configured but egress is off (gate order: egress first)", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ backendBaseUrl: "http://searx.lan:8080", egressEnabled: false, fetchImpl });

		const result = await client.search("query");

		expect(result).toMatchObject({ code: "blocked_by_egress" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("returns no_backend when egress is enabled but no backend URL is configured", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ backendBaseUrl: null, fetchImpl });

		const result = await client.search("query");

		expect(result).toMatchObject({ code: "no_backend" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("treats a whitespace-only backend URL as no_backend", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ backendBaseUrl: "   ", fetchImpl });

		const result = await client.search("query");

		expect(result).toMatchObject({ code: "no_backend" });
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("maps a SearXNG payload to the contract shape (content → snippet, engine → source)", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ fetchImpl });

		const result = await client.search("rust release");

		expect(isError(result)).toBe(false);
		const response = result as WebSearchResponse;
		expect(response.query).toBe("rust release");
		expect(response.results).toEqual([
			{
				title: "Result one",
				url: "https://example.com/one",
				snippet: "First snippet",
				publishedDate: "2026-06-30",
				source: "duckduckgo",
			},
			{ title: "Result two", url: "https://example.com/two", snippet: "Second snippet" },
			{ title: "Result three", url: "https://example.com/three", snippet: "Third snippet", source: "brave" },
		]);
	});

	it("requests <base>/search with format=json, redirect error, and the nklein-retrieval User-Agent", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ fetchImpl });

		await client.search("rust");

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://searx.lan:8080/search?q=rust&format=json");
		expect(init.method).toBe("GET");
		expect(init.redirect).toBe("error");
		expect(init.headers).toMatchObject({ "User-Agent": "nklein-retrieval" });
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("truncates to maxResults AFTER normalization", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ fetchImpl, maxResults: 2 });

		const result = (await client.search("rust")) as WebSearchResponse;

		expect(result.results).toHaveLength(2);
		expect(result.results.map((r) => r.title)).toEqual(["Result one", "Result two"]);
	});

	it("drops malformed entries (missing title/url, non-object) via the contract normalizer", async () => {
		const fetchImpl = jsonFetchStub({
			results: [
				{ title: "Good", url: "https://example.com/good", content: "kept" },
				{ title: "", url: "https://example.com/empty-title" },
				{ title: "No url" },
				"not-an-object",
				null,
				{ url: "https://example.com/no-title" },
			],
		});
		const client = makeClient({ fetchImpl });

		const result = (await client.search("q")) as WebSearchResponse;

		expect(result.results).toEqual([{ title: "Good", url: "https://example.com/good", snippet: "kept" }]);
	});

	it("returns an empty result list for an unrecognised payload shape instead of erroring", async () => {
		const fetchImpl = jsonFetchStub({ answers: [] });
		const client = makeClient({ fetchImpl });

		const result = (await client.search("q")) as WebSearchResponse;

		expect(result).toEqual({ query: "q", results: [] });
	});

	it("maps a non-2xx response to backend_error with the status code and no body content", async () => {
		const fetchImpl = jsonFetchStub({ detail: "secret internal state" }, 502);
		const client = makeClient({ fetchImpl });

		const result = await client.search("q");

		expect(result).toMatchObject({ code: "backend_error" });
		expect((result as WebSearchError).message).toContain("502");
		expect((result as WebSearchError).message).not.toContain("secret internal state");
	});

	it("maps a thrown fetch (network failure) to backend_error naming the error class, not the message", async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.5:8080");
		}) as unknown as typeof fetch;
		const client = makeClient({ fetchImpl });

		const result = await client.search("q");

		expect(result).toMatchObject({ code: "backend_error" });
		expect((result as WebSearchError).message).toContain("TypeError");
		expect((result as WebSearchError).message).not.toContain("10.0.0.5");
	});

	it("maps a redirect rejection to backend_error (redirecting backends are misconfigurations)", async () => {
		// With redirect: "error", undici rejects when the backend answers 3xx — simulate that rejection.
		const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
			expect(init?.redirect).toBe("error");
			throw new TypeError("fetch failed: unexpected redirect");
		}) as unknown as typeof fetch;
		const client = makeClient({ fetchImpl });

		const result = await client.search("q");

		expect(result).toMatchObject({ code: "backend_error" });
	});

	it("aborts a hung backend after timeoutMs and reports the timeout as backend_error", async () => {
		// A stub that never resolves on its own — it only settles when the client's AbortController fires.
		const fetchImpl = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
				}),
		) as unknown as typeof fetch;
		const client = makeClient({ fetchImpl, timeoutMs: 10 });

		const result = await client.search("q");

		expect(result).toMatchObject({ code: "backend_error" });
		expect((result as WebSearchError).message).toContain("timed out after 10ms");
	});

	it("maps a JSON parse failure to backend_error without echoing the body", async () => {
		const fetchImpl = vi.fn(
			async () => new Response("<html>not json</html>", { status: 200 }),
		) as unknown as typeof fetch;
		const client = makeClient({ fetchImpl });

		const result = await client.search("q");

		expect(result).toMatchObject({ code: "backend_error" });
		expect((result as WebSearchError).message).not.toContain("<html>");
	});

	it("trims trailing slashes off the backend base URL", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ backendBaseUrl: "http://searx.lan:8080///", fetchImpl });

		await client.search("rust");

		const [url] = fetchImpl.mock.calls[0] as [string];
		expect(url).toBe("http://searx.lan:8080/search?q=rust&format=json");
	});

	it("percent-encodes the query (spaces, ampersands, non-ASCII) so it cannot alter the request", async () => {
		const fetchImpl = jsonFetchStub(searxngPayload);
		const client = makeClient({ fetchImpl });

		await client.search('rust "async traits" & more? ü');

		const [url] = fetchImpl.mock.calls[0] as [string];
		expect(url).toBe(
			"http://searx.lan:8080/search?q=rust%20%22async%20traits%22%20%26%20more%3F%20%C3%BC&format=json",
		);
	});
});
