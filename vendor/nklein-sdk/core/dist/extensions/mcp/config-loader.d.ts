import type { McpManager, McpServerRegistration } from "./types";
export interface McpSettingsFile {
    mcpServers: Record<string, Omit<McpServerRegistration, "name">>;
}
export interface LoadMcpSettingsOptions {
    filePath?: string;
}
export interface RegisterMcpServersFromSettingsOptions {
    filePath?: string;
}
export declare function resolveDefaultMcpSettingsPath(): string;
export declare function loadMcpSettingsFile(options?: LoadMcpSettingsOptions): McpSettingsFile;
export declare function hasMcpSettingsFile(options?: LoadMcpSettingsOptions): boolean;
export declare function resolveMcpServerRegistrations(options?: LoadMcpSettingsOptions): McpServerRegistration[];
export declare function registerMcpServersFromSettingsFile(manager: Pick<McpManager, "registerServer">, options?: RegisterMcpServersFromSettingsOptions): Promise<McpServerRegistration[]>;
