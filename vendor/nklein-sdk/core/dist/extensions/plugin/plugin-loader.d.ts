import type { AgentExtension, PluginSetupContext } from "@nklein/shared";
import type { PluginInitializationFailure, PluginInitializationWarning } from "./plugin-load-report";
import { type PluginTargeting } from "./plugin-targeting";
export interface LoadAgentPluginFromPathOptions {
    exportName?: string;
    cwd?: string;
    useCache?: boolean;
    session?: PluginSetupContext["session"];
    client?: PluginSetupContext["client"];
    user?: PluginSetupContext["user"];
    workspaceInfo?: PluginSetupContext["workspaceInfo"];
    automation?: PluginSetupContext["automation"];
    logger?: PluginSetupContext["logger"];
    telemetry?: PluginSetupContext["telemetry"];
}
export declare function loadAgentPluginFromPath(pluginPath: string, options?: LoadAgentPluginFromPathOptions): Promise<AgentExtension>;
export declare function loadAgentPluginsFromPaths(pluginPaths: string[], options?: LoadAgentPluginFromPathOptions & PluginTargeting): Promise<AgentExtension[]>;
export declare function loadAgentPluginsFromPathsWithDiagnostics(pluginPaths: string[], options?: LoadAgentPluginFromPathOptions & PluginTargeting): Promise<{
    plugins: AgentExtension[];
    failures: PluginInitializationFailure[];
    warnings: PluginInitializationWarning[];
}>;
