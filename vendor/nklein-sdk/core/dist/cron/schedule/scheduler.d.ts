export interface ParsedCron {
    minutes: number[];
    hours: number[];
    daysOfMonth: number[];
    months: number[];
    daysOfWeek: number[];
}
export declare function parseCron(pattern: string): ParsedCron;
export declare function validateCronPattern(pattern: string): void;
export declare function validateCronSchedule(pattern: string, timezone?: string, after?: number): void;
export declare function validateTimezone(timezone: string | undefined): void;
export declare function getNextCronTime(pattern: string, after: number, timezone?: string): number;
