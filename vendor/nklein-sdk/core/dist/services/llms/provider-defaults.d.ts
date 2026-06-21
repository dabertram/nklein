/** biome-ignore-all lint/style/noNonNullAssertion: static */
import * as Llms from "@nklein/llms";
import type { ModelCatalogConfig, ModelInfo, ProviderCapability, ProviderConfig } from "./provider-settings";
export interface BuiltInProviderManifest {
    id: string;
    baseUrl: string;
    modelsSourceUrl?: string;
    modelId: string;
    knownModels?: Record<string, ModelInfo>;
    capabilities?: Llms.CatalogProviderCapability[];
    env?: readonly string[];
    client: Llms.ProviderClient;
    protocol?: Llms.ProviderProtocol;
}
export interface ProviderDefaults {
    baseUrl: string;
    modelId: string;
    knownModels?: Record<string, ModelInfo>;
    capabilities?: ProviderCapability[];
}
export declare const DEFAULT_MODELS_CATALOG_URL = "https://models.dev/api.json";
export declare function clearPublicModelsCatalogCache(): void;
export declare function getLiveModelsCatalog(options?: Pick<ModelCatalogConfig, "url" | "cacheTtlMs">): Promise<Record<string, Record<string, ModelInfo>>>;
export declare function clearLiveModelsCatalogCache(url?: string): void;
export declare function clearPrivateModelsCatalogCache(): void;
export declare const OPENAI_COMPATIBLE_PROVIDERS: Record<string, ProviderDefaults>;
export declare function getProviderConfig(providerId: string): ProviderDefaults | undefined;
export declare function resolveProviderConfig(providerId: string, modelCatalog?: ModelCatalogConfig, config?: ProviderConfig): Promise<ProviderDefaults | undefined>;
