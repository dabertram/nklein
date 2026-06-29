import { describe, expect, it } from "vitest";
import {
	normalizeWebSearchResults,
	validateQuery,
	type WebSearchError,
	type WebSearchResponse,
	type WebSearchResult,
	webSearchResponseSchema,
	webSearchResultSchema,
} from "../../../src/core/web-search-contract";

// ---------------------------------------------------------------------------
// webSearchResultSchema — valid objects
// ---------------------------------------------------------------------------

describe("webSearchResultSchema — valid objects", () => {
	it("parses a minimal valid result (no optional fields)", () => {
		const raw = {
			title: "TypeScript Handbook",
			url: "https://www.typescriptlang.org/docs/handbook/",
			snippet: "The TypeScript Handbook is a comprehensive guide.",
		};
		const result: WebSearchResult = webSearchResultSchema.parse(raw);
		expect(result.title).toBe("TypeScript Handbook");
		expect(result.url).toBe("https://www.typescriptlang.org/docs/handbook/");
		expect(result.snippet).toBe("The TypeScript Handbook is a comprehensive guide.");
		expect(result.publishedDate).toBeUndefined();
		expect(result.source).toBeUndefined();
	});

	it("parses a result with all optional fields present", () => {
		const raw = {
			title: "Zod docs",
			url: "https://zod.dev",
			snippet: "TypeScript-first schema validation.",
			publishedDate: "2024-03-01",
			source: "zod.dev",
		};
		const result: WebSearchResult = webSearchResultSchema.parse(raw);
		expect(result.publishedDate).toBe("2024-03-01");
		expect(result.source).toBe("zod.dev");
	});
});

// ---------------------------------------------------------------------------
// webSearchResultSchema — rejection cases
// ---------------------------------------------------------------------------

describe("webSearchResultSchema — invalid objects", () => {
	it("rejects a result missing url", () => {
		const bad = {
			title: "No URL here",
			snippet: "Some snippet.",
			// url intentionally omitted
		};
		expect(() => webSearchResultSchema.parse(bad)).toThrow();
	});

	it("rejects a result missing title", () => {
		const bad = {
			url: "https://example.com",
			snippet: "Some snippet.",
			// title intentionally omitted
		};
		expect(() => webSearchResultSchema.parse(bad)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// webSearchResponseSchema — valid objects
// ---------------------------------------------------------------------------

describe("webSearchResponseSchema — valid objects", () => {
	it("parses a response with an empty results array", () => {
		const raw = { query: "vitest tutorial", results: [] };
		const response: WebSearchResponse = webSearchResponseSchema.parse(raw);
		expect(response.query).toBe("vitest tutorial");
		expect(response.results).toHaveLength(0);
	});

	it("parses a response carrying two results", () => {
		const raw = {
			query: "zod schema",
			results: [
				{ title: "Zod docs", url: "https://zod.dev", snippet: "Schema validation." },
				{
					title: "Zod GitHub",
					url: "https://github.com/colinhacks/zod",
					snippet: "Source code.",
					source: "GitHub",
				},
			],
		};
		const response: WebSearchResponse = webSearchResponseSchema.parse(raw);
		expect(response.results).toHaveLength(2);
		expect(response.results[1].source).toBe("GitHub");
	});
});

// ---------------------------------------------------------------------------
// normalizeWebSearchResults — array input
// ---------------------------------------------------------------------------

describe("normalizeWebSearchResults — array input", () => {
	it("keeps well-formed entries and drops malformed entries", () => {
		const raw = [
			{ title: "Good entry", url: "https://example.com/good", snippet: "Nice." },
			{ title: "Missing URL" }, // no url → dropped
			{ url: "https://example.com/no-title", snippet: "No title." }, // no title → dropped
			{ title: "  ", url: "https://example.com/blank-title", snippet: "Blank title." }, // blank title → dropped
			{
				title: "No snippet",
				url: "https://example.com/no-snippet",
				// snippet absent → coerced to ""
			},
		];
		const response = normalizeWebSearchResults("test query", raw);
		expect(response.query).toBe("test query");
		expect(response.results).toHaveLength(2);
		expect(response.results[0].title).toBe("Good entry");
		expect(response.results[1].snippet).toBe("");
	});

	it("passes through publishedDate and source only when string", () => {
		const raw = [
			{
				title: "With dates",
				url: "https://example.com",
				snippet: "Hello",
				publishedDate: "2025-06-01",
				source: "example.com",
			},
			{
				title: "Numeric source",
				url: "https://other.com",
				snippet: "",
				publishedDate: 12345, // not string → omitted
				source: true, // not string → omitted
			},
		];
		const response = normalizeWebSearchResults("dates", raw);
		expect(response.results).toHaveLength(2);
		expect(response.results[0].publishedDate).toBe("2025-06-01");
		expect(response.results[0].source).toBe("example.com");
		expect(response.results[1].publishedDate).toBeUndefined();
		expect(response.results[1].source).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// normalizeWebSearchResults — {results:[...]} envelope input
// ---------------------------------------------------------------------------

describe("normalizeWebSearchResults — envelope input", () => {
	it("accepts { results: [...] } shaped payload", () => {
		const raw = {
			results: [{ title: "Envelope hit", url: "https://envelope.example.com", snippet: "Found via envelope." }],
		};
		const response = normalizeWebSearchResults("envelope test", raw);
		expect(response.results).toHaveLength(1);
		expect(response.results[0].title).toBe("Envelope hit");
	});

	it("returns empty results for an unrecognised raw shape", () => {
		const response = normalizeWebSearchResults("bad shape", "not an array or object with results");
		expect(response.results).toHaveLength(0);
		expect(response.query).toBe("bad shape");
	});
});

// ---------------------------------------------------------------------------
// validateQuery
// ---------------------------------------------------------------------------

describe("validateQuery", () => {
	it("returns null for a real non-empty query", () => {
		const err: WebSearchError | null = validateQuery("TypeScript generics");
		expect(err).toBeNull();
	});

	it("returns an empty_query error for a blank string", () => {
		const err = validateQuery("   ");
		expect(err).not.toBeNull();
		expect(err?.code).toBe("empty_query");
	});

	it("returns an empty_query error for an empty string", () => {
		const err = validateQuery("");
		expect(err).not.toBeNull();
		expect(err?.code).toBe("empty_query");
	});
});
