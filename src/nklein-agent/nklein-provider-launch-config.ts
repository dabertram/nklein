// F1.30 (§5.U) — the LOAD-CONTROL cluster of the provider service: resolving the launch config a task session
// actually dispatches with (provider, model, context window, key, base URL, reasoning effort). This is the single
// dispatch chokepoint where the local-only lockdown and the ≥32k context-window floor are asserted BEFORE any
// OAuth/key/network touch. Extracted verbatim from nklein-provider-service.ts.

import type { RuntimeNKleinReasoningEffort } from "../core/api-contract";
import { assertNKleinContextWindowPolicy } from "./nklein-context-window-policy";
import { assertLocalProviderAllowed } from "./nklein-local-only-policy";
import { resolveManagedProviderLaunchApiKey } from "./nklein-managed-provider-credentials";
import { resolveVisibleApiKey } from "./nklein-provider-credential-helpers";
import { isLiveOnlyProviderId, isManagedOauthProviderId } from "./nklein-provider-id-classification";
import { loadProviderModelsWithMeasuredWindows } from "./nklein-provider-model-discovery";
import { refreshManagedOauthSettings } from "./nklein-provider-oauth";
import { getSelectedProviderSettings } from "./nklein-provider-selected-settings";
import { toRuntimeReasoningEffort } from "./nklein-provider-settings-summary";
import {
	getSdkProviderSettings,
	listSdkProviderCatalog,
	SDK_DEFAULT_MODEL_ID,
	SDK_DEFAULT_PROVIDER_ID,
} from "./sdk-provider-boundary";

export interface ResolvedNKleinLaunchConfig {
	providerId: string;
	modelId: string | null;
	contextWindow?: number | null;
	apiKey: string | null;
	baseUrl: string | null;
	reasoningEffort?: RuntimeNKleinReasoningEffort | null;
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

export async function resolveNKleinLaunchConfig(overrides?: {
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
}
