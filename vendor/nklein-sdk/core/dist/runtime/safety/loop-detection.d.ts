/**
 * Repeated tool-call loop detection.
 *
 * @see PLAN.md §3.1 — helpers moved from `packages/agents/src/context/loop-detection.ts`.
 * @see PLAN.md §3.2.3 — public surface of `LoopDetectionTracker`.
 *
 * The pure helpers (`createLoopDetectionState`, `resetLoopDetectionState`,
 * `toolCallSignature`, `checkRepeatedToolCall`) are ported verbatim. The
 * `LoopDetectionTracker` class is a thin wrapper that owns a
 * `LoopDetectionState` and exposes the `inspect()` / `reset()` surface that
 * `SessionRuntime` installs as a `beforeTool` hook per §3.2.3.
 */
import type { LoopDetectionConfig } from "@nklein/shared";
export interface LoopDetectionState {
    lastToolName: string;
    lastToolSignature: string;
    consecutiveIdenticalCount: number;
}
export declare function createLoopDetectionState(): LoopDetectionState;
export declare function resetLoopDetectionState(state: LoopDetectionState): void;
export declare function toolCallSignature(input: unknown): string;
export interface LoopCheckResult {
    softWarning: boolean;
    hardEscalation: boolean;
}
export declare function checkRepeatedToolCall(state: LoopDetectionState, toolName: string, signature: string, config: LoopDetectionConfig): LoopCheckResult;
/**
 * Verdict returned by {@link LoopDetectionTracker.inspect}.
 *
 * - `"ok"`   — no repeated call detected.
 * - `"soft"` — soft-warning threshold reached; SessionRuntime may surface a
 *              recovery notice but should not block the call.
 * - `"hard"` — hard-escalation threshold reached; SessionRuntime should
 *              stop the run with the provided `message`.
 */
export interface LoopDetectionVerdict {
    kind: "ok" | "soft" | "hard";
    message?: string;
}
/** Minimal call shape the tracker needs; matches `AgentToolCallPart` subset. */
export interface LoopDetectionCall {
    name: string;
    input: unknown;
}
/**
 * Per-session repeated-tool-call detector.
 *
 * `SessionRuntime` owns the instance and installs a `beforeTool` hook
 * (see `AgentRuntimeHooks.beforeTool`) that calls `inspect()` to decide
 * whether to return `{ skip, stop, reason }`.
 */
export declare class LoopDetectionTracker {
    private readonly config;
    private readonly state;
    constructor(config?: Partial<LoopDetectionConfig>);
    inspect(call: LoopDetectionCall): LoopDetectionVerdict;
    reset(): void;
}
