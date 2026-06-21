import { z } from "zod";
import { type ProviderClient, type ProviderConfig, type ProviderProtocol, type ProviderSettings, type ToProviderConfigOptions, toProviderConfig } from "../services/llms/provider-settings";
export type { ProviderClient, ProviderConfig, ProviderProtocol, ProviderSettings, ToProviderConfigOptions, };
export declare const ProviderSettingsSchemaTyped: z.ZodType<ProviderSettings>;
export { toProviderConfig };
export type ProviderTokenSource = "manual" | "oauth" | "migration";
export interface StoredProviderSettingsEntry {
    settings: ProviderSettings;
    updatedAt: string;
    tokenSource: ProviderTokenSource;
}
export interface StoredProviderSettings {
    version: 1;
    lastUsedProvider?: string;
    providers: Record<string, StoredProviderSettingsEntry>;
}
export declare const StoredProviderSettingsEntrySchema: z.ZodType<StoredProviderSettingsEntry>;
export declare const StoredProviderSettingsSchema: z.ZodType<StoredProviderSettings>;
export declare function emptyStoredProviderSettings(): StoredProviderSettings;
