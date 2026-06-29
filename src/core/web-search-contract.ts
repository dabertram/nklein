/**
 * Pure contract + result normalizer for the egress-gated web_search tool (todo §5.AC).
 *
 * This module owns the data shapes and validation logic for web search — no network code lives here.
 * The actual egress-gated HTTP implementation and the LM-Studio tool binding that exposes `web_search`
 * to the agent are defined elsewhere (§5.AC implementation modules); this contract file is the single
 * authoritative source of truth for:
 *
 *   1. The wire schema for a single search hit (`webSearchResultSchema` / `WebSearchResult`).
 *   2. The envelope schema for a full search response (`webSearchResponseSchema` / `WebSearchResponse`).
 *   3. The discriminated error type (`WebSearchError`) covering the four failure modes an egress-gated
 *      tool may surface: no configured backend, the egress gate blocked the request, the backend itself
 *      returned an error, or the caller passed an empty/whitespace query.
 *   4. A tolerant result normalizer (`normalizeWebSearchResults`) that coerces raw backend payloads into
 *      `WebSearchResponse` while silently dropping malformed entries — designed to survive schema drift
 *      in upstream search APIs without crashing the agent.
 *   5. A query validator (`validateQuery`) so callers can produce a typed `WebSearchError` before any
 *      network round-trip.
 *
 * Egress gating note (§5.AC):
 *   The `web_search` tool MUST be behind an egress gate before any call leaves the operator's network.
 *   This file intentionally has no `fetch` / HTTP / DNS imports — keeping it free of side-effects also
 *   keeps it unit-testable without mocking.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema + inferred types
// ---------------------------------------------------------------------------

/**
 * Wire schema for one search hit returned by a web_search backend.
 *
 * `title` and `url` are required — a hit without both cannot be surfaced to the agent.
 * `snippet` is optional at the wire level but is always coerced to a string by `normalizeWebSearchResults`.
 * `publishedDate` and `source` are passed through as-is when present and string-typed.
 */
export const webSearchResultSchema = z.object({
	/** Human-readable title of the search result. */
	title: z.string(),
	/** Canonical URL of the result page. */
	url: z.string(),
	/** Short excerpt from the result page, suitable for display in the context window. */
	snippet: z.string(),
	/** ISO-8601 date string when the page was originally published, if available from the backend. */
	publishedDate: z.string().optional(),
	/** Identifies the originating domain or data provider (e.g. "news.example.com", "Wikipedia"). */
	source: z.string().optional(),
});

/** One web search hit, fully typed. */
export type WebSearchResult = z.infer<typeof webSearchResultSchema>;

// Compile-time drift guard: keep the wire schema in lockstep with the named type.
const _resultGuard: z.ZodType<WebSearchResult> = webSearchResultSchema;
void _resultGuard;

/**
 * Wire schema for the full response envelope from a web_search call.
 *
 * `query` echoes back the original query string so consumers can correlate results with requests in
 * multi-query fan-out patterns (§5.AC parallel search).
 */
export const webSearchResponseSchema = z.object({
	/** The search query that produced these results (echoed for correlation). */
	query: z.string(),
	/** Ordered list of search hits, highest-relevance first. */
	results: z.array(webSearchResultSchema),
});

/** Full web search response envelope. */
export type WebSearchResponse = z.infer<typeof webSearchResponseSchema>;

// Compile-time drift guard.
const _responseGuard: z.ZodType<WebSearchResponse> = webSearchResponseSchema;
void _responseGuard;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Typed error for the web_search tool (§5.AC egress-gated implementation).
 *
 * Discriminated by `code`:
 *   - `"no_backend"`         — no search backend is configured for this environment.
 *   - `"blocked_by_egress"`  — the egress gate denied the outbound request.
 *   - `"backend_error"`      — the search backend returned a non-OK response or threw.
 *   - `"empty_query"`        — the caller supplied a blank or whitespace-only query string.
 *
 * The implementation module translates HTTP / DNS / timeout failures into one of these codes before
 * surfacing them to the agent.  This file never throws — consumers check the returned value.
 */
export type WebSearchError = {
	code: "no_backend" | "blocked_by_egress" | "backend_error" | "empty_query";
	message: string;
};

// ---------------------------------------------------------------------------
// Tolerant result normalizer
// ---------------------------------------------------------------------------

/**
 * Coerce a raw backend payload into a `WebSearchResponse`, dropping any entries that lack a usable
 * `title` AND `url`.
 *
 * Accepted raw shapes:
 *   - An array of objects: `[ { title, url, ... }, ... ]`
 *   - An object with a `results` array: `{ results: [ { title, url, ... }, ... ] }`
 *
 * Per-entry coercion rules:
 *   - `title` must be a non-empty string after trimming — entries without it are dropped.
 *   - `url` must be a non-empty string after trimming — entries without it are dropped.
 *   - `snippet` is coerced: if missing or non-string it becomes `""`, otherwise it is trimmed.
 *   - `publishedDate` is passed through only when it is a string.
 *   - `source` is passed through only when it is a string.
 *
 * This function never throws.  Callers that need strict validation should use
 * `webSearchResponseSchema.parse(...)` instead.
 */
export function normalizeWebSearchResults(query: string, rawResults: unknown): WebSearchResponse {
	// Resolve the raw array from the two accepted input shapes.
	let rawArray: unknown[];

	if (Array.isArray(rawResults)) {
		rawArray = rawResults;
	} else if (
		rawResults !== null &&
		typeof rawResults === "object" &&
		"results" in rawResults &&
		Array.isArray((rawResults as { results: unknown }).results)
	) {
		rawArray = (rawResults as { results: unknown[] }).results;
	} else {
		// Unrecognised shape — return an empty response rather than crashing.
		return { query, results: [] };
	}

	const results: WebSearchResult[] = [];

	for (const entry of rawArray) {
		if (entry === null || typeof entry !== "object") {
			continue;
		}

		const record = entry as Record<string, unknown>;

		// Require both title and url to be usable non-empty strings.
		const rawTitle = record.title;
		const rawUrl = record.url;

		if (typeof rawTitle !== "string" || rawTitle.trim() === "") {
			continue;
		}
		if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
			continue;
		}

		const title = rawTitle.trim();
		const url = rawUrl.trim();

		// Coerce snippet: missing or wrong type → "".
		const rawSnippet = record.snippet;
		const snippet = typeof rawSnippet === "string" ? rawSnippet.trim() : "";

		// Pass through optional string fields only when they are actually strings.
		const rawPublishedDate = record.publishedDate;
		const publishedDate = typeof rawPublishedDate === "string" ? rawPublishedDate : undefined;

		const rawSource = record.source;
		const source = typeof rawSource === "string" ? rawSource : undefined;

		const result: WebSearchResult = { title, url, snippet };
		if (publishedDate !== undefined) {
			result.publishedDate = publishedDate;
		}
		if (source !== undefined) {
			result.source = source;
		}

		results.push(result);
	}

	return { query, results };
}

// ---------------------------------------------------------------------------
// Query validator
// ---------------------------------------------------------------------------

/**
 * Validate a query string before dispatching a web_search call.
 *
 * Returns a `WebSearchError` with code `"empty_query"` when `query` is blank or contains only
 * whitespace.  Returns `null` when the query is acceptable.
 *
 * This is a cheap synchronous check intended to be called before any network round-trip so the agent
 * receives a typed error rather than a confusing empty result set.
 */
export function validateQuery(query: string): WebSearchError | null {
	if (query.trim() === "") {
		return {
			code: "empty_query",
			message: "web_search query must not be blank or whitespace-only",
		};
	}
	return null;
}
