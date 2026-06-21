import type * as LlmsProviders from "@nklein/llms";
import { type AgentConfig, type AgentResult, type ITelemetryService } from "@nklein/shared";
import type { HookEventPayload } from "../../hooks";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";
import type { CoreSessionConfig } from "../../types/config";
import type { CoreSessionEvent } from "../../types/events";
import type { SessionRecord } from "../../types/sessions";
import type { RuntimeCapabilities } from "../capabilities";
import { RuntimeOAuthTokenManager } from "../orchestration/runtime-oauth-token-manager";
import type { RuntimeBuilder } from "../orchestration/session-runtime";
import { SessionRuntime } from "../orchestration/session-runtime-orchestrator";
import { type SessionBackend } from "./local/session-record";
import type { PendingPromptsServiceApi, RestoreSessionInput, RestoreSessionResult, RuntimeHost, RuntimeHostSubscribeOptions, SendSessionInput, SessionAccumulatedUsage, StartSessionInput, StartSessionResult } from "./runtime-host";
export interface LocalRuntimeHostOptions {
    distinctId?: string;
    sessionService: SessionBackend;
    runtimeBuilder?: RuntimeBuilder;
    createAgent?: (config: AgentConfig) => SessionRuntime;
    capabilities?: RuntimeCapabilities;
    toolPolicies?: AgentConfig["toolPolicies"];
    providerSettingsManager?: ProviderSettingsManager;
    oauthTokenManager?: RuntimeOAuthTokenManager;
    telemetry?: ITelemetryService;
    /**
     * Default custom `fetch` implementation threaded into every
     * `ProviderConfig.fetch` built during local session bootstrap. Used by
     * the AI gateway providers when issuing HTTP requests.
     */
    fetch?: typeof fetch;
}
export declare class LocalRuntimeHost implements RuntimeHost {
    readonly runtimeAddress: undefined;
    readonly pendingPrompts: PendingPromptsServiceApi;
    private readonly sessionService;
    private readonly runtimeBuilder;
    private readonly createAgentInstance;
    private readonly toolExecutors?;
    private readonly defaultCapabilities?;
    private readonly defaultToolPolicies?;
    private readonly providerSettingsManager;
    private readonly oauthTokenManager;
    private readonly defaultTelemetry?;
    private readonly defaultFetch?;
    private readonly events;
    private readonly sessions;
    private readonly usageBySession;
    private readonly subAgentStarts;
    private readonly pendingPromptsController;
    private readonly eventBridge;
    private readonly sessionVersioning;
    constructor(options: LocalRuntimeHostOptions);
    startSession(input: StartSessionInput): Promise<StartSessionResult>;
    restoreSession(input: RestoreSessionInput): Promise<RestoreSessionResult>;
    runTurn(input: SendSessionInput): Promise<AgentResult | undefined>;
    getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined>;
    abort(sessionId: string, reason?: unknown): Promise<void>;
    stopSession(sessionId: string): Promise<void>;
    dispose(reason?: string): Promise<void>;
    getSession(sessionId: string): Promise<SessionRecord | undefined>;
    listSessions(limit?: number): Promise<SessionRecord[]>;
    deleteSession(sessionId: string): Promise<boolean>;
    updateSession(sessionId: string, updates: {
        prompt?: string | null;
        metadata?: Record<string, unknown> | null;
        title?: string | null;
    }): Promise<{
        updated: boolean;
    }>;
    readSessionMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
    dispatchHookEvent(payload: HookEventPayload): Promise<void>;
    subscribe(listener: (event: CoreSessionEvent) => void, options?: RuntimeHostSubscribeOptions): () => void;
    updateSessionModel(sessionId: string, modelId: string): Promise<void>;
    handlePluginEvent(rootSessionId: string, event: {
        name: string;
        payload?: unknown;
    }, fallbackAutomation?: NonNullable<CoreSessionConfig["extensionContext"]>["automation"]): Promise<void>;
    private executeTurn;
    private completeInteractiveTurn;
    private executeAgentTurn;
    /**
     * Anchor `task.completed` telemetry to the assistant's explicit
     * completion declaration. We emit at most once per session, the moment
     * a successful `submit_and_exit` tool call is observed in the run
     * result. This is the SDK analog of original NKlein's
     * `attempt_completion`-driven emission and works for both interactive
     * and non-interactive sessions.
     *
     * `shutdownSession(...)` retains a fallback emission for completed
     * sessions that finish without an explicit completion-tool observation
     * (e.g., non-interactive runs not using the yolo preset). This helper
     * sets `submitAndExitObserved` so the shutdown fallback can suppress a
     * duplicate emission for the same logical completion.
     */
    private observeTaskCompletionTool;
    private prepareTurnInput;
    private ensureSessionPersisted;
    private markTurnRunning;
    private persistSessionMetadata;
    private finalizeSingleRun;
    private failSession;
    private shutdownSession;
    private releaseSessionRuntime;
    private updateStatus;
    private runWithAuthRetry;
    private syncOAuthCredentials;
    private getSessionOrThrow;
    private resolveAbsoluteFilePaths;
    private getSessionAgentTelemetryIdentity;
    private emitStatus;
    private emitSessionSnapshot;
    private emit;
    private listRows;
    private getRow;
    private readManifest;
    private invoke;
    private invokeOptional;
    private invokeOptionalValue;
}
