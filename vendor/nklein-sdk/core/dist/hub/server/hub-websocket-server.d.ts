import type { EnsuredHubWebSocketServerResult, EnsureHubWebSocketServerOptions, HubWebSocketServer, HubWebSocketServerOptions } from "./hub-server-options";
export { truncateNotificationBody } from "./hub-notifications";
export type { EnsuredHubWebSocketServerResult, EnsureHubWebSocketServerOptions, HubWebSocketServer, HubWebSocketServerOptions, } from "./hub-server-options";
export { HubServerTransport } from "./hub-server-transport";
export declare function startHubWebSocketServer(options: HubWebSocketServerOptions): Promise<HubWebSocketServer>;
export declare function ensureHubWebSocketServer(options: EnsureHubWebSocketServerOptions): Promise<EnsuredHubWebSocketServerResult>;
