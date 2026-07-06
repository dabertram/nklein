import type { RuntimeNKleinProviderSettings } from "../core/api-contract";
import { assertLocalProviderAllowed } from "./nklein-local-only-policy";
import { hasOauthAccessToken } from "./nklein-provider-credential-helpers";
import { writeKanbanSelectedProviderId } from "./nklein-provider-selection-store";
import { toProviderSettingsSummary } from "./nklein-provider-settings-summary";
import {
	addSdkCustomProvider,
	deleteSdkCustomProvider,
	getLastUsedSdkProviderSettings,
	getSdkProviderSettings,
	listSdkProviderCatalog,
	type SdkCustomProviderCapability,
	saveSdkProviderSettings,
	updateSdkCustomProvider,
} from "./sdk-provider-boundary";

export interface AddCustomNKleinProviderInput {
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string | null;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: SdkCustomProviderCapability[];
}

export interface UpdateCustomNKleinProviderInput {
	providerId: string;
	name?: string;
	baseUrl?: string;
	apiKey?: string | null;
	headers?: Record<string, string> | null;
	timeoutMs?: number | null;
	models?: string[];
	defaultModelId?: string | null;
	modelsSourceUrl?: string | null;
	capabilities?: SdkCustomProviderCapability[];
}

/** Service touchpoint: the current selected-provider summary (returned by delete). */
export interface CustomProviderManagerDeps {
	getProviderSettingsSummary(): RuntimeNKleinProviderSettings;
}

export interface CustomProviderManager {
	addCustomProvider(input: AddCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings>;
	updateCustomProvider(input: UpdateCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings>;
	deleteCustomProvider(input: { providerId: string }): Promise<RuntimeNKleinProviderSettings>;
}

/**
 * Custom (openai-compatible) provider CRUD, extracted verbatim from createNKleinProviderService. Each op normalizes
 * the provider id, enforces the local-only lockdown (`assertLocalProviderAllowed` before any persistence), mutates the
 * SDK-owned provider store, and returns the resulting provider-settings summary. Add also selects the new provider;
 * update preserves the last-used selection; delete falls back to the current selection summary.
 */
export function createCustomProviderManager(deps: CustomProviderManagerDeps): CustomProviderManager {
	async function addCustomProvider(input: AddCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
		const providerId = input.providerId.trim().toLowerCase();
		if (!providerId) {
			throw new Error("Provider ID cannot be empty.");
		}
		assertLocalProviderAllowed({ providerId, baseUrl: input.baseUrl });
		const existingProviders = await listSdkProviderCatalog().catch(() => []);
		if (existingProviders.some((provider) => provider.id.trim().toLowerCase() === providerId)) {
			throw new Error(`Provider "${providerId}" already exists.`);
		}

		await addSdkCustomProvider({
			providerId,
			name: input.name,
			baseUrl: input.baseUrl,
			apiKey: input.apiKey ?? null,
			headers: input.headers,
			timeoutMs: input.timeoutMs,
			models: input.models,
			defaultModelId: input.defaultModelId ?? null,
			modelsSourceUrl: input.modelsSourceUrl ?? null,
			capabilities: input.capabilities,
		});

		const existingSettings = getSdkProviderSettings(providerId) ?? { provider: providerId };
		saveSdkProviderSettings({
			settings: existingSettings,
			tokenSource: hasOauthAccessToken(existingSettings) ? "oauth" : "manual",
			setLastUsed: true,
		});
		writeKanbanSelectedProviderId(providerId);

		return toProviderSettingsSummary(getSdkProviderSettings(providerId));
	}

	async function updateCustomProvider(input: UpdateCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
		const providerId = input.providerId.trim().toLowerCase();
		if (!providerId) {
			throw new Error("Provider ID cannot be empty.");
		}
		const existingSettings = getSdkProviderSettings(providerId) ?? { provider: providerId };
		assertLocalProviderAllowed({ providerId, baseUrl: input.baseUrl ?? existingSettings.baseUrl });

		await updateSdkCustomProvider({
			providerId,
			name: input.name,
			baseUrl: input.baseUrl,
			apiKey: input.apiKey ?? undefined,
			headers: input.headers ?? undefined,
			timeoutMs: input.timeoutMs ?? undefined,
			models: input.models,
			defaultModelId: input.defaultModelId ?? undefined,
			modelsSourceUrl: input.modelsSourceUrl ?? undefined,
			capabilities: input.capabilities,
		});

		const isLastUsed = getLastUsedSdkProviderSettings()?.provider?.trim().toLowerCase() === providerId;
		saveSdkProviderSettings({
			settings: existingSettings,
			tokenSource: hasOauthAccessToken(existingSettings) ? "oauth" : "manual",
			setLastUsed: isLastUsed,
		});

		return toProviderSettingsSummary(getSdkProviderSettings(providerId));
	}

	async function deleteCustomProvider(input: { providerId: string }): Promise<RuntimeNKleinProviderSettings> {
		const providerId = input.providerId.trim().toLowerCase();
		if (!providerId) {
			throw new Error("Provider ID cannot be empty.");
		}

		await deleteSdkCustomProvider(providerId);
		return deps.getProviderSettingsSummary();
	}

	return { addCustomProvider, updateCustomProvider, deleteCustomProvider };
}
