import type { HubCommandEnvelope, HubReplyEnvelope, ToolApprovalRequest } from "@nklein/shared";
import { type HubTransportContext } from "./context";
export declare function handleSessionCreate(ctx: HubTransportContext, envelope: HubCommandEnvelope, requestToolApproval: (request: ToolApprovalRequest) => Promise<{
    approved: boolean;
    reason?: string;
}>): Promise<HubReplyEnvelope>;
export declare function handleSessionRestore(ctx: HubTransportContext, envelope: HubCommandEnvelope, requestToolApproval: (request: ToolApprovalRequest) => Promise<{
    approved: boolean;
    reason?: string;
}>): Promise<HubReplyEnvelope>;
export declare function handleSessionAttach(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionDetach(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionGet(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionMessages(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionList(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionUpdate(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionDelete(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionPendingPrompts(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionUpdatePendingPrompt(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
export declare function handleSessionRemovePendingPrompt(ctx: HubTransportContext, envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
