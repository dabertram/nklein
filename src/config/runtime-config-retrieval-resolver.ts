import type { RuntimeConfigState, RuntimeGlobalConfigFileShape } from "./runtime-config-types";

/** §5.AC egress-gated online retrieval — OFF BY DEFAULT (user 2026-07-02: opt-in; false keeps every retrieval path dormant). */
export const DEFAULT_RETRIEVAL_EGRESS_ENABLED = false;
/** §5.AC SearXNG-compatible search endpoint base URL — no backend configured by default. */
export const DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL: string | null = null;
export const RETRIEVAL_PROVIDER_MODES = ["none", "searxng_url", "managed_local"] as const;
export type RuntimeRetrievalProviderMode = (typeof RETRIEVAL_PROVIDER_MODES)[number];
export const DEFAULT_RETRIEVAL_PROVIDER_MODE: RuntimeRetrievalProviderMode = "none";
export const MANAGED_RETRIEVAL_BACKEND_URL = "http://127.0.0.1:18888";

/** Fail-closed egress-gate normalizer: only a literal boolean `true` enables egress — any other value is `false`. */
export function normalizeRetrievalEgressEnabled(value: unknown): boolean {
	return value === true;
}

/** Trim a configured search-backend base URL to a non-empty string, or null (empty/whitespace/non-string → null). */
export function normalizeRetrievalSearchBackendUrl(value: unknown): string | null {
	if (typeof value !== "string") {
		return DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL;
	}
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : DEFAULT_RETRIEVAL_SEARCH_BACKEND_URL;
}

/** Migrate old URL-only configs to the explicit user-supplied mode; otherwise fail closed to none. */
export function normalizeRetrievalProviderMode(
	value: unknown,
	legacyBackendUrl?: unknown,
): RuntimeRetrievalProviderMode {
	if (RETRIEVAL_PROVIDER_MODES.includes(value as RuntimeRetrievalProviderMode)) {
		return value as RuntimeRetrievalProviderMode;
	}
	return normalizeRetrievalSearchBackendUrl(legacyBackendUrl) ? "searxng_url" : DEFAULT_RETRIEVAL_PROVIDER_MODE;
}

export function effectiveRetrievalSearchBackendUrl(input: {
	providerMode?: unknown;
	searchBackendUrl?: unknown;
}): string | null {
	const mode = normalizeRetrievalProviderMode(input.providerMode, input.searchBackendUrl);
	if (mode === "managed_local") return MANAGED_RETRIEVAL_BACKEND_URL;
	if (mode === "searxng_url") return normalizeRetrievalSearchBackendUrl(input.searchBackendUrl);
	return null;
}

/** The online-retrieval (§5.AC) fields of the resolved runtime config. */
export type RuntimeRetrievalConfigFields = Pick<
	RuntimeConfigState,
	"retrievalEgressEnabled" | "retrievalProviderMode" | "retrievalSearchBackendUrl"
>;

/**
 * Resolve the online-retrieval config block from a stored global config, each field falling back to its
 * default. Mirrors the sandbox sub-resolver (§5.U pattern) so the big config-state assembly reads as a set
 * of focused, independently-tested sub-resolvers. The egress flag is fail-closed: anything but a literal
 * `true` resolves to `false`, keeping every retrieval path dormant.
 */
export function resolveRuntimeRetrievalConfig(
	globalConfig: RuntimeGlobalConfigFileShape | null,
): RuntimeRetrievalConfigFields {
	return {
		retrievalEgressEnabled: normalizeRetrievalEgressEnabled(globalConfig?.retrievalEgressEnabled),
		retrievalProviderMode: normalizeRetrievalProviderMode(
			globalConfig?.retrievalProviderMode,
			globalConfig?.retrievalSearchBackendUrl,
		),
		retrievalSearchBackendUrl: normalizeRetrievalSearchBackendUrl(globalConfig?.retrievalSearchBackendUrl),
	};
}
