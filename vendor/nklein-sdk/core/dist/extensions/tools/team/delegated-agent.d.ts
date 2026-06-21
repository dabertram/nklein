import type { AgentConfig, AgentEvent, AgentHooks, AgentTool, BasicLogger, HookErrorMode, ITelemetryService, ToolApprovalRequest, ToolApprovalResult } from "@nklein/shared";
import { SessionRuntime } from "../../../runtime/orchestration/session-runtime-orchestrator";
type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
export type DelegatedAgentConnectionConfig = Pick<AgentConfig, "providerId" | "modelId" | "apiKey" | "baseUrl" | "headers" | "providerConfig" | "knownModels" | "thinking">;
export interface DelegatedAgentRuntimeConfig extends DelegatedAgentConnectionConfig {
    cwd?: string;
    providerId: string;
    nkleinPlatform?: string;
    nkleinIdeName?: string;
    maxIterations?: number;
    hooks?: AgentHooks;
    extensions?: AgentExtension[];
    logger?: BasicLogger;
    telemetry?: ITelemetryService;
    workspaceMetadata?: string;
}
export interface DelegatedAgentConfigProvider {
    getRuntimeConfig(): DelegatedAgentRuntimeConfig;
    getConnectionConfig(): DelegatedAgentConnectionConfig;
    updateConnectionDefaults(overrides: Partial<DelegatedAgentConnectionConfig>): void;
}
export type DelegatedAgentKind = "subagent" | "teammate";
export interface BuildDelegatedAgentConfigOptions {
    kind: DelegatedAgentKind;
    prompt: string;
    tools: AgentTool[];
    configProvider: DelegatedAgentConfigProvider;
    parentAgentId?: string;
    maxIterations?: number;
    abortSignal?: AbortSignal;
    onEvent?: (event: AgentEvent) => void;
    hookErrorMode?: HookErrorMode;
    toolPolicies?: AgentConfig["toolPolicies"];
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult> | ToolApprovalResult;
    role?: string;
    cwd?: string;
}
export declare function createDelegatedAgentConfigProvider(initialConfig: DelegatedAgentRuntimeConfig): DelegatedAgentConfigProvider;
export declare function buildDelegatedAgentConfig(options: BuildDelegatedAgentConfigOptions): AgentConfig & {
    role?: string;
};
export declare function createDelegatedAgent(options: BuildDelegatedAgentConfigOptions): SessionRuntime;
export {};
