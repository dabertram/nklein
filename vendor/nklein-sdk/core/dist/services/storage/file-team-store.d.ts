import type { TeamRuntimeState, TeamTeammateSpec } from "@nklein/shared";
import type { TeamEvent } from "../../extensions/tools/team";
import type { TeamStore } from "../../types/storage";
export interface FileTeamStoreOptions {
    teamDir?: string;
}
export interface TeamRuntimeLoadResult {
    state?: TeamRuntimeState;
    teammates: TeamTeammateSpec[];
    interruptedRunIds: string[];
}
export declare class FileTeamStore implements TeamStore {
    private readonly teamDirPath;
    constructor(options?: FileTeamStoreOptions);
    init(): void;
    listTeamNames(): string[];
    readState(teamName: string): TeamRuntimeState | undefined;
    readHistory(teamName: string, limit?: number): unknown[];
    loadRuntime(teamName: string): TeamRuntimeLoadResult;
    handleTeamEvent(teamName: string, event: TeamEvent): void;
    persistRuntime(teamName: string, state: TeamRuntimeState, teammates: TeamTeammateSpec[]): void;
    markInProgressRunsInterrupted(teamName: string, reason: string): string[];
    private ensureTeamDir;
    private ensureTeamSubdir;
    private statePath;
    private historyPath;
    private readEnvelope;
}
