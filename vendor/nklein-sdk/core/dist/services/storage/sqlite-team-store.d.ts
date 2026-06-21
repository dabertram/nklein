import { type TeamRuntimeState, type TeamTeammateSpec } from "@nklein/shared";
import type { TeamEvent } from "../../extensions/tools/team";
import type { TeamStore } from "../../types/storage";
export interface SqliteTeamStoreOptions {
    teamDir?: string;
}
export interface TeamRuntimeLoadResult {
    state?: TeamRuntimeState;
    teammates: TeamTeammateSpec[];
    interruptedRunIds: string[];
}
export declare class SqliteTeamStore implements TeamStore {
    private readonly teamDirPath;
    private db;
    constructor(options?: SqliteTeamStoreOptions);
    init(): void;
    private ensureTeamDir;
    private dbPath;
    private getRawDb;
    private ensureSchema;
    private run;
    private queryOne;
    private queryAll;
    /** Runs `work` in a single SQLite transaction (rollback on any error). */
    private withTransaction;
    listTeamNames(): string[];
    readState(teamName: string): TeamRuntimeState | undefined;
    readHistory(teamName: string, limit?: number): unknown[];
    loadRuntime(teamName: string): TeamRuntimeLoadResult;
    appendTeamEvent(teamName: string, eventType: string, payload: unknown, correlationId?: string): void;
    persistRuntime(teamName: string, state: TeamRuntimeState, teammates: TeamTeammateSpec[]): void;
    markInProgressRunsInterrupted(teamName: string, reason: string): string[];
    handleTeamEvent(teamName: string, event: TeamEvent): void;
}
