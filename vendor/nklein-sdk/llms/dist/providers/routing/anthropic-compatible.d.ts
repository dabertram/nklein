import type { GatewayPromptCacheStrategy, GatewayProviderContext, GatewayProviderManifest, GatewayStreamRequest } from "@nklein/shared";
export type AnthropicReasoningRequestPolicy = {
    kind: "none";
} | {
    kind: "anthropic-manual";
} | {
    kind: "anthropic-adaptive";
};
/**
 * Anthropic-compatible routing precedence:
 * 1) `context.model.metadata.family` (contains "claude")
 * 2) `request.modelId` fallback heuristics
 *
 * Prompt-cache shaping is stricter: it only applies when the resolved model is
 * Anthropic-compatible AND provider metadata opts into
 * `promptCacheStrategy = "anthropic-automatic"`.
 */
export declare function resolveModelFamily(context: GatewayProviderContext): string | undefined;
export declare function isAnthropicCompatibleModel(options: {
    modelId?: string;
    family?: string;
}): boolean;
export declare function isAnthropicCompatibleModelId(modelId: string | undefined): boolean;
export declare function createPromptCacheProviderOptions(providerId: string, includeAnthropic: boolean): Record<string, unknown>;
export declare function applyPromptCacheToLastTextPart(message: Record<string, unknown> | undefined, providerId: string, includeAnthropic: boolean): void;
export declare function shouldUseAnthropicPromptCache(request: GatewayStreamRequest, context: GatewayProviderContext): boolean;
export declare function shouldEmitAnthropicReasoning(context: GatewayProviderContext): boolean;
export declare function resolveAnthropicReasoningRequestPolicy(request: GatewayStreamRequest, context: GatewayProviderContext): AnthropicReasoningRequestPolicy;
export declare function resolvePromptCacheStrategy(provider: GatewayProviderManifest): GatewayPromptCacheStrategy | undefined;
export declare function buildAnthropicProviderOptions(request: GatewayStreamRequest, context: GatewayProviderContext): {
    cache_control?: {
        type: "ephemeral";
    } | undefined;
    thinking?: Record<string, unknown> | undefined;
    effort?: "low" | "high" | "medium" | undefined;
};
export declare function resolveAnthropicCompatibleReasoningBudget(options: {
    modelId?: string;
    family?: string;
    effort?: string;
    maxTokens?: number;
    explicitBudgetTokens?: number;
}): number | undefined;
export declare function buildAnthropicCompatibleReasoningOptions(request: GatewayStreamRequest, context: GatewayProviderContext): Record<string, unknown> | undefined;
export declare function buildGatewayReasoningOptions(request: GatewayStreamRequest, context: GatewayProviderContext): Record<string, unknown> | undefined;
//# sourceMappingURL=anthropic-compatible.d.ts.map