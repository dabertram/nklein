import type { AgentEvent, BasicLogger } from "@nklein/shared";
import type { TeamEvent } from "../../../extensions/tools/team";
import { type AgentEventContext } from "../../../services/agent-events";
import type { CoreSessionConfig } from "../../../types/config";
import type { CoreSessionEvent } from "../../../types/events";
import type { ActiveSession } from "../../../types/session";
import type { SessionAccumulatedUsage } from "../runtime-host";
export interface AgentEventBridgeDeps {
    getSession(sessionId: string): ActiveSession | undefined;
    usageBySession: Map<string, SessionAccumulatedUsage>;
    emit(event: CoreSessionEvent): void;
    persistMessages: AgentEventContext["persistMessages"];
    enqueuePendingPrompt(sessionId: string, entry: {
        prompt: string;
        delivery: "queue" | "steer";
    }): void;
    invokeBackendOptional(method: string, ...args: unknown[]): Promise<void>;
}
export declare class AgentEventBridge {
    private readonly deps;
    constructor(deps: AgentEventBridgeDeps);
    dispatchAgentEvent(sessionId: string, config: CoreSessionConfig, event: AgentEvent): void;
    handleTeamEvent(rootSessionId: string, event: TeamEvent): Promise<void>;
    handlePluginEvent(rootSessionId: string, event: {
        name: string;
        payload?: unknown;
    }, fallbackAutomation?: NonNullable<CoreSessionConfig["extensionContext"]>["automation"]): Promise<void>;
    handlePluginLog(rootSessionId: string, payload: unknown, fallbackLogger?: BasicLogger): void;
}
