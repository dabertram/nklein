import type { HubCommandEnvelope, HubReplyEnvelope } from "@nklein/shared";
import { type HubTransportContext } from "./context";
export declare function requestCapability(ctx: HubTransportContext, sessionId: string, capabilityName: string, payload: Record<string, unknown>, targetClientId: string, onProgress?: (payload: Record<string, unknown>) => void): Promise<Record<string, unknown> | undefined>;
export declare function handleCapabilityProgress(ctx: HubTransportContext, envelope: HubCommandEnvelope): HubReplyEnvelope;
export declare function cancelPendingCapabilityRequests(ctx: HubTransportContext, filter: (request: {
    requestId: string;
    sessionId: string;
    targetClientId: string;
    capabilityName: string;
}) => boolean, reason: string): number;
export declare function handleCapabilityRequest(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleCapabilityRespond(ctx: HubTransportContext, envelope: HubCommandEnvelope): HubReplyEnvelope;
