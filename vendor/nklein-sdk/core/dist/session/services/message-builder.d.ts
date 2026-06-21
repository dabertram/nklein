/**
 * API-safe message builder for provider payloads.
 *
 * @see PLAN.md §3.1 — moved from `packages/agents/src/context/message-builder.ts`.
 * @see PLAN.md §3.2.3 — public surface of `MessageBuilder`.
 *
 * Walks the conversation to produce provider-ready messages, handling
 * tool-result truncation and outdated-file-content rewrite for compaction.
 * Per-instance caches make this host state.
 */
import type * as LlmsProviders from "@nklein/llms";
/**
 * Builds an API-safe message copy without mutating original conversation history.
 */
export declare class MessageBuilder {
    private readonly maxToolResultChars;
    private readonly targetToolNames;
    private readonly maxTotalTextBytes;
    private indexedMessageCount;
    private indexedTailRef;
    private readonly toolNameByIdCache;
    private readonly readLocatorsByToolUseIdCache;
    private readonly latestReadToolUseByLocatorCache;
    private readonly latestFullContentOwnerByPathCache;
    private readResultLocatorCache;
    constructor(maxToolResultChars?: number, targetToolNames?: Set<string>, maxTotalTextBytes?: number);
    buildForApi(messages: LlmsProviders.Message[]): LlmsProviders.Message[];
    private transformBlock;
    private reindex;
    private resetIndexes;
    private getReadLocators;
    private extractLocatorsFromReadToolInput;
    private extractReadLocatorsFromToolResultContent;
    private tryParseReadLocators;
    private extractLocatorsFromParsedReadResult;
    private extractLocatorFromReadRequest;
    private extractLocatorFromResultEntry;
    private extractPath;
    private extractLineNumber;
    private parseReadQuery;
    private dedupeReadLocators;
    private toReadLocatorKey;
    private isFullFileRead;
    private isOutdatedReadLocator;
    private replaceOutdatedReadContent;
    private countOutdatedImageEntries;
    private replaceOutdatedInString;
    private replaceOutdatedReadEntry;
    private isReadTool;
    private shouldTruncateTool;
    private truncateToolResultContent;
    private truncateMiddle;
    private truncateToTotalTextBudget;
    private countMessageTextBytes;
    private collectTruncationCandidates;
}
