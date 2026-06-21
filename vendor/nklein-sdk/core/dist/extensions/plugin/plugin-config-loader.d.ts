import type { AgentConfig, PluginSetupContext, WorkspaceInfo } from "@nklein/shared";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import type { PluginTargeting } from "./plugin-targeting";
type AgentPlugin = NonNullable<AgentConfig["extensions"]>[number];
export declare function resolvePluginConfigSearchPaths(workspacePath?: string): string[];
export declare function discoverPluginModulePaths(directoryPath: string): string[];
export interface ResolveAgentPluginPathsOptions {
    pluginPaths?: ReadonlyArray<string>;
    workspacePath?: string;
    cwd?: string;
}
export declare function resolveAgentPluginPaths(options?: ResolveAgentPluginPathsOptions): string[];
export interface ResolveAndLoadAgentPluginsOptions extends ResolveAgentPluginPathsOptions, PluginTargeting {
    mode?: "sandbox" | "in_process";
    exportName?: string;
    importTimeoutMs?: number;
    hookTimeoutMs?: number;
    contributionTimeoutMs?: number;
    onEvent?: (event: {
        name: string;
        payload?: unknown;
    }) => void;
    /**
     * Structured workspace and git metadata. Forwarded to sandboxed plugins
     * via PluginSetupCtx.workspaceInfo and made available to in-process plugins
     * in the extension context.
     */
    workspaceInfo?: WorkspaceInfo;
    session?: PluginSetupContext["session"];
    client?: PluginSetupContext["client"];
    user?: PluginSetupContext["user"];
    automation?: PluginSetupContext["automation"];
    logger?: PluginSetupContext["logger"];
    telemetry?: PluginSetupContext["telemetry"];
}
export declare function resolveAndLoadAgentPlugins(options?: ResolveAndLoadAgentPluginsOptions): Promise<{
    extensions: AgentPlugin[];
    shutdown?: () => Promise<void>;
} & PluginLoadDiagnostics>;
export {};
