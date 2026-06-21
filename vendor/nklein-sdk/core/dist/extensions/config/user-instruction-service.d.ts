import type { AgentExtension } from "@nklein/shared";
import { type AvailableRuntimeCommand } from "./runtime-commands";
import { type CreateUserInstructionConfigWatcherOptions, type UserInstructionConfig, type UserInstructionConfigType } from "./user-instruction-config-loader";
import { type CreateUserInstructionPluginOptions } from "./user-instruction-plugin";
export interface UserInstructionConfigRecord<TConfig extends UserInstructionConfig = UserInstructionConfig> {
    type: UserInstructionConfigType;
    id: string;
    filePath: string;
    item: TConfig;
}
export interface CreateUserInstructionConfigServiceOptions extends CreateUserInstructionConfigWatcherOptions {
}
export interface UserInstructionConfigService {
    start(): Promise<void>;
    stop(): void;
    refreshType(type: UserInstructionConfigType): Promise<void>;
    listRecords<TConfig extends UserInstructionConfig = UserInstructionConfig>(type: UserInstructionConfigType): UserInstructionConfigRecord<TConfig>[];
    listRuntimeCommands(): AvailableRuntimeCommand[];
    resolveRuntimeSlashCommand(input: string): string;
    hasConfiguredSkills(allowedSkillNames?: ReadonlyArray<string>): boolean;
    createExtension(options: Omit<CreateUserInstructionPluginOptions, "watcher" | "watcherReady">): AgentExtension;
}
export declare function createUserInstructionConfigService(options?: CreateUserInstructionConfigServiceOptions): UserInstructionConfigService;
