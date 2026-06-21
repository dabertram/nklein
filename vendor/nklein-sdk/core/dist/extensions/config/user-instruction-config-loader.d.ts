import { RULES_CONFIG_DIRECTORY_NAME, SKILLS_CONFIG_DIRECTORY_NAME, WORKFLOWS_CONFIG_DIRECTORY_NAME } from "@nklein/shared/storage";
import { type UnifiedConfigDefinition, UnifiedConfigFileWatcher, type UnifiedConfigWatcherEvent } from "./unified-config-file-watcher";
export { RULES_CONFIG_DIRECTORY_NAME, SKILLS_CONFIG_DIRECTORY_NAME, WORKFLOWS_CONFIG_DIRECTORY_NAME, };
export interface ParseMarkdownFrontmatterResult {
    data: Record<string, unknown>;
    body: string;
    hadFrontmatter: boolean;
    parseError?: string;
}
export interface SkillConfig {
    name: string;
    description?: string;
    disabled?: boolean;
    instructions: string;
    frontmatter: Record<string, unknown>;
}
export interface RuleConfig {
    name: string;
    disabled?: boolean;
    instructions: string;
    frontmatter: Record<string, unknown>;
}
export interface WorkflowConfig {
    name: string;
    disabled?: boolean;
    description?: string;
    instructions: string;
    frontmatter: Record<string, unknown>;
}
export type UserInstructionConfigType = "skill" | "rule" | "workflow";
export type UserInstructionConfig = SkillConfig | RuleConfig | WorkflowConfig;
export type UserInstructionConfigWatcher = UnifiedConfigFileWatcher<UserInstructionConfigType, UserInstructionConfig>;
export type UserInstructionConfigWatcherEvent = UnifiedConfigWatcherEvent<UserInstructionConfigType, UserInstructionConfig>;
export interface CreateInstructionWatcherOptions {
    debounceMs?: number;
    emitParseErrors?: boolean;
}
export interface CreateSkillsConfigDefinitionOptions {
    directories?: ReadonlyArray<string>;
    workspacePath?: string;
}
export interface CreateRulesConfigDefinitionOptions {
    directories?: ReadonlyArray<string>;
    workspacePath?: string;
}
export interface CreateWorkflowsConfigDefinitionOptions {
    directories?: ReadonlyArray<string>;
    workspacePath?: string;
}
export declare function parseSkillConfigFromMarkdown(content: string, fallbackName: string): SkillConfig;
export declare function parseRuleConfigFromMarkdown(content: string, fallbackName: string): RuleConfig;
export declare function parseWorkflowConfigFromMarkdown(content: string, fallbackName: string): WorkflowConfig;
export declare function resolveSkillsConfigSearchPaths(workspacePath?: string): string[];
export declare function resolveRulesConfigSearchPaths(workspacePath?: string): string[];
export declare function resolveWorkflowsConfigSearchPaths(workspacePath?: string): string[];
export declare function createSkillsConfigDefinition(options?: CreateSkillsConfigDefinitionOptions): UnifiedConfigDefinition<"skill", SkillConfig>;
export declare function createRulesConfigDefinition(options?: CreateRulesConfigDefinitionOptions): UnifiedConfigDefinition<"rule", RuleConfig>;
export declare function createWorkflowsConfigDefinition(options?: CreateWorkflowsConfigDefinitionOptions): UnifiedConfigDefinition<"workflow", WorkflowConfig>;
export interface CreateUserInstructionConfigWatcherOptions extends CreateInstructionWatcherOptions {
    skills?: CreateSkillsConfigDefinitionOptions;
    rules?: CreateRulesConfigDefinitionOptions;
    workflows?: CreateWorkflowsConfigDefinitionOptions;
}
export declare function createUserInstructionConfigWatcher(options?: CreateUserInstructionConfigWatcherOptions): UserInstructionConfigWatcher;
