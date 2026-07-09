import type { RuntimeNKleinEndpointModelDiscoveryResponse, RuntimeNKleinProviderModel } from "../core/api-contract";
import { createDefaultLmsRunner, fetchLmsPsModelsCached, type LmsPsModel } from "../core/lms-ps-json";
import { modelDiscoveryCacheTtlMs } from "../core/model-discovery-throttle";
import { fetchLiteLlmBaseUrlModels, fetchLmStudioBaseUrlModels } from "./nklein-baseurl-model-discovery";
import { selectLiveContextWindowRefreshes } from "./nklein-context-window-refresh";
import { appendMissingModels } from "./nklein-litellm-model-list";
import { getDefaultNKleinModelRegistry } from "./nklein-model-registry";
import { buildDiscoveredModelSourceUrls } from "./nklein-provider-discovery-urls";
import { isLiveOnlyProviderId } from "./nklein-provider-id-classification";
import {
	extractDiscoveredModelsFromPayload,
	mergeProviderModelsWithContextWindowFallback,
	mergeProviderModelsWithModelRegistry,
	normalizeContextWindow,
	sortDiscoveredProviderModels,
	toRuntimeProviderModel,
} from "./nklein-provider-model-parsing";
import { getSdkProviderSettings, listSdkProviderModels, type SdkProviderSettings } from "./sdk-provider-boundary";

/**
 * Provider model DISCOVERY (todo §5.U — extracted from nklein-provider-service.ts as a cohesive sibling module).
 * Owns the roster-discovery flow end to end: the explicit endpoint probe, the TTL-cached roster load with per-provider
 * fallback (litellm / lmstudio baseUrl merges), and the registry-window-measured overlay. Its coupling surface is all
 * imports plus its OWN module-level cache Map, so the move is behavior-preserving — the provider service imports the
 * two entry points its factory uses ({@link discoverModelsFromEndpoint}, {@link loadProviderModelsWithMeasuredWindows})
 * and re-exports the public helpers ({@link loadProviderModelsWithFallback}, {@link clearProviderModelDiscoveryCache}).
 */

const DEFAULT_GENERIC_MODEL_LIST_TIMEOUT_MS = 30 * 1000;

export async function discoverModelsFromEndpoint(input: {
	baseUrl: string;
	apiKey?: string | null;
	modelsSourceUrl?: string | null;
	timeoutMs?: number | null;
}): Promise<RuntimeNKleinEndpointModelDiscoveryResponse> {
	const sourceUrls = buildDiscoveredModelSourceUrls({
		baseUrl: input.baseUrl,
		modelsSourceUrl: input.modelsSourceUrl,
	});
	if (sourceUrls.length === 0) {
		throw new Error("Could not derive a model-discovery URL from the provided endpoint.");
	}
	const timeoutMs =
		typeof input.timeoutMs === "number" && input.timeoutMs > 0
			? Math.trunc(input.timeoutMs)
			: DEFAULT_GENERIC_MODEL_LIST_TIMEOUT_MS;
	const headers: Record<string, string> = {};
	if (input.apiKey?.trim()) {
		headers.Authorization = `Bearer ${input.apiKey.trim()}`;
	}
	for (const sourceUrl of sourceUrls) {
		try {
			const response = await globalThis.fetch(sourceUrl, {
				method: "GET",
				headers,
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (!response.ok) {
				continue;
			}
			const payload = (await response.json()) as unknown;
			const models = sortDiscoveredProviderModels(
				extractDiscoveredModelsFromPayload(payload, sourceUrl).map((model) => toRuntimeProviderModel(model)),
			);
			if (models.length > 0) {
				return {
					modelSourceUrl: sourceUrl,
					models,
				};
			}
		} catch {
			// Try the next candidate URL.
		}
	}
	throw new Error(
		`Could not discover models from ${input.modelsSourceUrl?.trim() || input.baseUrl.trim()}. Ensure the local endpoint is reachable and exposes a compatible /models route.`,
	);
}
/**
 * Roster discovery is throttled by a short TTL cache so the live `/models` (LM Studio `/api/v0/models`) catalog endpoint
 * isn't hammered — the roster only needs to be ~fresh (30 s default; `NKLEIN_MODEL_DISCOVERY_CACHE_TTL_MS` overrides, `0`
 * disables). Keyed by provider + base URL so distinct endpoints don't collide. The explicit "discover endpoint" flow
 * (`discoverEndpointModels`, user-triggered) does NOT go through here, so it stays fresh.
 */
const providerModelDiscoveryCache = new Map<string, { at: number; models: RuntimeNKleinProviderModel[] }>();

/** Clear the roster-discovery TTL cache (tests + an explicit "refresh now" path). */
export function clearProviderModelDiscoveryCache(): void {
	providerModelDiscoveryCache.clear();
}

function lmsPsModelsToRuntimeProviderModels(models: readonly LmsPsModel[]): RuntimeNKleinProviderModel[] {
	return models.map((model) => {
		const contextWindow = normalizeContextWindow(model.contextLength);
		return {
			id: model.identifier,
			name: model.identifier,
			...(model.isEmbedding ? { type: "embeddings" } : {}),
			...(contextWindow !== null ? { contextWindow } : {}),
		};
	});
}

async function loadProviderModelsWithFallbackForSettings(
	providerId: string,
	settingsOverride?: SdkProviderSettings | null,
): Promise<RuntimeNKleinProviderModel[]> {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return [];
	}

	const settings = settingsOverride ?? getSdkProviderSettings(normalizedProviderId);
	const ttlMs = modelDiscoveryCacheTtlMs();
	const cacheKey = `${normalizedProviderId}::${settings?.baseUrl ?? ""}`;
	const now = Date.now();
	if (ttlMs > 0) {
		const cached = providerModelDiscoveryCache.get(cacheKey);
		if (cached && now - cached.at < ttlMs) {
			return cached.models;
		}
	}

	const providerModels = await listSdkProviderModels(normalizedProviderId).catch(() => []);
	let resolved: RuntimeNKleinProviderModel[];
	if (normalizedProviderId === "litellm") {
		const liteLlmModels = await fetchLiteLlmBaseUrlModels(settings);
		const mergedModels = mergeProviderModelsWithContextWindowFallback(providerModels, liteLlmModels);
		resolved = appendMissingModels(mergedModels, liteLlmModels);
	} else if (normalizedProviderId === "lmstudio") {
		const lmStudioModels = await fetchLmStudioBaseUrlModels(settings);
		const lmsPsModels = lmsPsModelsToRuntimeProviderModels(
			await fetchLmsPsModelsCached(createDefaultLmsRunner()).catch(() => []),
		);
		const loadedModels = appendMissingModels(
			mergeProviderModelsWithContextWindowFallback(lmStudioModels, lmsPsModels, {
				preferFallbackContextWindow: true,
			}),
			lmsPsModels,
		);
		resolved = mergeProviderModelsWithContextWindowFallback(loadedModels, providerModels);
	} else {
		resolved = providerModels;
	}
	if (ttlMs > 0) {
		providerModelDiscoveryCache.set(cacheKey, { at: now, models: resolved });
	}
	return resolved;
}

export async function loadProviderModelsWithFallback(providerId: string): Promise<RuntimeNKleinProviderModel[]> {
	return await loadProviderModelsWithFallbackForSettings(providerId);
}

export async function loadProviderModelsWithMeasuredWindows(
	providerId: string,
	settingsOverride?: SdkProviderSettings | null,
): Promise<RuntimeNKleinProviderModel[]> {
	const providerModels = await loadProviderModelsWithFallbackForSettings(providerId, settingsOverride);
	try {
		const snapshot = await getDefaultNKleinModelRegistry().getSnapshot();
		const registryEntries = Object.values(snapshot.models);
		const mergedModels = mergeProviderModelsWithModelRegistry(providerId, providerModels, registryEntries);
		if (isLiveOnlyProviderId(providerId)) {
			// Keep the registry's context window in step with the LIVE loaded window: a local model is often loaded at a
			// context length smaller than its max, and a stale/max value left in the registry would otherwise drive the
			// context budget (overflow risk). Fire-and-forget; only fires for entries whose loaded window actually changed.
			for (const refresh of selectLiveContextWindowRefreshes({
				providerId,
				discoveredModels: providerModels,
				registryEntries,
			})) {
				void getDefaultNKleinModelRegistry()
					.recordContextWindow({
						providerId: refresh.providerId,
						modelId: refresh.modelId,
						endpoint: refresh.endpoint,
						advertisedContextWindow: refresh.contextWindow,
					})
					.catch(() => undefined);
			}
			return mergedModels;
		}
		const modelIds = new Set(mergedModels.map((model) => model.id));
		const normalizedProviderId = providerId.trim().toLowerCase();
		const registryOnlyModels = registryEntries.flatMap((entry) => {
			if (entry.providerId.trim().toLowerCase() !== normalizedProviderId || modelIds.has(entry.modelId)) {
				return [];
			}
			const contextWindow = normalizeContextWindow(entry.contextWindow.effective);
			if (contextWindow === null) {
				return [];
			}
			modelIds.add(entry.modelId);
			return [
				{
					id: entry.modelId,
					name: entry.modelId,
					contextWindow,
				},
			];
		});
		return [...mergedModels, ...registryOnlyModels];
	} catch {
		return providerModels;
	}
}
