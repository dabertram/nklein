import type { BasicLogger } from "@nklein/shared";
import type { CoreCompactionContext, CoreCompactionResult } from "../../types/config";
import { type EstimateMessageTokens } from "./compaction-shared";
export declare function runBasicCompaction(options: {
    context: CoreCompactionContext;
    estimateMessageTokens: EstimateMessageTokens;
    logger?: BasicLogger;
}): CoreCompactionResult | undefined;
