import type { ApiHandler } from "@nklein/llms";
import type { BuiltInProviderSummary, CreateHandlerInput, LlmsConfig, LlmsSdk, RegisterBuiltinProviderInput, RegisteredProviderSummary, RegisterModelInput, RegisterProviderInput } from "./runtime-types";
export declare class DefaultLlmsSdk implements LlmsSdk {
    private readonly configuredProviders;
    constructor(config: LlmsConfig);
    createHandler(input: CreateHandlerInput): ApiHandler;
    createHandlerAsync(input: CreateHandlerInput): Promise<ApiHandler>;
    registerProvider(input: RegisterProviderInput): void;
    registerBuiltinProvider(input: RegisterBuiltinProviderInput): void;
    registerModel(input: RegisterModelInput): void;
    getProviders(): RegisteredProviderSummary[];
    getBuiltInProviderIds(): import("@nklein/llms").BUILT_IN_PROVIDER[];
    getBuiltInProviders(): Promise<BuiltInProviderSummary[]>;
    getModels(providerId: string): string[];
    isProviderConfigured(providerId: string): boolean;
    isModelConfigured(providerId: string, modelId: string): boolean;
    private applyConfig;
}
export declare function createLlmsSdk(config: LlmsConfig): LlmsSdk;
