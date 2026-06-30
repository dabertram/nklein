import type { SdkProviderSettings } from "./sdk-provider-boundary";

/**
 * Pure provider credential / OAuth-token helpers, extracted from nklein-provider-service.
 *
 * Reading a usable API key out of provider settings, checking OAuth token presence, and converting
 * an OAuth expiry timestamp (which arrives in either seconds or milliseconds, depending on the
 * provider) into a normalized epoch-ms / response-seconds value. All pure — no I/O, no env, no SDK
 * calls — so the fiddly seconds-vs-ms detection and the empty/expired fallbacks are unit-tested.
 */

/** The first non-empty API key from settings (top-level or nested auth), or null. */
export function resolveVisibleApiKey(settings: SdkProviderSettings | null): string | null {
	const apiKey = settings?.apiKey?.trim() || settings?.auth?.apiKey?.trim() || "";
	return apiKey.length > 0 ? apiKey : null;
}

/** True when settings carry a non-empty OAuth access token. */
export function hasOauthAccessToken(settings: SdkProviderSettings | null): boolean {
	return (settings?.auth?.accessToken?.trim() ?? "").length > 0;
}

/** True when settings carry a non-empty OAuth refresh token. */
export function hasOauthRefreshToken(settings: SdkProviderSettings | null): boolean {
	return (settings?.auth?.refreshToken?.trim() ?? "").length > 0;
}

/**
 * Normalize an OAuth `expiresAt` to epoch milliseconds. Missing / non-finite / non-positive values
 * are treated as already-expired (now − 1ms). Values ≥ 1e12 are assumed to already be ms; smaller
 * positive values are assumed to be seconds and scaled up.
 */
export function normalizeEpochMs(expiresAt: number | null | undefined): number {
	if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= 0) {
		return Date.now() - 1;
	}
	if (expiresAt >= 1_000_000_000_000) {
		return Math.floor(expiresAt);
	}
	return Math.floor(expiresAt * 1000);
}

/** The expiry as whole seconds for an API response (≥ 1), or null when there is no valid expiry. */
export function toResponseExpirySeconds(expiresAt: number | null | undefined): number | null {
	if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= 0) {
		return null;
	}
	return Math.max(1, Math.floor(normalizeEpochMs(expiresAt) / 1000));
}
