// F1.30 (§5.U) — the REGISTRY-MUTATION cluster of the provider service: the managed-OAuth login and device-auth
// flows that end in `saveSdkProviderSettings` + `writeKanbanSelectedProviderId` (the only provider-service paths
// that mutate the SDK provider registry besides the custom-provider manager and the settings writer). Extracted
// verbatim from nklein-provider-service.ts; the local-only assert runs BEFORE any network or credential touch.

import type {
	RuntimeNKleinDeviceAuthCompleteResponse,
	RuntimeNKleinDeviceAuthStartResponse,
	RuntimeNKleinOauthLoginResponse,
} from "../core/api-contract";
import { assertLocalProviderAllowed } from "./nklein-local-only-policy";
import { normalizeEpochMs } from "./nklein-provider-credential-helpers";
import { createRuntimeOauthCallbacks } from "./nklein-provider-oauth";
import {
	DEFAULT_NKLEIN_API_BASE_URL,
	toProviderServiceErrorMessage as toErrorMessage,
} from "./nklein-provider-selected-settings";
import { writeKanbanSelectedProviderId } from "./nklein-provider-selection-store";
import { toProviderSettingsSummary } from "./nklein-provider-settings-summary";
import { toProviderApiKey } from "./nklein-provider-workos-token.js";
import {
	completeNKleinDeviceAuth as completeSdkDeviceAuth,
	getSdkProviderSettings,
	loginManagedOauthProvider,
	type ManagedNKleinOauthProviderId,
	type SdkProviderSettings,
	saveSdkProviderSettings,
	startNKleinDeviceAuth as startSdkDeviceAuth,
} from "./sdk-provider-boundary";

export async function runOauthLogin(input: {
	providerId: ManagedNKleinOauthProviderId;
	baseUrl?: string | null;
}): Promise<RuntimeNKleinOauthLoginResponse> {
	try {
		const existingSettings = getSdkProviderSettings(input.providerId) ?? {
			provider: input.providerId,
		};
		const baseUrl = input.baseUrl?.trim() || null;
		assertLocalProviderAllowed({ providerId: input.providerId, baseUrl });
		const credentials = await loginManagedOauthProvider({
			providerId: input.providerId,
			baseUrl,
			oauthProvider: input.providerId,
			callbacks: createRuntimeOauthCallbacks(input.providerId),
		});

		const nextSettings: SdkProviderSettings = {
			...existingSettings,
			provider: input.providerId,
			auth: {
				...(existingSettings.auth ?? {}),
				accessToken: toProviderApiKey(input.providerId, credentials.access),
				refreshToken: credentials.refresh,
				accountId: credentials.accountId ?? undefined,
				expiresAt: normalizeEpochMs(credentials.expires),
			},
		};

		if (baseUrl) {
			nextSettings.baseUrl = baseUrl;
		} else {
			delete nextSettings.baseUrl;
		}

		saveSdkProviderSettings({
			settings: nextSettings,
			tokenSource: "oauth",
			setLastUsed: true,
		});
		writeKanbanSelectedProviderId(input.providerId);

		return {
			ok: true,
			provider: input.providerId,
			settings: toProviderSettingsSummary(nextSettings),
		};
	} catch (error) {
		return {
			ok: false,
			provider: input.providerId,
			error: toErrorMessage(error),
		};
	}
}

export async function startDeviceAuth(): Promise<RuntimeNKleinDeviceAuthStartResponse> {
	assertLocalProviderAllowed({ providerId: "nklein" });
	const result = await startSdkDeviceAuth();
	return {
		deviceCode: result.deviceCode,
		userCode: result.userCode,
		verificationUrl: result.verificationUri,
		expiresInSeconds: result.expiresInSeconds,
		pollIntervalSeconds: result.pollIntervalSeconds,
	};
}

export async function completeDeviceAuth(input: {
	deviceCode: string;
	expiresInSeconds: number;
	pollIntervalSeconds: number;
	baseUrl?: string | null;
}): Promise<RuntimeNKleinDeviceAuthCompleteResponse> {
	const providerId: ManagedNKleinOauthProviderId = "nklein";
	try {
		const existingSettings = getSdkProviderSettings(providerId) ?? {
			provider: providerId,
		};
		const apiBaseUrl = input.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL;
		assertLocalProviderAllowed({ providerId, baseUrl: apiBaseUrl });
		const credentials = await completeSdkDeviceAuth({
			deviceCode: input.deviceCode,
			expiresInSeconds: input.expiresInSeconds,
			pollIntervalSeconds: input.pollIntervalSeconds,
			apiBaseUrl,
		});

		const nextSettings: SdkProviderSettings = {
			...existingSettings,
			provider: providerId,
			auth: {
				...(existingSettings.auth ?? {}),
				accessToken: toProviderApiKey(providerId, credentials.access),
				refreshToken: credentials.refresh,
				accountId: credentials.accountId ?? undefined,
				expiresAt: normalizeEpochMs(credentials.expires),
			},
		};

		if (apiBaseUrl !== DEFAULT_NKLEIN_API_BASE_URL) {
			nextSettings.baseUrl = apiBaseUrl;
		} else {
			delete nextSettings.baseUrl;
		}

		saveSdkProviderSettings({
			settings: nextSettings,
			tokenSource: "oauth",
			setLastUsed: true,
		});
		writeKanbanSelectedProviderId(providerId);

		return {
			ok: true,
			provider: providerId,
			settings: toProviderSettingsSummary(nextSettings),
		};
	} catch (error) {
		return {
			ok: false,
			provider: providerId,
			error: toErrorMessage(error),
		};
	}
}
