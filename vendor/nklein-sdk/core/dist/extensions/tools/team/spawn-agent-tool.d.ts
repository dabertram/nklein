/**
 * Reusable spawn_agent tool for delegating tasks to sub-agents.
 */
import { type AgentConfig, type AgentEvent, type AgentHooks, type AgentResult, type AgentTool, type AgentToolContext, type BasicLogger, type HookErrorMode, type ITelemetryService, type ToolApprovalRequest, type ToolApprovalResult, type ToolPolicy } from "@nklein/shared";
import { z } from "zod";
import { type DelegatedAgentConfigProvider } from "./delegated-agent";
type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentFinishReason = AgentResult["finishReason"];
export declare const SpawnAgentInputSchema: z.ZodObject<{
    systemPrompt: z.ZodString;
    task: z.ZodString;
}, z.core.$strip>;
export type SpawnAgentInput = z.infer<typeof SpawnAgentInputSchema>;
export interface SpawnAgentOutput {
    text: string;
    iterations: number;
    finishReason: AgentFinishReason;
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}
export interface SubAgentStartContext {
    subAgentId: string;
    conversationId: string;
    parentAgentId: string;
    input: SpawnAgentInput;
}
export interface SubAgentEndContext {
    subAgentId: string;
    conversationId: string;
    parentAgentId: string;
    input: SpawnAgentInput;
    result?: SpawnAgentOutput;
    error?: Error;
}
export interface SpawnAgentToolConfig {
    configProvider: DelegatedAgentConfigProvider;
    defaultMaxIterations?: number;
    subAgentTools?: AgentTool[];
    createSubAgentTools?: (input: SpawnAgentInput, context: AgentToolContext) => AgentTool[] | Promise<AgentTool[]>;
    onSubAgentEvent?: (event: AgentEvent) => void;
    /**
     * Lifecycle hooks forwarded to spawned sub-agent runs.
     */
    hooks?: AgentHooks;
    /**
     * Extension list forwarded to spawned sub-agent runs.
     */
    extensions?: AgentExtension[];
    /**
     * Error handling mode for forwarded lifecycle hooks.
     */
    hookErrorMode?: HookErrorMode;
    /**
     * Called after a sub-agent instance is created and before it starts running.
     * Errors are ignored so lifecycle observers cannot break task execution.
     */
    onSubAgentStart?: (context: SubAgentStartContext) => void | Promise<void>;
    /**
     * Called once a sub-agent run finishes (success or error).
     * Errors are ignored so lifecycle observers cannot break task execution.
     */
    onSubAgentEnd?: (context: SubAgentEndContext) => void | Promise<void>;
    /**
     * Optional per-tool policy for spawned sub-agents.
     */
    toolPolicies?: Record<string, ToolPolicy>;
    /**
     * Optional approval callback for spawned sub-agent tool calls.
     */
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult> | ToolApprovalResult;
    /**
     * Optional logger forwarded to spawned sub-agent runs.
     */
    logger?: BasicLogger;
    telemetry?: ITelemetryService;
}
/**
 * Create a spawn_agent tool that can run a delegated task with a focused sub-agent.
 */
export declare function createSpawnAgentTool(config: SpawnAgentToolConfig): AgentTool<SpawnAgentInput, SpawnAgentOutput>;
export {};
