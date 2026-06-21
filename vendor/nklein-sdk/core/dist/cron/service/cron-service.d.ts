import type { AutomationEventEnvelope, BasicLogger } from "@nklein/shared";
import type { ResolveCronSpecsDirOptions } from "@nklein/shared/storage";
import { type CronEventIngressResult } from "../events/cron-event-ingress";
import type { CronRunRecord, CronSpecRecord, ListEventLogsOptions, ListRunsOptions, ListSpecsOptions } from "../store/sqlite-cron-store";
import type { HubScheduleRuntimeHandlers } from "./schedule-service";
/**
 * Top-level orchestrator for file-based cron automation.
 *
 * Wires together:
 *   - `SqliteCronStore` (cron.db)
 *   - `CronReconciler` (disk -> DB)
 *   - `CronWatcher` (cron specs directory filesystem events)
 *   - `CronMaterializer` (queue materialization)
 *   - `CronRunner` (claim + execute + report)
 *
 * This service is the forward path: the legacy `HubScheduleService`
 * continues to serve programmatic schedules, while `CronService` handles
 * everything sourced from the configured file-based cron directory.
 */
export interface CronServiceOptions {
    /** Default runtime workspace for the hub/daemon process. */
    workspaceRoot: string;
    /** Cron spec source/report location. Defaults to global `~/.nklein/cron`. */
    specs?: ResolveCronSpecsDirOptions;
    runtimeHandlers: HubScheduleRuntimeHandlers;
    dbPath?: string;
    logger?: BasicLogger;
    pollIntervalMs?: number;
    claimLeaseSeconds?: number;
    globalMaxConcurrency?: number;
    watcherDebounceMs?: number;
}
export declare class CronService {
    private readonly store;
    private readonly reconciler;
    private readonly watcher;
    private readonly eventIngress;
    private readonly materializer;
    private readonly runner;
    private started;
    private disposed;
    constructor(options: CronServiceOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    listSpecs(options?: ListSpecsOptions): CronSpecRecord[];
    getSpec(specId: string): CronSpecRecord | undefined;
    listRuns(options?: ListRunsOptions): CronRunRecord[];
    getRun(runId: string): CronRunRecord | undefined;
    listActiveRuns(): CronRunRecord[];
    listUpcomingRuns(limit?: number): CronRunRecord[];
    reconcileNow(): Promise<void>;
    ingestEvent(event: AutomationEventEnvelope): CronEventIngressResult;
    listEventLogs(options?: ListEventLogsOptions): import("../store/sqlite-cron-store").CronEventLogRecord[];
    getEventLog(eventId: string): import("../store/sqlite-cron-store").CronEventLogRecord | undefined;
}
