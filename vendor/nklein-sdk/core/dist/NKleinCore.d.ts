import type { NKleinCoreAutomationApi, NKleinCoreListHistoryOptions, NKleinCoreOptions, NKleinCoreSettingsApi, NKleinCoreStartInput, RestoreInput, RestoreResult } from "./nklein-core/types";
import type { PendingPromptsServiceApi, RuntimeHost, RuntimeHostSubscribeOptions, SessionModelRuntimeService, SessionUsageRuntimeService, StartSessionInput, StartSessionResult } from "./runtime/host/runtime-host";
import type { CoreSessionEvent } from "./types/events";
import type { SessionHistoryRecord } from "./types/sessions";
export type { NKleinAutomationEventIngressResult, NKleinAutomationEventLog, NKleinAutomationEventSuppression, NKleinAutomationListEventsOptions, NKleinAutomationListRunsOptions, NKleinAutomationListSpecsOptions, NKleinAutomationRun, NKleinAutomationRunStatus, NKleinAutomationSpec, NKleinCoreAutomationApi, NKleinCoreAutomationOptions, NKleinCoreListHistoryOptions, NKleinCoreOptions, NKleinCoreSettingsApi, NKleinCoreStartInput, HubOptions, RemoteOptions, RestoreInput, RestoreOptions, RestoreResult, RuntimeHostMode, StartSessionBootstrap, } from "./nklein-core/types";
/**
 * The primary entry point for the NKlein Core SDK.
 *
 * @example
 * ```ts
 * import { NKleinCore } from "@nklein/core";
 *
 * const nklein = await NKleinCore.create({ clientName: "my-app" });
 * const session = await nklein.start({ ... });
 * ```
 */
export declare class NKleinCore {
    readonly clientName: string | undefined;
    readonly runtimeAddress: string | undefined;
    readonly automation: NKleinCoreAutomationApi;
    readonly settings: NKleinCoreSettingsApi;
    readonly pendingPrompts: PendingPromptsServiceApi;
    private readonly host;
    private readonly prepare;
    private readonly capabilities;
    private readonly logger;
    private readonly telemetry;
    private readonly distinctId;
    private readonly automationService;
    private readonly activeSessionBootstraps;
    private readonly unsubscribeBootstrapCleanup;
    private constructor();
    /**
     * Creates a new NKleinCore instance.
     *
     * This is the primary factory method for initializing the SDK. It sets up the runtime
     * host (local, hub, or remote) based on the provided options and prepares the SDK for
     * starting sessions.
     *
     * @param options Configuration options for the SDK instance
     * @returns A promise that resolves to a new NKleinCore instance
     *
     * @example
     * ```ts
     * const nklein = await NKleinCore.create({
     *   clientName: "my-app",
     *   backendMode: "local",
     * });
     * ```
     */
    static create(options?: NKleinCoreOptions): Promise<NKleinCore>;
    private disposeSessionBootstrap;
    /**
     * Starts a new NKlein session with the provided configuration.
     *
     * This method initializes and begins a new agent session. It handles session setup,
     * runs any preparation hooks, and returns session metadata along with event streams.
     * The session continues to run until explicitly stopped or aborted.
     *
     * @param input The session configuration and startup parameters
     * @returns A promise that resolves to session metadata and event stream
     *
     * @example
     * ```ts
     * const result = await nklein.start({
     *   config: {
     *     providerId: "anthropic",
     *     modelId: "claude-opus-4-1",
     *   },
     * });
     *
     * // Subscribe to session events
     * result.subscribe((event) => {
     *   console.log("Session event:", event);
     * });
     * ```
     */
    start(input: StartSessionInput): Promise<StartSessionResult>;
    /**
     * Starts a new NKlein session with extended core-specific configuration.
     * This overload allows specifying local runtime options and config overrides.
     */
    start(input: NKleinCoreStartInput): Promise<StartSessionResult>;
    /**
     * Sends a message or command to an active session.
     *
     * This method communicates with a running session, allowing you to send user messages,
     * tool responses, or other session input while the session is in progress.
     *
     * @example
     * ```ts
     * await nklein.send(sessionId, {
     *   type: "user_message",
     *   text: "Please implement the login feature",
     * });
     * ```
     */
    send: RuntimeHost["runTurn"];
    /**
     * Retrieves accumulated token and cost usage for a session.
     *
     * Returns metrics about the session's resource consumption, including tokens used
     * across different API providers and associated costs. Useful for monitoring and billing.
     *
     * @example
     * ```ts
     * const usage = await nklein.getAccumulatedUsage(sessionId);
     * console.log(`Total cost: $${usage.totalCost}`);
     * ```
     */
    getAccumulatedUsage: SessionUsageRuntimeService["getAccumulatedUsage"];
    /**
     * Aborts an in-flight tool execution without stopping the session.
     *
     * Interrupts the current tool operation (e.g., file read, shell command) while keeping
     * the session alive. The session can continue processing after the abort. Use this for
     * cancelling long-running operations.
     *
     * @example
     * ```ts
     * // Stop the current operation but keep the session running
     * await nklein.abort(sessionId);
     * ```
     */
    abort: RuntimeHost["abort"];
    /**
     * Stops an active session gracefully.
     *
     * Terminates the session and cleans up associated resources. Unlike abort, this
     * completely ends the session. The session cannot be resumed after stopping.
     *
     * @example
     * ```ts
     * // Cleanly shutdown the session
     * await nklein.stop(sessionId);
     * ```
     */
    stop: RuntimeHost["stopSession"];
    /**
     * Disposes the NKleinCore instance and all associated resources.
     *
     * Shuts down the runtime host, closes connections, and cleans up all active sessions
     * and bootstraps. Call this when you're done using the SDK instance, typically at
     * application shutdown. After calling dispose, the instance cannot be reused.
     *
     * @example
     * ```ts
     * // Clean up when done
     * await nklein.dispose();
     * ```
     */
    dispose: RuntimeHost["dispose"];
    /**
     * Retrieves information about a specific session by ID.
     *
     * Fetches the current metadata and state of a session, including configuration,
     * status, and other session details.
     *
     * @example
     * ```ts
     * const session = await nklein.get(sessionId);
     * console.log("Session status:", session?.status);
     * ```
     */
    get: RuntimeHost["getSession"];
    /**
     * Lists recent sessions through the shared history-listing path.
     */
    listHistory: (options?: NKleinCoreListHistoryOptions) => Promise<SessionHistoryRecord[]>;
    /**
     * Lists recent sessions with inferred history display metadata.
     *
     * Retrieves a paginated list of recent sessions, optionally limited by the
     * provided count.
     *
     * @param limit Maximum number of sessions to return (defaults to 200)
     * @returns A promise resolving to an array of session history records
     *
     * @example
     * ```ts
     * const sessions = await nklein.list(50);
     * sessions.forEach((session) => {
     *   console.log(`Session ${session.sessionId}: ${session.metadata?.title}`);
     * });
     * ```
     */
    list: (limit?: number, options?: Omit<NKleinCoreListHistoryOptions, "limit">) => Promise<SessionHistoryRecord[]>;
    /**
     * Permanently deletes a session and all its associated data.
     *
     * Removes the session from storage and cleans up any related resources. This is
     * a destructive operation that cannot be undone.
     *
     * @param sessionId The ID of the session to delete
     * @returns A promise that resolves to true if the session was deleted, false if not found
     *
     * @example
     * ```ts
     * const deleted = await nklein.delete(sessionId);
     * if (deleted) {
     *   console.log("Session deleted successfully");
     * }
     * ```
     */
    delete: RuntimeHost["deleteSession"];
    /**
     * Updates an existing session's metadata.
     *
     * Modifies session properties like title or other mutable metadata while preserving
     * message history and other session data.
     *
     * @example
     * ```ts
     * await nklein.update(sessionId, {
     *   title: "Updated session title",
     * });
     * ```
     */
    update: RuntimeHost["updateSession"];
    /**
     * Reads message history for a session.
     *
     * Retrieves the full message transcript for a specific session, including all
     * user messages, agent responses, and tool interactions.
     *
     * @example
     * ```ts
     * const messages = await nklein.readMessages(sessionId);
     * messages.forEach((msg) => {
     *   console.log(`${msg.role}: ${msg.content}`);
     * });
     * ```
     */
    readMessages: RuntimeHost["readSessionMessages"];
    restore(input: RestoreInput): Promise<RestoreResult>;
    /**
     * Handles hook events from the runtime environment.
     *
     * Processes system or environment events (e.g., workspace changes, external signals)
     * that may affect the current session. This is typically called by the host environment
     * rather than directly by consumer code.
     *
     * @internal
     */
    ingestHookEvent: RuntimeHost["dispatchHookEvent"];
    /**
     * Subscribes to session events.
     *
     * Registers a listener for all session events (messages, state changes, errors, etc.).
     * Returns an unsubscribe function to stop listening.
     *
     * @param listener Callback function invoked for each event
     * @param options Optional configuration for the subscription
     * @returns An unsubscribe function
     *
     * @example
     * ```ts
     * const unsubscribe = nklein.subscribe((event) => {
     *   if (event.type === "message") {
     *     console.log("New message:", event.payload.message);
     *   }
     * });
     *
     * // Later, stop listening
     * unsubscribe();
     * ```
     */
    subscribe(listener: (event: CoreSessionEvent) => void, options?: RuntimeHostSubscribeOptions): () => void;
    /**
     * Updates the AI model used by an active session.
     *
     * Switches the session to use a different AI model while maintaining the session state
     * and message history. This allows you to continue a conversation with a different model.
     *
     * @example
     * ```ts
     * // Switch to a different model mid-session
     * await nklein.updateSessionModel(sessionId, "claude-opus-4-1");
     * ```
     */
    updateSessionModel: SessionModelRuntimeService["updateSessionModel"];
}
