import type { SessionRecord as HubSessionRecord } from "@nklein/shared";
export declare function truncateNotificationBody(value: string): string;
export declare function buildCompletionNotification(session: HubSessionRecord | undefined): Promise<{
    title: string;
    body: string;
    severity: "info";
}>;
