import type { HubCommandTransport } from "./command-transport";
export interface BrowserHubSocketLike {
    send(data: string): void;
    addEventListener(type: "message", listener: (event: {
        data: string;
    }) => void): void;
    addEventListener(type: "close", listener: () => void): void;
    removeEventListener(type: "message", listener: (event: {
        data: string;
    }) => void): void;
    removeEventListener(type: "close", listener: () => void): void;
}
export declare class BrowserWebSocketHubAdapter {
    private readonly transport;
    constructor(transport: HubCommandTransport);
    attach(socket: BrowserHubSocketLike): () => void;
}
