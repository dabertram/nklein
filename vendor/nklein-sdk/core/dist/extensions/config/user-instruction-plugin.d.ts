import type { AgentExtension } from "@nklein/shared";
import { type SkillsExecutorWithMetadata } from "../tools";
import type { SkillConfig, UserInstructionConfigWatcher } from "./user-instruction-config-loader";
type SkillsExecutorMetadataItem = {
    id: string;
    name: string;
    description?: string;
    disabled: boolean;
};
type ConfiguredSkill = SkillsExecutorMetadataItem & {
    skill: SkillConfig;
};
export interface CreateUserInstructionPluginOptions {
    watcher: UserInstructionConfigWatcher;
    watcherReady?: Promise<void>;
    includeRules?: boolean;
    includeSkills?: boolean;
    includeWorkflows?: boolean;
    registerSkillsTool?: boolean;
    allowedSkillNames?: ReadonlyArray<string>;
}
export declare function getConfiguredSkillsFromWatcher(watcher: UserInstructionConfigWatcher, allowedSkillNames?: ReadonlyArray<string>): ConfiguredSkill[];
export declare function createUserInstructionSkillsExecutor(watcher: UserInstructionConfigWatcher, watcherReady?: Promise<void>, allowedSkillNames?: ReadonlyArray<string>): SkillsExecutorWithMetadata;
export declare function createUserInstructionPlugin(options: CreateUserInstructionPluginOptions): AgentExtension;
export {};
