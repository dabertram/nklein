import type { AgentExtension, AgentHooks } from "@nklein/shared";
import { type BasicLogger, type WorkspaceInfo } from "@nklein/shared";
type HookRuntimeOptions = {
    cwd: string;
    workspacePath: string;
    rootSessionId?: string;
    logger?: BasicLogger;
    toolCallTimeoutMs?: number;
    /** Structured git + path metadata forwarded into every hook payload. */
    workspaceInfo?: WorkspaceInfo;
};
export declare function getWindowsPythonFallbackCommand(command: string[], platform?: NodeJS.Platform, error?: unknown): string[] | undefined;
export declare function createHookAuditHooks(options: {
    rootSessionId?: string;
    workspacePath: string;
    workspaceInfo?: WorkspaceInfo;
}): AgentHooks;
export declare function createHookConfigFileHooks(options: HookRuntimeOptions): AgentHooks | undefined;
export declare function createHookConfigFileExtension(options: HookRuntimeOptions): AgentExtension | undefined;
export declare function mergeAgentHooks(layers: Array<AgentHooks | undefined>): AgentHooks | undefined;
export {};
