import type { AgentResult } from "@nklein/shared";
import type { HookEventPayload } from "../../hooks";
import type { RuntimeCapabilities } from "../../runtime/capabilities";
import type { PendingPromptsServiceApi, RestoreSessionInput, RestoreSessionResult, RuntimeHost, RuntimeHostSubscribeOptions, SendSessionInput, SessionAccumulatedUsage, StartSessionInput, StartSessionResult } from "../../runtime/host/runtime-host";
import type { CoreSettingsListInput, CoreSettingsMutationResult, CoreSettingsSnapshot, CoreSettingsToggleInput } from "../../settings";
import type { CoreSessionEvent } from "../../types/events";
import type { SessionRecord } from "../../types/sessions";
export interface HubRuntimeHostOptions {
    url: string;
    authToken?: string;
    clientType?: string;
    displayName?: string;
    capabilities?: RuntimeCapabilities;
}
export declare class HubRuntimeHost implements RuntimeHost {
    runtimeAddress: string;
    readonly pendingPrompts: PendingPromptsServiceApi;
    private client;
    private readonly clientOptions;
    private readonly clientContext?;
    private readonly events;
    private readonly sessionCapabilities;
    private readonly sessionClientContributionHandlers;
    private readonly sessionSubscriptions;
    private readonly pendingApprovalToolCallIds;
    private readonly agentDoneEmittedForCurrentRunBySession;
    private readonly activeCapabilityAbortControllers;
    private readonly defaultCapabilities;
    constructor(options: HubRuntimeHostOptions, clientContext?: {
        workspaceRoot?: string;
        cwd?: string;
    });
    private createClient;
    private replaceClient;
    private recoverLocalHubStartupDeadlock;
    private registerPlannedSession;
    private cleanupPlannedSession;
    connect(): Promise<void>;
    startSession(input: StartSessionInput): Promise<StartSessionResult>;
    restoreSession(input: RestoreSessionInput): Promise<RestoreSessionResult>;
    runTurn(input: SendSessionInput): Promise<AgentResult | undefined>;
    private requestPendingPromptsList;
    private requestPendingPromptUpdate;
    private requestPendingPromptDelete;
    getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined>;
    abort(sessionId: string, reason?: unknown): Promise<void>;
    stopSession(sessionId: string): Promise<void>;
    dispose(): Promise<void>;
    getSession(sessionId: string): Promise<SessionRecord | undefined>;
    listSessions(limit?: number): Promise<SessionRecord[]>;
    listSettings(input?: CoreSettingsListInput): Promise<CoreSettingsSnapshot>;
    toggleSetting(input: CoreSettingsToggleInput): Promise<CoreSettingsMutationResult>;
    deleteSession(sessionId: string): Promise<boolean>;
    updateSession(sessionId: string, updates: {
        prompt?: string | null;
        metadata?: Record<string, unknown> | null;
        title?: string | null;
    }): Promise<{
        updated: boolean;
    }>;
    readSessionMessages(sessionId: string): Promise<import("@nklein/llms").Message[]>;
    dispatchHookEvent(_payload: HookEventPayload): Promise<void>;
    subscribe(listener: (event: CoreSessionEvent) => void, options?: RuntimeHostSubscribeOptions): () => void;
    private ensureSessionSubscription;
    private disposeSessionSubscription;
    private resolveCapabilities;
    private emitToolCallContentStart;
    private emitAgentDoneIfNeeded;
    private handleHubEvent;
    private handleCapabilityRequest;
    private handleCapabilityResolved;
    private handleApprovalRequested;
}
