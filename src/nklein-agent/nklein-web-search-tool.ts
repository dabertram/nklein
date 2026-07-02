import type { WebSearchError, WebSearchResponse } from "../core/web-search-contract";
import type { AgentTool } from "./sdk-agent-types";

/**
 * `web_search` — the §5.AC egress-gated online-retrieval tool for !Klein task sessions (step 3: tool binding).
 *
 * The tool itself is a thin, NEVER-THROWING adapter over an injected search capability (in production the
 * SearXNG client from [web-search-searxng.ts](../server/web-search-searxng.ts), which already enforces the
 * fail-closed egress gate, redirect pinning, timeouts, and result truncation). Whether this tool is attached
 * to a session AT ALL is decided at the session seams (`InMemoryNKleinTaskSessionService`) from the runtime
 * config — synthetic sessions (`::review` / `::plan-critique` / `::acceptance`) never get it.
 *
 * Error contract: every `WebSearchError` code maps to `{ ok: false, error, instruction }` where `instruction`
 * is ONE actionable sentence for the model (small local models act on instructions far more reliably than on
 * raw error prose). Success maps to `{ ok: true, query, results }`. A rejecting search capability (contract
 * violation — the client promises never to throw) degrades to the `backend_error` shape rather than crashing
 * the agent turn.
 */

export interface NKleinWebSearchToolOptions {
	/** The egress-gated search capability; never throws by contract (errors come back as `WebSearchError`). */
	search(query: string): Promise<WebSearchResponse | WebSearchError>;
}

/** Tool result on failure: the typed error code plus one actionable follow-up sentence for the model. */
export interface NKleinWebSearchToolErrorOutput {
	ok: false;
	error: WebSearchError["code"];
	instruction: string;
}

/** Tool result on success: the echoed query plus normalized, pre-truncated hits (title/url/snippet[/date/source]). */
export interface NKleinWebSearchToolSuccessOutput {
	ok: true;
	query: string;
	results: WebSearchResponse["results"];
}

export type NKleinWebSearchToolOutput = NKleinWebSearchToolSuccessOutput | NKleinWebSearchToolErrorOutput;

/** One actionable follow-up sentence per contract error code — what the model should DO next, not just what failed. */
const INSTRUCTION_BY_ERROR_CODE: Record<WebSearchError["code"], string> = {
	blocked_by_egress: "Online retrieval is disabled for this workspace; continue without web results.",
	no_backend: "No search backend is configured for this workspace; continue without web results.",
	backend_error:
		"The search backend failed for this query; retry once with a simpler query or continue without web results.",
	empty_query: "The query was empty; call web_search again with a precise, non-empty query.",
};

export function createNKleinWebSearchTool(options: NKleinWebSearchToolOptions): AgentTool {
	return {
		name: "web_search",
		description:
			"Search the web for up-to-date information (docs, releases, news). Results carry title/url/snippet; judge their freshness before relying on them.",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						"A precise search query (specific names, versions, error text); results carry title/url/snippet.",
				},
			},
			required: ["query"],
			additionalProperties: false,
		},
		async execute(input): Promise<NKleinWebSearchToolOutput> {
			// Defensive extraction: a missing/non-string query becomes "" so the client's validator returns the
			// typed `empty_query` error instead of this tool throwing on malformed model input.
			const rawQuery = (input as { query?: unknown } | null | undefined)?.query;
			const query = typeof rawQuery === "string" ? rawQuery : "";
			let outcome: WebSearchResponse | WebSearchError;
			try {
				outcome = await options.search(query);
			} catch (error) {
				// Contract violation by the injected capability — degrade to backend_error, never throw at the agent.
				outcome = {
					code: "backend_error",
					message: `web_search capability rejected unexpectedly (${error instanceof Error ? error.name : typeof error})`,
				};
			}
			if ("code" in outcome) {
				return { ok: false, error: outcome.code, instruction: INSTRUCTION_BY_ERROR_CODE[outcome.code] };
			}
			return { ok: true, query: outcome.query, results: outcome.results };
		},
	};
}
