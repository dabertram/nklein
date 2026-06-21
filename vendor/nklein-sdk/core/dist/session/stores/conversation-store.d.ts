/**
 * Per-session conversation transcript store.
 *
 * @see PLAN.md §3.1 — moved from `packages/agents/src/runtime/conversation-store.ts`.
 * @see PLAN.md §3.2.3 — public surface of `ConversationStore`.
 *
 * Pure port of the old agents implementation. Owns the message list,
 * conversation id, and "session started" gate that today's `Agent`
 * class uses to decide when to fire `session_start` hooks.
 */
import type { MessageWithMetadata } from "@nklein/shared";
/** Generate a fresh conversation id. Exported for reuse by `SessionRuntime`. */
export declare function createConversationId(): string;
export declare class ConversationStore {
    private messages;
    private conversationId;
    private sessionStarted;
    constructor(initialMessages?: readonly MessageWithMetadata[]);
    getConversationId(): string;
    getMessages(): MessageWithMetadata[];
    appendMessage(message: MessageWithMetadata): void;
    appendMessages(messages: readonly MessageWithMetadata[]): void;
    replaceMessages(messages: readonly MessageWithMetadata[]): void;
    resetForRun(): void;
    clearHistory(): void;
    restore(messages: readonly MessageWithMetadata[]): void;
    isSessionStarted(): boolean;
    markSessionStarted(): void;
}
