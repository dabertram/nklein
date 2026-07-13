// F1.30 (§5.U) — the !Klein account/health cluster of the provider service: profile, kanban access, Featurebase
// token, balance, and organizations against the nklein.bot API, plus account switching. Owns the short-TTL profile
// dedupe cache and the shared retry-once-after-OAuth-refresh shape. Extracted verbatim from
// nklein-provider-service.ts; the facade composes it unchanged.

import type {
	RuntimeNKleinAccountBalanceResponse,
	RuntimeNKleinAccountOrganizationsResponse,
	RuntimeNKleinAccountProfileResponse,
	RuntimeNKleinAccountSwitchResponse,
	RuntimeNKleinKanbanAccessResponse,
} from "../core/api-contract";
import { computeKanbanEnabled, parseNKleinRemoteConfigValue } from "./nklein-kanban-access-policy";
import { refreshManagedOauthSettings } from "./nklein-provider-oauth";
import {
	DEFAULT_NKLEIN_API_BASE_URL,
	getSelectedProviderSettings,
	toProviderServiceErrorMessage as toErrorMessage,
} from "./nklein-provider-selected-settings";
import { ensureWorkosPrefix } from "./nklein-provider-workos-token.js";
import {
	fetchSdkFeaturebaseToken,
	fetchSdkNKleinAccountBalance,
	fetchSdkNKleinAccountProfile,
	fetchSdkNKleinUserRemoteConfig,
	fetchSdkOrganizationBalance,
	fetchSdkOrgData,
	type SdkProviderSettings,
	switchSdkNKleinAccount,
} from "./sdk-provider-boundary";

export function createProviderAccountApi() {
	// Dedup concurrent fetchSdkNKleinAccountProfile calls (e.g. balance + orgs on dialog open).
	// Cached for 5s so back-to-back callers share a single network round-trip.
	const PROFILE_CACHE_TTL_MS = 5_000;
	let profileCache: {
		key: string;
		promise: ReturnType<typeof fetchSdkNKleinAccountProfile>;
		expiresAt: number;
	} | null = null;

	function fetchProfileDeduped(apiParams: { apiBaseUrl: string; accessToken: string }) {
		const cacheKey = `${apiParams.apiBaseUrl}::${apiParams.accessToken}`;
		if (profileCache && profileCache.key === cacheKey && Date.now() < profileCache.expiresAt) {
			return profileCache.promise;
		}
		const promise = fetchSdkNKleinAccountProfile(apiParams);
		profileCache = { key: cacheKey, promise, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS };
		// Clear cache on failure so retries aren't stuck with a rejected promise.
		promise.catch(() => {
			if (profileCache?.promise === promise) {
				profileCache = null;
			}
		});
		return promise;
	}

	return {
		async getNKleinAccountProfile(): Promise<RuntimeNKleinAccountProfileResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return {
						profile: null,
					};
				}

				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return {
						profile: null,
					};
				}

				const tryFetchProfile = async (
					settings: SdkProviderSettings,
				): Promise<RuntimeNKleinAccountProfileResponse["profile"] | null> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return null;
					}
					const me = await fetchProfileDeduped({
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
					});
					return {
						accountId: me.id?.trim() || settings.auth?.accountId?.trim() || null,
						email: me.email?.trim() || null,
						displayName: me.displayName?.trim() || null,
					};
				};

				try {
					const profile = await tryFetchProfile(selectedSettings);
					if (profile) {
						return {
							profile,
						};
					}
				} catch {
					// Retry once after OAuth refresh below.
				}

				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				const profile = oauthResolution?.settings ? await tryFetchProfile(oauthResolution.settings) : null;
				return {
					profile,
				};
			} catch (error) {
				return {
					profile: null,
					error: toErrorMessage(error),
				};
			}
		},

		async getNKleinKanbanAccess(): Promise<RuntimeNKleinKanbanAccessResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { enabled: true };
				}

				const rawAccessToken = selectedSettings.auth?.accessToken?.trim() ?? "";
				if (!rawAccessToken) {
					return { enabled: true };
				}

				const remoteConfigResponse = await fetchSdkNKleinUserRemoteConfig({
					apiBaseUrl: selectedSettings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
				});
				if (!remoteConfigResponse?.enabled || !remoteConfigResponse?.organizationId) {
					return { enabled: true };
				}

				const orgData = await fetchSdkOrgData({
					apiBaseUrl: selectedSettings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
					organizationId: remoteConfigResponse.organizationId,
				});

				const parsedRemoteConfig = parseNKleinRemoteConfigValue(remoteConfigResponse.value);
				const isEnterpriseCustomer = !!orgData?.externalOrganizationId;
				return {
					enabled: computeKanbanEnabled(parsedRemoteConfig, isEnterpriseCustomer),
				};
			} catch (error) {
				return {
					enabled: true,
					error: toErrorMessage(error),
				};
			}
		},

		async getFeaturebaseToken(): Promise<{ featurebaseJwt: string }> {
			const selectedSettings = getSelectedProviderSettings();
			if (!selectedSettings) {
				throw new Error("No provider settings configured.");
			}

			const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
			if (normalizedProviderId !== "nklein") {
				throw new Error("Featurebase token requires a !Klein provider.");
			}

			const tryFetchToken = async (settings: SdkProviderSettings): Promise<{ featurebaseJwt: string }> => {
				const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
				if (!rawAccessToken) {
					throw new Error("No access token configured for !Klein provider.");
				}
				return await fetchSdkFeaturebaseToken({
					apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
					accessToken: ensureWorkosPrefix(rawAccessToken),
				});
			};

			try {
				return await tryFetchToken(selectedSettings);
			} catch {
				// Retry once after OAuth refresh.
			}

			const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
			if (oauthResolution?.settings) {
				return await tryFetchToken(oauthResolution.settings);
			}
			throw new Error("Failed to fetch Featurebase token.");
		},

		async getNKleinAccountBalance(): Promise<RuntimeNKleinAccountBalanceResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
				}
				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
				}

				const resolveWithSettings = async (
					settings: SdkProviderSettings,
				): Promise<RuntimeNKleinAccountBalanceResponse> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
					}
					const apiParams = {
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
					};
					const me = await fetchProfileDeduped(apiParams);
					const activeOrg = me.organizations?.find((org) => org.active) ?? null;
					if (activeOrg) {
						const orgBalance = await fetchSdkOrganizationBalance({
							...apiParams,
							organizationId: activeOrg.organizationId,
						});
						return {
							balance: orgBalance.balance,
							activeAccountLabel: activeOrg.name,
							activeOrganizationId: activeOrg.organizationId,
						};
					}
					const personalBalance = await fetchSdkNKleinAccountBalance(apiParams);
					return {
						balance: personalBalance.balance,
						activeAccountLabel: "Personal",
						activeOrganizationId: null,
					};
				};

				try {
					return await resolveWithSettings(selectedSettings);
				} catch {
					// Retry once after OAuth refresh.
				}
				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				if (oauthResolution?.settings) {
					return await resolveWithSettings(oauthResolution.settings);
				}
				return { balance: null, activeAccountLabel: null, activeOrganizationId: null };
			} catch (error) {
				return {
					balance: null,
					activeAccountLabel: null,
					activeOrganizationId: null,
					error: toErrorMessage(error),
				};
			}
		},

		async getNKleinAccountOrganizations(): Promise<RuntimeNKleinAccountOrganizationsResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { organizations: [] };
				}
				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return { organizations: [] };
				}

				const resolveWithSettings = async (
					settings: SdkProviderSettings,
				): Promise<RuntimeNKleinAccountOrganizationsResponse> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return { organizations: [] };
					}
					const apiParams = {
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
					};
					const me = await fetchProfileDeduped(apiParams);
					return {
						organizations: (me.organizations ?? []).map((org: NonNullable<typeof me.organizations>[number]) => ({
							organizationId: org.organizationId,
							name: org.name,
							active: org.active,
							roles: org.roles ?? [],
						})),
					};
				};

				try {
					return await resolveWithSettings(selectedSettings);
				} catch {
					// Retry once after OAuth refresh.
				}
				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				if (oauthResolution?.settings) {
					return await resolveWithSettings(oauthResolution.settings);
				}
				return { organizations: [] };
			} catch (error) {
				return {
					organizations: [],
					error: toErrorMessage(error),
				};
			}
		},

		async switchNKleinAccount(organizationId: string | null): Promise<RuntimeNKleinAccountSwitchResponse> {
			try {
				const selectedSettings = getSelectedProviderSettings();
				if (!selectedSettings) {
					return { ok: false, error: "No provider settings configured." };
				}
				const normalizedProviderId = selectedSettings.provider.trim().toLowerCase();
				if (normalizedProviderId !== "nklein") {
					return { ok: false, error: "Account switching requires a !Klein provider." };
				}

				const doSwitch = async (settings: SdkProviderSettings): Promise<RuntimeNKleinAccountSwitchResponse> => {
					const rawAccessToken = settings.auth?.accessToken?.trim() ?? "";
					if (!rawAccessToken) {
						return { ok: false, error: "No access token configured." };
					}
					await switchSdkNKleinAccount({
						apiBaseUrl: settings.baseUrl?.trim() || DEFAULT_NKLEIN_API_BASE_URL,
						accessToken: ensureWorkosPrefix(rawAccessToken),
						organizationId,
					});
					profileCache = null;
					return { ok: true };
				};

				try {
					return await doSwitch(selectedSettings);
				} catch {
					// Retry once after OAuth refresh.
				}
				const oauthResolution = await refreshManagedOauthSettings(selectedSettings);
				if (oauthResolution?.settings) {
					return await doSwitch(oauthResolution.settings);
				}
				return { ok: false, error: "Failed to switch account." };
			} catch (error) {
				return { ok: false, error: toErrorMessage(error) };
			}
		},
	};
}
