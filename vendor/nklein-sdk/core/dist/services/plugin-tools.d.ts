export interface PluginToolSummary {
    name: string;
    pluginName: string;
    path: string;
    source: "workspace-plugin" | "global-plugin";
    enabled: boolean;
    description?: string;
}
export declare function listPluginTools(input: {
    workspacePath: string;
    cwd?: string;
    disabledToolNames?: ReadonlyArray<string>;
    providerId?: string;
    modelId?: string;
}): Promise<PluginToolSummary[]>;
