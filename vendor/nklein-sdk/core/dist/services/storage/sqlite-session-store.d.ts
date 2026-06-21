import { type SqliteDb } from "@nklein/shared/db";
import type { SessionStatus } from "../../types/common";
import type { SessionRecord } from "../../types/sessions";
import type { SessionStore } from "../../types/storage";
export interface SqliteSessionStoreOptions {
    sessionsDir?: string;
}
export declare class SqliteSessionStore implements SessionStore {
    private readonly sessionsDirPath;
    private db;
    constructor(options?: SqliteSessionStoreOptions);
    init(): void;
    ensureSessionsDir(): string;
    sessionDbPath(): string;
    getRawDb(): SqliteDb;
    close(): void;
    run(sql: string, params?: unknown[]): {
        changes?: number;
    };
    queryOne<T>(sql: string, params?: unknown[]): T | undefined;
    queryAll<T>(sql: string, params?: unknown[]): T[];
    create(record: SessionRecord): void;
    update(record: Partial<SessionRecord> & {
        sessionId: string;
    }): void;
    updateStatus(sessionId: string, status: SessionStatus, exitCode?: number | null): void;
    get(sessionId: string): SessionRecord | undefined;
    list(limit?: number): SessionRecord[];
    delete(sessionId: string, cascade?: boolean): boolean;
}
