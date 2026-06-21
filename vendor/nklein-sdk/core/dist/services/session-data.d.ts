import type * as LlmsProviders from "@nklein/llms";
import type { AgentConfig, AgentEvent, AgentResult } from "@nklein/shared";
import { type SessionManifest } from "../session/models/session-manifest";
import type { SessionRow } from "../session/models/session-row";
import type { SessionStatus } from "../types/common";
import type { StoredMessageWithMetadata } from "../types/session";
import type { SessionRecord } from "../types/sessions";
export declare function hasRuntimeHooks(hooks: AgentConfig["hooks"]): boolean;
export declare function mergeAgentExtensions(explicitExtensions: AgentConfig["extensions"] | undefined, loadedExtensions: AgentConfig["extensions"] | undefined): AgentConfig["extensions"];
export declare function serializeAgentEvent(event: AgentEvent): string;
export declare function normalizeStoredMessagesForPersistence(messages: LlmsProviders.MessageWithMetadata[]): StoredMessageWithMetadata[];
export declare function withLatestAssistantTurnMetadata(messages: LlmsProviders.Message[], result: AgentResult, previousMessages?: LlmsProviders.MessageWithMetadata[]): StoredMessageWithMetadata[];
export declare function toSessionRecord(row: SessionRow): SessionRecord;
export declare function normalizeTitle(title?: string | null): string | undefined;
export declare function deriveTitleFromPrompt(prompt?: string | null): string | undefined;
export declare function sanitizeMetadata(metadata: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined;
export declare function resolveMetadataWithTitle(input: {
    metadata?: Record<string, unknown> | null;
    title?: string | null;
    prompt?: string | null;
}): Record<string, unknown> | undefined;
export type MessagesFileContext = {
    agent: "lead" | "subagent" | "teammate";
    sessionId: string;
    taskType?: string;
};
export declare function resolveMessagesFileContext(sessionId: string): MessagesFileContext;
export declare function buildMessagesFilePayload(input: {
    updatedAt: string;
    context: MessagesFileContext;
    messages: LlmsProviders.MessageWithMetadata[];
    systemPrompt?: string;
}): {
    version: 1;
    updated_at: string;
    agent: "lead" | "subagent" | "teammate";
    sessionId: string;
    taskType?: string;
    messages: StoredMessageWithMetadata[];
    system_prompt?: string;
};
export declare function writeEmptyMessagesFile(path: string, startedAt: string, context: MessagesFileContext): void;
export declare function buildManifestFromRow(row: SessionRow, overrides?: {
    status?: SessionStatus;
    endedAt?: string;
    exitCode?: number;
    metadata?: Record<string, unknown>;
}): SessionManifest;
export declare function withOccRetry<TFetch, TResult>(load: () => Promise<TFetch | undefined>, update: (loaded: TFetch) => Promise<TResult>, maxRetries: number): Promise<TResult | {
    updated: false;
}>;
