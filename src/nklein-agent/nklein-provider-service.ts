// !Klein-facing facade over the SDK-backed provider store.
// F1.30 (§5.U) — pure COMPOSITION of the split provider-service clusters, each behind its proven seam:
//   - discovery/cache  → nklein-provider-model-discovery.ts + nklein-model-discovery-api.ts (30 s TTL roster
//     throttle retained in model-discovery-throttle.ts) and the account-api profile dedupe cache;
//   - registry mutation → nklein-provider-auth-flows.ts (OAuth/device auth) + nklein-custom-provider-manager.ts
//     (custom CRUD) + nklein-provider-settings-save.ts (settings writer);
//   - load control      → nklein-provider-launch-config.ts (the single dispatch chokepoint: local-only lockdown +
//     ≥32k context-window floor before any OAuth/key/network touch);
//   - health/account    → nklein-provider-account-api.ts (profile, kanban access, balance, orgs, switch);
//   - response shaping  → nklein-provider-settings-summary.ts (settings → runtime summary).
// The facade keeps the public surface byte-compatible (same factory, same method shapes, same re-exports) so
// runtime-api and the behavior tests are untouched.

import type {
	RuntimeNKleinAccountBalanceResponse,
	RuntimeNKleinAccountOrganizationsResponse,
	RuntimeNKleinAccountProfileResponse,
	RuntimeNKleinAccountSwitchResponse,
	RuntimeNKleinDeviceAuthCompleteResponse,
	RuntimeNKleinDeviceAuthStartResponse,
	RuntimeNKleinEndpointModelDiscoveryResponse,
	RuntimeNKleinKanbanAccessResponse,
	RuntimeNKleinOauthLoginResponse,
	RuntimeNKleinProviderCatalogResponse,
	RuntimeNKleinProviderModelsResponse,
	RuntimeNKleinProviderSettings,
	RuntimeNKleinProviderSettingsSaveResponse,
	RuntimeNKleinReasoningEffort,
} from "../core/api-contract";
import {
	type AddCustomNKleinProviderInput,
	createCustomProviderManager,
	type UpdateCustomNKleinProviderInput,
} from "./nklein-custom-provider-manager";
import { createModelDiscoveryApi } from "./nklein-model-discovery-api";
import { createProviderAccountApi } from "./nklein-provider-account-api";
import { completeDeviceAuth, runOauthLogin, startDeviceAuth } from "./nklein-provider-auth-flows";
import { type ResolvedNKleinLaunchConfig, resolveNKleinLaunchConfig } from "./nklein-provider-launch-config";
import { discoverModelsFromEndpoint, loadProviderModelsWithMeasuredWindows } from "./nklein-provider-model-discovery";
import { getSelectedProviderSettings } from "./nklein-provider-selected-settings";
import { createProviderSettingsWriter, type SaveProviderSettingsInput } from "./nklein-provider-settings-save";
import { toProviderSettingsSummary } from "./nklein-provider-settings-summary";
import type { ManagedNKleinOauthProviderId } from "./sdk-provider-boundary";

// Re-exported for API compatibility — the custom-provider input types now live with their manager (§5.U).
export type { AddCustomNKleinProviderInput, UpdateCustomNKleinProviderInput } from "./nklein-custom-provider-manager";
// Re-exported for API compatibility — launch-config resolution now lives with the load-control cluster (F1.30).
export type { ResolvedNKleinLaunchConfig } from "./nklein-provider-launch-config";
// Re-exported for API compatibility — the model-discovery cluster now lives in its own module (§5.U).
export {
	clearProviderModelDiscoveryCache,
	loadProviderModelsWithFallback,
} from "./nklein-provider-model-discovery";

export function createNKleinProviderService() {
	const getProviderSettingsSummary = (): RuntimeNKleinProviderSettings =>
		toProviderSettingsSummary(getSelectedProviderSettings());

	const accountApi = createProviderAccountApi();
	const customProviderManager = createCustomProviderManager({ getProviderSettingsSummary });
	const modelDiscoveryApi = createModelDiscoveryApi({
		getProviderSettingsSummary,
		loadProviderModelsWithMeasuredWindows,
		discoverModelsFromEndpoint,
	});
	const providerSettingsWriter = createProviderSettingsWriter({ loadProviderModelsWithMeasuredWindows });

	return {
		getProviderSettingsSummary(): RuntimeNKleinProviderSettings {
			return getProviderSettingsSummary();
		},

		/**
		 * The base URL the board-independent chat (§5.M, local-only) should use: the selected provider's endpoint when
		 * a LOCAL provider (LM Studio / Ollama / a localhost custom provider) is selected, else null so the chat falls
		 * back to its own default local endpoint. (`getSelectedProviderSettings` already returns null for a cloud
		 * selection — the chat is local-only and fails closed against cloud.) Without this the chat ignored the
		 * configured endpoint entirely and always hit the hardcoded default port.
		 */
		getLocalChatBaseUrl(): string | null {
			return getSelectedProviderSettings()?.baseUrl?.trim() || null;
		},

		getNKleinAccountProfile(): Promise<RuntimeNKleinAccountProfileResponse> {
			return accountApi.getNKleinAccountProfile();
		},

		getNKleinKanbanAccess(): Promise<RuntimeNKleinKanbanAccessResponse> {
			return accountApi.getNKleinKanbanAccess();
		},

		getFeaturebaseToken(): Promise<{ featurebaseJwt: string }> {
			return accountApi.getFeaturebaseToken();
		},

		getNKleinAccountBalance(): Promise<RuntimeNKleinAccountBalanceResponse> {
			return accountApi.getNKleinAccountBalance();
		},

		getNKleinAccountOrganizations(): Promise<RuntimeNKleinAccountOrganizationsResponse> {
			return accountApi.getNKleinAccountOrganizations();
		},

		switchNKleinAccount(organizationId: string | null): Promise<RuntimeNKleinAccountSwitchResponse> {
			return accountApi.switchNKleinAccount(organizationId);
		},

		resolveLaunchConfig(overrides?: {
			providerIdOverride?: string;
			modelIdOverride?: string;
			reasoningEffortOverride?: RuntimeNKleinReasoningEffort | null;
		}): Promise<ResolvedNKleinLaunchConfig> {
			return resolveNKleinLaunchConfig(overrides);
		},

		getProviderCatalog(): Promise<RuntimeNKleinProviderCatalogResponse> {
			return modelDiscoveryApi.getProviderCatalog();
		},

		getProviderModels(providerId: string): Promise<RuntimeNKleinProviderModelsResponse> {
			return modelDiscoveryApi.getProviderModels(providerId);
		},

		discoverEndpointModels(input: {
			baseUrl: string;
			apiKey?: string | null;
			modelsSourceUrl?: string | null;
			timeoutMs?: number | null;
		}): Promise<RuntimeNKleinEndpointModelDiscoveryResponse> {
			return modelDiscoveryApi.discoverEndpointModels(input);
		},

		addCustomProvider(input: AddCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
			return customProviderManager.addCustomProvider(input);
		},

		updateCustomProvider(input: UpdateCustomNKleinProviderInput): Promise<RuntimeNKleinProviderSettings> {
			return customProviderManager.updateCustomProvider(input);
		},

		deleteCustomProvider(input: { providerId: string }): Promise<RuntimeNKleinProviderSettings> {
			return customProviderManager.deleteCustomProvider(input);
		},

		saveProviderSettings(input: SaveProviderSettingsInput): Promise<RuntimeNKleinProviderSettingsSaveResponse> {
			return providerSettingsWriter.saveProviderSettings(input);
		},

		runOauthLogin(input: {
			providerId: ManagedNKleinOauthProviderId;
			baseUrl?: string | null;
		}): Promise<RuntimeNKleinOauthLoginResponse> {
			return runOauthLogin(input);
		},

		startDeviceAuth(): Promise<RuntimeNKleinDeviceAuthStartResponse> {
			return startDeviceAuth();
		},

		completeDeviceAuth(input: {
			deviceCode: string;
			expiresInSeconds: number;
			pollIntervalSeconds: number;
			baseUrl?: string | null;
		}): Promise<RuntimeNKleinDeviceAuthCompleteResponse> {
			return completeDeviceAuth(input);
		},
	};
}
