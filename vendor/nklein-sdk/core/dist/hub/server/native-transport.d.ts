import type { HubCommandEnvelope, HubEventEnvelope, HubReplyEnvelope } from "@nklein/shared";
import type { HubCommandTransport } from "./command-transport";
export interface NativeHubTransport {
    handleCommand(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
    subscribe(clientId: string, listener: (event: HubEventEnvelope) => void, options?: {
        sessionId?: string;
    }): () => void;
}
export declare class NativeHubTransportAdapter implements HubCommandTransport {
    private readonly transport;
    constructor(transport: NativeHubTransport);
    command(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
    subscribe(clientId: string, listener: (event: HubEventEnvelope) => void, options?: {
        sessionId?: string;
    }): () => void;
}
