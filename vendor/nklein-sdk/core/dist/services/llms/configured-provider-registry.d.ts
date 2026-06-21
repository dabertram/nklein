import type { ProviderConfig } from "./provider-settings";
import type { BuiltInProviderSummary, CreateHandlerInput, ProviderConfigDefaults, ProviderSelectionConfig, RegisteredProviderSummary } from "./runtime-types";
interface RegisterConfiguredProviderInput {
    id: string;
    models: readonly string[];
    defaultModel?: string;
    defaults?: ProviderConfigDefaults;
}
export declare function toBuiltInProviderSummary(input: {
    collection: BuiltInProviderSummary["id"] extends string ? {
        provider: Pick<import("@nklein/llms").ProviderInfo, "id" | "name" | "description" | "protocol" | "baseUrl" | "capabilities" | "env" | "defaultModelId">;
        models: Record<string, unknown>;
    } : never;
}): BuiltInProviderSummary;
export declare class ConfiguredProviderRegistry {
    private readonly providers;
    register(input: RegisterConfiguredProviderInput): void;
    registerSelectionConfig(provider: ProviderSelectionConfig): void;
    registerModel(providerId: string, modelId: string): void;
    createHandlerConfig(input: CreateHandlerInput): ProviderConfig;
    list(): RegisteredProviderSummary[];
    getModels(providerId: string): string[];
    hasProvider(providerId: string): boolean;
    hasModel(providerId: string, modelId: string): boolean;
    private require;
}
export {};
