import type { AgentEvent, AgentTool } from "@nklein/shared";
import { type ToolExecutors } from "../../../extensions/tools";
import type { CoreSessionConfig } from "../../../types/config";
import type { ActiveSession } from "../../../types/session";
export type SubAgentStartTracker = Map<string, {
    startedAt: number;
    rootSessionId: string;
}>;
export interface SpawnToolDeps {
    getSession(sessionId: string): ActiveSession | undefined;
    subAgentStarts: SubAgentStartTracker;
    onAgentEvent(rootSessionId: string, config: CoreSessionConfig, event: AgentEvent): void;
    invokeBackendOptional(method: string, ...args: unknown[]): Promise<void>;
}
export declare function createSessionSpawnTool(deps: SpawnToolDeps, config: CoreSessionConfig, rootSessionId: string, toolExecutors?: Partial<ToolExecutors>): AgentTool;
