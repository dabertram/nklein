import type { AgentHooks, HubClientContribution } from "@nklein/shared";
export { HUB_CHECKPOINT_CAPABILITY, HUB_COMPACTION_CAPABILITY, HUB_CUSTOM_TOOL_CAPABILITY_PREFIX, HUB_HOOK_CAPABILITY_PREFIX, HUB_MISTAKE_LIMIT_CAPABILITY, HUB_TOOL_EXECUTOR_CAPABILITY_PREFIX, HUB_USER_INSTRUCTIONS_SNAPSHOT_CAPABILITY, } from "@nklein/shared";
import type { ToolExecutors } from "../../extensions/tools";
import type { LocalRuntimeStartOptions, RuntimeSessionConfig } from "../../runtime/host/runtime-host";
type RequestCapability = (sessionId: string, capabilityName: string, payload: Record<string, unknown>, targetClientId: string, onProgress?: (payload: Record<string, unknown>) => void) => Promise<Record<string, unknown> | undefined>;
export declare function listHubAgentHookNames(hooks: AgentHooks | undefined): string[];
export declare function parseHubClientContributions(value: unknown): HubClientContribution[];
export declare function createHubClientContributionRuntime(input: {
    sessionId: string;
    targetClientId: string;
    contributions: readonly HubClientContribution[];
    sessionConfig?: Partial<RuntimeSessionConfig>;
    requestCapability: RequestCapability;
}): {
    localRuntime: LocalRuntimeStartOptions;
    toolExecutors?: Partial<ToolExecutors>;
    hasClientContributions: boolean;
};
export declare function defaultClientContributionCapabilityName(contribution: Pick<HubClientContribution, "kind"> & Record<string, unknown>): string | undefined;
