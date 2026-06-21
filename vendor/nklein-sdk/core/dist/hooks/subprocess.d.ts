import { type AgentAbortHookPayload, type AgentEndHookPayload, type AgentErrorHookPayload, type AgentHooks, type AgentResumeHookPayload, type AgentStartHookPayload, type HookEventName, HookEventNameSchema, type HookEventPayload, type HookEventPayloadBase, HookEventPayloadSchema, type HookSessionContextProvider, type PostToolUseData, type PreCompactData, type PreCompactHookPayload, type PreToolUseData, type PromptSubmitHookPayload, parseHookEventPayload, type SessionShutdownHookPayload, type TaskCancelData, type TaskCompleteData, type TaskResumeData, type TaskStartData, type ToolCallHookPayload, type ToolResultHookPayload, type UserPromptSubmitData, type WorkspaceInfo } from "@nklein/shared";
import { z } from "zod";
import { type RunSubprocessEventResult } from "./subprocess-runner";
export interface HookOutput {
    contextModification: string;
    cancel: boolean;
    review?: boolean;
    errorMessage: string;
}
export declare const HookOutputSchema: z.ZodObject<{
    contextModification: z.ZodOptional<z.ZodString>;
    cancel: z.ZodOptional<z.ZodBoolean>;
    review: z.ZodOptional<z.ZodBoolean>;
    errorMessage: z.ZodOptional<z.ZodString>;
    context: z.ZodOptional<z.ZodString>;
    overrideInput: z.ZodOptional<z.ZodUnknown>;
}, z.core.$loose>;
export { HookEventNameSchema, HookEventPayloadSchema, parseHookEventPayload };
export type { AgentAbortHookPayload, AgentEndHookPayload, AgentErrorHookPayload, AgentResumeHookPayload, AgentStartHookPayload, HookEventName, HookEventPayload, HookEventPayloadBase, PostToolUseData, PreCompactData, PreCompactHookPayload, PreToolUseData, PromptSubmitHookPayload, SessionShutdownHookPayload, TaskCancelData, TaskCompleteData, TaskResumeData, TaskStartData, ToolCallHookPayload, ToolResultHookPayload, UserPromptSubmitData, };
export interface RunHookOptions {
    command?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    detached?: boolean;
    timeoutMs?: number;
    onSpawn?: (event: {
        command: string[];
        pid?: number;
        detached: boolean;
    }) => void;
}
export type RunHookResult = RunSubprocessEventResult;
export declare function runHook(payload: HookEventPayload, options?: RunHookOptions): Promise<RunHookResult | undefined>;
export interface SubprocessHooksOptions {
    command?: string[];
    cwd?: string;
    /**
     * Structured workspace and git metadata forwarded into every hook payload
     * as `workspaceInfo`. Obtained from `generateWorkspaceInfo` at session
     * startup and passed here so hook scripts can inspect branch, commit, and
     * remote without running their own `git` commands.
     */
    workspaceInfo?: WorkspaceInfo;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    onDispatchError?: (error: Error, payload: HookEventPayload) => void;
    onDispatch?: (event: {
        payload: HookEventPayload;
        result?: RunHookResult;
        detached: boolean;
    }) => void;
    onSpawn?: (event: {
        command: string[];
        pid?: number;
        detached: boolean;
    }) => void;
    sessionContext?: HookSessionContextProvider;
}
export interface SubprocessHookControl {
    hooks: AgentHooks;
    shutdown: (ctx: {
        agentId: string;
        conversationId: string;
        parentAgentId: string | null;
        reason?: string;
    }) => Promise<void>;
}
export declare function createSubprocessHooks(options?: SubprocessHooksOptions): SubprocessHookControl;
