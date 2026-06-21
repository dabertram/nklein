import { type ITelemetryService, type OAuthProviderId } from "@nklein/shared";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
type ManagedOAuthProviderId = OAuthProviderId;
export declare class OAuthReauthRequiredError extends Error {
    readonly providerId: ManagedOAuthProviderId;
    constructor(providerId: ManagedOAuthProviderId);
}
export type RuntimeOAuthResolution = {
    providerId: ManagedOAuthProviderId;
    apiKey: string;
    accountId?: string;
    refreshed: boolean;
};
export declare class RuntimeOAuthTokenManager {
    private readonly providerSettingsManager;
    private readonly telemetry?;
    private readonly refreshInFlight;
    constructor(options?: {
        providerSettingsManager?: ProviderSettingsManager;
        telemetry?: ITelemetryService;
    });
    resolveProviderApiKey(input: {
        providerId: string;
        forceRefresh?: boolean;
    }): Promise<RuntimeOAuthResolution | null>;
    private resolveWithSingleFlight;
    private resolveProviderApiKeyInternal;
    private resolveCredentials;
}
export {};
