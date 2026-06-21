import type { CronSpecParseResult } from "@nklein/shared";
import { type ResolveCronSpecsDirOptions } from "@nklein/shared/storage";
import type { CronSpecRecord, SqliteCronStore, UpsertSpecResult } from "../store/sqlite-cron-store";
/**
 * Scan the configured cron specs directory on disk, parse every file, and
 * upsert spec state into the cron DB. This is the startup source of truth:
 * watcher events are triggers to re-run reconciliation for one file, not a
 * replacement.
 */
export interface CronReconcilerOptions {
    store: SqliteCronStore;
    /**
     * Cron spec source location. Defaults to global `~/.nklein/cron`.
     * Pass `{ scope: "workspace", workspaceRoot }` later to enable
     * workspace-level cron sources without changing reconciler internals.
     */
    specs?: ResolveCronSpecsDirOptions;
    /** @deprecated Use `specs: { scope: "workspace", workspaceRoot }`. */
    workspaceRoot?: string;
}
export interface ReconcileChange {
    relativePath: string;
    result: UpsertSpecResult;
    parse: CronSpecParseResult;
}
export interface ReconcileSummary {
    scanned: number;
    upserted: number;
    invalidParses: number;
    removed: number;
    changes: ReconcileChange[];
}
export declare class CronReconciler {
    private readonly store;
    private readonly cronDir;
    constructor(options: CronReconcilerOptions);
    getCronDir(): string;
    /**
     * Reconcile every file under the cron specs directory into the DB and mark specs
     * whose source files no longer exist as `removed=1`.
     */
    reconcileAll(): Promise<ReconcileSummary>;
    /**
     * Reconcile a single file (absolute path). `relativePath` is expected to
     * be POSIX-relative to the cron specs directory. Returns the reconciliation change
     * or undefined if the file could not be read.
     */
    reconcileFile(relativePath: string, absolutePath: string): Promise<ReconcileChange | undefined>;
    /**
     * Handle a file that disappeared from disk between reconciliations.
     * Marks the spec as removed and cancels any queued runs for it.
     */
    handleFileDeleted(spec: CronSpecRecord): void;
    /**
     * Refresh next_run_at for every enabled schedule spec.
     * Used at startup to handle the "one overdue catch-up on startup then
     * advance to next slot" policy.
     */
    refreshScheduleNextRunAt(): void;
    private applyScheduleNextRunAt;
}
