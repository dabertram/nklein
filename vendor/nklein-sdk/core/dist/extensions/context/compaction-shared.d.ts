import type { ToolResultContent } from "@nklein/llms";
import type { MessageWithMetadata } from "@nklein/shared";
import type { CoreCompactionContext, CoreCompactionSummarizerConfig } from "../../types/config";
import type { ProviderConfig } from "../../types/provider-settings";
export declare const DEFAULT_CONTEXT_WINDOW_TOKENS = 200000;
export declare const DEFAULT_THRESHOLD_RATIO = 0.95;
export declare const DEFAULT_RESERVE_TOKENS = 16384;
export declare const DEFAULT_PRESERVE_RECENT_TOKENS = 20000;
export declare const DEFAULT_SUMMARY_MAX_OUTPUT_TOKENS = 1024;
export declare const TOOL_RESULT_CHAR_LIMIT = 2000;
export declare const FILE_CONTENT_CHAR_LIMIT = 2000;
export declare const MIN_TRUNCATED_MESSAGE_TOKENS = 8;
export interface FileOperationSummary {
    readFiles: string[];
    modifiedFiles: string[];
}
export interface CompactionSummaryMetadata {
    kind: "compaction_summary";
    summary: string;
    details: FileOperationSummary;
    tokensBefore: number;
    generatedAt: number;
}
export type EstimateMessageTokens = (message: MessageWithMetadata) => number;
export declare function estimateTokens(text: string): number;
export declare function truncateText(text: string, limit: number): string;
export declare function flattenToolResultContent(content: ToolResultContent["content"]): string;
export declare function formatToolInput(input: Record<string, unknown>): string;
export declare function serializeMessage(message: MessageWithMetadata): string;
export declare function serializeConversation(messages: MessageWithMetadata[]): string;
export declare function createTokenEstimator(): EstimateMessageTokens;
export declare function isCompactionSummaryMessage(message: MessageWithMetadata): boolean;
export declare function getCompactionSummaryMetadata(message: MessageWithMetadata): CompactionSummaryMetadata | undefined;
export declare function isToolResultOnlyUserMessage(message: MessageWithMetadata): boolean;
export declare function isTurnStartMessage(message: MessageWithMetadata): boolean;
export declare function findFirstUserMessageIndex(messages: MessageWithMetadata[]): number;
export declare function findLastTurnStartIndex(messages: MessageWithMetadata[]): number;
export declare function findLastAssistantIndex(messages: MessageWithMetadata[]): number;
export declare function findLatestSummaryIndex(messages: MessageWithMetadata[]): number;
export declare function findCutIndex(messages: MessageWithMetadata[], preserveRecentTokens: number, estimateMessageTokens: EstimateMessageTokens): number;
export declare function collectPaths(value: unknown): string[];
export declare function mergeUnique(base: string[], next: Iterable<string>): string[];
export declare function extractFileOps(messages: MessageWithMetadata[]): FileOperationSummary;
export declare function renderFilesSection(fileOps: FileOperationSummary): string;
export declare function ensureFilesSection(summary: string, fileOps: FileOperationSummary): string;
export declare function buildSummaryRequest(options: {
    previousSummary?: string;
    conversationText: string;
    fileOps: FileOperationSummary;
}): string;
export declare function resolveSummarizerConfig(options: {
    activeProviderConfig: ProviderConfig;
    summarizer?: CoreCompactionSummarizerConfig;
}): ProviderConfig;
export declare function buildSummaryMessage(options: {
    summary: string;
    fileOps: FileOperationSummary;
    tokensBefore: number;
}): MessageWithMetadata;
export declare function getContextWindowTokens(context: Pick<CoreCompactionContext, "contextWindowTokens">): number;
