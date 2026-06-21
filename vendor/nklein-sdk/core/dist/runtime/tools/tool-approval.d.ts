import type { ToolApprovalRequest, ToolApprovalResult } from "@nklein/shared";
export type DesktopToolApprovalOptions = {
    approvalDir?: string;
    sessionId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
    nowIso?: () => string;
};
export declare function requestDesktopToolApproval(request: ToolApprovalRequest, options?: DesktopToolApprovalOptions): Promise<ToolApprovalResult>;
