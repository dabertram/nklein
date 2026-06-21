import type * as LlmsProviders from "@nklein/llms";
import type { AgentResult } from "@nklein/shared";
import type { SubAgentEndContext, SubAgentStartContext } from "../../extensions/tools/team";
import type { HookEventPayload } from "../../hooks";
import type { SessionStatus } from "../../types/common";
import type { SessionPersistenceAdapter, StoredMessageWithMetadata } from "../../types/session";
import type { UpsertSubagentInput } from "../models/session-row";
import type { SessionManifestStore } from "../stores/session-manifest-store";
export declare class TeamChildSessionManager {
    private readonly adapter;
    private readonly manifestStore;
    private readonly toPersistedMessages;
    private readonly heartbeatLogIntervalMs;
    private readonly teamTaskSessionsByAgent;
    private readonly teamTaskLastHeartbeatBySession;
    private readonly teamTaskLastProgressLineBySession;
    constructor(adapter: SessionPersistenceAdapter, manifestStore: SessionManifestStore, toPersistedMessages: (messages: LlmsProviders.Message[] | undefined, result?: AgentResult, previousMessages?: LlmsProviders.Message[]) => StoredMessageWithMetadata[] | undefined, heartbeatLogIntervalMs: number);
    private teamTaskQueueKey;
    private activeTeamTaskSessionId;
    private buildSubsessionRow;
    queueSpawnRequest(event: HookEventPayload): Promise<void>;
    upsertSubagentSession(input: UpsertSubagentInput): Promise<string | undefined>;
    upsertSubagentSessionFromHook(event: HookEventPayload): Promise<string | undefined>;
    applySubagentStatus(subSessionId: string, event: HookEventPayload): Promise<void>;
    applySubagentStatusBySessionId(subSessionId: string, status: SessionStatus): Promise<void>;
    applyStatusToRunningChildSessions(parentSessionId: string, status: Exclude<SessionStatus, "running">): Promise<void>;
    onTeamTaskStart(rootSessionId: string, agentId: string, message: string): Promise<void>;
    onTeamTaskEnd(rootSessionId: string, agentId: string, status: SessionStatus, _summary?: string, result?: AgentResult, messages?: LlmsProviders.Message[]): Promise<void>;
    onTeamTaskProgress(rootSessionId: string, agentId: string, progress: string, options?: {
        kind?: "heartbeat" | "progress" | "text";
    }): Promise<void>;
    handleSubAgentStart(rootSessionId: string, context: SubAgentStartContext): Promise<void>;
    handleSubAgentEnd(rootSessionId: string, context: SubAgentEndContext): Promise<void>;
    appendSubagentHookAudit(event: HookEventPayload): void;
}
