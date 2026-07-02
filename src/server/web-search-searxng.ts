/**
 * §5.AC step 2 — egress-gated `web_search` HTTP client against SearXNG's JSON API (`/search?format=json`).
 *
 * HOST-side, trusted-runtime module (the sandbox network stays `none`; retrieval HTTP runs here as control-plane
 * I/O). Hard constraints, in gate order:
 *
 *   1. **Fail closed on egress.** `egressEnabled` must be *literally* `true` or every search returns the contract's
 *      `blocked_by_egress` error BEFORE any URL is constructed or touched — the opt-in, default-off posture
 *      (todo §5.AC "EGRESS GREENLIT") is enforced here, not just in config.
 *   2. **No backend, no request.** A `null` (or blank) `backendBaseUrl` yields the `no_backend` error.
 *   3. **No redirect following.** The request is pinned to the configured origin via `redirect: "error"` — a
 *      redirecting backend is a misconfiguration and maps to `backend_error`, never a silent hop to another origin.
 *   4. **Bounded and quiet failures.** Requests are aborted after `timeoutMs`; non-2xx / network / timeout / JSON
 *      parse failures become `backend_error` with a concise reason (status code or error class) — response bodies
 *      are never echoed into the error (they can be huge and untrusted).
 *
 * Shapes are owned by [web-search-contract.ts](../core/web-search-contract.ts) (the single source of truth); this
 * module only maps SearXNG's wire fields (`content` → `snippet`, `engine` → `source`) and defers all coercion /
 * malformed-entry dropping to `normalizeWebSearchResults`.
 */

import {
	normalizeWebSearchResults,
	validateQuery,
	type WebSearchError,
	type WebSearchResponse,
} from "../core/web-search-contract";

/** Configuration for {@link createSearxngWebSearchClient}, resolved from runtime config by the caller. */
export interface SearxngWebSearchClientOptions {
	/** From runtime config: null ⇒ every search returns the no-backend WebSearchError. */
	backendBaseUrl: string | null;
	/** From runtime config: false ⇒ every search returns the egress-blocked WebSearchError (fail closed). */
	egressEnabled: boolean;
	/** Abort the backend request after this many milliseconds (default 15_000). */
	timeoutMs?: number;
	/** Maximum hits surfaced to the agent — truncated AFTER normalization (default 8). */
	maxResults?: number;
	/** Injected for tests; defaults to `globalThis.fetch`. Never hit a real network in unit tests. */
	fetchImpl?: typeof fetch;
}

/** The egress-gated search capability handed to the §5.AC tool binding (step 3). */
export interface SearxngWebSearchClient {
	/** Run one search; never throws — failures come back as the contract's typed `WebSearchError`. */
	search(query: string): Promise<WebSearchResponse | WebSearchError>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESULTS = 8;

/**
 * Map SearXNG's result entries onto the contract's field names so `normalizeWebSearchResults` can do the actual
 * validation/dropping. SearXNG hits look like `{ title, url, content, publishedDate?, engine? }`; only the field
 * names differ from the contract (`content` → `snippet`, `engine` → `source`). Non-object entries and unrecognised
 * payload shapes pass through untouched — the tolerant normalizer discards them.
 */
function mapSearxngPayload(payload: unknown): unknown[] {
	let rawEntries: unknown[];
	if (Array.isArray(payload)) {
		rawEntries = payload;
	} else if (
		payload !== null &&
		typeof payload === "object" &&
		"results" in payload &&
		Array.isArray((payload as { results: unknown }).results)
	) {
		rawEntries = (payload as { results: unknown[] }).results;
	} else {
		return [];
	}

	return rawEntries.map((entry) => {
		if (entry === null || typeof entry !== "object") {
			return entry;
		}
		const record = entry as Record<string, unknown>;
		return {
			title: record.title,
			url: record.url,
			snippet: record.content,
			publishedDate: record.publishedDate,
			source: record.engine,
		};
	});
}

/** Concise, body-free reason for a rejected fetch: timeout beats error class (an abort IS our timeout firing). */
function describeFetchFailure(error: unknown, timedOut: boolean, timeoutMs: number): string {
	if (timedOut) {
		return `web_search backend request timed out after ${timeoutMs}ms`;
	}
	const errorClass = error instanceof Error ? error.name : typeof error;
	return `web_search backend request failed (${errorClass})`;
}

/**
 * Create the egress-gated SearXNG client. Gate order is load-bearing: query validation, then the egress gate
 * (before ANY URL work), then backend presence, then the actual request — see the module doc-comment.
 */
export function createSearxngWebSearchClient(options: SearxngWebSearchClientOptions): SearxngWebSearchClient {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	return {
		async search(query: string): Promise<WebSearchResponse | WebSearchError> {
			const queryError = validateQuery(query);
			if (queryError !== null) {
				return queryError;
			}

			// Fail closed: only a literal `true` opens the gate — no request, no URL construction, otherwise.
			if (options.egressEnabled !== true) {
				return {
					code: "blocked_by_egress",
					message:
						"web_search egress is disabled — enable retrieval egress in settings to allow outbound searches",
				};
			}

			if (options.backendBaseUrl === null || options.backendBaseUrl.trim() === "") {
				return {
					code: "no_backend",
					message: "no web_search backend configured — set the SearXNG endpoint URL in settings",
				};
			}

			const base = options.backendBaseUrl.trim().replace(/\/+$/, "");
			const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;

			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			try {
				let response: Response;
				try {
					response = await fetchImpl(url, {
						method: "GET",
						headers: { "User-Agent": "nklein-retrieval" },
						// A redirecting backend is a misconfiguration — never follow the query to another origin.
						redirect: "error",
						signal: controller.signal,
					});
				} catch (error) {
					return {
						code: "backend_error",
						message: describeFetchFailure(error, controller.signal.aborted, timeoutMs),
					};
				}

				if (!response.ok) {
					return {
						code: "backend_error",
						message: `web_search backend returned HTTP ${response.status}`,
					};
				}

				let payload: unknown;
				try {
					payload = await response.json();
				} catch {
					return {
						code: "backend_error",
						message: "web_search backend returned a non-JSON response",
					};
				}

				const normalized = normalizeWebSearchResults(query, mapSearxngPayload(payload));
				return { query: normalized.query, results: normalized.results.slice(0, maxResults) };
			} finally {
				clearTimeout(timer);
			}
		},
	};
}
