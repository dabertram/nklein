import type { CronReconciler } from "./cron-reconciler";
export interface CronWatcherOptions {
    reconciler: CronReconciler;
    debounceMs?: number;
    onError?: (error: unknown) => void;
    onReconciled?: () => void | Promise<void>;
}
export declare class CronWatcher {
    private readonly reconciler;
    private readonly debounceMs;
    private readonly onError;
    private readonly onReconciled;
    private watcher?;
    private readonly pending;
    private disposed;
    constructor(options: CronWatcherOptions);
    start(): void;
    stop(): void;
    dispose(): void;
    private scheduleReconcile;
    private reconcileNow;
}
