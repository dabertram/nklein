/**
 * Per-session consecutive-mistake tracker.
 *
 * @see PLAN.md §3.1 — wrapped around `recordMistake` moved from
 *                    `packages/agents/src/api/error-handling.ts` lines 147–311.
 * @see PLAN.md §3.2.3 — public surface of `MistakeTracker`.
 *
 * The pure procedural `recordMistake(input, deps)` becomes `record(input)`
 * on the class; `consecutiveMistakes` is internal state. Other deps flow
 * through the constructor instead.
 *
 * NOTE: the §3.2.3 constructor shape omits some fields (agentId,
 * conversationId/runId getters, appendRecoveryNotice). They are retained
 * here for log + notice parity per PLAN.md §3.4.3/§3.4.5. Step 8
 * (`impl-runtime-porter`) may refactor once SessionRuntime is wired up.
 */
import type { AgentEvent, BasicLogMetadata, ConsecutiveMistakeLimitContext, ConsecutiveMistakeLimitDecision } from "@nklein/shared";
/**
 * Legacy-agents-style leveled log function. The sdk-re `BasicLogger`
 * does not carry a level argument (§shared/logging/logger.ts); callers
 * are expected to bridge via `metadata.severity` or dispatch to
 * `debug`/`log`/`error`. `MistakeTracker` accepts a leveled callable
 * here so Step 8 can plug in whichever bridging shape `SessionRuntime`
 * ends up using.
 */
export type LeveledLog = (level: "debug" | "info" | "warn" | "error", message: string, metadata?: BasicLogMetadata) => void;
export type MistakeReason = "api_error" | "invalid_tool_call" | "tool_execution_failed";
export interface RecordMistakeInput {
    iteration: number;
    reason: MistakeReason;
    details?: string;
    /** When true, jump straight to maxConsecutiveMistakes instead of incrementing by 1. */
    forceAtLimit?: boolean;
}
export type MistakeOutcome = {
    action: "continue";
    guidance?: string;
} | {
    action: "stop";
    message: string;
    reason?: string;
};
export interface MistakeTrackerOptions {
    readonly maxConsecutiveMistakes: number;
    readonly onLimitReached?: (ctx: ConsecutiveMistakeLimitContext) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision;
    readonly emit: (event: AgentEvent) => void;
    readonly log: LeveledLog;
    readonly agentId: string;
    readonly getConversationId: () => string;
    readonly getActiveRunId: () => string;
    readonly appendRecoveryNotice: (message: string, reason: MistakeReason) => void;
}
export declare class MistakeTracker {
    private consecutiveMistakes;
    private readonly options;
    constructor(options: MistakeTrackerOptions);
    record(input: RecordMistakeInput): Promise<MistakeOutcome>;
    reset(): void;
    get value(): number;
}
export declare function buildMistakeLimitStopMessage(input: {
    iteration: number;
    consecutiveMistakes: number;
    maxConsecutiveMistakes: number;
    reason: "api_error" | "invalid_tool_call" | "completion_without_submit" | "tool_execution_failed";
    details?: string;
    stopReason?: string;
}): string;
