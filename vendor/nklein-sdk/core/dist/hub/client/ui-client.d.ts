import type { HubClientRecord, HubUINotifyPayload, HubUIShowWindowPayload, SessionRecord } from "@nklein/shared";
export interface HubUIClientOptions {
    address: string;
    authToken?: string;
    clientId?: string;
    clientType?: string;
    displayName?: string;
}
/**
 * A lightweight hub client for UI/notification concerns.
 * Used by the menu bar app and other UI clients to send/receive
 * UI events (notifications, show window, client tracking).
 */
export declare class HubUIClient {
    private readonly client;
    constructor(options: HubUIClientOptions);
    connect(): Promise<void>;
    close(): void;
    dispose(): Promise<void>;
    getClientId(): string;
    /**
     * Send a notification request to the hub.
     * The hub will broadcast a "ui.notify" event to all subscribers (e.g. the menu bar app).
     */
    sendNotify(payload: HubUINotifyPayload): Promise<void>;
    /**
     * Request the hub to broadcast a "ui.show_window" event to all subscribers.
     */
    sendShowWindow(payload?: HubUIShowWindowPayload): Promise<void>;
    listClients(): Promise<HubClientRecord[]>;
    listSessions(limit?: number): Promise<SessionRecord[]>;
    /**
     * Subscribe to UI-relevant hub events.
     * Returns an unsubscribe function.
     */
    subscribeUI(handlers: {
        onNotify?: (payload: HubUINotifyPayload) => void;
        onShowWindow?: (payload: HubUIShowWindowPayload) => void;
        onClientRegistered?: (payload: Record<string, unknown>) => void;
        onClientDisconnected?: (payload: Record<string, unknown>) => void;
        onSessionCreated?: (payload: Record<string, unknown>) => void;
        onSessionUpdated?: (payload: Record<string, unknown>) => void;
        onSessionDetached?: (payload: Record<string, unknown>) => void;
    }): () => void;
}
