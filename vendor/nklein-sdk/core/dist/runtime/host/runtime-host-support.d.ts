import type * as LlmsProviders from "@nklein/llms";
import type { HookEventPayload } from "../../hooks";
import type { CoreSessionEvent } from "../../types/events";
import type { RuntimeHostSubscribeOptions, SessionAccumulatedUsage } from "./runtime-host";
export declare class RuntimeHostEventBus {
    private readonly listeners;
    subscribe(listener: (event: CoreSessionEvent) => void, options?: RuntimeHostSubscribeOptions): () => void;
    emit(event: CoreSessionEvent): void;
    get size(): number;
}
export declare function readPersistedMessagesFile(messagesPath?: string | null): Promise<LlmsProviders.Message[]>;
export declare function cloneAccumulatedUsage(usage: SessionAccumulatedUsage | undefined): SessionAccumulatedUsage | undefined;
type HookAuditBackend = {
    queueSpawnRequest(payload: HookEventPayload): Promise<void>;
    upsertSubagentSessionFromHook(payload: HookEventPayload): Promise<string | undefined>;
    appendSubagentHookAudit(sessionId: string, payload: HookEventPayload): Promise<void>;
    applySubagentStatus(sessionId: string, payload: HookEventPayload): Promise<void>;
};
export declare function replaySubagentHookEvent(payload: HookEventPayload, backend: HookAuditBackend): Promise<void>;
export {};
