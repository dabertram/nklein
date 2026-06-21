export declare class ResourceLimiter {
    private readonly globalMaxConcurrency;
    private readonly activeExecutions;
    constructor(globalMaxConcurrency: number);
    acquire(scheduleId: string, executionId: string, maxParallel: number): boolean;
    release(scheduleId: string, executionId: string): void;
    getGlobalActiveCount(): number;
}
