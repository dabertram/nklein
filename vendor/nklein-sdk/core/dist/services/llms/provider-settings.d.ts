import * as Llms from "@nklein/llms";
import { z } from "zod";
import { type ProviderDefaults } from "./provider-defaults";
export type ModelInfo = Llms.ModelInfo;
export type ProviderClient = Llms.ProviderClient;
export type ProviderProtocol = Llms.ProviderProtocol;
export type ProviderId = Llms.ProviderId;
export type ProviderCapability = Llms.ProviderCapability;
export type ProviderConfig = Llms.ProviderConfig;
export type BuiltInProviderId = Llms.BuiltInProviderId;
export declare const BUILT_IN_PROVIDER: typeof Llms.BUILT_IN_PROVIDER;
export declare const BUILT_IN_PROVIDER_IDS: [Llms.BUILT_IN_PROVIDER, ...Llms.BUILT_IN_PROVIDER[]];
export declare const isBuiltInProviderId: typeof Llms.isBuiltInProviderId;
export declare const normalizeProviderId: typeof Llms.normalizeProviderId;
export type ProviderDefaultsConfig = ProviderDefaults;
export declare const ProviderIdSchema: z.ZodString;
export declare const ProviderProtocolSchema: z.ZodEnum<{
    "openai-responses": "openai-responses";
    anthropic: "anthropic";
    gemini: "gemini";
    "openai-chat": "openai-chat";
    "openai-r1": "openai-r1";
    "ai-sdk": "ai-sdk";
}>;
export declare const ProviderClientSchema: z.ZodEnum<{
    custom: "custom";
    anthropic: "anthropic";
    gemini: "gemini";
    "openai-r1": "openai-r1";
    "ai-sdk": "ai-sdk";
    "ai-sdk-community": "ai-sdk-community";
    openai: "openai";
    "openai-compatible": "openai-compatible";
    bedrock: "bedrock";
    fetch: "fetch";
    vertex: "vertex";
}>;
export declare const AuthSettingsSchema: z.ZodObject<{
    apiKey: z.ZodOptional<z.ZodString>;
    accessToken: z.ZodOptional<z.ZodString>;
    refreshToken: z.ZodOptional<z.ZodString>;
    expiresAt: z.ZodOptional<z.ZodNumber>;
    accountId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AuthSettings = z.infer<typeof AuthSettingsSchema>;
export declare const ReasoningSettingsSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    effort: z.ZodOptional<z.ZodEnum<{
        low: "low";
        high: "high";
        medium: "medium";
        xhigh: "xhigh";
        none: "none";
    }>>;
    budgetTokens: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type ReasoningSettings = z.infer<typeof ReasoningSettingsSchema>;
export declare const AwsSettingsSchema: z.ZodObject<{
    accessKey: z.ZodOptional<z.ZodString>;
    secretKey: z.ZodOptional<z.ZodString>;
    sessionToken: z.ZodOptional<z.ZodString>;
    region: z.ZodOptional<z.ZodString>;
    profile: z.ZodOptional<z.ZodString>;
    authentication: z.ZodOptional<z.ZodEnum<{
        iam: "iam";
        "api-key": "api-key";
        profile: "profile";
    }>>;
    usePromptCache: z.ZodOptional<z.ZodBoolean>;
    useCrossRegionInference: z.ZodOptional<z.ZodBoolean>;
    useGlobalInference: z.ZodOptional<z.ZodBoolean>;
    endpoint: z.ZodOptional<z.ZodString>;
    customModelBaseId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AwsSettings = z.infer<typeof AwsSettingsSchema>;
export declare const GcpSettingsSchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    region: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type GcpSettings = z.infer<typeof GcpSettingsSchema>;
export declare const AzureSettingsSchema: z.ZodObject<{
    apiVersion: z.ZodOptional<z.ZodString>;
    useIdentity: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type AzureSettings = z.infer<typeof AzureSettingsSchema>;
export declare const SapSettingsSchema: z.ZodObject<{
    clientId: z.ZodOptional<z.ZodString>;
    clientSecret: z.ZodOptional<z.ZodString>;
    tokenUrl: z.ZodOptional<z.ZodString>;
    resourceGroup: z.ZodOptional<z.ZodString>;
    deploymentId: z.ZodOptional<z.ZodString>;
    useOrchestrationMode: z.ZodOptional<z.ZodBoolean>;
    api: z.ZodOptional<z.ZodEnum<{
        orchestration: "orchestration";
        "foundation-models": "foundation-models";
    }>>;
    defaultSettings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type SapSettings = z.infer<typeof SapSettingsSchema>;
export declare const OcaSettingsSchema: z.ZodObject<{
    mode: z.ZodOptional<z.ZodEnum<{
        external: "external";
        internal: "internal";
    }>>;
    usePromptCache: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type OcaSettings = z.infer<typeof OcaSettingsSchema>;
export declare const ModelCatalogSettingsSchema: z.ZodObject<{
    loadLatestOnInit: z.ZodOptional<z.ZodBoolean>;
    loadPrivateOnAuth: z.ZodOptional<z.ZodBoolean>;
    url: z.ZodOptional<z.ZodString>;
    cacheTtlMs: z.ZodOptional<z.ZodNumber>;
    failOnError: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type ModelCatalogSettings = z.infer<typeof ModelCatalogSettingsSchema>;
export type ModelCatalogConfig = ModelCatalogSettings;
export declare const ProviderSettingsSchema: z.ZodObject<{
    provider: z.ZodString;
    apiKey: z.ZodOptional<z.ZodString>;
    auth: z.ZodOptional<z.ZodObject<{
        apiKey: z.ZodOptional<z.ZodString>;
        accessToken: z.ZodOptional<z.ZodString>;
        refreshToken: z.ZodOptional<z.ZodString>;
        expiresAt: z.ZodOptional<z.ZodNumber>;
        accountId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    model: z.ZodOptional<z.ZodString>;
    protocol: z.ZodOptional<z.ZodEnum<{
        "openai-responses": "openai-responses";
        anthropic: "anthropic";
        gemini: "gemini";
        "openai-chat": "openai-chat";
        "openai-r1": "openai-r1";
        "ai-sdk": "ai-sdk";
    }>>;
    client: z.ZodOptional<z.ZodEnum<{
        custom: "custom";
        anthropic: "anthropic";
        gemini: "gemini";
        "openai-r1": "openai-r1";
        "ai-sdk": "ai-sdk";
        "ai-sdk-community": "ai-sdk-community";
        openai: "openai";
        "openai-compatible": "openai-compatible";
        bedrock: "bedrock";
        fetch: "fetch";
        vertex: "vertex";
    }>>;
    routingProviderId: z.ZodOptional<z.ZodString>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    contextWindow: z.ZodOptional<z.ZodNumber>;
    baseUrl: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    timeout: z.ZodOptional<z.ZodNumber>;
    reasoning: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        effort: z.ZodOptional<z.ZodEnum<{
            low: "low";
            high: "high";
            medium: "medium";
            xhigh: "xhigh";
            none: "none";
        }>>;
        budgetTokens: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
    aws: z.ZodOptional<z.ZodObject<{
        accessKey: z.ZodOptional<z.ZodString>;
        secretKey: z.ZodOptional<z.ZodString>;
        sessionToken: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodString>;
        profile: z.ZodOptional<z.ZodString>;
        authentication: z.ZodOptional<z.ZodEnum<{
            iam: "iam";
            "api-key": "api-key";
            profile: "profile";
        }>>;
        usePromptCache: z.ZodOptional<z.ZodBoolean>;
        useCrossRegionInference: z.ZodOptional<z.ZodBoolean>;
        useGlobalInference: z.ZodOptional<z.ZodBoolean>;
        endpoint: z.ZodOptional<z.ZodString>;
        customModelBaseId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    gcp: z.ZodOptional<z.ZodObject<{
        projectId: z.ZodOptional<z.ZodString>;
        region: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    azure: z.ZodOptional<z.ZodObject<{
        apiVersion: z.ZodOptional<z.ZodString>;
        useIdentity: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    sap: z.ZodOptional<z.ZodObject<{
        clientId: z.ZodOptional<z.ZodString>;
        clientSecret: z.ZodOptional<z.ZodString>;
        tokenUrl: z.ZodOptional<z.ZodString>;
        resourceGroup: z.ZodOptional<z.ZodString>;
        deploymentId: z.ZodOptional<z.ZodString>;
        useOrchestrationMode: z.ZodOptional<z.ZodBoolean>;
        api: z.ZodOptional<z.ZodEnum<{
            orchestration: "orchestration";
            "foundation-models": "foundation-models";
        }>>;
        defaultSettings: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    oca: z.ZodOptional<z.ZodObject<{
        mode: z.ZodOptional<z.ZodEnum<{
            external: "external";
            internal: "internal";
        }>>;
        usePromptCache: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    region: z.ZodOptional<z.ZodString>;
    apiLine: z.ZodOptional<z.ZodEnum<{
        china: "china";
        international: "international";
    }>>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        tools: "tools";
        streaming: "streaming";
        "prompt-cache": "prompt-cache";
        reasoning: "reasoning";
        "computer-use": "computer-use";
        oauth: "oauth";
        vision: "vision";
    }>>>;
    modelCatalog: z.ZodOptional<z.ZodObject<{
        loadLatestOnInit: z.ZodOptional<z.ZodBoolean>;
        loadPrivateOnAuth: z.ZodOptional<z.ZodBoolean>;
        url: z.ZodOptional<z.ZodString>;
        cacheTtlMs: z.ZodOptional<z.ZodNumber>;
        failOnError: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;
export interface ToProviderConfigOptions {
    includeKnownModels?: boolean;
}
export declare function parseSettings(input: unknown): ProviderSettings;
export declare function safeParseSettings(input: unknown): ReturnType<typeof ProviderSettingsSchema.safeParse>;
export declare function toProviderConfig(settings: ProviderSettings, options?: ToProviderConfigOptions): ProviderConfig;
export declare function createProviderConfig(input: unknown): ProviderConfig;
export declare function safeCreateProviderConfig(input: unknown): {
    success: true;
    config: ProviderConfig;
} | {
    success: false;
    error: z.ZodError;
};
