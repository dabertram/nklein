import { hasLiveTaskSession } from "./session-state-predicates";
import type { RuntimeTaskSessionState } from "./task-session-api-contract";

/**
 * Which durable leases the scheduler tick must HEARTBEAT instead of reclaiming (§5.AF). PURE core.
 *
 * The durable lease exists to detect a DEAD worker — a card whose process vanished — so the run can re-dispatch it.
 * It must never fire on a card the runtime is still on the hook for, because a reclaim burns one of the card's few
 * attempts and `max_attempts` then CANCELS it. Getting this set too narrow does not degrade gracefully: it destroys
 * healthy cards.
 *
 * Two populations count as "the runtime is still on the hook", and G6.8a v16 (2026-07-29) proved the live filter was
 * missing BOTH:
 *
 *   1. **A live session** — running, queued, paused, or awaiting_review ({@link hasLiveTaskSession}). The old filter
 *      accepted `running` only, so a review outliving the 5-minute lease (reviews ran ~10 minutes in that drain)
 *      would get its card reclaimed and re-dispatched while the reviewer was still working.
 *
 *   2. **A queued START, with no session at all.** When the endpoint is busy the start path returns `summary: null`
 *      and parks the request in the task-start queue. The card therefore has nothing that "looks alive" — and this
 *      is exactly what broke v16: `habit-score-clamping-tests-clamping` was leased at 19:26:55, re-queued behind a
 *      busy host every ~2s for 27 minutes, reclaimed at 19:31:55 / 19:37:28 / 19:42:58, and cancelled on
 *      `max_attempts`. It then started for real at 19:53:44 — eleven minutes after the scheduler gave up on it —
 *      leaving the board frozen for ~70 minutes.
 *
 * A queued start is the runtime's own promise to start that card the moment capacity frees. Reclaiming its lease
 * cannot help (there is no dead worker to replace, and the endpoint is busy either way) and costs an attempt. The
 * start queue bounds itself — an entry that exhausts its own retries is dropped rather than stored — so honoring it
 * here cannot pin a lease open forever on a card the queue has already abandoned.
 */
export interface DurableHeartbeatSessionView {
	readonly taskId: string;
	readonly state: RuntimeTaskSessionState;
}

export interface DurableHeartbeatInput {
	/** Session summaries for the workspace (any state; this function decides which ones count). */
	readonly sessions: readonly DurableHeartbeatSessionView[];
	/** Task ids whose START is enqueued for this workspace (endpoint-busy waiters with no session yet). */
	readonly queuedStartTaskIds: readonly string[];
}

/** The task ids whose leases must be heartbeated on this tick. Deduplicated; order is not significant. */
export function resolveDurableHeartbeatTaskIds(input: DurableHeartbeatInput): string[] {
	const live = new Set<string>();
	for (const session of input.sessions) {
		if (hasLiveTaskSession(session.state)) {
			live.add(session.taskId);
		}
	}
	for (const taskId of input.queuedStartTaskIds) {
		live.add(taskId);
	}
	return [...live];
}
