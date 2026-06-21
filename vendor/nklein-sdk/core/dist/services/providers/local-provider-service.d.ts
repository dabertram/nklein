import { type AddProviderActionRequest, type OAuthProviderId, type ProviderCapability, type ProviderListItem, type ProviderModel, type SaveProviderSettingsActionRequest } from "@nklein/shared";
import type { ProviderClient, ProviderConfig, ProviderProtocol, ProviderSettings } from "../../services/llms/provider-settings";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
export { ensureCustomProvidersLoaded } from "./local-provider-registry";
export interface UpdateLocalProviderRequest {
    providerId: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string | null;
    headers?: Record<string, string> | null;
    timeoutMs?: number | null;
    models?: string[];
    defaultModelId?: string | null;
    modelsSourceUrl?: string | null;
    protocol?: ProviderProtocol | null;
    client?: ProviderClient | null;
    capabilities?: ProviderCapability[] | null;
}
export interface DeleteLocalProviderRequest {
    providerId: string;
}
export declare function addLocalProvider(manager: ProviderSettingsManager, request: Omit<AddProviderActionRequest, "action">): Promise<{
    providerId: string;
    settingsPath: string;
    modelsPath: string;
    modelsCount: number;
}>;
export declare function updateLocalProvider(manager: ProviderSettingsManager, request: UpdateLocalProviderRequest): Promise<{
    providerId: string;
    settingsPath: string;
    modelsPath: string;
    modelsCount: number;
}>;
export declare function deleteLocalProvider(manager: ProviderSettingsManager, request: DeleteLocalProviderRequest): Promise<{
    providerId: string;
    settingsPath: string;
    modelsPath: string;
}>;
export declare function listLocalProviders(manager: ProviderSettingsManager): Promise<{
    providers: ProviderListItem[];
    settingsPath: string;
}>;
export declare function getLocalProviderModels(providerId: string, config?: ProviderConfig): Promise<{
    providerId: string;
    models: ProviderModel[];
}>;
export declare function saveLocalProviderSettings(manager: ProviderSettingsManager, request: Omit<SaveProviderSettingsActionRequest, "action">): {
    providerId: string;
    enabled: boolean;
    settingsPath: string;
};
export declare function refreshProviderModelsFromSource(manager: ProviderSettingsManager, providerId: string): Promise<{
    providerId: string;
    refreshed: boolean;
    modelsCount?: number;
}>;
export declare function normalizeOAuthProvider(provider: string): OAuthProviderId;
export declare function loginLocalProvider(providerId: OAuthProviderId, existing: ProviderSettings | undefined, openUrl: (url: string) => void): Promise<{
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
}>;
export declare function saveLocalProviderOAuthCredentials(manager: ProviderSettingsManager, providerId: OAuthProviderId, existing: ProviderSettings | undefined, credentials: {
    access: string;
    refresh: string;
    expires: number;
    accountId?: string;
}): ProviderSettings;
export declare function resolveLocalNKleinAuthToken(settings: ProviderSettings | undefined): string | undefined;
export type ProviderConfigFieldKey = "apiKey" | "baseUrl";
export interface ProviderConfigFieldRequirement {
    defaultValue?: string;
}
export interface ProviderConfigFields {
    providerId: string;
    authMethod: "api-key" | "oauth";
    fields: Partial<Record<ProviderConfigFieldKey, ProviderConfigFieldRequirement>>;
}
/**
 * Project a provider into the inputs a configure-dialog should render.
 *
 * No fields are marked "required" — `llms` no longer pre-flights credentials,
 * so a missing API key surfaces as the provider's own auth error rather than
 * a synthetic SDK failure. UIs may still require fields client-side if they
 * want, but the runtime does not.
 *
 * - OAuth providers (`nklein`, `oca`, `openai-codex`) return `authMethod:
 *   "oauth"` with no fields; the configure UI should route to the OAuth
 *   login flow instead.
 * - All other providers return `apiKey`. Built-in local/proxy-style providers
 *   with user-supplied endpoints, plus user-added providers with saved
 *   endpoints, also return a pre-filled `baseUrl` field.
 *
 * Returns the same fallback shape for unknown providers (single `apiKey`
 * input, no default base URL) so callers can render a reasonable configure
 * dialog without per-id branches.
 */
export declare function getProviderConfigFields(providerId: string): ProviderConfigFields;
