import type { HubCommandEnvelope, HubReplyEnvelope, ToolApprovalRequest } from "@nklein/shared";
import { type HubTransportContext } from "./context";
export declare function requestToolApproval(ctx: HubTransportContext, request: ToolApprovalRequest): Promise<{
    approved: boolean;
    reason?: string;
}>;
export declare function resolvePendingApproval(ctx: HubTransportContext, approvalId: string, result: {
    approved: boolean;
    reason?: string;
}): {
    sessionId: string;
} | undefined;
export declare function cancelPendingApprovals(ctx: HubTransportContext, filter: (approval: {
    approvalId: string;
    sessionId: string;
}) => boolean, reason: string): number;
export declare function handleApprovalRespond(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
