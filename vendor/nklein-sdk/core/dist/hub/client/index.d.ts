import { type HubCommandEnvelope, type HubEventEnvelope, type HubReplyEnvelope } from "@nklein/shared";
export interface HubClientOptions {
    url: string;
    clientId?: string;
    clientType?: string;
    displayName?: string;
    workspaceRoot?: string;
    cwd?: string;
    authToken?: string;
}
export interface LocalHubResolutionOptions {
    endpoint?: string;
    strategy?: "prefer-hub" | "require-hub";
    workspaceRoot?: string;
    cwd?: string;
}
export type HubTransportErrorCode = "hub_connect_timeout" | "hub_connect_failed" | "hub_connection_closed" | "hub_connection_not_open";
export declare class HubTransportError extends Error {
    readonly code: HubTransportErrorCode;
    readonly details?: {
        closeCode?: number;
        closeReason?: string;
    } | undefined;
    constructor(code: HubTransportErrorCode, message: string, details?: {
        closeCode?: number;
        closeReason?: string;
    } | undefined);
}
export declare function isHubReconnectableTransportError(error: unknown): error is HubTransportError;
export declare class HubCommandError extends Error {
    readonly command: HubCommandEnvelope["command"];
    readonly code: string | undefined;
    constructor(command: HubCommandEnvelope["command"], code: string | undefined, message: string);
}
export declare function isHubCommandTimeoutError(error: unknown, command?: HubCommandEnvelope["command"]): boolean;
export declare function rememberRecoverableLocalHubUrl(url: string, authToken?: string): string;
export declare class NodeHubClient {
    private readonly options;
    private socket;
    private connectPromise;
    private readonly clientId;
    private currentUrl;
    private recoveryPromise;
    private readonly pendingReplies;
    private readonly listeners;
    private readonly subscriptionCounts;
    private reconnectTimer;
    private reconnectAttempt;
    private closedByClient;
    private lastCloseError;
    private sawSocketClose;
    private registered;
    constructor(options: HubClientOptions);
    getClientId(): string;
    getUrl(): string;
    connect(): Promise<void>;
    subscribe(listener: (event: HubEventEnvelope) => void, options?: {
        sessionId?: string;
    }): () => void;
    command(command: HubCommandEnvelope["command"], payload?: Record<string, unknown>, sessionId?: string, options?: {
        timeoutMs?: number | null;
    }): Promise<HubReplyEnvelope>;
    private commandOnce;
    private recoverLocalHubTransport;
    private hasActiveSubscriptions;
    private clearReconnectTimer;
    private scheduleReconnect;
    private reconnectSubscribedTransport;
    close(): void;
    dispose(): Promise<void>;
    private sendFrame;
    private sendSubscriptionFrame;
    private adjustSubscriptionCount;
    private subscriptionKeyForSessionId;
    private subscriptionSessionIdFromKey;
    private handleFrame;
}
export declare function normalizeHubWebSocketUrl(url: string): string;
export declare function verifyHubConnection(url: string, options?: Pick<HubClientOptions, "workspaceRoot" | "cwd" | "authToken">): Promise<boolean>;
export declare function resolveCompatibleLocalHubUrl(options?: LocalHubResolutionOptions): Promise<string | undefined>;
export declare function ensureCompatibleLocalHubUrl(options?: LocalHubResolutionOptions): Promise<string | undefined>;
export declare function requestHubShutdown(url: string, authToken?: string): Promise<boolean>;
export declare function stopLocalHubServerGracefully(): Promise<boolean>;
export declare function restartLocalHubIfIdleAfterStartupTimeout(options: {
    url: string;
    workspaceRoot?: string;
    cwd?: string;
}): Promise<string | undefined>;
