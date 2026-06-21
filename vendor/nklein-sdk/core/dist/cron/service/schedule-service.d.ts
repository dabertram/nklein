import type { BasicLogger, ChatRunTurnRequest, ChatStartSessionArtifacts, ChatStartSessionRequest, HubScheduleCreateInput, HubScheduleUpdateInput, ScheduleExecutionRecord, ScheduleExecutionStatus, ScheduleRecord } from "@nklein/shared";
type HubScheduleTurnResult = {
    text: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        totalCost?: number;
    };
    inputTokens?: number;
    outputTokens?: number;
    iterations?: number;
    finishReason?: string;
    messages?: unknown[];
    toolCalls?: Array<{
        name: string;
        input?: unknown;
        output?: unknown;
        error?: string;
        durationMs?: number;
    }>;
};
export interface HubScheduleRuntimeHandlers {
    startSession(request: ChatStartSessionRequest): Promise<{
        sessionId: string;
        startResult?: ChatStartSessionArtifacts;
    }>;
    sendSession(sessionId: string, request: ChatRunTurnRequest): Promise<{
        result: HubScheduleTurnResult;
    }>;
    abortSession(sessionId: string): Promise<{
        applied: boolean;
    }>;
    stopSession(sessionId: string): Promise<{
        applied: boolean;
    }>;
}
export interface ActiveScheduledExecution {
    executionId: string;
    scheduleId: string;
    sessionId: string;
    startedAt: string;
    timeoutAt?: string;
}
export interface HubScheduleServiceOptions {
    runtimeHandlers: HubScheduleRuntimeHandlers;
    eventPublisher?: (eventType: string, payload: unknown) => void;
    logger?: BasicLogger;
    dbPath?: string;
    pollIntervalMs?: number;
    globalMaxConcurrency?: number;
    claimLeaseSeconds?: number;
}
export interface ListSchedulesOptions {
    enabled?: boolean;
    limit?: number;
    tags?: string[];
}
export interface ListScheduleExecutionsOptions {
    scheduleId?: string;
    status?: ScheduleExecutionStatus;
    limit?: number;
}
export interface ScheduleExecutionStats {
    totalRuns: number;
    successRate: number;
    avgDurationSeconds: number;
    lastFailure?: ScheduleExecutionRecord;
}
export declare class HubScheduleService {
    private readonly store;
    private readonly materializer;
    private readonly runner;
    private started;
    private disposed;
    constructor(options: HubScheduleServiceOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    createSchedule(input: HubScheduleCreateInput): ScheduleRecord;
    getSchedule(scheduleId: string): ScheduleRecord | undefined;
    listSchedules(options?: ListSchedulesOptions): ScheduleRecord[];
    updateSchedule(scheduleId: string, updates: HubScheduleUpdateInput): ScheduleRecord | undefined;
    deleteSchedule(scheduleId: string): boolean;
    pauseSchedule(scheduleId: string): ScheduleRecord | undefined;
    resumeSchedule(scheduleId: string): ScheduleRecord | undefined;
    triggerScheduleNow(scheduleId: string): Promise<ScheduleExecutionRecord | undefined>;
    listScheduleExecutions(options: ListScheduleExecutionsOptions): ScheduleExecutionRecord[];
    getScheduleStats(scheduleId: string): ScheduleExecutionStats;
    getActiveExecutions(): ActiveScheduledExecution[];
    getUpcomingRuns(limit?: number): Array<{
        scheduleId: string;
        name: string;
        nextRunAt: string;
    }>;
}
export {};
