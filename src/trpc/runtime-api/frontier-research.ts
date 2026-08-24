import { homedir } from "node:os";
import { buildSsrfGuardedPageFetcher } from "../../chat/chat-browser-tool";
import { loadRuntimeConfig } from "../../config/runtime-config";
import { effectiveRetrievalSearchBackendUrl } from "../../config/runtime-config-retrieval-resolver";
import type { FrontierEvidenceSource } from "../../core/frontier-research";
import { createDefaultLmsRunner, fetchLmsPsModelsCached } from "../../core/lms-ps-json";
import { MECHANISM_REGISTRY } from "../../core/mechanism-observation-audit";
import { lookupModelCapability } from "../../core/model-capability-catalog";
import { browserFetchAdapter } from "../../core/retrieval-fetch-adapter";
import { runRetrievalLoop } from "../../core/retrieval-loop-driver";
import { searchHitsAdapter } from "../../core/retrieval-search-adapter";
import { LocalLlmClient } from "../../nklein-agent/nklein-local-llm-client";
import { createFrontierResearchRunner, type FrontierResearchRunner } from "../../server/frontier-research-runner";
import { createSearxngWebSearchClient } from "../../server/web-search-searxng";

/**
 * Frontier-radar composition — wires the runner to the REAL seams: the egress-gated §5.AC retrieval loop
 * (SearXNG search + SSRF-guarded fetch; fail-closed when retrieval egress is off), the largest LOADED
 * local model as the synthesis engine (largest-resident is the deliberate 0.0.1 heuristic for "most
 * capable" — documented, replaceable by the capability blend later), the hand-maintained
 * MECHANISM_REGISTRY as the "self" half of the reflection, and the device RAM from the machine-aware
 * loader knob. Config is read LIVE per call so an egress flip mid-session takes effect on the next run.
 */

const LOCAL_GATEWAY_BASE_URL = "http://127.0.0.1:1234/v1";

function deviceRamGb(): number | null {
	const raw = Number(process.env.NKLEIN_DEVICE_RAM_GB);
	return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null;
}

async function retrievalSettings(): Promise<{ egressEnabled: boolean; searchBackendUrl: string | null }> {
	const config = await loadRuntimeConfig(homedir());
	return {
		egressEnabled: config.retrievalEgressEnabled === true,
		searchBackendUrl: effectiveRetrievalSearchBackendUrl({
			providerMode: config.retrievalProviderMode,
			searchBackendUrl: config.retrievalSearchBackendUrl,
		}),
	};
}

async function loadedModels(): Promise<{ identifier: string; modelKey: string; contextLength: number | null }[]> {
	const models = await fetchLmsPsModelsCached(createDefaultLmsRunner());
	return models
		.filter((model) => !model.isEmbedding)
		.map((model) => ({
			identifier: model.identifier,
			modelKey: model.modelKey,
			contextLength: model.contextLength,
		}));
}

/** Catalog tool-use verdict rank — the capability half of the "most capable resident" pick. */
const TOOL_USE_RANK: Record<string, number> = {
	TOOL_NATIVE: 4,
	TOOL_CAPABLE: 3,
	UNKNOWN: 2,
	TOOL_WEAK: 1,
	TOOL_UNSUITABLE: 0,
};

let singleton: FrontierResearchRunner | null = null;

export interface FrontierRunnerWiring {
	/** The runtime's managed-search LEASE: starts the docker SearXNG on demand and hands the live URL.
	 *  Without it the radar's first run silently searched a never-started backend (2026-08-24). */
	withSearchBackend?: <T>(operation: (backendUrl: string) => Promise<T>) => Promise<T>;
	/** Loud failures — the runner's refusals and errors must reach the runtime log. */
	onLog?: (line: string) => void;
}

/** The process-wide radar runner (config re-read per call keeps the egress gate live). */
export function getFrontierResearchRunner(wiring?: FrontierRunnerWiring): FrontierResearchRunner {
	if (singleton) {
		return singleton;
	}
	singleton = createFrontierResearchRunner({
		isEgressEnabled: async () => (await retrievalSettings()).egressEnabled,
		runRetrieval: async (question: string): Promise<{ sources: FrontierEvidenceSource[] }> => {
			const settings = await retrievalSettings();
			if (!settings.egressEnabled || !settings.searchBackendUrl) {
				throw new Error("retrieval egress is off or no search backend is configured");
			}
			const backendUrl = settings.searchBackendUrl;
			const searchAt = (url: string, query: string) =>
				createSearxngWebSearchClient({
					backendBaseUrl: url,
					egressEnabled: settings.egressEnabled,
				}).search(query);
			const result = await runRetrievalLoop(
				question,
				{
					search: searchHitsAdapter(
						(query) =>
							wiring?.withSearchBackend
								? wiring.withSearchBackend((url) => searchAt(url, query))
								: searchAt(backendUrl, query),
						{ rerankByRelevance: true },
					),
					// PRIME DIRECTIVE #1: fetched result URLs are untrusted — same SSRF floor as browse_url.
					fetch: browserFetchAdapter(buildSsrfGuardedPageFetcher()),
					now: () => Date.now(),
				},
				{ maxIterations: 2, maxFetchPerQuery: 3, freshnessSensitive: true },
			);
			return {
				sources: result.evidence.map((entry, index) => ({
					url: entry.url ?? `evidence-${index}`,
					title: entry.url ?? `source ${index + 1}`,
					text: entry.text,
				})),
			};
		},
		createSynthesisClient: pickSynthesisClient,
		installedModels: async () => (await loadedModels()).map((model) => model.identifier),
		mechanisms: async () => MECHANISM_REGISTRY.map((entry) => `${entry.item}: ${entry.category}`).slice(0, 120),
		deviceRamGb,
		...(wiring?.onLog ? { onLog: wiring.onLog } : {}),
	});
	return singleton;
}

/** Most capable resident = best catalog tool-use verdict, then longest loaded context (0.0.1 heuristic). */
export async function pickSynthesisClient(): Promise<{
	modelId: string;
	generateStructured: (input: {
		messages: { role: "system" | "user"; content: string }[];
		schema: Record<string, unknown>;
	}) => Promise<unknown>;
} | null> {
	const models = await loadedModels();
	const best = [...models].sort((left, right) => {
		const leftRank = TOOL_USE_RANK[lookupModelCapability(left.modelKey)?.toolUse ?? "UNKNOWN"] ?? 2;
		const rightRank = TOOL_USE_RANK[lookupModelCapability(right.modelKey)?.toolUse ?? "UNKNOWN"] ?? 2;
		if (leftRank !== rightRank) return rightRank - leftRank;
		return (right.contextLength ?? 0) - (left.contextLength ?? 0);
	})[0];
	if (!best) {
		return null;
	}
	const client = new LocalLlmClient({
		providerId: "lmstudio",
		modelId: best.identifier,
		baseUrl: LOCAL_GATEWAY_BASE_URL,
		timeoutMs: 600_000,
	});
	return {
		modelId: best.identifier,
		generateStructured: (input) =>
			client.generateStructured({
				messages: input.messages,
				jsonSchema: { name: "frontier_synthesis", schema: input.schema },
				parse: (value) => value,
			}),
	};
}
