import type { BasicLogger } from "@nklein/shared";
import type { CoreCompactionContext, CoreCompactionResult, CoreCompactionSummarizerConfig } from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
import { type EstimateMessageTokens } from "./compaction-shared";
export declare function runAgenticCompaction(options: {
    context: CoreCompactionContext;
    providerConfig: ProviderConfig;
    summarizer?: CoreCompactionSummarizerConfig;
    preserveRecentTokens: number;
    estimateMessageTokens: EstimateMessageTokens;
    logger?: BasicLogger;
}): Promise<CoreCompactionResult | undefined>;
