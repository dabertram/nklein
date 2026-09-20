/**
 * `lookup` policy constants — PURE. The fact-check tool is DEFAULT OFF (`NKLEIN_LOOKUP`), like every other
 * behaviour-changing flag (registered in `feature-flag-registry.ts`). When on:
 * - the sandbox egress proxy publishes its worker listener on host loopback so the trusted runtime's lookup client
 *   can route THROUGH it (per-task credential ⇒ attributable audit records);
 * - the `ecosystem:lookup` pack (the search engine's HTML host) joins the static allowlist;
 * - result-page fetches ride time-bounded per-task grants (`egress-task-grants.ts`) — never a widened static list.
 */

import { isTruthyEnv } from "./env-flag";

export const LOOKUP_ENABLED_ENV = "NKLEIN_LOOKUP";
/** The ecosystem pack name whose hosts the search leg needs (see `sandbox-egress-ecosystems.ts`). */
export const LOOKUP_ECOSYSTEM_PACK = "lookup";
/** The one host the search leg contacts — DuckDuckGo's server-rendered HTML endpoint (no API key, no JavaScript). */
export const LOOKUP_SEARCH_HOSTS: readonly string[] = ["html.duckduckgo.com"];

export function isLookupEnabled(): boolean {
	// Literal `process.env.NKLEIN_LOOKUP` on purpose: the F4.8b flag-coverage ratchet finds gate sites by that spelling.
	return isTruthyEnv(process.env.NKLEIN_LOOKUP);
}
