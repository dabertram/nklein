import type * as LlmsProviders from "@nklein/llms";
import type { SessionAccumulatedUsage } from "../runtime/host/runtime-host";
export declare function createInitialAccumulatedUsage(): SessionAccumulatedUsage;
export declare function accumulateUsageTotals(baseline: SessionAccumulatedUsage, usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalCost?: number;
}): SessionAccumulatedUsage;
export declare function summarizeUsageFromMessages(messages: LlmsProviders.Message[]): SessionAccumulatedUsage;
/**
 * Current model context-window usage, derived from the latest assistant LLM
 * call. Provider usage is normalized so `inputTokens` is already the full
 * prompt size, including any cache-read/cache-write portions. Do not add cache
 * fields back on top.
 */
export declare function getCurrentContextSize(messages: readonly LlmsProviders.Message[]): number | undefined;
