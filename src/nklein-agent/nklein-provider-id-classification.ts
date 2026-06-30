import type { ManagedNKleinOauthProviderId } from "./sdk-provider-boundary";

/**
 * Pure provider-id classification + display helpers, extracted from nklein-provider-service.
 *
 * Which provider ids are managed-OAuth providers (sign-in-based, not API-key-based), which are
 * live-only (no persisted credentials — LM Studio), and the human-facing display name for a managed
 * provider. Pure string predicates/maps, so the membership sets are pinned by unit tests.
 */

/** True for the managed-OAuth providers (credentials come from sign-in, not a pasted API key). */
export function isManagedOauthProviderId(providerId: string): providerId is ManagedNKleinOauthProviderId {
	return providerId === "nklein" || providerId === "oca" || providerId === "openai-codex";
}

/** True for providers whose models exist only live at the endpoint (no persisted catalog) — LM Studio. */
export function isLiveOnlyProviderId(providerId: string): boolean {
	return providerId.trim().toLowerCase() === "lmstudio";
}

/** The human-facing display name for a managed-OAuth provider. */
export function formatManagedProviderDisplayName(providerId: ManagedNKleinOauthProviderId): string {
	if (providerId === "nklein") {
		return "!Klein";
	}
	if (providerId === "oca") {
		return "Oracle Code Assist";
	}
	return "OpenAI Codex";
}
