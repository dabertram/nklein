import { type AgentTool, type TeamRuntimeState, type TeamTeammateSpec } from "@nklein/shared";
import { type DelegatedAgentConfigProvider, type DelegatedAgentRuntimeConfig } from "./delegated-agent";
import type { AgentTeamsRuntime } from "./multi-agent";
export type TeamTeammateRuntimeConfig = DelegatedAgentRuntimeConfig;
export interface CreateAgentTeamsToolsOptions {
    runtime: AgentTeamsRuntime;
    requesterId: string;
    teammateConfigProvider: DelegatedAgentConfigProvider;
    createBaseTools?: () => AgentTool[];
    allowSpawn?: boolean;
    includeSpawnTool?: boolean;
    includeManagementTools?: boolean;
    onLeadToolsUnlocked?: (tools: AgentTool[]) => void;
}
export interface BootstrapAgentTeamsOptions {
    runtime: AgentTeamsRuntime;
    teammateConfigProvider: DelegatedAgentConfigProvider;
    createBaseTools?: () => AgentTool[];
    leadAgentId?: string;
    restoredTeammates?: TeamTeammateSpec[];
    restoredFromPersistence?: boolean;
    includeLeadSpawnTool?: boolean;
    includeLeadManagementTools?: boolean;
    onLeadToolsUnlocked?: (tools: AgentTool[]) => void;
}
export interface BootstrapAgentTeamsResult {
    tools: AgentTool[];
    restoredFromPersistence: boolean;
    restoredTeammates: string[];
}
export declare const TEAM_TOOL_NAMES: readonly ["team_spawn_teammate", "team_shutdown_teammate", "team_status", "team_task", "team_run_task", "team_cancel_run", "team_list_runs", "team_await_runs", "team_send_message", "team_broadcast", "team_read_mailbox", "team_mission_log", "team_cleanup", "team_create_outcome", "team_attach_outcome_fragment", "team_review_outcome_fragment", "team_finalize_outcome", "team_list_outcomes"];
export declare function bootstrapAgentTeams(options: BootstrapAgentTeamsOptions): BootstrapAgentTeamsResult;
export declare function createAgentTeamsTools(options: CreateAgentTeamsToolsOptions): AgentTool[];
export declare function reviveTeamStateDates(state: TeamRuntimeState): TeamRuntimeState;
export declare function sanitizeTeamName(name: string): string;
