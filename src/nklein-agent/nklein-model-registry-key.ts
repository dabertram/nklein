import { normalizeEndpoint, normalizeModelId, normalizeProviderId } from "../core/model-identity";
import { isLocalProvider } from "./nklein-local-only-policy";
import type { NKleinModelRegistryKeyInput } from "./nklein-model-registry";

/**
 * Pure model-registry key/endpoint builders, extracted from nklein-model-registry. They derive the
 * canonical registry key and the shared local-endpoint id from a (provider, model, endpoint) tuple.
 * No registry state (the input type is a type-only import, erased → no runtime cycle); the registry
 * re-exports these so existing importers are unaffected.
 */

/**
 * The shared local-endpoint id for a (provider, model, endpoint) — the per-model key the swarm
 * scheduler serializes on (or null for non-local providers, which don't share a host endpoint). Trims
 * the model id so a stray-whitespace value doesn't change the key.
 */
export function buildSharedLocalEndpointId(input: {
	providerId: string;
	modelId: string;
	endpoint: string | null;
}): string | null {
	if (!isLocalProvider(input.providerId, input.endpoint)) {
		return null;
	}
	const endpoint = input.endpoint ?? `${input.providerId}:default`;
	const modelId = input.modelId.trim();
	return modelId.length > 0 ? `${endpoint}#${modelId}` : endpoint;
}

/** The canonical `provider:model:endpoint` registry key (normalized coordinates, endpoint defaulting to "default"). */
export function buildNKleinModelRegistryKey(input: NKleinModelRegistryKeyInput): string {
	const providerId = normalizeProviderId(input.providerId);
	const modelId = normalizeModelId(input.modelId);
	const endpoint = normalizeEndpoint(input.endpoint) ?? "default";
	return `${providerId}:${modelId}:${endpoint}`;
}
