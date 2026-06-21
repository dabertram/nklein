import type { AgentEvent } from "@nklein/shared";
import type { SessionAccumulatedUsage } from "../runtime/host/runtime-host";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { ActiveSession } from "../types/session";
import { type TelemetryAgentIdentityProperties } from "./telemetry/core-events";
export declare function extractSkillNameFromToolInput(input: unknown): string | undefined;
export interface AgentEventContext {
    sessionId: string;
    config: CoreSessionConfig;
    liveSession: ActiveSession | undefined;
    usageBySession: Map<string, SessionAccumulatedUsage>;
    persistMessages: (sessionId: string, messages: unknown[], systemPrompt?: string) => void;
    emit: (event: CoreSessionEvent) => void;
}
export interface AgentTelemetryContextOverrides {
    agentId?: string;
    conversationId?: string;
    parentAgentId?: string | null;
    createdByAgentId?: string;
    teamId?: string;
    teamName?: string;
    teamRole?: "lead" | "teammate";
    teamAgentId?: string;
    isPrimaryAgentEvent?: boolean;
}
export declare function extractAgentEventMetadata(event: AgentEvent): {
    agentId?: string;
    conversationId?: string;
    parentAgentId?: string;
};
export declare function buildTelemetryAgentIdentity(context: AgentTelemetryContextOverrides): TelemetryAgentIdentityProperties | undefined;
export declare function handleAgentEvent(ctx: AgentEventContext, event: AgentEvent, overrides?: AgentTelemetryContextOverrides): void;
