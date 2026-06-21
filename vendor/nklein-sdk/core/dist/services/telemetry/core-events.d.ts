import type { ITelemetryService, TelemetryProperties } from "@nklein/shared";
export type TelemetryAgentKind = "root" | "subagent" | "team_lead" | "team_teammate";
export interface TelemetryAgentIdentityProperties {
    agentId: string;
    agentKind: TelemetryAgentKind;
    conversationId?: string;
    parentAgentId?: string;
    createdByAgentId?: string;
    isSubagent: boolean;
    teamId?: string;
    teamName?: string;
    teamRole?: "lead" | "teammate";
    teamAgentId?: string;
}
export declare const CORE_TELEMETRY_EVENTS: {
    readonly CLIENT: {
        readonly EXTENSION_ACTIVATED: "user.extension_activated";
    };
    readonly SESSION: {
        readonly STARTED: "session.started";
        readonly ENDED: "session.ended";
    };
    readonly USER: {
        readonly AUTH_STARTED: "user.auth_started";
        readonly AUTH_SUCCEEDED: "user.auth_succeeded";
        readonly AUTH_FAILED: "user.auth_failed";
        readonly AUTH_LOGGED_OUT: "user.auth_logged_out";
        readonly TELEMETRY_OPT_OUT: "user.opt_out";
    };
    readonly TASK: {
        readonly CREATED: "task.created";
        readonly RESTARTED: "task.restarted";
        readonly COMPLETED: "task.completed";
        readonly CONVERSATION_TURN: "task.conversation_turn";
        readonly TOKEN_USAGE: "task.tokens";
        readonly MODE_SWITCH: "task.mode";
        readonly TOOL_USED: "task.tool_used";
        readonly SKILL_USED: "task.skill_used";
        readonly DIFF_EDIT_FAILED: "task.diff_edit_failed";
        readonly PROVIDER_API_ERROR: "task.provider_api_error";
        readonly MENTION_USED: "task.mention_used";
        readonly MENTION_FAILED: "task.mention_failed";
        readonly MENTION_SEARCH_RESULTS: "task.mention_search_results";
        readonly AGENT_CREATED: "task.agent_created";
        readonly AGENT_TEAM_CREATED: "task.agent_team_created";
        readonly SUBAGENT_STARTED: "task.subagent_started";
        readonly SUBAGENT_COMPLETED: "task.subagent_completed";
    };
    readonly HOOKS: {
        readonly DISCOVERY_COMPLETED: "hooks.discovery_completed";
    };
    readonly WORKSPACE: {
        readonly INITIALIZED: "workspace.initialized";
        readonly INIT_ERROR: "workspace.init_error";
        readonly PATH_RESOLVED: "workspace.path_resolved";
    };
};
export interface WorkspaceInitializedProperties {
    root_count: number;
    vcs_types: ReadonlyArray<string>;
    init_duration_ms?: number;
    feature_flag_enabled?: boolean;
    is_remote_workspace?: boolean;
}
export interface WorkspaceInitErrorProperties {
    fallback_to_single_root: boolean;
    workspace_count?: number;
}
export interface WorkspacePathResolvedProperties {
    ulid: string;
    context: string;
    resolution_type: "hint_provided" | "fallback_to_primary" | "cross_workspace_search";
    hint_type?: "workspace_name" | "workspace_path" | "invalid";
    resolution_success?: boolean;
    target_workspace_index?: number;
    is_multi_root_enabled?: boolean;
}
export declare function captureExtensionActivated(telemetry: ITelemetryService | undefined): void;
export declare function captureWorkspaceInitialized(telemetry: ITelemetryService | undefined, properties: WorkspaceInitializedProperties): void;
export declare function captureWorkspaceInitError(telemetry: ITelemetryService | undefined, error: Error | string, properties: WorkspaceInitErrorProperties): void;
export declare function captureWorkspacePathResolved(telemetry: ITelemetryService | undefined, properties: WorkspacePathResolvedProperties): void;
export declare function captureAuthStarted(telemetry: ITelemetryService | undefined, provider?: string): void;
export declare function captureAuthSucceeded(telemetry: ITelemetryService | undefined, provider?: string): void;
export declare function captureAuthFailed(telemetry: ITelemetryService | undefined, provider?: string, errorMessage?: string): void;
export declare function captureAuthLoggedOut(telemetry: ITelemetryService | undefined, provider?: string, reason?: string): void;
export declare function captureTelemetryOptOut(telemetry: ITelemetryService | undefined, properties?: TelemetryProperties): void;
export declare function identifyAccount(telemetry: ITelemetryService | undefined, account: {
    id?: string;
    email?: string;
    provider?: string;
    organizationId?: string;
    organizationName?: string;
    memberId?: string;
}): void;
export declare function captureTaskCreated(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    apiProvider?: string;
    openAiCompatibleDomain?: string;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureTaskRestarted(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    apiProvider?: string;
    openAiCompatibleDomain?: string;
} & Partial<TelemetryAgentIdentityProperties>): void;
/**
 * Distinguishes the trigger that produced a `task.completed` telemetry event.
 *
 * - `submit_and_exit`: the assistant explicitly declared completion by
 *   invoking the canonical completion tool. Parity with original NKlein's
 *   `attempt_completion`-anchored emission.
 * - `shutdown`: the session lifecycle completed (typically a non-interactive
 *   single-run that finished without an explicit completion tool). Acts as a
 *   safety-net so we still report completed runs that never observed
 *   `submit_and_exit`.
 */
export type TaskCompletedSource = "submit_and_exit" | "shutdown";
export declare function captureTaskCompleted(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    provider?: string;
    modelId?: string;
    mode?: string;
    durationMs?: number;
    source?: TaskCompletedSource;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureConversationTurnEvent(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    provider?: string;
    model?: string;
    source: "user" | "assistant";
    mode?: string;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureTokenUsage(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    tokensIn: number;
    tokensOut: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
    totalCost?: number;
    model: string;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureModeSwitch(telemetry: ITelemetryService | undefined, ulid: string, mode?: string): void;
export declare function captureToolUsage(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    tool: string;
    modelId?: string;
    provider?: string;
    autoApproved?: boolean;
    success: boolean;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureSkillUsed(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    skillName: string;
    skillSource: "global" | "project";
    skillsAvailableGlobal: number;
    skillsAvailableProject: number;
    provider?: string;
    modelId?: string;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureDiffEditFailure(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    modelId?: string;
    provider?: string;
    errorType?: string;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureProviderApiError(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    model: string;
    errorMessage: string;
    provider?: string;
    errorStatus?: number;
    requestId?: string;
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureMentionUsed(telemetry: ITelemetryService | undefined, mentionType: "file" | "folder" | "url" | "problems" | "terminal" | "git-changes" | "commit", contentLength?: number): void;
export declare function captureMentionFailed(telemetry: ITelemetryService | undefined, mentionType: "file" | "folder" | "url" | "problems" | "terminal" | "git-changes" | "commit", errorType: "not_found" | "permission_denied" | "network_error" | "parse_error" | "unknown", errorMessage?: string): void;
export declare function captureMentionSearchResults(telemetry: ITelemetryService | undefined, query: string, resultCount: number, searchType: "file" | "folder" | "all", isEmpty: boolean): void;
export declare function captureAgentCreated(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    modelId?: string;
    provider?: string;
} & TelemetryAgentIdentityProperties): void;
export declare function captureAgentTeamCreated(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    teamId: string;
    teamName: string;
    leadAgentId?: string;
    restoredFromPersistence?: boolean;
}): void;
export declare function captureSubagentExecution(telemetry: ITelemetryService | undefined, properties: {
    ulid: string;
    durationMs: number;
    outputLines?: number;
    event: "created" | "started" | "ended";
    agentId: string;
    parentId?: string;
    errorMessage?: string;
    type?: "agent" | "team";
} & Partial<TelemetryAgentIdentityProperties>): void;
export declare function captureHookDiscovery(telemetry: ITelemetryService | undefined, hookName: string, globalCount: number, workspaceCount: number): void;
