import type {
	RuntimeNKleinEndpointModelDiscoveryResponse,
	RuntimeNKleinProviderCatalogItem,
	RuntimeNKleinProviderCatalogResponse,
	RuntimeNKleinProviderModel,
	RuntimeNKleinProviderModelsResponse,
	RuntimeNKleinProviderSettings,
} from "../core/api-contract";
import { assertLocalProviderAllowed, isLocalProvider } from "./nklein-local-only-policy";
import { isLiveOnlyProviderId } from "./nklein-provider-id-classification";
import { toRuntimeProviderModel } from "./nklein-provider-model-parsing";
import { getSdkProviderSettings, listSdkProviderCatalog, type SdkProviderSettings } from "./sdk-provider-boundary";

/**
 * Service touchpoints. `loadProviderModelsWithMeasuredWindows` + `discoverModelsFromEndpoint` stay defined in
 * nklein-provider-service (shared with the launch-config/model paths) and are injected here so the discovery API
 * doesn't drag the whole model-fetch subsystem with it. `getProviderSettingsSummary` is the current selection.
 */
export interface ModelDiscoveryApiDeps {
	getProviderSettingsSummary(): RuntimeNKleinProviderSettings;
	loadProviderModelsWithMeasuredWindows(
		providerId: string,
		settingsOverride?: SdkProviderSettings | null,
	): Promise<RuntimeNKleinProviderModel[]>;
	discoverModelsFromEndpoint(input: {
		baseUrl: string;
		apiKey?: string | null;
		modelsSourceUrl?: string | null;
		timeoutMs?: number | null;
	}): Promise<RuntimeNKleinEndpointModelDiscoveryResponse>;
}

export interface ModelDiscoveryApi {
	getProviderCatalog(): Promise<RuntimeNKleinProviderCatalogResponse>;
	getProviderModels(providerId: string): Promise<RuntimeNKleinProviderModelsResponse>;
	discoverEndpointModels(input: {
		baseUrl: string;
		apiKey?: string | null;
		modelsSourceUrl?: string | null;
		timeoutMs?: number | null;
	}): Promise<RuntimeNKleinEndpointModelDiscoveryResponse>;
}

/**
 * The local-only provider/model discovery surface, extracted verbatim from createNKleinProviderService. It lists the
 * LOCAL provider catalog (cloud providers filtered out; LM Studio floated to the top; the current selection ensured
 * present), resolves a provider's models (measured context windows, live-only handling, configured-model fallback),
 * and discovers models from a raw local endpoint (behind the local-only gate).
 */
export function createModelDiscoveryApi(deps: ModelDiscoveryApiDeps): ModelDiscoveryApi {
	async function getProviderCatalog(): Promise<RuntimeNKleinProviderCatalogResponse> {
		const selectedProviderId = deps.getProviderSettingsSummary().providerId?.trim().toLowerCase() ?? "";
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
				defaultModelId: isLiveOnlyProviderId(selectedProviderId) ? null : deps.getProviderSettingsSummary().modelId,
				baseUrl: deps.getProviderSettingsSummary().baseUrl,
				supportsBaseUrl: (deps.getProviderSettingsSummary().baseUrl?.trim().length ?? 0) > 0,
				env: undefined,
			});
		}

		return {
			providers,
		};
	}

	async function getProviderModels(providerId: string): Promise<RuntimeNKleinProviderModelsResponse> {
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
				? (await deps.loadProviderModelsWithMeasuredWindows(normalizedProviderId))
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
	}

	async function discoverEndpointModels(input: {
		baseUrl: string;
		apiKey?: string | null;
		modelsSourceUrl?: string | null;
		timeoutMs?: number | null;
	}): Promise<RuntimeNKleinEndpointModelDiscoveryResponse> {
		assertLocalProviderAllowed({
			providerId: "openai-compatible",
			baseUrl: input.baseUrl,
		});
		return await deps.discoverModelsFromEndpoint(input);
	}

	return { getProviderCatalog, getProviderModels, discoverEndpointModels };
}
