import type * as LlmsProviders from "@nklein/llms";
import type { ChatRunTurnRequest, ChatStartSessionRequest, ChatStartSessionResponse, ChatTurnResult, TeamProgressProjectionEvent } from "@nklein/shared";
import type { CheckpointEntry } from "../../hooks/checkpoint-hooks";
type ScheduleClientRecord = Record<string, unknown> & {
    metadata?: Record<string, unknown>;
};
export interface HubSessionClientOptions {
    address: string;
    authToken?: string;
    clientId?: string;
    clientType?: string;
    displayName?: string;
    workspaceRoot?: string;
    cwd?: string;
    metadata?: Record<string, unknown>;
}
export interface HubSessionRow {
    sessionId: string;
    parentSessionId?: string;
    metadata?: Record<string, unknown>;
    messagesPath?: string;
}
export interface HubStreamEvent {
    sessionId: string;
    eventType: string;
    payload: Record<string, unknown>;
}
export interface HubRestoreRequest {
    sessionId: string;
    checkpointRunCount: number;
    config?: ChatStartSessionRequest;
    restore?: {
        messages?: boolean;
        workspace?: boolean;
        omitCheckpointMessageFromSession?: boolean;
    };
}
export interface HubRestoreResponse {
    sessionId?: string;
    startResult?: {
        sessionId: string;
        manifestPath: string;
        messagesPath: string;
    };
    messages?: LlmsProviders.Message[];
    checkpoint: CheckpointEntry;
}
export interface HubEventStreamHandlers {
    onEvent?: (event: HubStreamEvent) => void;
    onError?: (error: Error) => void;
}
export interface HubTeamProgressHandlers {
    onProjection?: (event: TeamProgressProjectionEvent) => void;
    onError?: (error: Error) => void;
}
export declare class HubSessionClient {
    private readonly options;
    private readonly client;
    private metadataApplied;
    constructor(options: HubSessionClientOptions);
    private ensureMetadataApplied;
    connect(): Promise<void>;
    close(): void;
    dispose(): Promise<void>;
    startRuntimeSession(request: ChatStartSessionRequest): Promise<ChatStartSessionResponse>;
    sendRuntimeSession(sessionId: string, request: ChatRunTurnRequest, options?: {
        timeoutMs?: number | null;
    }): Promise<{
        result?: ChatTurnResult;
    }>;
    stopRuntimeSession(sessionId: string): Promise<{
        applied: boolean;
    }>;
    abortRuntimeSession(sessionId: string): Promise<{
        applied: boolean;
    }>;
    updateSession(input: {
        sessionId: string;
        metadata?: Record<string, unknown>;
    }): Promise<{
        updated: boolean;
    }>;
    getSession(sessionId: string): Promise<HubSessionRow | undefined>;
    readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
    restore(input: HubRestoreRequest): Promise<HubRestoreResponse>;
    listSessions(input?: {
        limit?: number;
    }): Promise<HubSessionRow[]>;
    deleteSession(sessionId: string, deleteCheckpointRefs?: boolean): Promise<boolean>;
    respondToolApproval(input: {
        approvalId: string;
        approved: boolean;
        reason?: string;
        responderClientId?: string;
    }): Promise<void>;
    streamEvents(input: {
        clientId?: string;
        sessionIds?: string[];
    }, handlers: HubEventStreamHandlers): () => void;
    streamTeamProgress(_input: {
        clientId?: string;
    }, handlers: HubTeamProgressHandlers): () => void;
    createSchedule(input: Record<string, unknown>): Promise<ScheduleClientRecord | undefined>;
    listSchedules(_input?: {
        limit?: number;
    }): Promise<ScheduleClientRecord[]>;
    getSchedule(scheduleId: string): Promise<ScheduleClientRecord | undefined>;
    updateSchedule(scheduleId: string, input: Record<string, unknown>): Promise<ScheduleClientRecord | undefined>;
    pauseSchedule(scheduleId: string): Promise<ScheduleClientRecord | undefined>;
    resumeSchedule(scheduleId: string): Promise<ScheduleClientRecord | undefined>;
    deleteSchedule(scheduleId: string): Promise<boolean>;
    triggerScheduleNow(scheduleId: string): Promise<Record<string, unknown> | undefined>;
    listScheduleExecutions(scheduleId: string, limit?: number): Promise<Array<Record<string, unknown>>>;
    getScheduleStats(): Promise<Record<string, unknown> | undefined>;
    getActiveScheduledExecutions(): Promise<Array<Record<string, unknown>>>;
    getUpcomingScheduledRuns(limit?: number): Promise<Array<Record<string, unknown>>>;
}
export {};
