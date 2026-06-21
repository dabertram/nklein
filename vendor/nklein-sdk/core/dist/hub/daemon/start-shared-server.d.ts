import { type EnsuredHubWebSocketServerResult, type EnsureHubWebSocketServerOptions, type HubWebSocketServer, type HubWebSocketServerOptions } from "../server";
export type HubServer = HubWebSocketServer;
export type EnsureHubServerResult = EnsuredHubWebSocketServerResult;
export interface StartHubServerOptions extends Omit<HubWebSocketServerOptions, "owner"> {
}
export interface EnsureHubServerOptions extends Omit<EnsureHubWebSocketServerOptions, "owner"> {
}
/**
 * Start a hub WebSocket server bound to the process-local shared owner
 * context. Callers that need a custom owner should invoke
 * {@link startHubWebSocketServer} directly.
 */
export declare function startHubServer(options: StartHubServerOptions): Promise<HubServer>;
/**
 * Ensure a hub WebSocket server is running in the process-local shared owner
 * context, reusing a compatible in-process instance when available.
 */
export declare function ensureHubServer(options: EnsureHubServerOptions): Promise<EnsureHubServerResult>;
