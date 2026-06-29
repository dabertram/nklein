/**
 * Bridge: a task-session state change → the durable-run controller call the runtime should make (todo §5.AF, the C3
 * live-wiring glue). The runtime's `onSummary` subscription owns the effect; this pure mapper owns the DECISION, so the
 * "which controller method for which task state" policy is unit-testable without the live event bus.
 *
 * Job semantics for a durable multi-card run: a card's "job" is the AGENT producing its result, so the job is
 * **succeeded** when the session reaches `awaiting_review` (the agent finished — review/merge are separate downstream
 * concerns, not the scheduler's). `failed`/`interrupted` are reported as a failure (the controller then classifies a
 * TRANSIENT one — a body/headers timeout — into a retry, §5.AF). A `running` session is alive → heartbeat its lease so
 * a slow-but-alive worker isn't reclaimed. Non-actionable states (`idle`/`queued`/`paused`) map to `none`.
 */

import type { RuntimeTaskSessionState } from "./task-session-api-contract";

export type DurableRunReaction =
	| { type: "report"; outcome: "succeeded" | "failed"; error: string | null }
	| { type: "heartbeat" }
	| { type: "none" };

/**
 * Pure: map a session state (+ optional error text for failures, passed to the controller so it can classify a
 * transient failure into a retry) to the controller reaction. The caller dispatches it:
 * `report` → `controller.reportCompletion(taskId, outcome, error)`, `heartbeat` → `controller.heartbeat(taskId)`,
 * then `controller.tick()`; `none` → do nothing.
 */
export function mapTaskSessionStateToDurableRunReaction(
	state: RuntimeTaskSessionState,
	errorText?: string | null,
): DurableRunReaction {
	switch (state) {
		case "awaiting_review":
			return { type: "report", outcome: "succeeded", error: null };
		case "failed":
		case "interrupted":
			return { type: "report", outcome: "failed", error: errorText ?? null };
		case "running":
			return { type: "heartbeat" };
		default:
			// idle / queued / paused — not a durable-run transition.
			return { type: "none" };
	}
}
