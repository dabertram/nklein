import type { BasicLogger } from "@nklein/shared";
import type { ResolveCronSpecsDirOptions } from "@nklein/shared/storage";
import type { HubScheduleRuntimeHandlers } from "../service/schedule-service";
import type { CronRunRecord, SqliteCronStore } from "../store/sqlite-cron-store";
import type { CronMaterializer } from "./cron-materializer";
export interface CronRunnerOptions {
    store: SqliteCronStore;
    materializer: CronMaterializer;
    runtimeHandlers: HubScheduleRuntimeHandlers;
    /** Default runtime workspace for the hub/daemon process. */
    workspaceRoot: string;
    /** Cron spec source/report location. Defaults to global `~/.nklein/cron`. */
    specs?: ResolveCronSpecsDirOptions;
    logger?: BasicLogger;
    pollIntervalMs?: number;
    claimLeaseSeconds?: number;
    globalMaxConcurrency?: number;
}
export declare class CronRunner {
    private readonly store;
    private readonly materializer;
    private readonly options;
    private readonly limiter;
    private readonly claimLeaseMs;
    private timer;
    private started;
    private ticking;
    private disposed;
    private stopping;
    private readonly activeRuns;
    constructor(options: CronRunnerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    dispose(): Promise<void>;
    tick(): Promise<void>;
    getActiveRuns(): Array<CronRunRecord & {
        claimToken: string;
        sessionId?: string;
    }>;
    private executeClaim;
    private buildPrompt;
    private startClaimLeaseHeartbeat;
    private buildSystemPrompt;
    private buildStartRequest;
}
