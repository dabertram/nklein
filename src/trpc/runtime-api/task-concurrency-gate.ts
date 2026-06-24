import type { RuntimeTaskSessionSummary } from "../../core/api-contract";
import { isHomeAgentSessionId } from "../../core/home-agent-session";

/**
 * Pure concurrency-gate accounting for `createRuntimeApi`'s task-start path, extracted from the oversized
 * `runtime-api.ts` (todo §5.U). Counts the *other* active project task sessions (excluding the home agent and the
 * task being started) so the start path can enforce the max-concurrent-tasks limit, and builds the limit-reached
 * error message. No I/O — pure functions over the session summaries.
 */

function isActiveProjectTaskSession(summary: RuntimeTaskSessionSummary): boolean {
	return (
		!isHomeAgentSessionId(summary.taskId) &&
		summary.state !== "idle" &&
		(summary.state === "queued" || summary.state === "running" || summary.state === "awaiting_review")
	);
}

export function countActiveProjectTaskSessions(summaries: RuntimeTaskSessionSummary[], startingTaskId: string): number {
	const activeTaskIds = new Set<string>();
	for (const summary of summaries) {
		if (summary.taskId === startingTaskId || !isActiveProjectTaskSession(summary)) {
			continue;
		}
		activeTaskIds.add(summary.taskId);
	}
	return activeTaskIds.size;
}

export function createConcurrencyLimitStartError(maxConcurrentTasks: number): string {
	return `Maximum concurrent task limit reached (${maxConcurrentTasks}). Wait for a running task to finish, or stop an active task before starting another.`;
}
