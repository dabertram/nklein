import { type ProviderModel } from "@nklein/shared";
import { z } from "zod";
import type { ProviderSettings, StoredProviderSettings } from "../../types/provider-settings";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
export declare const StoredModelEntrySchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        images: "images";
        tools: "tools";
        streaming: "streaming";
        "prompt-cache": "prompt-cache";
        reasoning: "reasoning";
        "reasoning-effort": "reasoning-effort";
        "computer-use": "computer-use";
        "global-endpoint": "global-endpoint";
        structured_output: "structured_output";
        temperature: "temperature";
        files: "files";
    }>>>;
    supportsVision: z.ZodOptional<z.ZodBoolean>;
    supportsAttachments: z.ZodOptional<z.ZodBoolean>;
    supportsReasoning: z.ZodOptional<z.ZodBoolean>;
}, z.core.$loose>;
export type StoredModelEntry = z.infer<typeof StoredModelEntrySchema>;
export declare const StoredProviderMetadataSchema: z.ZodObject<{
    name: z.ZodString;
    baseUrl: z.ZodString;
    defaultModelId: z.ZodOptional<z.ZodString>;
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
    capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        tools: "tools";
        streaming: "streaming";
        "prompt-cache": "prompt-cache";
        reasoning: "reasoning";
        "computer-use": "computer-use";
        temperature: "temperature";
        files: "files";
        "provider-tools": "provider-tools";
        oauth: "oauth";
        vision: "vision";
        "local-auth": "local-auth";
    }>>>;
    modelsSourceUrl: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
export declare const StoredProviderEntrySchema: z.ZodObject<{
    provider: z.ZodOptional<z.ZodObject<{
        name: z.ZodString;
        baseUrl: z.ZodString;
        defaultModelId: z.ZodOptional<z.ZodString>;
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
        capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            tools: "tools";
            streaming: "streaming";
            "prompt-cache": "prompt-cache";
            reasoning: "reasoning";
            "computer-use": "computer-use";
            temperature: "temperature";
            files: "files";
            "provider-tools": "provider-tools";
            oauth: "oauth";
            vision: "vision";
            "local-auth": "local-auth";
        }>>>;
        modelsSourceUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
    models: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            images: "images";
            tools: "tools";
            streaming: "streaming";
            "prompt-cache": "prompt-cache";
            reasoning: "reasoning";
            "reasoning-effort": "reasoning-effort";
            "computer-use": "computer-use";
            "global-endpoint": "global-endpoint";
            structured_output: "structured_output";
            temperature: "temperature";
            files: "files";
        }>>>;
        supportsVision: z.ZodOptional<z.ZodBoolean>;
        supportsAttachments: z.ZodOptional<z.ZodBoolean>;
        supportsReasoning: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$loose>>>;
}, z.core.$loose>;
export type StoredProviderEntry = z.infer<typeof StoredProviderEntrySchema>;
export declare const StoredModelsFileSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    providers: z.ZodRecord<z.ZodString, z.ZodObject<{
        provider: z.ZodOptional<z.ZodObject<{
            name: z.ZodString;
            baseUrl: z.ZodString;
            defaultModelId: z.ZodOptional<z.ZodString>;
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
            capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                tools: "tools";
                streaming: "streaming";
                "prompt-cache": "prompt-cache";
                reasoning: "reasoning";
                "computer-use": "computer-use";
                temperature: "temperature";
                files: "files";
                "provider-tools": "provider-tools";
                oauth: "oauth";
                vision: "vision";
                "local-auth": "local-auth";
            }>>>;
            modelsSourceUrl: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
        models: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
            id: z.ZodOptional<z.ZodString>;
            name: z.ZodOptional<z.ZodString>;
            capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                images: "images";
                tools: "tools";
                streaming: "streaming";
                "prompt-cache": "prompt-cache";
                reasoning: "reasoning";
                "reasoning-effort": "reasoning-effort";
                "computer-use": "computer-use";
                "global-endpoint": "global-endpoint";
                structured_output: "structured_output";
                temperature: "temperature";
                files: "files";
            }>>>;
            supportsVision: z.ZodOptional<z.ZodBoolean>;
            supportsAttachments: z.ZodOptional<z.ZodBoolean>;
            supportsReasoning: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$loose>>>;
    }, z.core.$loose>>;
}, z.core.$strip>;
export type StoredModelsFile = z.infer<typeof StoredModelsFileSchema>;
export declare function resolveModelsRegistryPath(manager: ProviderSettingsManager): string;
export declare function emptyModelsFile(): StoredModelsFile;
export declare function parseModelsFile(input: unknown): StoredModelsFile;
export declare function readModelsFileSync(filePath: string): StoredModelsFile;
export declare function readModelsFile(filePath: string): Promise<StoredModelsFile>;
export declare function writeModelsFileSync(filePath: string, state: StoredModelsFile): void;
export declare function writeModelsFile(filePath: string, state: StoredModelsFile): Promise<void>;
export declare function toProviderModel(modelId: string, info: {
    name?: string;
    capabilities?: string[];
    thinkingConfig?: unknown;
}): ProviderModel;
export declare function registerProviderSettingsProvider(settings: ProviderSettings): void;
export declare function registerConfiguredProvidersFromSettings(state: StoredProviderSettings): void;
/**
 * Custom Provider Registry
 *
 * This module manages the registration of custom OpenAI-compatible providers and
 * their models based on local JSON files. It provides functions to read/write the models
 * registry file and to register providers with the LlmsModels system.
 */
export declare function registerCustomProvider(providerId: string, entry: StoredProviderEntry): void;
export declare function ensureCustomProvidersLoadedSync(manager: ProviderSettingsManager): void;
export declare function ensureCustomProvidersLoaded(manager: ProviderSettingsManager): Promise<void>;
