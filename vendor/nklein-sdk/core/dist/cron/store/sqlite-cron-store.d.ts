import type { AutomationEventEnvelope, CronSpec, CronSpecExtensionKind, CronTriggerKind, HubScheduleCreateInput, HubScheduleUpdateInput } from "@nklein/shared";
/**
 * Generalized cron/automation store backed by `cron.db`. Sessions stay in
 * their own database (see @nklein/shared `ensureSessionSchema`). cron_runs
 * here absorb one-off, recurring, and event-driven work under one queue.
 */
export type CronRunStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type CronRunTriggerKind = "one_off" | "schedule" | "event" | "manual" | "retry";
export type CronParseStatus = "valid" | "invalid";
export type CronEventProcessingStatus = "received" | "unmatched" | "queued" | "suppressed" | "failed";
export interface CronSpecRecord {
    specId: string;
    externalId: string;
    sourcePath: string;
    triggerKind: CronTriggerKind;
    sourceMtimeMs?: number;
    sourceHash?: string;
    parseStatus: CronParseStatus;
    parseError?: string;
    enabled: boolean;
    removed: boolean;
    title: string;
    prompt?: string;
    workspaceRoot?: string;
    scheduleExpr?: string;
    timezone?: string;
    eventType?: string;
    filters?: Record<string, unknown>;
    debounceSeconds?: number;
    dedupeWindowSeconds?: number;
    cooldownSeconds?: number;
    mode?: string;
    systemPrompt?: string;
    providerId?: string;
    modelId?: string;
    maxIterations?: number;
    timeoutSeconds?: number;
    maxParallel?: number;
    tools?: string[];
    notesDirectory?: string;
    extensions?: CronSpecExtensionKind[];
    source?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    revision: number;
    lastMaterializedRunId?: string;
    lastRunAt?: string;
    nextRunAt?: string;
    createdAt: string;
    updatedAt: string;
}
export interface CronRunRecord {
    runId: string;
    specId: string;
    specRevision: number;
    triggerKind: CronRunTriggerKind;
    status: CronRunStatus;
    claimToken?: string;
    claimStartedAt?: string;
    claimUntilAt?: string;
    scheduledFor?: string;
    triggerEventId?: string;
    startedAt?: string;
    completedAt?: string;
    sessionId?: string;
    reportPath?: string;
    error?: string;
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface CronEventLogRecord {
    eventId: string;
    eventType: string;
    source: string;
    subject?: string;
    occurredAt: string;
    receivedAt: string;
    workspaceRoot?: string;
    dedupeKey?: string;
    payload?: Record<string, unknown>;
    attributes?: Record<string, unknown>;
    processingStatus: CronEventProcessingStatus;
    matchedSpecCount: number;
    queuedRunCount: number;
    suppressedCount: number;
    error?: string;
    createdAt: string;
    updatedAt: string;
}
export interface UpsertSpecInput {
    externalId: string;
    sourcePath: string;
    triggerKind: CronTriggerKind;
    sourceMtimeMs?: number;
    sourceHash: string;
    parseStatus: CronParseStatus;
    parseError?: string;
    spec?: CronSpec;
}
export interface UpsertSpecResult {
    record: CronSpecRecord;
    created: boolean;
    revisionChanged: boolean;
}
export interface SqliteCronStoreOptions {
    dbPath?: string;
}
export interface ListSpecsOptions {
    triggerKind?: CronTriggerKind;
    enabled?: boolean;
    parseStatus?: CronParseStatus;
    includeRemoved?: boolean;
    limit?: number;
}
export interface ListRunsOptions {
    specId?: string;
    status?: CronRunStatus | CronRunStatus[];
    limit?: number;
}
export interface ClaimRunOptions {
    nowIso: string;
    leaseMs: number;
    limit?: number;
}
export interface ClaimedCronRun {
    run: CronRunRecord;
    claimToken: string;
    claimUntilAt: string;
}
interface ClaimBoundUpdate {
    runId: string;
    claimToken: string;
}
export interface MaterializeScheduleRunResult {
    queued: boolean;
    run?: CronRunRecord;
    nextRunAt?: string;
}
export interface EnqueueRunInput {
    specId: string;
    specRevision: number;
    triggerKind: CronRunTriggerKind;
    scheduledFor?: string;
    triggerEventId?: string;
}
export interface InsertEventLogResult {
    record: CronEventLogRecord;
    created: boolean;
}
export interface ListEventLogsOptions {
    eventType?: string;
    source?: string;
    processingStatus?: CronEventProcessingStatus;
    limit?: number;
}
export declare class SqliteCronStore {
    private readonly db;
    constructor(options?: SqliteCronStoreOptions);
    close(): void;
    getSpecBySourcePath(sourcePath: string): CronSpecRecord | undefined;
    getSpec(specId: string): CronSpecRecord | undefined;
    getSpecByExternalId(externalId: string): CronSpecRecord | undefined;
    listSpecs(options?: ListSpecsOptions): CronSpecRecord[];
    createHubSchedule(input: HubScheduleCreateInput): CronSpecRecord;
    getHubSchedule(scheduleId: string): CronSpecRecord | undefined;
    listHubSchedules(options?: {
        enabled?: boolean;
        limit?: number;
        tags?: string[];
    }): CronSpecRecord[];
    updateHubSchedule(scheduleId: string, updates: HubScheduleUpdateInput): CronSpecRecord | undefined;
    deleteHubSchedule(scheduleId: string): boolean;
    enqueueHubScheduleRun(scheduleId: string, triggerKind?: "manual" | "retry"): CronRunRecord | undefined;
    listEventSpecsForType(eventType: string): CronSpecRecord[];
    upsertSpec(input: UpsertSpecInput): UpsertSpecResult;
    private insertSpecRow;
    private updateSpecRow;
    markSpecRemoved(specId: string): void;
    updateSpecNextRunAt(specId: string, nextRunAt: string | undefined): void;
    updateSpecLastRunAt(specId: string, lastRunAt: string): void;
    updateLastMaterializedRunId(specId: string, runId: string): void;
    private initializeScheduleNextRun;
    materializeDueScheduleRun(options: {
        specId: string;
        nowMs: number;
    }): MaterializeScheduleRunResult;
    getRun(runId: string): CronRunRecord | undefined;
    insertEventLog(event: AutomationEventEnvelope, options?: {
        receivedAtIso?: string;
    }): InsertEventLogResult;
    getEventLog(eventId: string): CronEventLogRecord | undefined;
    listEventLogs(options?: ListEventLogsOptions): CronEventLogRecord[];
    updateEventLogProcessing(eventId: string, update: {
        status: CronEventProcessingStatus;
        matchedSpecCount?: number;
        queuedRunCount?: number;
        suppressedCount?: number;
        error?: string;
    }): boolean;
    listRuns(options?: ListRunsOptions): CronRunRecord[];
    hasRecentEventRunForDedupe(options: {
        specId: string;
        dedupeKey: string;
        sinceIso: string;
    }): boolean;
    hasRecentEventRunForSpec(options: {
        specId: string;
        sinceIso: string;
    }): boolean;
    findQueuedEventRunForDedupe(options: {
        specId: string;
        dedupeKey: string;
    }): CronRunRecord | undefined;
    updateQueuedEventRunForDebounce(options: {
        runId: string;
        triggerEventId: string;
        scheduledFor: string;
    }): CronRunRecord | undefined;
    hasOneOffRunForRevision(specId: string, revision: number): boolean;
    enqueueRun(input: EnqueueRunInput): CronRunRecord;
    cancelQueuedRunsForSpec(specId: string): number;
    claimDueRuns(options: ClaimRunOptions): ClaimedCronRun[];
    renewClaim(runId: string, claimToken: string, leaseUntilAt: string): boolean;
    completeRun(runId: string, update: {
        status: "done" | "failed" | "cancelled";
        sessionId?: string;
        reportPath?: string;
        error?: string;
        completedAtIso?: string;
        claimToken?: string;
    }): boolean;
    requeueRun(update: ClaimBoundUpdate & {
        error?: string;
        scheduledFor?: string;
    }): boolean;
    attachSessionIdToRun(runId: string, sessionId: string): void;
    attachReportPathToRun(runId: string, reportPath: string): void;
}
export {};
