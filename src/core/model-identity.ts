/**
 * Canonical model identity normalization — the single source of truth shared by the model registry
 * (key construction), the endpoint scheduler (shared-endpoint serialization), and the model-performance
 * telemetry aggregates. Keeping one implementation is what lets those surfaces *agree*: the registry must
 * not register `localhost` and `127.0.0.1` as two models while telemetry counts them as one (todo §5.Q).
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** Provider ids are case-insensitive; blank collapses to the `"unknown"` sentinel. */
export function normalizeProviderId(providerId: string): string {
	const normalized = providerId.trim().toLowerCase();
	return normalized.length > 0 ? normalized : "unknown";
}

/** Model ids are case-sensitive (vendor slugs vary); blank collapses to the `"unknown"` sentinel. */
export function normalizeModelId(modelId: string): string {
	const normalized = modelId.trim();
	return normalized.length > 0 ? normalized : "unknown";
}

/**
 * Canonicalize an endpoint URL so the same local server addressed differently maps to one key. All
 * loopback spellings (`localhost`/`127.0.0.1`/`0.0.0.0`/`::1`) address the same local server, so the host
 * is canonicalized to `localhost` and any trailing slash dropped. Non-URL strings are returned trimmed;
 * blank/absent endpoints return `null`.
 */
export function normalizeEndpoint(endpoint: string | null | undefined): string | null {
	if (typeof endpoint !== "string") {
		return null;
	}
	const trimmed = endpoint.trim();
	if (trimmed.length === 0) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return trimmed;
	}
	if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
		parsed.hostname = "localhost";
	}
	const path = parsed.pathname.replace(/\/+$/, "");
	return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}
