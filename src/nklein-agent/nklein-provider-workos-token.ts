import type { ManagedNKleinOauthProviderId } from "./sdk-provider-boundary";

/**
 * WorkOS access-token helpers for the !Klein managed OAuth provider (§5.U-extracted from the oversized
 * `nklein-provider-service.ts`): the managed `nklein` provider tags its OAuth access tokens with a `workos:` prefix, so
 * these add / strip it and build the provider API key from an access token. Pure string transforms.
 */

const WORKOS_TOKEN_PREFIX = "workos:";

export function stripWorkosPrefix(accessToken: string): string {
	if (accessToken.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)) {
		return accessToken.slice(WORKOS_TOKEN_PREFIX.length);
	}
	return accessToken;
}

export function ensureWorkosPrefix(accessToken: string): string {
	const normalized = accessToken.trim();
	if (!normalized) {
		return normalized;
	}
	if (normalized.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)) {
		return normalized;
	}
	return `${WORKOS_TOKEN_PREFIX}${normalized}`;
}

export function toProviderApiKey(providerId: ManagedNKleinOauthProviderId, accessToken: string): string {
	if (providerId === "nklein") {
		return `${WORKOS_TOKEN_PREFIX}${accessToken}`;
	}
	return accessToken;
}
