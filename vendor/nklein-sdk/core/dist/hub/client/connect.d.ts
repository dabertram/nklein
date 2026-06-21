import type { HubCommandEnvelope, HubReplyEnvelope } from "@nklein/shared";
import { type HubEndpointOverrides } from "../discovery/defaults";
export interface HubConnection {
    send(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
    close(): void;
}
export interface HubCommandRequest extends Omit<HubCommandEnvelope, "version" | "clientId"> {
    version?: HubCommandEnvelope["version"];
    clientId?: string;
}
export declare function resolveHubUrl(overrides?: HubEndpointOverrides): Promise<string>;
export declare function connectToHub(url: string): Promise<HubConnection>;
export declare function probeHubConnection(url: string): Promise<boolean>;
export declare function sendHubCommand(overrides: HubEndpointOverrides, envelope: HubCommandRequest): Promise<HubReplyEnvelope>;
