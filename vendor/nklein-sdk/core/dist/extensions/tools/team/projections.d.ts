import type { TeamProgressLifecycleEvent, TeamProgressSummary, TeamRuntimeState } from "@nklein/shared";
import type { TeamEvent } from "./multi-agent";
export declare function buildTeamProgressSummary(teamName: string, state: TeamRuntimeState): TeamProgressSummary;
export declare function toTeamProgressLifecycleEvent(input: {
    teamName: string;
    sessionId: string;
    event: TeamEvent;
}): TeamProgressLifecycleEvent;
