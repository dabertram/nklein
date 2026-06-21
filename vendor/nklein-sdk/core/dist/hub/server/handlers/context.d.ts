import type { HubClientRecord, HubCommandEnvelope, HubEventEnvelope, HubReplyEnvelope, SessionRecord as HubSessionRecord, JsonValue, SessionParticipant } from "@nklein/shared";
import type { PendingPromptsRuntimeService, RuntimeHost, SessionUsageRuntimeService } from "../../../runtime/host/runtime-host";
import { type CoreSessionSnapshot } from "../../../session/session-snapshot";
import { type HubSessionState } from "../hub-session-records";
export type PendingApproval = {
    sessionId: string;
    resolve: (result: {
        approved: boolean;
        reason?: string;
    }) => void;
};
export type PendingCapabilityRequest = {
    sessionId: string;
    targetClientId: string;
    capabilityName: string;
    onProgress?: (payload: Record<string, unknown>) => void;
    resolve: (result: {
        ok: boolean;
        payload?: Record<string, unknown>;
        error?: string;
    }) => void;
};
/**
 * Shared mutable state and helpers passed to every command-handler module.
 * The transport class owns the maps; handlers get a stable read/write surface.
 */
export interface HubTransportContext {
    readonly clients: Map<string, HubClientRecord>;
    readonly sessionState: Map<string, HubSessionState>;
    readonly pendingApprovals: Map<string, PendingApproval>;
    readonly pendingCapabilityRequests: Map<string, PendingCapabilityRequest>;
    readonly suppressNextTerminalEventBySession: Map<string, string>;
    readonly sessionHost: RuntimeHost & Partial<PendingPromptsRuntimeService & SessionUsageRuntimeService>;
    publish(event: HubEventEnvelope): void;
    buildEvent(event: HubEventEnvelope["event"], payload?: Record<string, unknown>, sessionId?: string): HubEventEnvelope;
    requestCapability(sessionId: string, capabilityName: string, payload: Record<string, unknown>, targetClientId: string, onProgress?: (payload: Record<string, unknown>) => void): Promise<Record<string, unknown> | undefined>;
}
type EnvelopeRef = Pick<HubCommandEnvelope, "version" | "requestId">;
export declare function okReply(envelope: EnvelopeRef, payload?: HubReplyEnvelope["payload"]): HubReplyEnvelope;
export declare function errorReply(envelope: EnvelopeRef, code: string, message: string): HubReplyEnvelope;
/** Returns the value when it's a plain object, or undefined otherwise. */
export declare function asPlainRecord(value: unknown): Record<string, JsonValue | undefined> | undefined;
/**
 * Pulls the session id from the envelope. Handlers accept either
 * `payload.sessionId` (top-level command argument) or `envelope.sessionId`
 * (envelope-level addressing). Returns "" when neither is present so handlers
 * can branch on truthiness.
 */
export declare function extractSessionId(envelope: HubCommandEnvelope): string;
export declare function buildHubEvent(event: HubEventEnvelope["event"], payload?: Record<string, unknown>, sessionId?: string): HubEventEnvelope;
export declare function readHubSessionRecord(ctx: HubTransportContext, sessionId: string): Promise<HubSessionRecord | undefined>;
export declare function readCoreSessionSnapshot(ctx: HubTransportContext, sessionId: string): Promise<CoreSessionSnapshot | undefined>;
export declare function ensureSessionState(ctx: HubTransportContext, sessionId: string, clientId: string, role: SessionParticipant["role"], options?: {
    interactive?: boolean;
}): HubSessionState;
export {};
