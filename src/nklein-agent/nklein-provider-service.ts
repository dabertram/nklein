// !Klein-facing facade over the SDK-backed provider store.
// It resolves provider settings, model catalogs, OAuth flows, and launch
// config without leaking SDK details into runtime-api.ts or the UI.

import { z } from "zod";
import type {
	RuntimeNKleinAccountBalanceResponse,
	RuntimeNKleinAccountOrganizationsResponse,
	RuntimeNKleinAccountProfileResponse,
	RuntimeNKleinAccountSwitchResponse,
	RuntimeNKleinDeviceAuthCompleteResponse,
	RuntimeNKleinDeviceAuthStartResponse,
	RuntimeNKleinEndpointModelDiscoveryResponse,
	RuntimeNKleinKanbanAccessResponse,
	RuntimeNKleinOauthLoginResponse,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderCatalogResponse,
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderModelsResponse,
	RuntimeNKleinProviderSettings,
	RuntimeNKleinProviderSettingsSaveResponse,
	RuntimeNKleinReasoningEffort,
} from "../core/api-contract";
import { toErrorMessage as formatErrorMessage } from "../core/error-message";
import { modelDiscoveryCacheTtlMs } from "../core/model-discovery-throttle";
import { openInBrowser } from "../server/browser";
import { assertNKleinContextWindowPolicy } from "./nklein-context-window-policy";
import { selectLiveContextWindowRefreshes } from "./nklein-context-window-refresh";
import {
	appendMissingModels,
	LITELLM_MODEL_LIST_PATHNAMES,
	LITELLM_MODELS_RESPONSE_SCHEMA,
	resolveLiteLlmModelListHeaders,
	resolveLiteLlmModelListItemId,
} from "./nklein-litellm-model-list";
import { assertLocalProviderAllowed, isLocalProvider } from "./nklein-local-only-policy";
import { resolveManagedProviderLaunchApiKey } from "./nklein-managed-provider-credentials";
import { getDefaultNKleinModelRegistry } from "./nklein-model-registry";
import { hasOauthAccessToken, normalizeEpochMs, resolveVisibleApiKey } from "./nklein-provider-credential-helpers";
import { buildDiscoveredModelSourceUrls, normalizeLmStudioModelListBaseUrl } from "./nklein-provider-discovery-urls";
import { isLiveOnlyProviderId, isManagedOauthProviderId } from "./nklein-provider-id-classification";
import {
	extractDiscoveredModelsFromPayload,
	mergeProviderModelsWithContextWindowFallback,
	mergeProviderModelsWithModelRegistry,
	normalizeContextWindow,
	sortDiscoveredProviderModels,
	toLmStudioModels,
	toRuntimeProviderModel,
} from "./nklein-provider-model-parsing";
import { readKanbanSelectedProviderId, writeKanbanSelectedProviderId } from "./nklein-provider-selection-store";
import { toProviderSettingsSummary, toRuntimeReasoningEffort } from "./nklein-provider-settings-summary";
import { ensureWorkosPrefix, stripWorkosPrefix, toProviderApiKey } from "./nklein-provider-workos-token.js";
import { createKanbanNKleinLogger } from "./nklein-runtime-logger";
import {
	addSdkCustomProvider,
	completeNKleinDeviceAuth as completeSdkDeviceAuth,
	deleteSdkCustomProvider,
	fetchSdkFeaturebaseToken,
	fetchSdkNKleinAccountBalance,
	fetchSdkNKleinAccountProfile,
	fetchSdkNKleinUserRemoteConfig,
	fetchSdkOrganizationBalance,
	fetchSdkOrgData,
	getLastUsedSdkProviderSettings,
	getSdkProviderSettings,
	listSdkProviderCatalog,
	listSdkProviderModels,
	loginManagedOauthProvider,
	type ManagedNKleinOauthProviderId,
	refreshManagedOauthCredentials,
	SDK_DEFAULT_MODEL_ID,
	SDK_DEFAULT_PROVIDER_ID,
	type SdkCustomProviderCapability,
	type SdkProviderSettings,
	saveSdkProviderSettings,
	startNKleinDeviceAuth as startSdkDeviceAuth,
	switchSdkNKleinAccount,
	updateSdkCustomProvider,
} from "./sdk-provider-boundary";

const DEFAULT_NKLEIN_API_BASE_URL = "https://api.nklein.bot";
const NKLEIN_REMOTE_CONFIG_SCHEMA = z.object({
	kanbanEnabled: z.boolean().optional(),
});
const LMSTUDIO_MODELS_RESPONSE_SCHEMA = z
	.object({
		data: z.array(z.unknown()).optional(),
		models: z.array(z.unknown()).optional(),
	})
	.passthrough();
const LMSTUDIO_MODEL_LIST_PATHNAMES = ["/api/v0/models", "/api/v1/models", "/v1/models"] as const;
const DEFAULT_LITELLM_MODEL_LIST_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_LMSTUDIO_MODEL_LIST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_GENERIC_MODEL_LIST_TIMEOUT_MS = 30 * 1000;
const LOGGER = createKanbanNKleinLogger({ component: "nklein-provider-service" });

type NKleinRemoteConfig = z.infer<typeof NKLEIN_REMOTE_CONFIG_SCHEMA>;

function isLocalProviderSettings(settings: Pick<SdkProviderSettings, "provider" | "baseUrl"> | null): boolean {
	if (!settings) {
		return false;
	}
	return isLocalProvider(settings.provider, settings.baseUrl);
}

export interface ResolvedNKleinLaunchConfig {
	providerId: string;
	modelId: string | null;
	contextWindow?: number | null;
	apiKey: string | null;
	baseUrl: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
}

export interface AddCustomNKleinProviderInput {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string | null;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: SdkCustomProviderCapability[];
}

export interface UpdateCustomNKleinProviderInput {
	providerId: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string | null;
	headers?: Record<string, string> | null;
	timeoutMs?: number | null;
	models?: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: SdkCustomProviderCapability[];
}

function toErrorMessage(error: unknown): string {
	return formatErrorMessage(error, "An unexpected error occurred.");
}

function parseNKleinRemoteConfigValue(value: string): NKleinRemoteConfig {
	const parsed = JSON.parse(value) as unknown;
	return NKLEIN_REMOTE_CONFIG_SCHEMA.parse(parsed);
}

function logLiteLlmModelListWarning(message: string, metadata?: Record<string, unknown>): void {
	LOGGER.log(message, {
		severity: "warn",
		providerId: "litellm",
		...(metadata ?? {}),
	});
}

async function discoverModelsFromEndpoint(input: {
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

async function resolveModelListSettings(
	providerId: string,
	settings: SdkProviderSettings | null,
): Promise<SdkProviderSettings | null> {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return null;
	}

	const normalizedSettingsProviderId = settings?.provider?.trim().toLowerCase() ?? "";
	if (normalizedSettingsProviderId === normalizedProviderId && settings?.baseUrl?.trim()) {
		return settings;
	}

	const catalogProvider = (await listSdkProviderCatalog().catch(() => [])).find(
		(provider) => provider.id.trim().toLowerCase() === normalizedProviderId,
	);
	const catalogBaseUrl = catalogProvider?.baseUrl?.trim() ?? "";
	if (!catalogBaseUrl) {
		return normalizedSettingsProviderId === normalizedProviderId ? settings : null;
	}

	const nextSettings: SdkProviderSettings =
		normalizedSettingsProviderId === normalizedProviderId && settings
			? { ...settings }
			: { provider: normalizedProviderId };
	nextSettings.provider = normalizedProviderId;
	nextSettings.baseUrl = catalogBaseUrl;
	return nextSettings;
}

async function fetchLiteLlmBaseUrlModels(settings: SdkProviderSettings | null): Promise<RuntimeNKleinProviderModel[]> {
	const resolvedSettings = await resolveModelListSettings("litellm", settings);
	const baseUrl = resolvedSettings?.baseUrl?.trim() ?? "";
	if (!resolvedSettings || !baseUrl) {
		return [];
	}

	const headers = resolveLiteLlmModelListHeaders(resolvedSettings);
	const timeoutMs =
		typeof resolvedSettings.timeout === "number" && resolvedSettings.timeout >= 0
			? Math.trunc(resolvedSettings.timeout)
			: DEFAULT_LITELLM_MODEL_LIST_TIMEOUT_MS;
	const signal = timeoutMs === 0 ? undefined : AbortSignal.timeout(timeoutMs);
	const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
	for (const pathname of LITELLM_MODEL_LIST_PATHNAMES) {
		const url = `${normalizedBaseUrl}${pathname}`;
		try {
			const response = await globalThis.fetch(url, {
				method: "GET",
				headers,
				...(signal ? { signal } : {}),
			});
			if (!response.ok) {
				logLiteLlmModelListWarning("LiteLLM model list request returned an unsuccessful response.", {
					url,
					status: response.status,
				});
				continue;
			}

			const parsed = LITELLM_MODELS_RESPONSE_SCHEMA.safeParse((await response.json()) as unknown);
			if (!parsed.success) {
				logLiteLlmModelListWarning("LiteLLM model list request returned an unexpected response.", { url });
				continue;
			}

			const modelIds =
				parsed.data.data
					?.map((item) => resolveLiteLlmModelListItemId(item, pathname))
					.filter((modelId) => modelId.length > 0) ?? [];
			if (modelIds.length > 0) {
				return [...new Set(modelIds)].map((id) => ({ id, name: id }));
			}
		} catch (error) {
			logLiteLlmModelListWarning("LiteLLM model list request failed.", {
				url,
				errorMessage: toErrorMessage(error),
			});
		}
	}
	return [];
}

async function fetchLmStudioBaseUrlModels(settings: SdkProviderSettings | null): Promise<RuntimeNKleinProviderModel[]> {
	const resolvedSettings = await resolveModelListSettings("lmstudio", settings);
	const baseUrl = resolvedSettings?.baseUrl?.trim() ?? "";
	if (!resolvedSettings || !baseUrl) {
		return [];
	}

	const headers = resolveLiteLlmModelListHeaders(resolvedSettings);
	const timeoutMs =
		typeof resolvedSettings.timeout === "number" && resolvedSettings.timeout >= 0
			? Math.trunc(resolvedSettings.timeout)
			: DEFAULT_LMSTUDIO_MODEL_LIST_TIMEOUT_MS;
	const signal = timeoutMs === 0 ? undefined : AbortSignal.timeout(timeoutMs);
	const normalizedBaseUrl = normalizeLmStudioModelListBaseUrl(baseUrl);
	for (const pathname of LMSTUDIO_MODEL_LIST_PATHNAMES) {
		const url = `${normalizedBaseUrl}${pathname}`;
		try {
			const response = await globalThis.fetch(url, {
				method: "GET",
				headers,
				...(signal ? { signal } : {}),
			});
			if (!response.ok) {
				LOGGER.log("LM Studio model list request returned an unsuccessful response.", {
					severity: "warn",
					providerId: "lmstudio",
					url,
					status: response.status,
				});
				continue;
			}

			const parsed = LMSTUDIO_MODELS_RESPONSE_SCHEMA.safeParse((await response.json()) as unknown);
			if (!parsed.success) {
				LOGGER.log("LM Studio model list request returned an unexpected response.", {
					severity: "warn",
					providerId: "lmstudio",
					url,
				});
				continue;
			}

			const items = parsed.data.data ?? parsed.data.models ?? [];
			const models = items.flatMap((item) => toLmStudioModels(item, pathname));
			if (models.length > 0) {
				return models;
			}
		} catch (error) {
			LOGGER.log("LM Studio model list request failed.", {
				severity: "warn",
				providerId: "lmstudio",
				url,
				errorMessage: toErrorMessage(error),
			});
		}
	}
	return [];
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
		resolved = mergeProviderModelsWithContextWindowFallback(lmStudioModels, providerModels);
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

async function loadProviderModelsWithMeasuredWindows(
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

async function assertProviderModelMeetsContextRequirement(input: {
	providerId: string;
	modelId: string | null | undefined;
	settings?: SdkProviderSettings | null;
	label?: string;
}): Promise<void> {
	const modelId = input.modelId?.trim();
	if (!modelId) {
		return;
	}
	const providerModels = await loadProviderModelsWithMeasuredWindows(input.providerId, input.settings);
	const resolvedModel = providerModels.find((model) => model.id === modelId) ?? null;
	if (isLiveOnlyProviderId(input.providerId) && !resolvedModel) {
		throw new Error(
			`Selected LM Studio model "${modelId}" is not currently loaded. Load it in LM Studio, refresh models, then choose it before activation.`,
		);
	}
	assertNKleinContextWindowPolicy({
		providerId: input.providerId,
		modelId,
		contextWindow: resolvedModel?.contextWindow ?? null,
		label: input.label ?? "Selected !Klein model",
	});
}

function getSelectedProviderSettings(): SdkProviderSettings | null {
	const resolvedProviderId = readKanbanSelectedProviderId();
	if (!resolvedProviderId) {
		return null;
	}
	const settings = getSdkProviderSettings(resolvedProviderId) ?? { provider: resolvedProviderId };
	return isLocalProviderSettings(settings) ? settings : null;
}

async function resolveDefaultModelIdForProvider(providerId: string): Promise<string | null> {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return null;
	}
	try {
		const provider = (await listSdkProviderCatalog()).find((candidate) => candidate.id === normalizedProviderId);
		const defaultModelId = provider?.defaultModelId?.trim();
		if (defaultModelId) {
			return defaultModelId;
		}
	} catch {
		// Fall through to the stable built-in defaults.
	}
	return normalizedProviderId === SDK_DEFAULT_PROVIDER_ID ? SDK_DEFAULT_MODEL_ID : null;
}

function createRuntimeOauthCallbacks(providerId: ManagedNKleinOauthProviderId) {
	let authUrl: string | null = null;
	return {
		onAuth: ({ url }: { url: string; instructions?: string }) => {
			authUrl = url;
			openInBrowser(url);
		},
		onPrompt: async () => {
			throw new Error(
				authUrl
					? `Browser callback did not complete. Open this URL and complete sign in: ${authUrl}`
					: `Browser callback did not complete for ${providerId}.`,
			);
		},
		onProgress: () => {},
	};
}

function authSettingsEqual(left: SdkProviderSettings["auth"], right: SdkProviderSettings["auth"]): boolean {
	return (
		(left?.accessToken ?? null) === (right?.accessToken ?? null) &&
		(left?.refreshToken ?? null) === (right?.refreshToken ?? null) &&
		(left?.accountId ?? null) === (right?.accountId ?? null) &&
		(left?.expiresAt ?? null) === (right?.expiresAt ?? null)
	);
}

async function refreshManagedOauthSettings(
	settings: SdkProviderSettings,
): Promise<{ settings: SdkProviderSettings; apiKey: string } | null> {
	const providerId = settings.provider.trim().toLowerCase();
	if (!isManagedOauthProviderId(providerId)) {
		return null;
	}

	const accessToken = settings.auth?.accessToken?.trim() ?? "";
	const refreshToken = settings.auth?.refreshToken?.trim() ?? "";
	if (!accessToken || !refreshToken) {
		return null;
	}

	const nextCredentials = await refreshManagedOauthCredentials({
		providerId,
		currentCredentials: {
			access: providerId === "nklein" ? stripWorkosPrefix(accessToken) : accessToken,
			refresh: refreshToken,
			expires: normalizeEpochMs(settings.auth?.expiresAt),
			accountId: settings.auth?.accountId ?? undefined,
		},
		baseUrl: settings.baseUrl?.trim() || null,
		oauthProvider: providerId,
	});
	if (!nextCredentials) {
		throw new Error(`OAuth credentials for provider "${providerId}" are invalid. Re-run OAuth login.`);
	}

	const nextSettings: SdkProviderSettings = {
		...settings,
		auth: {
			...(settings.auth ?? {}),
			accessToken: toProviderApiKey(providerId, nextCredentials.access),
			refreshToken: nextCredentials.refresh,
			accountId: nextCredentials.accountId ?? undefined,
			expiresAt: normalizeEpochMs(nextCredentials.expires),
		},
	};

	if (!authSettingsEqual(settings.auth, nextSettings.auth)) {
		saveSdkProviderSettings({
			settings: nextSettings,
			tokenSource: "oauth",
			setLastUsed: true,
		});
	}

	return {
		settings: nextSettings,
		apiKey: toProviderApiKey(providerId, nextCredentials.access),
	};
}

export function createNKleinProviderService() {
	const getProviderSettingsSummary = (): RuntimeNKleinProviderSettings =>
		toProviderSettingsSummary(getSelectedProviderSettings());

	// Dedup concurrent fetchSdkNKleinAccountProfile calls (e.g. balance + orgs on dialog open).
	// Cached for 5s so back-to-back callers share a single network round-trip.
	const PROFILE_CACHE_TTL_MS = 5_000;
	let profileCache: {
		key: string;
		promise: ReturnType<typeof fetchSdkNKleinAccountProfile>;
		expiresAt: number;
	} | null = null;

	function fetchProfileDeduped(apiParams: { apiBaseUrl: string; accessToken: string }) {
		const cacheKey = `${apiParams.apiBaseUrl}::${apiParams.accessToken}`;
		if (profileCache && profileCache.key === cacheKey && Date.now() < profileCache.expiresAt) {
			return profileCache.promise;
		}
		const promise = fetchSdkNKleinAccountProfile(apiParams);
		profileCache = { key: cacheKey, promise, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS };
		// Clear cache on failure so retries aren't stuck with a rejected promise.
		promise.catch(() => {
			if (profileCache?.promise === promise) {
				profileCache = null;
			}
		});
		return promise;
	}

	return {
		getProviderSettingsSummary(): RuntimeNKleinProviderSettings {
			return getProviderSettingsSummary();
		},

		/**
		 * The base URL the board-independent chat (§5.M, local-only) should use: the selected provider's endpoint when
		 * a LOCAL provider (LM Studio / Ollama / a localhost custom provider) is selected, else null so the chat falls
		 * back to its own default local endpoint. (`getSelectedProviderSettings` already returns null for a cloud
		 * selection — the chat is local-only and fails closed against cloud.) Without this the chat ignored the
		 * configured endpoint entirely and always hit the hardcoded default port.
		 */
		getLocalChatBaseUrl(): string | null {
			return getSelectedProviderSettings()?.baseUrl?.trim() || null;
		},

		async getNKleinAccountProfile(): Promise<RuntimeNKleinAccountProfileResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return {
						profile: null,
					};
				}

				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return {
						profile: null,
					};
				}

				const tryFetchProfile = async (
					settings: SdkProviderSettings,
				): Promise<RuntimeNKleinAccountProfileResponse["profile"] | null> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return null;
					}
					const me = await fetchProfileDeduped({
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
					});
					return {
						accountId: me.id?.trim() || settings.auth?.accountId?.trim() || null,
						email: me.email?.trim() || null,
						displayName: me.displayName?.trim() || null,
					};
				};

				try {
					const profile = await tryFetchProfile(selectedSettings);
					if (profile) {
						return {
							profile,
						};
					}
				} catch {
					// Retry once after OAuth refresh below.
				}

				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				const profile = oauthResolution?.settings ? await tryFetchProfile(oauthResolution.settings) : null;
				return {
					profile,
				};
			} catch (error) {
				return {
					profile: null,
					error: toErrorMessage(error),
				};
			}
		},

		async getNKleinKanbanAccess(): Promise<RuntimeNKleinKanbanAccessResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { enabled: true };
				}

				const rawAccessToken = selectedSettings.auth?.accessToken?.trim() ?? "";
				if (!rawAccessToken) {
					return { enabled: true };
				}

				const remoteConfigResponse = await fetchSdkNKleinUserRemoteConfig({
					apiBaseUrl: selectedSettings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
				});
				if (!remoteConfigResponse?.enabled || !remoteConfigResponse?.organizationId) {
					return { enabled: true };
				}

				const orgData = await fetchSdkOrgData({
					apiBaseUrl: selectedSettings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
					organizationId: remoteConfigResponse.organizationId,
				});

				const parsedRemoteConfig = parseNKleinRemoteConfigValue(remoteConfigResponse.value);
				const isEnterpriseCustomer = !!orgData?.externalOrganizationId;
				return {
					enabled: !parsedRemoteConfig || !isEnterpriseCustomer || parsedRemoteConfig.kanbanEnabled === true,
				};
			} catch (error) {
				return {
					enabled: true,
					error: toErrorMessage(error),
				};
			}
		},

		async getFeaturebaseToken(): Promise<{ featurebaseJwt: string }> {
			const selectedSettings = getSelectedProviderSettings();
			if (!selectedSettings) {
				throw new Error("No provider settings configured.");
			}

			const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
			if (normalizedProviderId !== "nklein") {
				throw new Error("Featurebase token requires a !Klein provider.");
			}

			const tryFetchToken = async (settings: SdkProviderSettings): Promise<{ featurebaseJwt: string }> => {
				const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
				if (!rawAccessToken) {
					throw new Error("No access token configured for !Klein provider.");
				}
				return await fetchSdkFeaturebaseToken({
					apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
				});
			};

			try {
				return await tryFetchToken(selectedSettings);
			} catch {
				// Retry once after OAuth refresh.
			}

			const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
			if (oauthResolution?.settings) {
				return await tryFetchToken(oauthResolution.settings);
			}
			throw new Error("Failed to fetch Featurebase token.");
		},

		async getNKleinAccountBalance(): Promise<RuntimeNKleinAccountBalanceResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
				}
				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
				}

				const resolveWithSettings = async (
					settings: SdkProviderSettings,
				): Promise<RuntimeNKleinAccountBalanceResponse> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
					}
					const apiParams = {
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
					};
					const me = await fetchProfileDeduped(apiParams);
					const activeOrg = me.organizations?.find((org) => org.active) ?? null;
					if (activeOrg) {
						const orgBalance = await fetchSdkOrganizationBalance({
							...apiParams,
							organizationId: activeOrg.organizationId,
						});
						return {
							balance: orgBalance.balance,
							activeAccountLabel: activeOrg.name,
							activeOrganizationId: activeOrg.organizationId,
						};
					}
					const personalBalance = await fetchSdkNKleinAccountBalance(apiParams);
					return {
						balance: personalBalance.balance,
						activeAccountLabel: "Personal",
						activeOrganizationId: null,
					};
				};

				try {
					return await resolveWithSettings(selectedSettings);
				} catch {
					// Retry once after OAuth refresh.
				}
				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				if (oauthResolution?.settings) {
					return await resolveWithSettings(oauthResolution.settings);
				}
				return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
			} catch (error) {
				return {
					balance: null,
					activeAccountLabel: null,
					activeOrganizationId: null,
					error: toErrorMessage(error),
				};
			}
		},

		async getNKleinAccountOrganizations(): Promise<RuntimeNKleinAccountOrganizationsResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { organizations: [] };
				}
				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return { organizations: [] };
				}

				const resolveWithSettings = async (
					settings: SdkProviderSettings,
				): Promise<RuntimeNKleinAccountOrganizationsResponse> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return { organizations: [] };
					}
					const apiParams = {
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
					};
					const me = await fetchProfileDeduped(apiParams);
					return {
						organizations: (me.organizations ?? []).map((org: NonNullable<typeof me.organizations>[number]) => ({
							organizationId: org.organizationId,
							name: org.name,
							active: org.active,
							roles: org.roles ?? [],
						})),
					};
				};

				try {
					return await resolveWithSettings(selectedSettings);
				} catch {
					// Retry once after OAuth refresh.
				}
				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				if (oauthResolution?.settings) {
					return await resolveWithSettings(oauthResolution.settings);
				}
				return { organizations: [] };
			} catch (error) {
				return {
					organizations: [],
					error: toErrorMessage(error),
				};
			}
		},

		async switchNKleinAccount(organizationId: string | null): Promise<RuntimeNKleinAccountSwitchResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { ok: false, error: "No provider settings configured." };
				}
				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return { ok: false, error: "Account switching requires a !Klein provider." };
				}

				const doSwitch = async (settings: SdkProviderSettings): Promise<RuntimeNKleinAccountSwitchResponse> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return { ok: false, error: "No access token configured." };
					}
					await switchSdkNKleinAccount({
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
						organizationId,
					});
					profileCache = null;
					return { ok: true };
				};

				try {
					return await doSwitch(selectedSettings);
				} catch {
					// Retry once after OAuth refresh.
				}
				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				if (oauthResolution?.settings) {
					return await doSwitch(oauthResolution.settings);
				}
				return { ok: false, error: "Failed to switch account." };
			} catch (error) {
				return { ok: false, error: toErrorMessage(error) };
			}
		},

		async resolveLaunchConfig(overrides?: {
			providerIdOverride?: string;
			modelIdOverride?: string;
			reasoningEffortOverride?: RuntimeNKleinReasoningEffort | null;
		}): Promise<ResolvedNKleinLaunchConfig> {
			const providerIdOverride = overrides?.providerIdOverride?.trim().toLowerCase() ?? "";
			const selectedSettings = providerIdOverride
				? (getSdkProviderSettings(providerIdOverride) ?? { provider: providerIdOverride })
				: getSelectedProviderSettings();
			if (!selectedSettings) {
				throw new Error(
					"No native !Klein provider is configured. Open Settings, choose a provider, and then start the task again.",
				);
			}

			const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
			if (!normalizedProviderId) {
				throw new Error(
					"No native !Klein provider is configured. Open Settings, choose a provider, and then start the task again.",
				);
			}
			// Local-only lockdown: refuse to resolve a launch config for any cloud/paid provider before
			// we touch OAuth, API keys, or the network. This is the single dispatch chokepoint.
			assertLocalProviderAllowed({
				providerId: normalizedProviderId,
				baseUrl: selectedSettings.baseUrl,
			});
			const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
			const resolvedSettings = oauthResolution?.settings ?? selectedSettings;
			const apiKey = isManagedOauthProviderId(normalizedProviderId)
				? resolveManagedProviderLaunchApiKey({
						providerId: normalizedProviderId,
						settings: resolvedSettings,
						oauthApiKey: oauthResolution?.apiKey ?? null,
					})
				: resolveVisibleApiKey(resolvedSettings);
			const modelId =
				overrides?.modelIdOverride?.trim() ||
				resolvedSettings.model?.trim() ||
				(await resolveDefaultModelIdForProvider(normalizedProviderId));
			const providerModels = await loadProviderModelsWithMeasuredWindows(normalizedProviderId);
			const resolvedModel = providerModels.find((candidate) => candidate.id === modelId) ?? null;
			if (isLiveOnlyProviderId(normalizedProviderId) && modelId && !resolvedModel) {
				throw new Error(
					`Selected LM Studio model "${modelId}" is not currently loaded. Load it in LM Studio, refresh models, then choose it before starting the task.`,
				);
			}
			assertNKleinContextWindowPolicy({
				providerId: normalizedProviderId,
				modelId,
				contextWindow: resolvedModel?.contextWindow ?? null,
				label: "Selected !Klein model",
			});
			return {
				providerId: normalizedProviderId,
				modelId,
				contextWindow: resolvedModel?.contextWindow ?? null,
				apiKey,
				baseUrl: resolvedSettings.baseUrl?.trim() || null,
				reasoningEffort:
					overrides && "reasoningEffortOverride" in overrides
						? (overrides.reasoningEffortOverride ?? null)
						: (toRuntimeReasoningEffort(resolvedSettings.reasoning?.effort) ?? undefined),
			};
		},

		async getProviderCatalog(): Promise<RuntimeNKleinProviderCatalogResponse> {
			const selectedProviderId = getProviderSettingsSummary().providerId?.trim().toLowerCase() ?? "";
			const providers: RuntimeNKleinProviderCatalogItem[] = await listSdkProviderCatalog()
				.then((sdkProviders) =>
					sdkProviders
						.filter((provider) =>
							isLocalProvider(provider.id, provider.baseUrl ?? getSdkProviderSettings(provider.id)?.baseUrl),
						)
						.map((provider) => ({
							id: provider.id,
							name: provider.name,
							oauthSupported: (provider.capabilities ?? []).includes("oauth"),
							enabled: selectedProviderId.length > 0 && selectedProviderId === provider.id,
							defaultModelId: isLiveOnlyProviderId(provider.id) ? null : (provider.defaultModelId ?? null),
							baseUrl: provider.baseUrl?.trim() || null,
							supportsBaseUrl: (provider.baseUrl?.trim().length ?? 0) > 0,
							env: provider.env,
						}))
						.sort((left, right) => {
							if (left.id === "lmstudio") {
								return -1;
							}
							if (right.id === "lmstudio") {
								return 1;
							}
							return left.name.localeCompare(right.name);
						}),
				)
				.catch(() => []);

			const selectedSettings = getSdkProviderSettings(selectedProviderId);
			if (
				selectedProviderId.length > 0 &&
				isLocalProvider(selectedProviderId, selectedSettings?.baseUrl) &&
				!providers.some((provider) => provider.id === selectedProviderId)
			) {
				providers.unshift({
					id: selectedProviderId,
					name: selectedProviderId,
					oauthSupported: false,
					enabled: true,
					defaultModelId: isLiveOnlyProviderId(selectedProviderId) ? null : getProviderSettingsSummary().modelId,
					baseUrl: getProviderSettingsSummary().baseUrl,
					supportsBaseUrl: (getProviderSettingsSummary().baseUrl?.trim().length ?? 0) > 0,
					env: undefined,
				});
			}

			return {
				providers,
			};
		},

		async getProviderModels(providerId: string): Promise<RuntimeNKleinProviderModelsResponse> {
			const normalizedProviderId = providerId.trim().toLowerCase();
			const providerSettings = getSdkProviderSettings(normalizedProviderId);
			if (normalizedProviderId.length > 0 && !isLocalProvider(normalizedProviderId, providerSettings?.baseUrl)) {
				return {
					providerId: normalizedProviderId || providerId,
					models: [],
				};
			}
			const providerModels =
				normalizedProviderId.length > 0
					? (await loadProviderModelsWithMeasuredWindows(normalizedProviderId))
							.map((model) => toRuntimeProviderModel(model))
							.sort((left, right) => left.name.localeCompare(right.name))
					: [];

			if (providerModels.length > 0) {
				return {
					providerId: normalizedProviderId,
					models: providerModels,
				};
			}

			if (isLiveOnlyProviderId(normalizedProviderId)) {
				return {
					providerId: normalizedProviderId || providerId,
					models: [],
				};
			}

			const configuredModel = providerSettings?.model?.trim() ?? "";
			if (configuredModel.length > 0) {
				return {
					providerId: normalizedProviderId || providerId,
					models: [{ id: configuredModel, name: configuredModel }],
				};
			}

			return {
				providerId: normalizedProviderId || providerId,
				models: [],
			};
		},

		async discoverEndpointModels(input: {
			baseUrl: string;
			apiKey?: string | null;
			modelsSourceUrl?: string | null;
			timeoutMs?: number | null;
		}): Promise<RuntimeNKleinEndpointModelDiscoveryResponse> {
			assertLocalProviderAllowed({
				providerId: "openai-compatible",
				baseUrl: input.baseUrl,
			});
			return await discoverModelsFromEndpoint(input);
		},

		async addCustomProvider(input: AddCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
			const providerId = input.providerId.trim().toLowerCase();
			if (!providerId) {
				throw new Error("Provider ID cannot be empty.");
			}
			assertLocalProviderAllowed({ providerId, baseUrl: input.baseUrl });
			const existingProviders = await listSdkProviderCatalog().catch(() => []);
			if (existingProviders.some((provider) => provider.id.trim().toLowerCase() === providerId)) {
				throw new Error(`Provider "${providerId}" already exists.`);
			}

			await addSdkCustomProvider({
				providerId,
				name: input.name,
				baseUrl: input.baseUrl,
				apiKey: input.apiKey ?? null,
				headers: input.headers,
				timeoutMs: input.timeoutMs,
				models: input.models,
				defaultModelId: input.defaultModelId ?? null,
				modelsSourceUrl: input.modelsSourceUrl ?? null,
				capabilities: input.capabilities,
			});

			const existingSettings = getSdkProviderSettings(providerId) ?? { provider: providerId };
			saveSdkProviderSettings({
				settings: existingSettings,
				tokenSource: hasOauthAccessToken(existingSettings) ? "oauth" : "manual",
				setLastUsed: true,
			});
			writeKanbanSelectedProviderId(providerId);

			return toProviderSettingsSummary(getSdkProviderSettings(providerId));
		},

		async updateCustomProvider(input: UpdateCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
			const providerId = input.providerId.trim().toLowerCase();
			if (!providerId) {
				throw new Error("Provider ID cannot be empty.");
			}
			const existingSettings = getSdkProviderSettings(providerId) ?? { provider: providerId };
			assertLocalProviderAllowed({ providerId, baseUrl: input.baseUrl ?? existingSettings.baseUrl });

			await updateSdkCustomProvider({
				providerId,
				name: input.name,
				baseUrl: input.baseUrl,
				apiKey: input.apiKey ?? undefined,
				headers: input.headers ?? undefined,
				timeoutMs: input.timeoutMs ?? undefined,
				models: input.models,
				defaultModelId: input.defaultModelId ?? undefined,
				modelsSourceUrl: input.modelsSourceUrl ?? undefined,
				capabilities: input.capabilities,
			});

			const isLastUsed = getLastUsedSdkProviderSettings()?.provider?.trim().toLowerCase() === providerId;
			saveSdkProviderSettings({
				settings: existingSettings,
				tokenSource: hasOauthAccessToken(existingSettings) ? "oauth" : "manual",
				setLastUsed: isLastUsed,
			});

			return toProviderSettingsSummary(getSdkProviderSettings(providerId));
		},

		async deleteCustomProvider(input: { providerId: string }): Promise<RuntimeNKleinProviderSettings> {
			const providerId = input.providerId.trim().toLowerCase();
			if (!providerId) {
				throw new Error("Provider ID cannot be empty.");
			}

			await deleteSdkCustomProvider(providerId);
			return getProviderSettingsSummary();
		},

		async saveProviderSettings(input: {
			providerId: string;
			modelId?: string | null;
			apiKey?: string | null;
			baseUrl?: string | null;
			reasoningEffort?: RuntimeNKleinReasoningEffort | null;
			region?: string | null;
			aws?: {
				accessKey?: string | null;
				secretKey?: string | null;
				sessionToken?: string | null;
				region?: string | null;
				profile?: string | null;
				authentication?: "iam" | "api-key" | "profile" | null;
				endpoint?: string | null;
			};
			gcp?: {
				projectId?: string | null;
				region?: string | null;
			};
		}): Promise<RuntimeNKleinProviderSettingsSaveResponse> {
			const providerId = input.providerId.trim().toLowerCase();
			if (!providerId) {
				throw new Error("Provider ID cannot be empty.");
			}

			const existingSettings = getSdkProviderSettings(providerId) ?? {
				provider: providerId,
			};
			const nextSettings: SdkProviderSettings = {
				...existingSettings,
				provider: providerId,
			};

			if (input.modelId !== undefined) {
				const modelId = input.modelId?.trim() ?? "";
				if (modelId) {
					nextSettings.model = modelId;
				} else {
					delete nextSettings.model;
				}
			}

			if (input.baseUrl !== undefined) {
				const baseUrl = input.baseUrl?.trim() ?? "";
				if (baseUrl) {
					nextSettings.baseUrl = baseUrl;
				} else {
					delete nextSettings.baseUrl;
				}
			}

			if (input.apiKey !== undefined) {
				const apiKey = input.apiKey?.trim() ?? "";
				if (apiKey) {
					nextSettings.apiKey = apiKey;
				} else {
					delete nextSettings.apiKey;
				}
			}

			if (input.reasoningEffort !== undefined) {
				const nextReasoning = { ...(nextSettings.reasoning ?? {}) };
				if (input.reasoningEffort) {
					nextReasoning.effort = input.reasoningEffort;
				} else {
					delete nextReasoning.effort;
				}
				if (
					nextReasoning.enabled === undefined &&
					nextReasoning.effort === undefined &&
					nextReasoning.budgetTokens === undefined
				) {
					delete nextSettings.reasoning;
				} else {
					nextSettings.reasoning = nextReasoning;
				}
			}

			if (input.region !== undefined) {
				const region = input.region?.trim() ?? "";
				if (region) {
					nextSettings.region = region;
				} else {
					delete nextSettings.region;
				}
			}

			if (input.aws !== undefined) {
				const nextAws = { ...(nextSettings.aws ?? {}) } as NonNullable<SdkProviderSettings["aws"]>;
				if (input.aws.accessKey !== undefined) {
					const accessKey = input.aws.accessKey?.trim() ?? "";
					if (accessKey) nextAws.accessKey = accessKey;
					else delete nextAws.accessKey;
				}
				if (input.aws.secretKey !== undefined) {
					const secretKey = input.aws.secretKey?.trim() ?? "";
					if (secretKey) nextAws.secretKey = secretKey;
					else delete nextAws.secretKey;
				}
				if (input.aws.sessionToken !== undefined) {
					const sessionToken = input.aws.sessionToken?.trim() ?? "";
					if (sessionToken) nextAws.sessionToken = sessionToken;
					else delete nextAws.sessionToken;
				}
				if (input.aws.region !== undefined) {
					const awsRegion = input.aws.region?.trim() ?? "";
					if (awsRegion) nextAws.region = awsRegion;
					else delete nextAws.region;
				}
				if (input.aws.profile !== undefined) {
					const profile = input.aws.profile?.trim() ?? "";
					if (profile) nextAws.profile = profile;
					else delete nextAws.profile;
				}
				if (input.aws.authentication !== undefined) {
					const authentication = input.aws.authentication;
					if (authentication) nextAws.authentication = authentication;
					else delete nextAws.authentication;
				}
				if (input.aws.endpoint !== undefined) {
					const endpoint = input.aws.endpoint?.trim() ?? "";
					if (endpoint) nextAws.endpoint = endpoint;
					else delete nextAws.endpoint;
				}

				if (
					nextAws.accessKey === undefined &&
					nextAws.secretKey === undefined &&
					nextAws.sessionToken === undefined &&
					nextAws.region === undefined &&
					nextAws.profile === undefined &&
					nextAws.authentication === undefined &&
					nextAws.usePromptCache === undefined &&
					nextAws.useCrossRegionInference === undefined &&
					nextAws.useGlobalInference === undefined &&
					nextAws.endpoint === undefined &&
					nextAws.customModelBaseId === undefined
				) {
					delete nextSettings.aws;
				} else {
					nextSettings.aws = nextAws;
				}
			}

			if (input.gcp !== undefined) {
				const nextGcp = { ...(nextSettings.gcp ?? {}) } as NonNullable<SdkProviderSettings["gcp"]>;
				if (input.gcp.projectId !== undefined) {
					const projectId = input.gcp.projectId?.trim() ?? "";
					if (projectId) nextGcp.projectId = projectId;
					else delete nextGcp.projectId;
				}
				if (input.gcp.region !== undefined) {
					const gcpRegion = input.gcp.region?.trim() ?? "";
					if (gcpRegion) nextGcp.region = gcpRegion;
					else delete nextGcp.region;
				}
				if (nextGcp.projectId === undefined && nextGcp.region === undefined) {
					delete nextSettings.gcp;
				} else {
					nextSettings.gcp = nextGcp;
				}
			}

			if (providerId === "vertex") {
				const projectId = nextSettings.gcp?.projectId?.trim() ?? "";
				if (!projectId) {
					throw new Error("Vertex provider requires GCP Project ID.");
				}
				const modelId = nextSettings.model?.trim().toLowerCase() ?? "";
				const isClaudeModel = modelId.includes("claude");
				const resolvedRegion = nextSettings.gcp?.region?.trim() || nextSettings.region?.trim() || "";
				if (isClaudeModel && !resolvedRegion) {
					throw new Error("Vertex Claude models require GCP Region (or Region).");
				}
			}

			if (!isManagedOauthProviderId(providerId)) {
				delete nextSettings.auth;
			}
			assertLocalProviderAllowed({ providerId, baseUrl: nextSettings.baseUrl });

			await assertProviderModelMeetsContextRequirement({
				providerId,
				modelId: nextSettings.model,
				settings: nextSettings,
				label: "Selected !Klein model",
			});

			saveSdkProviderSettings({
				settings: nextSettings,
				tokenSource: hasOauthAccessToken(nextSettings) ? "oauth" : "manual",
				setLastUsed: true,
			});
			writeKanbanSelectedProviderId(providerId);

			return toProviderSettingsSummary(nextSettings);
		},

		async runOauthLogin(input: {
			providerId: ManagedNKleinOauthProviderId;
			baseUrl?: string | null;
		}): Promise<RuntimeNKleinOauthLoginResponse> {
			try {
				const existingSettings = getSdkProviderSettings(input.providerId) ?? {
					provider: input.providerId,
				};
				const baseUrl = input.baseUrl?.trim() || null;
				assertLocalProviderAllowed({ providerId: input.providerId, baseUrl });
				const credentials = await loginManagedOauthProvider({
					providerId: input.providerId,
					baseUrl,
					oauthProvider: input.providerId,
					callbacks: createRuntimeOauthCallbacks(input.providerId),
				});

				const nextSettings: SdkProviderSettings = {
					...existingSettings,
					provider: input.providerId,
					auth: {
						...(existingSettings.auth ?? {}),
						accessToken: toProviderApiKey(input.providerId, credentials.access),
						refreshToken: credentials.refresh,
						accountId: credentials.accountId ?? undefined,
						expiresAt: normalizeEpochMs(credentials.expires),
					},
				};

				if (baseUrl) {
					nextSettings.baseUrl = baseUrl;
				} else {
					delete nextSettings.baseUrl;
				}

				saveSdkProviderSettings({
					settings: nextSettings,
					tokenSource: "oauth",
					setLastUsed: true,
				});
				writeKanbanSelectedProviderId(input.providerId);

				return {
					ok: true,
					provider: input.providerId,
					settings: toProviderSettingsSummary(nextSettings),
				};
			} catch (error) {
				return {
					ok: false,
					provider: input.providerId,
					error: toErrorMessage(error),
				};
			}
		},

		async startDeviceAuth(): Promise<RuntimeNKleinDeviceAuthStartResponse> {
			assertLocalProviderAllowed({ providerId: "nklein" });
			const result = await startSdkDeviceAuth();
			return {
				deviceCode: result.deviceCode,
				userCode: result.userCode,
				verificationUrl: result.verificationUri,
				expiresInSeconds: result.expiresInSeconds,
				pollIntervalSeconds: result.pollIntervalSeconds,
			};
		},

		async completeDeviceAuth(input: {
			deviceCode: string;
			expiresInSeconds: number;
			pollIntervalSeconds: number;
			baseUrl?: string | null;
		}): Promise<RuntimeNKleinDeviceAuthCompleteResponse> {
			const providerId: ManagedNKleinOauthProviderId = "nklein";
			try {
				const existingSettings = getSdkProviderSettings(providerId) ?? {
					provider: providerId,
				};
				const apiBaseUrl = input.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL;
				assertLocalProviderAllowed({ providerId, baseUrl: apiBaseUrl });
				const credentials = await completeSdkDeviceAuth({
					deviceCode: input.deviceCode,
					expiresInSeconds: input.expiresInSeconds,
					pollIntervalSeconds: input.pollIntervalSeconds,
					apiBaseUrl,
				});

				const nextSettings: SdkProviderSettings = {
					...existingSettings,
					provider: providerId,
					auth: {
						...(existingSettings.auth ?? {}),
						accessToken: toProviderApiKey(providerId, credentials.access),
						refreshToken: credentials.refresh,
						accountId: credentials.accountId ?? undefined,
						expiresAt: normalizeEpochMs(credentials.expires),
					},
				};

				if (apiBaseUrl !== DEFAULT_NKLEIN_API_BASE_URL) {
					nextSettings.baseUrl = apiBaseUrl;
				} else {
					delete nextSettings.baseUrl;
				}

				saveSdkProviderSettings({
					settings: nextSettings,
					tokenSource: "oauth",
					setLastUsed: true,
				});
				writeKanbanSelectedProviderId(providerId);

				return {
					ok: true,
					provider: providerId,
					settings: toProviderSettingsSummary(nextSettings),
				};
			} catch (error) {
				return {
					ok: false,
					provider: providerId,
					error: toErrorMessage(error),
				};
			}
		},
	};
}
