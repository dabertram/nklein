import type { AgentConfig, PluginSetupContext, WorkspaceInfo } from "@nklein/shared";
import type { PluginLoadDiagnostics } from "./plugin-load-report";
import type { PluginTargeting } from "./plugin-targeting";
export type SandboxedPluginSetupContext = Pick<PluginSetupContext, "session" | "client" | "user" | "workspaceInfo" | "logger">;
export interface PluginSandboxOptions extends PluginTargeting {
    pluginPaths: string[];
    exportName?: string;
    importTimeoutMs?: number;
    hookTimeoutMs?: number;
    contributionTimeoutMs?: number;
    onEvent?: (event: {
        name: string;
        payload?: unknown;
    }) => void;
    /**
     * The session's working directory. Forwarded to the sandbox subprocess so
     * that `process.cwd()` returns the correct path inside the sandbox even
     * when `--cwd` was passed without calling `process.chdir()` on the host.
     */
    cwd?: string;
    /**
     * Structured workspace and git metadata (branch, commit, remotes) generated
     * at session startup. Forwarded to plugins via PluginSetupCtx.workspaceInfo
     * so they can inspect git state without running their own commands.
     */
    workspaceInfo?: WorkspaceInfo;
    session?: SandboxedPluginSetupContext["session"];
    client?: SandboxedPluginSetupContext["client"];
    user?: SandboxedPluginSetupContext["user"];
    /** Enables a logger bridge that forwards sandbox log calls to the host. */
    logger?: SandboxedPluginSetupContext["logger"];
}
export declare function loadSandboxedPlugins(options: PluginSandboxOptions): Promise<{
    extensions: AgentConfig["extensions"];
    shutdown: () => Promise<void>;
} & PluginLoadDiagnostics>;
