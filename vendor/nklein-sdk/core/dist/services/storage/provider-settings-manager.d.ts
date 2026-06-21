import { type ProviderConfig, type ProviderSettings, type ProviderTokenSource, type StoredProviderSettings, type ToProviderConfigOptions } from "../../types/provider-settings";
export interface ProviderSettingsManagerOptions {
    filePath?: string;
    dataDir?: string;
}
export interface SaveProviderSettingsOptions {
    setLastUsed?: boolean;
    tokenSource?: ProviderTokenSource;
}
export declare class ProviderSettingsManager {
    private readonly filePath;
    private readonly dataDir?;
    constructor(options?: ProviderSettingsManagerOptions);
    getFilePath(): string;
    read(): StoredProviderSettings;
    write(state: StoredProviderSettings): void;
    saveProviderSettings(settings: unknown, options?: SaveProviderSettingsOptions): StoredProviderSettings;
    getProviderSettings(providerId: string): ProviderSettings | undefined;
    getLastUsedProviderSettings(): ProviderSettings | undefined;
    getProviderConfig(providerId: string, options?: ToProviderConfigOptions): ProviderConfig | undefined;
    getLastUsedProviderConfig(options?: ToProviderConfigOptions): ProviderConfig | undefined;
    refreshCatalog(): Promise<void>;
}
