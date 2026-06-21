import type * as LlmsProviders from "@nklein/llms";
import type { AgentResult } from "@nklein/shared";
import type { SubAgentEndContext, SubAgentStartContext } from "../../extensions/tools/team";
import type { HookEventPayload } from "../../hooks";
import type { SessionStatus } from "../../types/common";
import type { PersistedSessionUpdateInput, SessionMessagesArtifactUploader, SessionPersistenceAdapter } from "../../types/session";
import type { SessionRow } from "../models/session-row";
export type { PersistedSessionUpdateInput, SessionPersistenceAdapter };
export declare class UnifiedSessionPersistenceService {
    private readonly adapter;
    private readonly manifestStore;
    private readonly teamChildren;
    private static readonly STALE_REASON;
    private static readonly STALE_SOURCE;
    private static readonly TEAM_HEARTBEAT_LOG_INTERVAL_MS;
    constructor(adapter: SessionPersistenceAdapter, options?: {
        messagesArtifactUploader?: SessionMessagesArtifactUploader;
    });
    private toPersistedMessages;
    ensureSessionsDir(): string;
    writeSessionManifest(manifestPath: string, manifest: import("../models/session-manifest").SessionManifest): void;
    readSessionManifest(sessionId: string): import("../models/session-manifest").SessionManifest | undefined;
    createRootSessionWithArtifacts(input: import("../models/session-row").CreateRootSessionWithArtifactsInput): Promise<import("../models/session-row").RootSessionArtifacts>;
    updateSessionStatus(sessionId: string, status: SessionStatus, exitCode?: number | null): Promise<{
        updated: boolean;
        endedAt?: string;
    }>;
    updateSession(input: {
        sessionId: string;
        prompt?: string | null;
        metadata?: Record<string, unknown> | null;
        title?: string | null;
    }): Promise<{
        updated: boolean;
    }>;
    queueSpawnRequest(event: HookEventPayload): Promise<void>;
    upsertSubagentSession(input: import("../models/session-row").UpsertSubagentInput): Promise<string | undefined>;
    upsertSubagentSessionFromHook(event: HookEventPayload): Promise<string | undefined>;
    appendSubagentHookAudit(_subSessionId: string, event: HookEventPayload): Promise<void>;
    persistSessionMessages(sessionId: string, messages: LlmsProviders.Message[], systemPrompt?: string): Promise<void>;
    applySubagentStatus(subSessionId: string, event: HookEventPayload): Promise<void>;
    applySubagentStatusBySessionId(subSessionId: string, status: SessionStatus): Promise<void>;
    applyStatusToRunningChildSessions(parentSessionId: string, status: Exclude<SessionStatus, "running">): Promise<void>;
    onTeamTaskStart(rootSessionId: string, agentId: string, message: string): Promise<void>;
    onTeamTaskEnd(rootSessionId: string, agentId: string, status: SessionStatus, summary?: string, result?: AgentResult, messages?: LlmsProviders.Message[]): Promise<void>;
    onTeamTaskProgress(rootSessionId: string, agentId: string, progress: string, options?: {
        kind?: "heartbeat" | "progress" | "text";
    }): Promise<void>;
    handleSubAgentStart(rootSessionId: string, context: SubAgentStartContext): Promise<void>;
    handleSubAgentEnd(rootSessionId: string, context: SubAgentEndContext): Promise<void>;
    private isPidAlive;
    private reconcileDeadRunningSession;
    listSessions(limit?: number): Promise<SessionRow[]>;
    reconcileDeadSessions(limit?: number): Promise<number>;
    deleteSession(sessionId: string): Promise<{
        deleted: boolean;
    }>;
}
