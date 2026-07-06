import type { RuntimeNKleinProviderSettings, RuntimeNKleinReasoningEffort } from "../core/api-contract";
import {
	hasOauthAccessToken,
	hasOauthRefreshToken,
	resolveVisibleApiKey,
	toResponseExpirySeconds,
} from "./nklein-provider-credential-helpers";
import { isManagedOauthProviderId } from "./nklein-provider-id-classification";
import type { SdkProviderSettings } from "./sdk-provider-boundary";

/**
 * §5.U — the PURE mapper from vendored-SDK provider settings onto the runtime's `RuntimeNKleinProviderSettings` DTO the
 * web-ui/API render (provider/model/baseUrl, reasoning effort, and the "is X configured?" booleans that NEVER leak the
 * secret values themselves). Extracted from `nklein-provider-service` so the settings→summary projection is a focused,
 * independently-testable unit. No I/O, no state.
 */

type SdkReasoningEffort = NonNullable<NonNullable<SdkProviderSettings["reasoning"]>["effort"]>;

/** SDK reasoning effort → the runtime enum: `"none"` (and absent) collapse to null; any other value passes through. */
export function toRuntimeReasoningEffort(
	effort: SdkReasoningEffort | null | undefined,
): RuntimeNKleinReasoningEffort | null {
	if (!effort || effort === "none") {
		return null;
	}
	return effort;
}

/** The empty summary — no provider selected / configured (every "configured?" flag false, every value null). */
export function createEmptyProviderSettingsSummary(): RuntimeNKleinProviderSettings {
	return {
		providerId: null,
		modelId: null,
		baseUrl: null,
		reasoningEffort: null,
		apiKeyConfigured: false,
		oauthProvider: null,
		oauthAccessTokenConfigured: false,
		oauthRefreshTokenConfigured: false,
		oauthAccountId: null,
		oauthExpiresAt: null,
	};
}

/** Project SDK settings onto the render DTO — trims the string fields, and reports credential PRESENCE, never values. */
export function toProviderSettingsSummary(settings: SdkProviderSettings | null): RuntimeNKleinProviderSettings {
	if (!settings) {
		return createEmptyProviderSettingsSummary();
	}

	const providerId = settings.provider?.trim() || null;
	const oauthProvider = providerId && isManagedOauthProviderId(providerId) ? providerId : null;

	return {
		providerId,
		modelId: settings.model?.trim() || null,
		baseUrl: settings.baseUrl?.trim() || null,
		reasoningEffort: toRuntimeReasoningEffort(settings.reasoning?.effort),
		apiKeyConfigured: Boolean(resolveVisibleApiKey(settings)),
		oauthProvider,
		oauthAccessTokenConfigured: hasOauthAccessToken(settings),
		oauthRefreshTokenConfigured: hasOauthRefreshToken(settings),
		oauthAccountId: settings.auth?.accountId?.trim() || null,
		oauthExpiresAt: toResponseExpirySeconds(settings.auth?.expiresAt),
	};
}
