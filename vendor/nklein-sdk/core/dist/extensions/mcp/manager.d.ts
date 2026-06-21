import type { McpManager, McpManagerOptions, McpServerRegistration, McpServerSnapshot, McpToolCallRequest, McpToolCallResult, McpToolDescriptor } from "./types";
export declare class InMemoryMcpManager implements McpManager {
    private readonly toolsCacheTtlMs;
    private readonly clientFactory;
    private readonly servers;
    private readonly operationLocks;
    constructor(options: McpManagerOptions);
    registerServer(registration: McpServerRegistration): Promise<void>;
    unregisterServer(serverName: string): Promise<void>;
    connectServer(serverName: string): Promise<void>;
    disconnectServer(serverName: string): Promise<void>;
    setServerDisabled(serverName: string, disabled: boolean): Promise<void>;
    listServers(): readonly McpServerSnapshot[];
    listTools(serverName: string): Promise<readonly McpToolDescriptor[]>;
    refreshTools(serverName: string): Promise<readonly McpToolDescriptor[]>;
    callTool(request: McpToolCallRequest): Promise<McpToolCallResult>;
    dispose(): Promise<void>;
    private ensureConnectedClient;
    private connectState;
    private disconnectState;
    private requireServer;
    private runExclusive;
}
