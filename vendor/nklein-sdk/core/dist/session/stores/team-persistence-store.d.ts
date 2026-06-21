import type { TeamTeammateSpec } from "@nklein/shared";
import type { AgentTeamsRuntime, TeamEvent } from "../../extensions/tools/team";
import { type TeamRuntimeState } from "../models/session-row";
export interface FileTeamPersistenceStoreOptions {
    teamName: string;
    baseDir?: string;
}
export declare class FileTeamPersistenceStore {
    private readonly dirPath;
    private readonly statePath;
    private readonly taskHistoryPath;
    private readonly teammateSpecs;
    constructor(options: FileTeamPersistenceStoreOptions);
    loadState(): TeamRuntimeState | undefined;
    getTeammateSpecs(): TeamTeammateSpec[];
    upsertTeammateSpec(spec: TeamTeammateSpec): void;
    removeTeammateSpec(agentId: string): void;
    persist(runtime: AgentTeamsRuntime): void;
    appendTaskHistory(event: TeamEvent): void;
    private ensureDir;
    private hasPersistableState;
    private clearPersistedState;
}
