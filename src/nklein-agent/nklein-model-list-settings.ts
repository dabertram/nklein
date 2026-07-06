import type { SdkProviderCatalogItem, SdkProviderSettings } from "./sdk-provider-boundary";

/**
 * §5.U — the "which settings do we call the model-list endpoint with?" resolver extracted from `nklein-provider-service`.
 * Prefers the caller's settings when they already point at the right provider with a base URL; otherwise fills the base
 * URL from the SDK provider catalog. The catalog lister is injected so the branching (normalize → short-circuit →
 * catalog fallback → merge) is testable without the real SDK. Pure apart from the injected async lookup.
 */
export async function resolveModelListSettings(
	providerId: string,
	settings: SdkProviderSettings | null,
	listCatalog: () => Promise<SdkProviderCatalogItem[]>,
): Promise<SdkProviderSettings | null> {
	const normalizedProviderId = providerId.trim().toLowerCase();
	if (!normalizedProviderId) {
		return null;
	}

	const normalizedSettingsProviderId = settings?.provider?.trim().toLowerCase() ?? "";
	if (normalizedSettingsProviderId === normalizedProviderId && settings?.baseUrl?.trim()) {
		return settings;
	}

	const catalogProvider = (await listCatalog().catch(() => [])).find(
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
