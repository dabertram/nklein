import type { ToolApprovalRequest, ToolApprovalResult } from "@nklein/shared";
import type { ToolExecutors } from "../../extensions/tools";
export interface RuntimeCapabilities {
    toolExecutors?: Partial<ToolExecutors>;
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult> | ToolApprovalResult;
}
