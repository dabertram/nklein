import type { CoreAgentMode } from "../../types/config";
import type { DefaultToolName, DefaultToolsConfig } from "./types";
export interface ToolRoutingRule {
    /**
     * Optional rule label for debugging and logs.
     */
    name?: string;
    /**
     * Which mode the rule applies to.
     * @default "any"
     */
    mode?: CoreAgentMode | "any";
    /**
     * Case-insensitive substrings that must match the model ID.
     * When omitted/empty, the rule is not constrained by model ID.
     */
    modelIdIncludes?: string[];
    /**
     * Case-insensitive substrings that must match the provider ID.
     * When omitted/empty, the rule is not constrained by provider ID.
     */
    providerIdIncludes?: string[];
    /**
     * Enable these tools when the rule matches.
     */
    enableTools?: DefaultToolName[];
    /**
     * Disable these tools when the rule matches.
     */
    disableTools?: DefaultToolName[];
}
export declare const DEFAULT_MODEL_TOOL_ROUTING_RULES: ToolRoutingRule[];
export declare function resolveToolRoutingConfig(providerId: string, modelId: string, mode: CoreAgentMode, rules: ToolRoutingRule[] | undefined): Partial<DefaultToolsConfig>;
