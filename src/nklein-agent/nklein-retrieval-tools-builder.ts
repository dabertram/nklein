import { buildSsrfGuardedPageFetcher } from "../chat/chat-browser-tool";
import { DEFAULT_LOCAL_CHAT_BASE_URL } from "../chat/local-chat-model";
import { browserFetchAdapter } from "../core/retrieval-fetch-adapter";
import { runRetrievalLoop } from "../core/retrieval-loop-driver";
import { searchHitsAdapter } from "../core/retrieval-search-adapter";
import { citedSynthesisAdapter } from "../core/retrieval-synthesis-adapter";
import { createSearxngWebSearchClient } from "../server/web-search-searxng";
import { LocalLlmClient } from "./nklein-local-llm-client";
import { createNKleinResearchTool } from "./nklein-research-tool";
import { shouldAttachRetrievalTools } from "./nklein-retrieval-tools-gate";
import type { AgentTool } from "./sdk-agent-types";

/** The retrieval egress configuration, read LIVE per build so a mid-session config-off fails closed immediately. */
export interface RetrievalConfigSnapshot {
	egressEnabled: boolean;
	agentWebResearchAllowed: boolean;
	searchBackendUrl: string | null;
}

/**
 * Service touchpoints. `getRetrievalConfig` MUST reflect the current service fields on every call (it gates egress and
 * feeds the SearXNG client) — do not capture it once. The model accessors resolve the task's local model for the
 * cited-synthesis step.
 */
export interface RetrievalToolsBuilderDeps {
	getRetrievalConfig(): RetrievalConfigSnapshot;
	resolveProviderId(taskId: string): string;
	getModelId(taskId: string): string;
	getEndpoint(taskId: string): string | null;
}

export interface RetrievalToolsBuilder {
	build(taskId: string): AgentTool[];
}

/**
 * Builds the §5.AC retrieval tools (SearXNG web_search + SSRF-guarded browse fetch + cited local-model synthesis) for
 * a task, or `[]` when the fail-closed gate says no egress. Extracted verbatim from
 * InMemoryNKleinTaskSessionService.buildRetrievalExtraTools. The egress lives entirely in the injected adapters
 * constructed here; the config is read LIVE (via deps.getRetrievalConfig) so a config-off mid-session fails closed on
 * the very next call, and `browse`/`fetch` enforce the SSRF floor unconditionally.
 */
export function createRetrievalToolsBuilder(deps: RetrievalToolsBuilderDeps): RetrievalToolsBuilder {
	function build(taskId: string): AgentTool[] {
		// §5.U: the fail-closed attach decision (synthetic ⇒ no egress; egress literally true; §5.L role gate; a search
		// backend is configured) is the pure `shouldAttachRetrievalTools` (unit-tested). Read the LIVE service fields so a
		// config-off mid-session fails closed on the very next call. The egress itself lives entirely in the injected
		// adapters (SearXNG search + SSRF-guarded browse fetch) constructed below.
		const config = deps.getRetrievalConfig();
		if (
			!shouldAttachRetrievalTools({
				taskId,
				egressEnabled: config.egressEnabled,
				agentWebResearchAllowed: config.agentWebResearchAllowed,
				searchBackendUrl: config.searchBackendUrl,
			})
		) {
			return [];
		}
		return [
			createNKleinResearchTool({
				runLoop: (input) =>
					runRetrievalLoop(
						input.question,
						{
							// §5.AC: enable lexical query-relevance ranking in the live loop — hits that actually match the
							// query terms are folded above ones that are merely fresh/authoritative.
							search: searchHitsAdapter(
								(query) =>
									createSearxngWebSearchClient({
										backendBaseUrl: deps.getRetrievalConfig().searchBackendUrl,
										egressEnabled: deps.getRetrievalConfig().egressEnabled,
									}).search(query),
								{ rerankByRelevance: true },
							),
							// PRIME DIRECTIVE #1: the retrieval loop fetches untrusted, backend/SEO-controllable result URLs,
							// so the egress MUST be SSRF-guarded. buildSsrfGuardedPageFetcher enforces the same floor as
							// browse_url (http/https only + pre-fetch DNS-resolve-all-IPs private/reserved refusal +
							// post-redirect re-check); a blocked URL throws and the driver skips that hit (fail-closed).
							fetch: browserFetchAdapter(buildSsrfGuardedPageFetcher()),
							// §5.AC: synthesize the gathered evidence into a CITED answer via the task's own local model
							// (validated 2026-07-04: a capable local model reliably emits the {claim,cite[]} contract). The
							// model call is fail-soft — any error / no model ⇒ "" ⇒ the loop returns evidence only (its prior
							// behavior), so enabling synthesis never degrades the result below evidence-only.
							synthesize: citedSynthesisAdapter(async (prompt) => {
								const modelId = deps.getModelId(taskId);
								if (!modelId) {
									return "";
								}
								try {
									const client = new LocalLlmClient({
										providerId: deps.resolveProviderId(taskId),
										modelId,
										baseUrl: deps.getEndpoint(taskId) ?? DEFAULT_LOCAL_CHAT_BASE_URL,
									});
									const res = await client.complete({
										messages: [{ role: "user", content: prompt }],
										sampling: { temperature: 0.2, maxTokens: 1500 },
									});
									return res.content;
								} catch {
									return ""; // fail-soft → evidence-only (unchanged from before synthesis was wired)
								}
							}),
							now: () => Date.now(),
						},
						{ ...(input.knowledgeDebt ? { knowledgeDebt: [...input.knowledgeDebt] } : {}) },
					),
			}),
		];
	}

	return { build };
}
