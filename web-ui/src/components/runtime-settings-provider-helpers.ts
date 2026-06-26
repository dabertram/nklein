import type { RuntimeNKleinProviderCatalogItem } from "@/runtime/types";

/**
 * Provider-catalog helpers for the Settings dialog, extracted from the oversized `runtime-settings-dialog.tsx`
 * (§5.X #2 / anti-patterns #2). Pure, self-contained: case-insensitive provider-id normalization, catalog lookup,
 * and the dropdown option label. No React/state.
 */

export function normalizeProviderId(value: string | null | undefined): string {
	return value?.trim().toLowerCase() ?? "";
}

export function findProviderCatalogItem(
	providers: RuntimeNKleinProviderCatalogItem[],
	providerId: string,
): RuntimeNKleinProviderCatalogItem | null {
	const normalizedProviderId = normalizeProviderId(providerId);
	return providers.find((provider) => normalizeProviderId(provider.id) === normalizedProviderId) ?? null;
}

export function formatProviderOptionLabel(provider: { id: string; name: string }): string {
	const name = provider.name.trim();
	const id = provider.id.trim();
	if (!name || name.toLowerCase() === id.toLowerCase()) {
		return id;
	}
	return `${name} (${id})`;
}
