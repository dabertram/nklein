// Owns the per-task timeout TIMER MECHANICS (extracted from nklein-task-session-service handleTaskTimeout/
// scheduleTaskTimeout, §5.U): the handle store plus the deadline math that re-arms a timer in
// <= MAX_NODE_TIMER_DELAY_MS chunks so a timeout longer than Node's max delay still fires. Pure mechanics —
// the session service keeps the POLICY (which timeouts to schedule, read from settings + tool-activity state) and
// the firing RESPONSE (clear → abort → record → observe → emit), which it injects as the `onFired` callback.
import { type NKleinTaskTimeoutKind, TaskTimeoutHandles } from "./nklein-task-timeout-handles";

// Node's setTimeout caps the delay at ~24.8 days (2^31-1 ms); a longer timeout must be re-armed in chunks.
const MAX_NODE_TIMER_DELAY_MS = 2_147_483_647;

export class TaskTimeoutScheduler {
	private readonly handles = new TaskTimeoutHandles();

	/**
	 * Arm the `kind` timeout for `taskId` to fire `onFired(timeoutMs)` after `timeoutMs`, clearing any prior
	 * timer of that kind first. A null / non-finite / non-positive `timeoutMs` is a no-op (it just clears).
	 */
	schedule(
		taskId: string,
		kind: NKleinTaskTimeoutKind,
		timeoutMs: number | null,
		onFired: (timeoutMs: number) => void,
	): void {
		this.handles.clearKind(taskId, kind);
		if (timeoutMs === null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			return;
		}
		const deadline = Date.now() + timeoutMs;
		const scheduleRemaining = (): void => {
			const remainingMs = deadline - Date.now();
			if (remainingMs <= 0) {
				onFired(timeoutMs);
				return;
			}
			const handle = setTimeout(scheduleRemaining, Math.min(remainingMs, MAX_NODE_TIMER_DELAY_MS));
			handle.unref();
			this.handles.set(taskId, kind, handle);
		};
		scheduleRemaining();
	}

	clearKind(taskId: string, kind: NKleinTaskTimeoutKind): void {
		this.handles.clearKind(taskId, kind);
	}

	clearAll(taskId: string): void {
		this.handles.clearAll(taskId);
	}

	taskIds(): IterableIterator<string> {
		return this.handles.taskIds();
	}
}
