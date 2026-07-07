import { openInBrowser } from "../server/browser";
import { normalizeEpochMs } from "./nklein-provider-credential-helpers";
import { isManagedOauthProviderId } from "./nklein-provider-id-classification";
import { stripWorkosPrefix, toProviderApiKey } from "./nklein-provider-workos-token.js";
import {
	type ManagedNKleinOauthProviderId,
	refreshManagedOauthCredentials,
	type SdkProviderSettings,
	saveSdkProviderSettings,
} from "./sdk-provider-boundary";

/**
 * Managed-OAuth provider credential lifecycle (todo §5.U — extracted from nklein-provider-service.ts as a cohesive
 * sibling module). These three functions form the OAuth cluster the provider service delegates to: the interactive
 * sign-in callbacks, the token-change equality gate, and the on-launch silent refresh. Their entire dependency surface
 * is imports (no provider-service module state, no factory closure), so the move is behavior-preserving — the service
 * imports them back and uses them exactly as before.
 */

/** Build the interactive OAuth callbacks (open the auth URL in the browser; a stuck callback surfaces the URL). */
export function createRuntimeOauthCallbacks(providerId: ManagedNKleinOauthProviderId) {
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

/**
 * The OAuth-token-change gate — its correctness decides whether refreshed credentials get persisted, so a dropped
 * field would silently keep stale tokens. Pure; unit-tested directly (provider-auth-settings-equal.test.ts).
 */
export function authSettingsEqual(left: SdkProviderSettings["auth"], right: SdkProviderSettings["auth"]): boolean {
	return (
		(left?.accessToken ?? null) === (right?.accessToken ?? null) &&
		(left?.refreshToken ?? null) === (right?.refreshToken ?? null) &&
		(left?.accountId ?? null) === (right?.accountId ?? null) &&
		(left?.expiresAt ?? null) === (right?.expiresAt ?? null)
	);
}

/**
 * On launch, silently refresh a managed-OAuth provider's access token from its refresh token. Returns null for
 * non-managed providers or when there is nothing to refresh (no access/refresh token); throws when the refresh is
 * rejected (credentials invalid → the user must re-login). Persists the new settings ONLY when they actually changed
 * (via {@link authSettingsEqual}), avoiding redundant writes.
 */
export async function refreshManagedOauthSettings(
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
