import { type ProviderSettings } from "../../types/provider-settings";
import type { ProviderSettingsManager } from "./provider-settings-manager";
export interface MigrateLegacyProviderSettingsOptions {
    providerSettingsManager: ProviderSettingsManager;
    dataDir?: string;
    globalStatePath?: string;
    secretsPath?: string;
}
export interface MigrateLegacyProviderSettingsResult {
    migrated: boolean;
    providerCount: number;
    lastUsedProvider?: string;
}
export type LegacyNKleinUserInfo = {
    idToken: string;
    expiresAt: number;
    refreshToken: string;
    userInfo: {
        id: string;
        email: string;
        displayName: string;
        termsAcceptedAt: string;
        nkleinBenchConsent: boolean;
        createdAt: string;
        updatedAt: string;
    };
    provider: string;
    startedAt: number;
};
/**
 * Resolves legacy NKlein account auth data from the raw `nklein:nkleinAccountId`
 * secret string into the auth fields used by `ProviderSettings`.
 *
 * Returns `undefined` when the input is missing, empty, whitespace-only, or
 * unparseable JSON.
 */
export declare function resolveLegacyNKleinAuth(rawAccountData: string | undefined): ProviderSettings["auth"] | undefined;
export declare function migrateLegacyProviderSettings(options: MigrateLegacyProviderSettingsOptions): MigrateLegacyProviderSettingsResult;
