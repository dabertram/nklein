export interface OAuthCallbackPayload {
    url: URL;
    code?: string;
    state?: string;
    provider?: string;
    error?: string;
}
export interface OAuthServerListeningInfo {
    host: string;
    port: number;
    callbackUrl: string;
}
export interface OAuthServerCloseInfo {
    host: string;
    port: number;
}
export interface LocalOAuthServerOptions {
    host?: string;
    ports: number[];
    callbackPath: string;
    timeoutMs?: number;
    expectedState?: string;
    successHtml?: string;
    /**
     * Called when the local redirect server successfully binds to a port and is
     * ready to receive the OAuth callback. Hosts can use this to display a
     * "waiting for callback" status indicator or — in remote-development
     * environments like JetBrains Gateway — to forward the port from the remote
     * machine to the local machine where the user's browser is running.
     *
     * May be async; `startLocalOAuthServer` will **await** this callback before
     * returning so that any setup it performs (e.g. port-forwarding) is
     * guaranteed to complete before the caller opens the auth URL. Errors
     * thrown by this callback are swallowed — they do not prevent the OAuth
     * flow from proceeding.
     */
    onListening?: (info: OAuthServerListeningInfo) => void | Promise<void>;
    /**
     * Called when the local redirect server closes, either because the OAuth
     * callback was received, the flow was cancelled, or the timeout elapsed.
     * Hosts should use this to tear down any port-forward set up in
     * `onListening` and clear any "waiting for callback" status UI.
     *
     * May be async; fired after the underlying server socket is closed.
     */
    onClose?: (info: OAuthServerCloseInfo) => void | Promise<void>;
}
export interface LocalOAuthServer {
    callbackUrl: string;
    waitForCallback: () => Promise<OAuthCallbackPayload | null>;
    cancelWait: () => void;
    close: () => void;
}
export declare function startLocalOAuthServer(options: LocalOAuthServerOptions): Promise<LocalOAuthServer>;
