import { ProviderSettingsManager } from "../storage/provider-settings-manager";
export interface NKleinRecommendedModel {
    id: string;
    name: string;
    description: string;
    tags: string[];
}
export interface NKleinRecommendedModelsData {
    recommended: NKleinRecommendedModel[];
    free: NKleinRecommendedModel[];
}
export interface FetchNKleinRecommendedModelsOptions {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    providerSettingsManager?: Pick<ProviderSettingsManager, "getProviderSettings">;
    timeoutMs?: number;
}
export declare const FALLBACK_NKLEIN_RECOMMENDED_MODELS: NKleinRecommendedModelsData;
export declare function fetchNKleinRecommendedModels(options?: FetchNKleinRecommendedModelsOptions): Promise<NKleinRecommendedModelsData>;
