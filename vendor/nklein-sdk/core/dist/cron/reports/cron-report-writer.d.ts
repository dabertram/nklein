import { type ResolveCronSpecsDirOptions } from "@nklein/shared/storage";
import type { CronEventLogRecord, CronRunRecord, CronSpecRecord } from "../store/sqlite-cron-store";
/**
 * Writes a markdown report for a completed or failed cron run.
 * Reports live under `<cron-specs-dir>/reports/<run-id>.md`.
 * By default that is `~/.nklein/cron/reports/<run-id>.md`.
 * and are derived artifacts — the database is still the operational source
 * of truth.
 */
export interface CronRunReportData {
    finalText?: string;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        totalCost?: number;
    };
    toolCalls?: Array<{
        name: string;
        error?: string;
        durationMs?: number;
    }>;
    durationMs?: number;
    error?: string;
    triggerEvent?: CronEventLogRecord;
}
export interface WriteReportOptions {
    /**
     * Cron spec source/report location. Defaults to global `~/.nklein/cron`.
     * Pass `{ scope: "workspace", workspaceRoot }` to write reports beside a
     * future workspace-scoped cron specs directory.
     */
    specs?: ResolveCronSpecsDirOptions;
    workspaceRoot: string;
    run: CronRunRecord;
    spec: CronSpecRecord;
    data: CronRunReportData;
}
export declare function writeCronRunReport(options: WriteReportOptions): string;
