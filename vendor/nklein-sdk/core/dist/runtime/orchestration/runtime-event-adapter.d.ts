/**
 * Adapter from the new `AgentRuntimeEvent` union (13 variants, defined
 * in `@nklein/shared/src/agent.ts`) to the legacy `AgentEvent` union
 * (9 top-level types, defined in
 * `@nklein/shared/src/agents/types.ts`) consumed by today's
 * `Agent.subscribeEvents` callback.
 *
 * @see PLAN.md §3.1  — new file introduced alongside the core runtime port.
 * @see PLAN.md §3.3.2 — variant-by-variant OLD → NEW mapping.
 * @see PLAN.md §3.2.4 — called from `Agent.subscribeEvents` inside the
 *                       legacy-agent facade.
 *
 * --- IMPLEMENTATION NOTE — PLAN §3.3.2 text/reasoning-delta rows ----------
 *
 * PLAN.md §3.3.2 describes `assistant-text-delta` as "first delta →
 * content_start, subsequent → content_update". The **actual** legacy
 * shape forbids this: `AgentContentUpdateEvent.contentType` is
 * hard-typed as `"tool"` in
 * `packages/shared/src/agents/types.ts:87`, and the legacy
 * turn-processor
 * (`packages/agents/src/runtime/turn-processor.ts:82-87,113-118`)
 * emits a `content_start` event for **every** text delta and for
 * **every** reasoning delta — not just the first. This adapter
 * preserves that observable behavior (what every legacy consumer
 * relies on today) over the description in §3.3.2.
 *
 *   text deltas      → content_start { contentType:"text", text,
 *                        accumulated } (per delta)
 *   reasoning deltas → content_start { contentType:"reasoning",
 *                        reasoning, redacted } (per delta)
 *   assistant-message → one content_end { contentType:"text", text }
 *                        if any text parts; one
 *                        content_end { contentType:"reasoning", reasoning }
 *                        if any reasoning parts
 *                        (turn-processor.ts:157-170).
 *
 * --- STATEFUL BOOK-KEEPING ------------------------------------------------
 *
 *  1. Rolling usage totals. `usage-updated` carries the already-
 *     accumulated snapshot (agent-runtime.ts:668-683). Legacy
 *     `AgentUsageEvent` wants both per-turn delta and accumulated
 *     totals; the adapter subtracts the previous accumulated value
 *     from the incoming one to produce the delta.
 *  2. Tool timing. `tool-finished` does not carry `durationMs`. The
 *     adapter records `Date.now()` on `tool-started` (keyed by
 *     `toolCallId`) and computes `durationMs` at `tool-finished`.
 *     Matches `tool-orchestrator.ts:112-131`.
 *
 * Both are scoped to a single adapter instance and cleared by
 * `reset()`.
 */
import type { AgentEvent, AgentMessage, AgentRuntimeEvent } from "@nklein/shared";
declare function textFromMessage(message: AgentMessage | undefined): string;
/**
 * Per-subscriber adapter instance. Constructed once per
 * `Agent.subscribeEvents` registration (or per `SessionRuntime`),
 * used for the lifetime of that subscription, and `reset()` at the
 * start of every new run.
 *
 * `translate(event)` returns zero, one, or two `AgentEvent`s. An
 * array is needed because a single `assistant-message` may yield both
 * a text `content_end` and a reasoning `content_end`. Empty array
 * means the event is intentionally suppressed (§3.3.2 rows
 * `run-started`, `message-added`).
 */
export declare class RuntimeEventAdapter {
    private lastUsage;
    private toolStartedAt;
    translate(event: AgentRuntimeEvent): AgentEvent[];
    reset(): void;
    private translateAssistantMessage;
    private translateToolStarted;
    private translateToolFinished;
    private translateUsage;
    private translateRunFinished;
}
/**
 * Stateless translator. Works correctly for every variant except
 * those that require bookkeeping:
 *
 *  - `usage-updated` — deltas cannot be computed without a prior
 *    snapshot; this function treats the prior snapshot as zero (so
 *    delta == accumulated). Adequate for a single event, incorrect
 *    across multiple.
 *  - `tool-finished` — `durationMs` is reported as `undefined`
 *    because the corresponding `tool-started` was never observed by
 *    this one-shot adapter.
 *
 * Production code must use `RuntimeEventAdapter` for multi-event
 * runs; this function exists for ad-hoc unit tests and one-shot
 * translations where bookkeeping does not matter.
 *
 * Returns `undefined` when the event maps to zero legacy events
 * (`run-started`, `message-added`, or an `assistant-message` that
 * carries no text/reasoning parts). When an event produces multiple
 * legacy events (e.g. `assistant-message` with both text and
 * reasoning parts), only the first is returned; callers needing the
 * full array must use `RuntimeEventAdapter.translate()`.
 */
export declare function toLegacyAgentEvent(event: AgentRuntimeEvent): AgentEvent | undefined;
export { textFromMessage };
