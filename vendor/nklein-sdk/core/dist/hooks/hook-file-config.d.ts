import { HOOKS_CONFIG_DIRECTORY_NAME } from "@nklein/shared/storage";
import type { HookEventName } from "./subprocess";
export { HOOKS_CONFIG_DIRECTORY_NAME };
export declare function resolveHooksConfigSearchPaths(workspacePath?: string): string[];
export declare enum HookConfigFileName {
    TaskStart = "TaskStart",
    TaskResume = "TaskResume",
    TaskCancel = "TaskCancel",
    TaskComplete = "TaskComplete",
    TaskError = "TaskError",
    PreToolUse = "PreToolUse",
    PostToolUse = "PostToolUse",
    UserPromptSubmit = "UserPromptSubmit",
    PreCompact = "PreCompact",
    SessionShutdown = "SessionShutdown"
}
export declare const HOOK_CONFIG_FILE_EVENT_MAP: Readonly<Record<HookConfigFileName, HookEventName | undefined>>;
export declare function toHookConfigFileName(fileName: string): HookConfigFileName | undefined;
export interface HookConfigFileEntry {
    fileName: HookConfigFileName;
    hookEventName?: HookEventName;
    path: string;
}
export declare function listHookConfigFiles(workspacePath?: string): HookConfigFileEntry[];
