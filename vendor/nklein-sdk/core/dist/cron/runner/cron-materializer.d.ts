import type { CronSpecRecord, SqliteCronStore } from "../store/sqlite-cron-store";
/**
 * Queue materialization rules shared between the reconciler, watcher, and
 * periodic runner tick. Execution stays trigger-agnostic once a row is
 * queued; this module is the only place that decides when to create a row.
 */
export interface CronMaterializerOptions {
    store: SqliteCronStore;
    now?: () => number;
}
export interface MaterializeSummary {
    oneOffQueued: number;
    scheduleQueued: number;
}
export declare class CronMaterializer {
    private readonly store;
    private readonly nowFn;
    constructor(options: CronMaterializerOptions);
    /**
     * Run materialization for every valid/enabled spec. Typically called at
     * startup (after reconciliation) and on each runner tick.
     */
    materializeAll(): MaterializeSummary;
    /**
     * Ensure a single one-off spec has exactly one run record for its current
     * revision unless an explicit rerun path creates a different trigger kind.
     * Returns true if a new queued run was created.
     */
    materializeOneOff(spec: CronSpecRecord): boolean;
    /**
     * Materialize schedule runs. Implements the "one overdue catch-up on
     * startup, then advance" policy described in PLAN.md.
     */
    materializeSchedule(spec: CronSpecRecord): boolean;
}
