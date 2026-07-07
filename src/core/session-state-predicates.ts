import type { RuntimeTaskSessionState } from "./task-session-api-contract";

/**
 * Session-state predicates (todo §5.U — consolidates a `state === "running" || state === "queued"` check that had
 * drifted across ~5 files). A single source of truth for the state groupings the runtime reasons about.
 */

/**
 * True while a session actively occupies a runtime/model slot: it is RUNNING or waiting-to-run (QUEUED). The grouping
 * the concurrency/preemption/park paths mean by "busy" — a session in either state is holding (or about to hold)
 * capacity. Deliberately excludes `awaiting_review` and `idle`, which are separate concepts some call sites add on top.
 */
export function isBusySessionState(state: RuntimeTaskSessionState | null | undefined): boolean {
	return state === "running" || state === "queued";
}

/**
 * True when a session ended in an UNSUCCESSFUL terminal state: it errored (`failed`) or was aborted / torn down
 * (`interrupted`) — as opposed to still-active, awaiting review, or cleanly completed. The grouping the recovery /
 * feedback / finalize paths mean by "the run did not finish successfully".
 */
export function isTerminalFailureSessionState(
	state: RuntimeTaskSessionState | null | undefined,
): state is "failed" | "interrupted" {
	return state === "failed" || state === "interrupted";
}
