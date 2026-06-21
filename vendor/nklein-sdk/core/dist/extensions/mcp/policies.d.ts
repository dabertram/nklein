import type { ToolPolicy } from "@nklein/shared";
import type { McpToolNameTransform } from "./types";
export interface CreateDisabledMcpToolPolicyOptions {
    serverName: string;
    toolName: string;
    nameTransform?: McpToolNameTransform;
}
export interface CreateDisabledMcpToolPoliciesOptions {
    serverName: string;
    toolNames: readonly string[];
    nameTransform?: McpToolNameTransform;
}
export declare function createDisabledMcpToolPolicy(options: CreateDisabledMcpToolPolicyOptions): Record<string, ToolPolicy>;
export declare function createDisabledMcpToolPolicies(options: CreateDisabledMcpToolPoliciesOptions): Record<string, ToolPolicy>;
