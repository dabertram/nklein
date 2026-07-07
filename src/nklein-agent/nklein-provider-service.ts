// !Klein-facing facade over the SDK-backed provider store.
// It resolves provider settings, model catalogs, OAuth flows, and launch
// config without leaking SDK details into runtime-api.ts or the UI.

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
	RuntimeNKleinProviderCatalogResponse,
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderModelsResponse,
	RuntimeNKleinProviderSettings,
	RuntimeNKleinProviderSettingsSaveResponse,
	RuntimeNKleinReasoningEffort,
} from "../core/api-contract";
import { toErrorMessage as formatErrorMessage } from "../core/error-message";
import { modelDiscoveryCacheTtlMs } from "../core/model-discovery-throttle";
import { fetchLiteLlmBaseUrlModels, fetchLmStudioBaseUrlModels } from "./nklein-baseurl-model-discovery";
import { assertNKleinContextWindowPolicy } from "./nklein-context-window-policy";
import { selectLiveContextWindowRefreshes } from "./nklein-context-window-refresh";
import {
	type AddCustomNKleinProviderInput,
	createCustomProviderManager,
	type UpdateCustomNKleinProviderInput,
} from "./nklein-custom-provider-manager";
import { computeKanbanEnabled, parseNKleinRemoteConfigValue } from "./nklein-kanban-access-policy";
import { appendMissingModels } from "./nklein-litellm-model-list";
import { assertLocalProviderAllowed, isLocalProvider } from "./nklein-local-only-policy";
import { resolveManagedProviderLaunchApiKey } from "./nklein-managed-provider-credentials";
import { createModelDiscoveryApi } from "./nklein-model-discovery-api";
import { getDefaultNKleinModelRegistry } from "./nklein-model-registry";
import { normalizeEpochMs, resolveVisibleApiKey } from "./nklein-provider-credential-helpers";
import { buildDiscoveredModelSourceUrls } from "./nklein-provider-discovery-urls";
import { isLiveOnlyProviderId, isManagedOauthProviderId } from "./nklein-provider-id-classification";
import {
	extractDiscoveredModelsFromPayload,
	mergeProviderModelsWithContextWindowFallback,
	mergeProviderModelsWithModelRegistry,
	normalizeContextWindow,
	sortDiscoveredProviderModels,
	toRuntimeProviderModel,
} from "./nklein-provider-model-parsing";
import { createRuntimeOauthCallbacks, refreshManagedOauthSettings } from "./nklein-provider-oauth";
import { readKanbanSelectedProviderId, writeKanbanSelectedProviderId } from "./nklein-provider-selection-store";
import { createProviderSettingsWriter, type SaveProviderSettingsInput } from "./nklein-provider-settings-save";
import { toProviderSettingsSummary, toRuntimeReasoningEffort } from "./nklein-provider-settings-summary";
import { ensureWorkosPrefix, toProviderApiKey } from "./nklein-provider-workos-token.js";

// Re-exported for API compatibility — the custom-provider input types now live with their manager (§5.U).
export type { AddCustomNKleinProviderInput, UpdateCustomNKleinProviderInput } from "./nklein-custom-provider-manager";

import {
	completeNKleinDeviceAuth as completeSdkDeviceAuth,
	fetchSdkFeaturebaseToken,
	fetchSdkNKleinAccountBalance,
	fetchSdkNKleinAccountProfile,
	fetchSdkNKleinUserRemoteConfig,
	fetchSdkOrganizationBalance,
	fetchSdkOrgData,
	getSdkProviderSettings,
	listSdkProviderCatalog,
	listSdkProviderModels,
	loginManagedOauthProvider,
	type ManagedNKleinOauthProviderId,
	SDK_DEFAULT_MODEL_ID,
	SDK_DEFAULT_PROVIDER_ID,
	type SdkProviderSettings,
	saveSdkProviderSettings,
	startNKleinDeviceAuth as startSdkDeviceAuth,
	switchSdkNKleinAccount,
} from "./sdk-provider-boundary";

const DEFAULT_NKLEIN_API_BASE_URL = "https://api.nklein.bot";
const DEFAULT_GENERIC_MODEL_LIST_TIMEOUT_MS = 30 * 1000;

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

function toErrorMessage(error: unknown): string {
	return formatErrorMessage(error, "An unexpected error occurred.");
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

	const customProviderManager = createCustomProviderManager({ getProviderSettingsSummary });
	const modelDiscoveryApi = createModelDiscoveryApi({
		getProviderSettingsSummary,
		loadProviderModelsWithMeasuredWindows,
		discoverModelsFromEndpoint,
	});
	const providerSettingsWriter = createProviderSettingsWriter({ loadProviderModelsWithMeasuredWindows });

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
					enabled: computeKanbanEnabled(parsedRemoteConfig, isEnterpriseCustomer),
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

		getProviderCatalog(): Promise<RuntimeNKleinProviderCatalogResponse> {
			return modelDiscoveryApi.getProviderCatalog();
		},

		getProviderModels(providerId: string): Promise<RuntimeNKleinProviderModelsResponse> {
			return modelDiscoveryApi.getProviderModels(providerId);
		},

		discoverEndpointModels(input: {
			baseUrl: string;
			apiKey?: string | null;
			modelsSourceUrl?: string | null;
			timeoutMs?: number | null;
		}): Promise<RuntimeNKleinEndpointModelDiscoveryResponse> {
			return modelDiscoveryApi.discoverEndpointModels(input);
		},

		addCustomProvider(input: AddCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
			return customProviderManager.addCustomProvider(input);
		},

		updateCustomProvider(input: UpdateCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
			return customProviderManager.updateCustomProvider(input);
		},

		deleteCustomProvider(input: { providerId: string }): Promise<RuntimeNKleinProviderSettings> {
			return customProviderManager.deleteCustomProvider(input);
		},

		saveProviderSettings(input: SaveProviderSettingsInput): Promise<RuntimeNKleinProviderSettingsSaveResponse> {
			return providerSettingsWriter.saveProviderSettings(input);
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
