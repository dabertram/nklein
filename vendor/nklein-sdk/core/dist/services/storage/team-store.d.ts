export type { TeamStore } from "../../types/storage";
export { FileTeamStore, type FileTeamStoreOptions, } from "./file-team-store";
export { SqliteTeamStore, type SqliteTeamStoreOptions, } from "./sqlite-team-store";
import { FileTeamStore } from "./file-team-store";
import { type SqliteTeamStoreOptions } from "./sqlite-team-store";
export declare function createLocalTeamStore(options?: SqliteTeamStoreOptions): {
    init(): void;
    listTeamNames(): string[];
    readState(teamName: string): ReturnType<FileTeamStore["readState"]>;
    readHistory(teamName: string, limit?: number): unknown[];
    loadRuntime(teamName: string): ReturnType<FileTeamStore["loadRuntime"]>;
    handleTeamEvent: FileTeamStore["handleTeamEvent"];
    persistRuntime: FileTeamStore["persistRuntime"];
    markInProgressRunsInterrupted: FileTeamStore["markInProgressRunsInterrupted"];
};
