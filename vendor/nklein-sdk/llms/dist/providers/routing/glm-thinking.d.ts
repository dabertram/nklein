import type { GatewayProviderContext, GatewayStreamRequest } from "@nklein/shared";
import type { ProviderOptionsPatch } from "./utils";
/**
 * GLM thinking routing.
 *
 * Native Z.AI uses `thinking: { type: "enabled" | "disabled" }`.
 * Routed OpenAI-compatible GLM endpoints should use the generic `reasoning`
 * control shape. The return value is a normal provider-options patch so the
 * composer can rely on merge order instead of out-of-band flags.
 */
export declare function isGlmModel(request: GatewayStreamRequest, context: GatewayProviderContext): boolean;
export declare function isNativeZaiProvider(providerId: string): boolean;
export declare function shouldSuppressGenericCompatibleThinking(request: GatewayStreamRequest, context: GatewayProviderContext): boolean;
export declare function buildGlmThinkingProviderOptionsPatch(request: GatewayStreamRequest, context: GatewayProviderContext, providerOptionsKey: string): ProviderOptionsPatch | undefined;
//# sourceMappingURL=glm-thinking.d.ts.map