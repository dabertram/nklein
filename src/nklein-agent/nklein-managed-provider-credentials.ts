import { resolveVisibleApiKey } from "./nklein-provider-credential-helpers";
import { formatManagedProviderDisplayName } from "./nklein-provider-id-classification";
import type { ManagedNKleinOauthProviderId, SdkProviderSettings } from "./sdk-provider-boundary";

/**
 * §5.U — the managed-provider (nklein / oca / openai-codex) credential resolution extracted from
 * `nklein-provider-service`: the env-var fallback keys, the env/oauth/settings precedence for a launch API key, and the
 * "you're not signed in" error when nothing resolves. Reads `process.env`; otherwise pure. Independently testable.
 */

/** The environment variables consulted (in order) as a fallback API key for each managed provider. */
export const MANAGED_PROVIDER_ENV_KEYS: Record<ManagedNKleinOauthProviderId, readonly string[]> = {
	nklein: ["NKLEIN_API_KEY"],
	oca: ["OCA_API_KEY"],
	"openai-codex": [],
};

/** Read a single env var as a trimmed API key, or null when unset/blank. */
export function readEnvApiKey(envKey: string): string | null {
	const apiKey = process.env[envKey]?.trim() ?? "";
	return apiKey.length > 0 ? apiKey : null;
}

/** The first non-blank env-var API key for a managed provider, or null when none is set. */
export function resolveManagedProviderEnvApiKey(providerId: ManagedNKleinOauthProviderId): string | null {
	for (const envKey of MANAGED_PROVIDER_ENV_KEYS[providerId]) {
		const apiKey = readEnvApiKey(envKey);
		if (apiKey) {
			return apiKey;
		}
	}
	return null;
}

/**
 * The API key to launch a native task under a managed provider — oauth-derived key, then the visible settings key, then
 * an env-var fallback. Throws a "sign in from Settings" error (naming the env vars, if any) when nothing resolves.
 */
export function resolveManagedProviderLaunchApiKey(input: {
	providerId: ManagedNKleinOauthProviderId;
	settings: SdkProviderSettings;
	oauthApiKey: string | null;
}): string {
	const resolvedApiKey =
		input.oauthApiKey ?? resolveVisibleApiKey(input.settings) ?? resolveManagedProviderEnvApiKey(input.providerId);
	if (resolvedApiKey) {
		return resolvedApiKey;
	}

	const envKeys = MANAGED_PROVIDER_ENV_KEYS[input.providerId];
	const envHelp = envKeys.length > 0 ? ` or set ${envKeys.join(" or ")}` : "";
	throw new Error(
		`${formatManagedProviderDisplayName(input.providerId)} provider is selected but no ${formatManagedProviderDisplayName(input.providerId)} credentials are configured. Sign in from Settings${envHelp} before starting a native !Klein task.`,
	);
}
