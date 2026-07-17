/**
 * F12.40 live token-usage registry — the accumulator prerequisite for the runaway-budget consult.
 *
 * The SDK reports RUN-CUMULATIVE usage totals on every runtime-state snapshot (each model call's context re-read
 * counts toward input), but the session summary only learns usage at run END (`run-finished`/`done`) — so nothing
 * live-facing knows what a RUNNING card has spent. The context-focus extension stamps each session's latest
 * snapshot here (beforeModel — one Map write per model call); the autonomy-budget watchdog reads it at every turn
 * checkpoint. Module-level registry like the predict-output tool's: keyed by task/session id, forgotten on session
 * teardown so a dead session never inflates the board view.
 */

export interface LiveTaskUsage {
	/** Run-cumulative input tokens (every turn's full context re-read counts — NOT the F12.58 card-effort basis). */
	readonly inputTokens: number;
	readonly outputTokens: number;
}

const liveUsageByTaskId = new Map<string, LiveTaskUsage>();

export function recordLiveTaskUsage(taskId: string, usage: LiveTaskUsage): void {
	if (!Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) {
		return;
	}
	liveUsageByTaskId.set(taskId, {
		inputTokens: Math.max(0, usage.inputTokens),
		outputTokens: Math.max(0, usage.outputTokens),
	});
}

export function getLiveTaskUsage(taskId: string): LiveTaskUsage | null {
	return liveUsageByTaskId.get(taskId) ?? null;
}

/** Input+output summed across ALL live sessions — the board-level multiplied-burn view (current runs only). */
export function sumLiveUsageTokens(): number {
	let total = 0;
	for (const usage of liveUsageByTaskId.values()) {
		total += usage.inputTokens + usage.outputTokens;
	}
	return total;
}

export function forgetLiveTaskUsage(taskId: string): void {
	liveUsageByTaskId.delete(taskId);
}
