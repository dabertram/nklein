import type { UserInstructionConfigWatcher } from "./user-instruction-config-loader";
export type RuntimeCommandKind = "skill" | "workflow";
export type AvailableRuntimeCommand = {
    id: string;
    name: string;
    instructions: string;
    description?: string;
    kind: RuntimeCommandKind;
};
export declare function listAvailableRuntimeCommandsFromWatcher(watcher: UserInstructionConfigWatcher): AvailableRuntimeCommand[];
export declare function resolveRuntimeSlashCommandFromWatcher(input: string, watcher: UserInstructionConfigWatcher): string;
