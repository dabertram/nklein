/**
 * Small process-local string cache with TTL expiry and a hard entry cap.
 * Used where unbounded Maps would grow without bound in long-running processes.
 */
export declare class BoundedTtlCache {
    private readonly ttlMs;
    private readonly maxEntries;
    private readonly entries;
    constructor(ttlMs: number, maxEntries: number);
    get(key: string, now?: number): string | undefined;
    set(key: string, value: string, now?: number, ttlMsOverride?: number): void;
    private pruneExpired;
}
