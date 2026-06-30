import type { RuntimeTaskSessionSummary } from "../core/api-contract";

/**
 * Stamp a task summary's `paused` flag from the workspace's paused-task set — the projection the
 * runtime-api pause/resume/stop procedures apply before returning a summary so the board reflects the
 * persisted pause state. Pure: a null summary stays null. Extracted from runtime-api.ts (§5.U) since
 * it is shared by several procedures.
 */
export function withTaskPausedState(
	summary: RuntimeTaskSessionSummary | null,
	pausedTaskIds: Set<string>,
): RuntimeTaskSessionSummary | null {
	return summary ? { ...summary, paused: pausedTaskIds.has(summary.taskId) } : null;
}
