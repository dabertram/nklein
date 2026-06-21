import type { TeamTeammateSpec } from "@nklein/shared";
import type { AgentTeamsRuntime } from "../../extensions/tools/team";
import type { SessionSource, SessionStatus } from "../../types/common";
import type { SessionManifest } from "./session-manifest";
export interface SessionRow {
    sessionId: string;
    source: string;
    pid: number;
    startedAt: string;
    endedAt?: string | null;
    exitCode?: number | null;
    status: SessionStatus;
    statusLock: number;
    interactive: boolean;
    provider: string;
    model: string;
    cwd: string;
    workspaceRoot: string;
    teamName?: string | null;
    enableTools: boolean;
    enableSpawn: boolean;
    enableTeams: boolean;
    parentSessionId?: string | null;
    parentAgentId?: string | null;
    agentId?: string | null;
    conversationId?: string | null;
    isSubagent: boolean;
    prompt?: string | null;
    metadata?: Record<string, unknown> | null;
    hookPath?: string;
    messagesPath?: string | null;
    updatedAt: string;
}
export interface CreateRootSessionInput {
    sessionId: string;
    source: SessionSource;
    pid: number;
    startedAt: string;
    interactive: boolean;
    provider: string;
    model: string;
    cwd: string;
    workspaceRoot: string;
    teamName?: string;
    enableTools: boolean;
    enableSpawn: boolean;
    enableTeams: boolean;
    prompt?: string;
    metadata?: Record<string, unknown>;
    messagesPath: string;
}
export interface CreateRootSessionWithArtifactsInput {
    sessionId: string;
    source: SessionSource;
    pid: number;
    interactive: boolean;
    provider: string;
    model: string;
    cwd: string;
    workspaceRoot: string;
    teamName?: string;
    enableTools: boolean;
    enableSpawn: boolean;
    enableTeams: boolean;
    prompt?: string;
    metadata?: Record<string, unknown>;
    startedAt?: string;
}
export interface RootSessionArtifacts {
    manifestPath: string;
    messagesPath: string;
    manifest: SessionManifest;
}
export interface UpsertSubagentInput {
    agentId: string;
    parentAgentId: string;
    conversationId: string;
    prompt?: string;
    rootSessionId?: string;
}
/** SELECT clause that aliases snake_case columns to camelCase SessionRow keys. */
export declare const SESSION_SELECT_COLUMNS = "\n\tsession_id    AS sessionId,\n\tsource,\n\tpid,\n\tstarted_at    AS startedAt,\n\tended_at      AS endedAt,\n\texit_code     AS exitCode,\n\tstatus,\n\tstatus_lock   AS statusLock,\n\tinteractive,\n\tprovider,\n\tmodel,\n\tcwd,\n\tworkspace_root AS workspaceRoot,\n\tteam_name      AS teamName,\n\tenable_tools   AS enableTools,\n\tenable_spawn   AS enableSpawn,\n\tenable_teams   AS enableTeams,\n\tparent_session_id AS parentSessionId,\n\tparent_agent_id   AS parentAgentId,\n\tagent_id       AS agentId,\n\tconversation_id AS conversationId,\n\tis_subagent    AS isSubagent,\n\tprompt,\n\tmetadata_json  AS metadata,\n\thook_path       AS hookPath,\n\tmessages_path   AS messagesPath,\n\tupdated_at      AS updatedAt";
export declare function patchSqliteRow(raw: Record<string, unknown>): SessionRow;
export declare function stringifyMetadata(metadata: Record<string, unknown> | null | undefined): string | null;
export type TeamRuntimeState = ReturnType<AgentTeamsRuntime["exportState"]>;
export interface PersistedTeamEnvelope {
    version: 1;
    updatedAt: string;
    teamState: TeamRuntimeState;
    teammates: TeamTeammateSpec[];
}
export declare function reviveTeamStateDates(state: TeamRuntimeState): TeamRuntimeState;
