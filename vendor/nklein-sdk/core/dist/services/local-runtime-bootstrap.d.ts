import type { AgentConfig, AgentHooks, AgentTool, ITelemetryService, ToolApprovalRequest, ToolApprovalResult, WorkspaceInfo } from "@nklein/shared";
import type { TeamEvent } from "../extensions/tools/team";
import type { RuntimeCapabilities } from "../runtime/capabilities";
import type { LocalRuntimeStartOptions, StartSessionInput } from "../runtime/host/runtime-host";
import type { RuntimeBuilderInput } from "../runtime/orchestration/session-runtime";
import type { CoreSessionConfig } from "../types/config";
import { type ProviderConfig } from "../types/provider-settings";
import type { ProviderSettingsManager } from "./storage/provider-settings-manager";
export interface PrepareLocalRuntimeBootstrapOptions {
    input: StartSessionInput;
    localRuntime?: LocalRuntimeStartOptions;
    sessionId: string;
    providerSettingsManager: ProviderSettingsManager;
    defaultTelemetry?: ITelemetryService;
    defaultCapabilities?: RuntimeCapabilities;
    defaultToolPolicies?: AgentConfig["toolPolicies"];
    /**
     * Host-level default `fetch` threaded into `ProviderConfig.fetch` so the
     * AI gateway providers can use a custom HTTP implementation.
     */
    defaultFetch?: typeof fetch;
    onPluginEvent: (event: {
        name: string;
        payload?: unknown;
    }) => void;
    onTeamEvent: (event: TeamEvent) => void;
    createSpawnTool: () => AgentTool;
    readSessionMetadata: () => Promise<Record<string, unknown> | undefined>;
    writeSessionMetadata: (metadata: Record<string, unknown>) => Promise<void> | void;
}
export interface LocalRuntimeBootstrap {
    effectiveInput: StartSessionInput;
    config: CoreSessionConfig;
    providerConfig: ProviderConfig;
    workspaceMetadata: string;
    /** Structured git + path metadata generated alongside workspaceMetadata. */
    workspaceInfo: WorkspaceInfo;
    extensions: AgentConfig["extensions"];
    hooks: AgentHooks | undefined;
    toolPolicies: AgentConfig["toolPolicies"];
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult> | ToolApprovalResult;
    pluginSandboxShutdown?: () => Promise<void>;
    runtimeBuilderInput: RuntimeBuilderInput;
}
export declare function prepareLocalRuntimeBootstrap(options: PrepareLocalRuntimeBootstrapOptions): Promise<LocalRuntimeBootstrap>;
