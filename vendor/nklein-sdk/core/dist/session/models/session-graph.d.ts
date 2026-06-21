import type { HookEventPayload } from "../../hooks";
import type { SessionStatus } from "../../types/common";
export declare function sanitizeSessionToken(value: string): string;
export declare function makeSubSessionId(rootSessionId: string, agentId: string): string;
export declare function makeTeamTaskSubSessionId(rootSessionId: string, agentId: string): string;
export declare function parseTeamTaskSubSessionId(sessionId: string): {
    rootSessionId: string;
    agentId: string;
    teamTaskId: string;
} | null;
export declare function parseSubSessionId(sessionId: string): {
    rootSessionId: string;
    agentId: string;
} | null;
export declare function deriveSubsessionStatus(event: HookEventPayload): SessionStatus;
