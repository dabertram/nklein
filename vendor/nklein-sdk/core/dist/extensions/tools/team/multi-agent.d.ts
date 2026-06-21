/**
 * Multi-Agent Coordination
 *
 * Utilities for orchestrating multiple agents working together.
 */
import { type AgentConfig, type AgentEvent, type AgentResult, type AppendMissionLogInput, type AttachTeamOutcomeFragmentInput, type CreateTeamOutcomeInput, type CreateTeamTaskInput, type MissionLogEntry, type ReviewTeamOutcomeFragmentInput, type RouteToTeammateOptions, type TeamMailboxMessage, type TeamMemberSnapshot, TeamMessageType, type TeammateLifecycleSpec, type TeamOutcome, type TeamOutcomeFragment, type TeamRunRecord, type TeamRunStatus, type TeamRuntimeSnapshot, type TeamRuntimeState, type TeamTask, type TeamTaskListItem, type TeamTaskStatus } from "@nklein/shared";
import { SessionRuntime } from "../../../runtime/orchestration/session-runtime-orchestrator";
export { type AppendMissionLogInput, type AttachTeamOutcomeFragmentInput, type CreateTeamOutcomeInput, type CreateTeamTaskInput, type MissionLogEntry, type MissionLogKind, type ReviewTeamOutcomeFragmentInput, type RouteToTeammateOptions, type TeamMailboxMessage, type TeamMemberSnapshot, TeamMessageType, type TeammateLifecycleSpec, type TeamOutcome, type TeamOutcomeFragment, type TeamOutcomeFragmentStatus, type TeamOutcomeStatus, type TeamRunRecord, type TeamRunStatus, type TeamRuntimeSnapshot, type TeamRuntimeState, type TeamTask, type TeamTaskListItem, type TeamTaskStatus, } from "@nklein/shared";
export interface TeamMemberConfig extends AgentConfig {
    role?: string;
}
export interface AgentTask {
    agentId: string;
    message: string;
    metadata?: Record<string, unknown>;
}
export interface TaskResult {
    agentId: string;
    result: AgentResult;
    error?: Error;
    metadata?: Record<string, unknown>;
}
export type TeamEvent = {
    type: TeamMessageType.TaskStart;
    agentId: string;
    message: string;
} | {
    type: TeamMessageType.TaskEnd;
    agentId: string;
    result?: AgentResult;
    error?: Error;
    messages?: AgentResult["messages"];
} | {
    type: TeamMessageType.AgentEvent;
    agentId: string;
    event: AgentEvent;
} | {
    type: TeamMessageType.TeammateSpawned;
    agentId: string;
    role?: string;
    teammate: TeammateLifecycleSpec;
} | {
    type: TeamMessageType.TeammateShutdown;
    agentId: string;
    reason?: string;
} | {
    type: TeamMessageType.TeamTaskUpdated;
    task: TeamTask;
} | {
    type: TeamMessageType.TeamMessage;
    message: TeamMailboxMessage;
} | {
    type: TeamMessageType.TeamMissionLog;
    entry: MissionLogEntry;
} | {
    type: TeamMessageType.RunQueued;
    run: TeamRunRecord;
} | {
    type: TeamMessageType.RunStarted;
    run: TeamRunRecord;
} | {
    type: TeamMessageType.RunProgress;
    run: TeamRunRecord;
    message: string;
} | {
    type: TeamMessageType.RunCompleted;
    run: TeamRunRecord;
} | {
    type: TeamMessageType.RunFailed;
    run: TeamRunRecord;
} | {
    type: TeamMessageType.RunCancelled;
    run: TeamRunRecord;
    reason?: string;
} | {
    type: TeamMessageType.RunInterrupted;
    run: TeamRunRecord;
    reason?: string;
} | {
    type: TeamMessageType.OutcomeCreated;
    outcome: TeamOutcome;
} | {
    type: TeamMessageType.OutcomeFragmentAttached;
    fragment: TeamOutcomeFragment;
} | {
    type: TeamMessageType.OutcomeFragmentReviewed;
    fragment: TeamOutcomeFragment;
} | {
    type: TeamMessageType.OutcomeFinalized;
    outcome: TeamOutcome;
};
export interface AgentTeamsRuntimeOptions {
    teamName: string;
    leadAgentId?: string;
    missionLogIntervalSteps?: number;
    missionLogIntervalMs?: number;
    maxConcurrentRuns?: number;
    onTeamEvent?: (event: TeamEvent) => void;
}
export interface SpawnTeammateOptions {
    agentId: string;
    config: TeamMemberConfig;
}
export declare class AgentTeam {
    private agents;
    private configs;
    private onTeamEvent?;
    constructor(configs?: Record<string, TeamMemberConfig>, onTeamEvent?: (event: TeamEvent) => void);
    addAgent(id: string, config: TeamMemberConfig): void;
    removeAgent(id: string): boolean;
    getAgent(id: string): SessionRuntime | undefined;
    getAgentIds(): string[];
    get size(): number;
    routeTo(agentId: string, message: string): Promise<AgentResult>;
    continueTo(agentId: string, message: string): Promise<AgentResult>;
    runParallel(tasks: AgentTask[]): Promise<TaskResult[]>;
    runSequential(tasks: AgentTask[]): Promise<TaskResult[]>;
    runPipeline(pipeline: string[], initialMessage: string, messageTransformer?: (prevResult: AgentResult, nextAgentId: string) => string): Promise<TaskResult[]>;
    abortAll(): void;
    clear(): void;
    private emitEvent;
}
export declare function createAgentTeam(configs: Record<string, TeamMemberConfig>, onTeamEvent?: (event: TeamEvent) => void): AgentTeam;
export declare function createWorkerReviewerTeam(configs: {
    worker: TeamMemberConfig;
    reviewer: TeamMemberConfig;
}): AgentTeam & {
    doAndReview: (message: string) => Promise<{
        workerResult: AgentResult;
        reviewResult: AgentResult;
    }>;
};
export declare class AgentTeamsRuntime {
    private readonly teamId;
    private readonly teamName;
    private readonly onTeamEvent?;
    private readonly members;
    private readonly tasks;
    private readonly missionLog;
    private readonly mailbox;
    private missionStepCounter;
    private taskCounter;
    private messageCounter;
    private missionCounter;
    private runCounter;
    private outcomeCounter;
    private outcomeFragmentCounter;
    private readonly runs;
    private readonly runQueue;
    private queuedRunDispatchTimer;
    private readonly outcomes;
    private readonly outcomeFragments;
    private readonly missionLogIntervalSteps;
    private readonly missionLogIntervalMs;
    private readonly maxConcurrentRuns;
    constructor(options: AgentTeamsRuntimeOptions);
    getTeamId(): string;
    getTeamName(): string;
    getMemberRole(agentId: string): "lead" | "teammate" | undefined;
    getMemberIds(): string[];
    getTeammateIds(): string[];
    getTask(taskId: string): TeamTask | undefined;
    listTasks(): TeamTask[];
    listTaskItems(options?: {
        status?: TeamTaskStatus;
        assignee?: string;
    }): TeamTaskListItem[];
    listMissionLog(limit?: number): MissionLogEntry[];
    listMailbox(agentId: string, options?: {
        unreadOnly?: boolean;
        markRead?: boolean;
        limit?: number;
    }): TeamMailboxMessage[];
    getSnapshot(): TeamRuntimeSnapshot;
    exportState(): TeamRuntimeState;
    hydrateState(state: TeamRuntimeState): void;
    isTeammateActive(agentId: string): boolean;
    spawnTeammate({ agentId, config }: SpawnTeammateOptions): TeamMemberSnapshot;
    shutdownTeammate(agentId: string, reason?: string): void;
    updateTeammateConnections(overrides: Partial<Pick<AgentConfig, "apiKey" | "baseUrl" | "headers">>): void;
    createTask(input: CreateTeamTaskInput): TeamTask;
    claimTask(taskId: string, agentId: string): TeamTask;
    blockTask(taskId: string, agentId: string, reason: string): TeamTask;
    completeTask(taskId: string, agentId: string, summary: string): TeamTask;
    routeToTeammate(agentId: string, message: string, options?: RouteToTeammateOptions): Promise<AgentResult>;
    startTeammateRun(agentId: string, message: string, options?: RouteToTeammateOptions & {
        priority?: number;
        maxRetries?: number;
        leaseOwner?: string;
    }): TeamRunRecord;
    private dispatchQueuedRuns;
    private selectNextDispatchableQueuedRun;
    private scheduleQueuedRunDispatch;
    private clearQueuedRunDispatchTimer;
    private countActiveRuns;
    private executeQueuedRun;
    listRuns(options?: {
        status?: TeamRunStatus | null;
        agentId?: string | null;
        includeCompleted?: boolean | null;
    }): TeamRunRecord[];
    getRun(runId: string): TeamRunRecord | undefined;
    awaitRun(runId: string, pollIntervalMs?: number): Promise<TeamRunRecord>;
    awaitAllRuns(pollIntervalMs?: number): Promise<TeamRunRecord[]>;
    cancelRun(runId: string, reason?: string): TeamRunRecord;
    recoverActiveRuns(reason?: string): TeamRunRecord[];
    markStaleRunsInterrupted(reason?: string): TeamRunRecord[];
    sendMessage(fromAgentId: string, toAgentId: string, subject: string, body: string, taskId?: string): TeamMailboxMessage;
    broadcast(fromAgentId: string, subject: string, body: string, options?: {
        taskId?: string;
    }): TeamMailboxMessage[];
    appendMissionLog(input: AppendMissionLogInput): MissionLogEntry;
    createOutcome(input: CreateTeamOutcomeInput): TeamOutcome;
    listOutcomes(): TeamOutcome[];
    attachOutcomeFragment(input: AttachTeamOutcomeFragmentInput): TeamOutcomeFragment;
    reviewOutcomeFragment(input: ReviewTeamOutcomeFragmentInput): TeamOutcomeFragment;
    listOutcomeFragments(outcomeId: string): TeamOutcomeFragment[];
    finalizeOutcome(outcomeId: string): TeamOutcome;
    cleanup(): void;
    private requireTask;
    private assertDependenciesResolved;
    private getUnresolvedDependencies;
    private trackMeaningfulEvent;
    private recordRunActivityFromAgentEvent;
    private recordRunProgress;
    private formatProgressErrorActivity;
    private recordProgressStep;
    private buildMailboxNotification;
    private emitEvent;
}
