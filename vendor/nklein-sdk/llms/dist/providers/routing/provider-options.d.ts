import type { GatewayProviderContext, GatewayStreamRequest } from "@nklein/shared";
import { type ProviderOptionsPatch } from "./utils";
export type { ProviderOptionsPatch } from "./utils";
/** Merge patches in order. Later patches override earlier ones per bucket key. */
export declare function mergeProviderOptionPatches(patches: ReadonlyArray<ProviderOptionsPatch | undefined>): Record<string, unknown>;
/**
 * Compose AI SDK `providerOptions` from a small set of ordered patches.
 *
 * Precedence (low -> high):
 *  1. base/openai-compatible buckets
 *  2. codex provider-specific override
 *  3. provider-id + alias fanout
 *  4. gemini-specific google bucket
 *  5. DeepSeek thinking type patch
 *  6. Moonshot Kimi disable patch
 *  7. GLM/Z.AI overlay
 */
export declare function composeAiSdkProviderOptions(request: GatewayStreamRequest, context: GatewayProviderContext): Record<string, unknown>;
//# sourceMappingURL=provider-options.d.ts.map