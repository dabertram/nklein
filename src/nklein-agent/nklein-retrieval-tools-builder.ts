import { buildSsrfGuardedPageFetcher } from "../chat/chat-browser-tool";
import { DEFAULT_LOCAL_CHAT_BASE_URL } from "../chat/local-chat-model";
import { browserFetchAdapter } from "../core/retrieval-fetch-adapter";
import { type RetrievalLoopResult, runRetrievalLoop } from "../core/retrieval-loop-driver";
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
	/** F4.R1 managed-local lease wrapper; absent keeps the user-supplied URL path byte-identical. */
	withSearchBackend?<T>(operation: (backendUrl: string) => Promise<T>): Promise<T>;
}

export interface RetrievalToolsBuilder {
	build(taskId: string): AgentTool[];
	/** Run the same gated loop directly for a trusted control-plane preflight (never bypasses the attach gate). */
	run(
		taskId: string,
		input: { question: string; knowledgeDebt?: readonly string[]; synthesize?: boolean },
	): Promise<RetrievalLoopResult>;
	isAvailable(taskId: string): boolean;
}

/**
 * Builds the §5.AC retrieval tools (SearXNG web_search + SSRF-guarded browse fetch + cited local-model synthesis) for
 * a task, or `[]` when the fail-closed gate says no egress. Extracted verbatim from
 * InMemoryNKleinTaskSessionService.buildRetrievalExtraTools. The egress lives entirely in the injected adapters
 * constructed here; the config is read LIVE (via deps.getRetrievalConfig) so a config-off mid-session fails closed on
 * the very next call, and `browse`/`fetch` enforce the SSRF floor unconditionally.
 */
export function createRetrievalToolsBuilder(deps: RetrievalToolsBuilderDeps): RetrievalToolsBuilder {
	function isAvailable(taskId: string): boolean {
		// §5.U: the fail-closed attach decision (synthetic ⇒ no egress; egress literally true; §5.L role gate; a search
		// backend is configured) is the pure `shouldAttachRetrievalTools` (unit-tested). Read the LIVE service fields so a
		// config-off mid-session fails closed on the very next call. The egress itself lives entirely in the injected
		// adapters (SearXNG search + SSRF-guarded browse fetch) constructed below.
		const config = deps.getRetrievalConfig();
		return shouldAttachRetrievalTools({
			taskId,
			egressEnabled: config.egressEnabled,
			agentWebResearchAllowed: config.agentWebResearchAllowed,
			searchBackendUrl: config.searchBackendUrl,
		});
	}

	async function run(
		taskId: string,
		input: { question: string; knowledgeDebt?: readonly string[]; synthesize?: boolean },
	): Promise<RetrievalLoopResult> {
		if (!isAvailable(taskId)) {
			throw new Error("Online retrieval is not available for this task.");
		}
		return await runRetrievalLoop(
			input.question,
			{
				// §5.AC: enable lexical query-relevance ranking in the live loop — hits that actually match the
				// query terms are folded above ones that are merely fresh/authoritative.
				search: searchHitsAdapter(
					(query) => {
						const searchAt = (backendUrl: string) =>
							createSearxngWebSearchClient({
								backendBaseUrl: backendUrl,
								egressEnabled: deps.getRetrievalConfig().egressEnabled,
							}).search(query);
						const configured = deps.getRetrievalConfig().searchBackendUrl;
						return deps.withSearchBackend ? deps.withSearchBackend(searchAt) : searchAt(configured ?? "");
					},
					{ rerankByRelevance: true },
				),
				// PRIME DIRECTIVE #1: the retrieval loop fetches untrusted, backend/SEO-controllable result URLs,
				// so the egress MUST be SSRF-guarded. buildSsrfGuardedPageFetcher enforces the same floor as
				// browse_url (http/https only + pre-fetch DNS-resolve-all-IPs private/reserved refusal +
				// post-redirect re-check); a blocked URL throws and the driver skips that hit (fail-closed).
				fetch: browserFetchAdapter(buildSsrfGuardedPageFetcher()),
				// The agent-facing tool synthesizes through the task's local model. The trusted decomposition preflight
				// passes `synthesize:false`: it needs cited evidence, not a second model turn before admission (which could
				// contend with the very architect turn it is preparing).
				...(input.synthesize === false
					? {}
					: {
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
						}),
				now: () => Date.now(),
			},
			{ ...(input.knowledgeDebt ? { knowledgeDebt: [...input.knowledgeDebt] } : {}) },
		);
	}

	function build(taskId: string): AgentTool[] {
		if (!isAvailable(taskId)) {
			return [];
		}
		return [
			createNKleinResearchTool({
				runLoop: (input) => run(taskId, input),
			}),
		];
	}

	return { build, run, isAvailable };
}
