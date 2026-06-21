import type { AutomationEventEnvelope, BasicLogger } from "@nklein/shared";
import type { CronEventLogRecord, CronRunRecord, CronSpecRecord, SqliteCronStore } from "../store/sqlite-cron-store";
/**
 * Durable ingress for normalized automation events.
 *
 * This layer persists the incoming event before matching, then materializes
 * queued `cron_runs` for matching event specs. It deliberately does not
 * execute agents; the normal runner claim loop owns execution.
 */
export interface CronEventIngressOptions {
    store: SqliteCronStore;
    now?: () => number;
    logger?: BasicLogger;
}
export type CronEventSuppressionReason = "duplicate_event" | "filter_mismatch" | "dedupe_window" | "cooldown";
export interface CronEventSuppression {
    specId?: string;
    externalId?: string;
    reason: CronEventSuppressionReason;
    dedupeKey?: string;
}
export interface CronEventIngressResult {
    event: CronEventLogRecord;
    duplicate: boolean;
    matchedSpecs: CronSpecRecord[];
    queuedRuns: CronRunRecord[];
    suppressions: CronEventSuppression[];
}
export declare function automationEventMatchesFilters(event: AutomationEventEnvelope, filters: Record<string, unknown> | undefined): boolean;
export declare class CronEventIngress {
    private readonly store;
    private readonly nowFn;
    private readonly logger?;
    constructor(options: CronEventIngressOptions);
    ingestEvent(event: AutomationEventEnvelope): CronEventIngressResult;
    private materializeForSpec;
}
