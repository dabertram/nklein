/**
 * Per-session `SessionRuntime` orchestrator.
 *
 * Owns all cross-turn state for one logical agent session:
 *
 *   - `ConversationStore`      — message transcript + session-started gate
 *   - `MistakeTracker`         — per-session consecutive-mistake counter
 *   - `LoopDetectionTracker`   — per-session repeated-tool-call detector
 *   - `MessageBuilder`         — provider-message assembly cache
 *   - `AgentRuntimeHooks`      — runtime-native hooks from config/extensions
 *   - `RuntimeEventAdapter`    — per-run stateful `AgentRuntimeEvent`
 *                                → legacy `AgentEvent` translator
 *   - listener registry        — host subscribers see legacy `AgentEvent`s
 *   - pending tool set, abort  — per-run lifecycle housekeeping
 *
 * A fresh `AgentRuntime` is instantiated per run via
 * `createAgentRuntime(createAgentRuntimeConfig({...}))`. All
 * session-level state outlives any one `AgentRuntime`, making
 * OAuth-retry and run replay feasible.
 */
import type { AgentRuntime } from "@nklein/agents";
import { createAgentRuntime } from "@nklein/agents";
import { type AgentConfig, type AgentEvent, type AgentExtensionRegistry, type AgentResult, type AgentTool, type BasicLogger, type ITelemetryService, type Message, type MessageWithMetadata } from "@nklein/shared";
import { MessageBuilder } from "../../session/services/message-builder";
/**
 * Listener invoked for every legacy `AgentEvent` produced by the
 * session runtime. Use `subscribeEvents(listener)` — it returns an
 * `unsubscribe` function.
 */
export type SessionEventListener = (event: AgentEvent) => void;
/** Subset of host-side deps needed by the session orchestrator. */
export interface SessionRuntimeOrchestratorDeps {
    readonly logger?: BasicLogger;
    readonly telemetry?: ITelemetryService;
    /**
     * Test hook: override the `AgentRuntime` factory. Production
     * callers leave this undefined and get the real `createAgentRuntime`.
     */
    readonly createAgentRuntimeImpl?: (config: Parameters<typeof createAgentRuntime>[0]) => AgentRuntime;
}
/** Connection overrides applied via `updateConnection`. */
export interface ConnectionOverrides {
    providerId?: string;
    modelId?: string;
    apiKey?: string;
    baseUrl?: string;
    headers?: Record<string, string>;
    providerConfig?: unknown;
    reasoningEffort?: AgentConfig["reasoningEffort"];
    thinking?: boolean;
    thinkingBudgetTokens?: number;
}
/**
 * Per-session orchestrator. Construct once per agent session; call
 * `run` / `continue` repeatedly. The class matches the subset of
 * runtime-facing session surface.
 */
export declare class SessionRuntime {
    private config;
    private readonly agentId;
    private readonly parentAgentId?;
    private readonly logger?;
    readonly telemetry?: ITelemetryService;
    private readonly conversation;
    private readonly mistakeTracker;
    private readonly loopTracker;
    /**
     * True when `execution.loopDetection === false` at construction
     * time. Loop inspection is skipped entirely — the tracker still
     * exists for API compatibility but is never fed.
     */
    private readonly loopDetectionDisabled;
    readonly messageBuilder: MessageBuilder;
    /**
     * Contribution registry that hosts extension-provided tools,
     * commands, message builders, and providers. Lazily initialized
     * on first run (parity with legacy `Agent.ensureExtensionsInitialized`
     * at `packages/agents/src/agent.ts:1122-1147`).
     */
    private readonly contributionRegistry;
    private extensionsInitialized;
    private readonly listeners;
    private readonly createAgentRuntimeImpl;
    /** Stable run id for the active run. */
    private activeRunId;
    /** True while a run is in flight. `canStartRun()` is the negation. */
    private running;
    /** True once `abort()` has been requested for the active run. */
    private abortRequested;
    /** Last abort reason requested for the active run. */
    private abortReason;
    /** Reference to the current run's `AgentRuntime` so `abort` can forward. */
    private activeRuntime;
    /** Promise returned from the current run so shutdown can await its drain. */
    private activeRunPromise;
    /** Per-run `Agent → AgentEvent` adapter; `reset()` each run. */
    private readonly eventAdapter;
    /** Session-shutdown gate — rejects late runs. */
    private shutdownCalled;
    /** Running tally of tool-call records for `AgentResult.toolCalls`. */
    private currentRunToolCalls;
    /** Aggregated usage across the current run. */
    private currentRunUsage;
    /** Tool-start timestamps for `ToolCallRecord.durationMs`. */
    private toolStartedAt;
    /** Tool-call input snapshot for `ToolCallRecord.input`. */
    private toolInputs;
    /**
     * Per-turn tool outcome counters used by the MistakeTracker wiring.
     * Reset on every `turn-started` event; consumed on `turn-finished`
     * to feed `mistakeTracker.record` when every tool call erred and no
     * successful call landed. Matches legacy `agent.ts` tool-failure
     * mistake-feed path (§3.4.6 + pre-Step-9 oracle lines 972-997).
     */
    private currentTurnSuccessfulTools;
    private currentTurnFailedTools;
    private currentTurnFailureDetails;
    /**
     * Serial queue for `MistakeTracker.record(...)` + loop-detection
     * side-effects fired from the sync `handleRuntimeEvent` stream. The
     * tracker's `record()` is async but the runtime event stream is
     * synchronous, so we chain tracker work onto a promise and await it
     * in `executeRun` before returning the `AgentResult`.
     */
    private activeTrackerWork;
    /** True when tracker logic has issued an abort for the active run. */
    private trackerAbortInFlight;
    constructor(config: AgentConfig, deps?: SessionRuntimeOrchestratorDeps);
    getAgentId(): string;
    getConversationId(): string;
    getMessages(): MessageWithMetadata[];
    /** True when no run is currently active and the session is not shut down. */
    canStartRun(): boolean;
    /**
     * Snapshot of the contribution registry (tools, commands, and other
     * extension contributions).
     *
     * Before the first run, the registry is in the `validate` phase:
     * extensions are validated but their `setup()` callbacks have not
     * run yet, so the snapshot only reflects eagerly-declared
     * contributions. After the first `run()`/`continue()`, the
     * registry is initialized (§`ensureExtensionsInitialized`), and
     * the snapshot reflects everything extensions registered via
     * `api.registerTool` / `registerCommand` / `registerMessageBuilder`
     * / `registerProvider` / `registerAutomationEventType`.
     */
    getExtensionRegistry(): AgentExtensionRegistry<AgentTool, Message[]>;
    /** Append additional tools to every subsequent turn's runtime config. */
    addTools(tools: AgentTool[]): void;
    /** Mutate provider / reasoning fields for subsequent runs. */
    updateConnection(overrides: ConnectionOverrides): void;
    clearHistory(): void;
    restore(messages: readonly MessageWithMetadata[]): void;
    private resetConversationBoundaryTrackers;
    /**
     * Subscribe to **legacy** `AgentEvent`s. The session runtime
     * translates the new `AgentRuntimeEvent` stream via
     * `RuntimeEventAdapter` before fanout, so consumers see the
     * pre-swap shape.
     */
    subscribeEvents(listener: SessionEventListener): () => void;
    abort(reason?: unknown): void;
    /** Shut the session down after any active run drains. */
    shutdown(_reason?: string, _timeoutMs?: number): Promise<void>;
    run(userMessage: string, userImages?: string[], userFiles?: string[]): Promise<AgentResult>;
    continue(userMessage?: string, userImages?: string[], userFiles?: string[]): Promise<AgentResult>;
    private composeSystemPrompt;
    private executeRun;
    private executeRunInternal;
    /**
     * Initialize the contribution registry once per session. Runs
     * extension `setup()` callbacks so they can `registerTool`,
     * `registerCommand`, `registerMessageBuilder`, and
     * `registerProvider`. Matches legacy `Agent.ensureExtensionsInitialized`
     * at pre-Step-9 `agent.ts:1122-1147`:
     *
     *   - on `hookErrorMode === "throw"`, setup failures propagate;
     *   - otherwise setup failures emit a recoverable `error` event
     *     via the legacy event channel and leave the registry
     *     partially initialized.
     *
     * Idempotent: subsequent calls are no-ops once the registry has
     * been activated.
     */
    private ensureExtensionsInitialized;
    private createRuntimeHooks;
    private createRuntimePrepareTurn;
    private prepareMessagesForModelRequest;
    private prepareProviderMessagesForApi;
    private handleRuntimeEvent;
    private syncConversationFromRuntimeMessage;
    private emitLegacyEvent;
    /**
     * Feed the `LoopDetectionTracker` with a tool-call and react to
     * the returned verdict. Parity with pre-Step-9 agent.ts L917-954:
     *
     *   - `"soft"`  → append a recovery notice telling the model to
     *                 change approach;
     *   - `"hard"`  → feed `MistakeTracker.record` with
     *                 `forceAtLimit:true`. When the tracker returns
     *                 `action: "stop"`, append the stop notice and
     *                 abort the active runtime.
     */
    private inspectLoopForToolCall;
    /**
     * Enqueue a mistake-record onto the serial tracker work chain. The
     * runtime event stream is synchronous but `MistakeTracker.record`
     * is async — chaining onto a shared promise preserves ordering
     * (legacy parity) and lets `executeRun` await draining before
     * returning the `AgentResult`.
     *
     * When the tracker returns `action: "stop"`, append the stop notice
     * to the conversation and abort the active runtime so the run ends
     * with `finishReason: "aborted"`.
     */
    private enqueueMistakeRecord;
    private buildLegacyResult;
}
