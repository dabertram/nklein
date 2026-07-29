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

export function countActiveProjectTaskSessions(
	summaries: RuntimeTaskSessionSummary[],
	startingTaskId: string,
	options?: {
		/**
		 * Task ids whose CARD already sits in a terminal board lane (completed/trash). A session summary lingering
		 * active for such a card is a GHOST, not workload: nothing will ever settle it, so counting it starves every
		 * future start. Live-found G6.8a v14 (2026-07-29): a post-completion re-drive left an `awaiting_review`
		 * summary on a completed-lane card; auto-start then hit the concurrency limit every 30s for 6+ minutes
		 * ("deferred for retry on the next completion" — which can never come) while the frozen-board self-heal
		 * fired uselessly around it, until the drain's stagnation settle ended the run.
		 */
		terminalLaneTaskIds?: ReadonlySet<string>;
	},
): number {
	const activeTaskIds = new Set<string>();
	for (const summary of summaries) {
		if (summary.taskId === startingTaskId || !isActiveProjectTaskSession(summary)) {
			continue;
		}
		if (options?.terminalLaneTaskIds?.has(summary.taskId)) {
			continue;
		}
		activeTaskIds.add(summary.taskId);
	}
	return activeTaskIds.size;
}

export function createConcurrencyLimitStartError(maxConcurrentTasks: number): string {
	return `Maximum concurrent task limit reached (${maxConcurrentTasks}). Wait for a running task to finish, or stop an active task before starting another.`;
}
