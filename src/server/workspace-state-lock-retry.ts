import { isWorkspaceStateLockError } from "../state/workspace-state";

/**
 * §5.U — the workspace-state lock retry extracted from `runtime-server`. Proper-lock contention on the shared workspace
 * state file is transient (a sibling writer holds it briefly), so a lock error is retried on a fixed backoff schedule;
 * ANY other error propagates immediately. Pure control flow apart from the sleep, which is injectable so the retry logic
 * is testable without real timers.
 */

/** The backoff schedule (ms) between workspace-state lock retries — one entry per retry after the initial attempt. */
export const WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryWorkspaceStateLockOptions {
	/** The backoff schedule; defaults to {@link WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS}. */
	delaysMs?: readonly number[];
	/** Injectable sleep (tests pass a no-op); defaults to a real `setTimeout`-backed delay. */
	sleep?: (ms: number) => Promise<void>;
}

/**
 * Run `operation`, retrying only on a workspace-state lock error along the backoff schedule. The operation is attempted
 * once plus once per delay entry; a non-lock error, or exhausting the schedule, rethrows the last error.
 */
export async function retryWorkspaceStateLock<T>(
	operation: () => Promise<T>,
	options: RetryWorkspaceStateLockOptions = {},
): Promise<T> {
	const delaysMs = options.delaysMs ?? WORKSPACE_STATE_LOCK_RETRY_DELAYS_MS;
	const sleep = options.sleep ?? realSleep;
	let lastError: unknown = null;
	for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			const delayMs = delaysMs[attempt];
			if (!isWorkspaceStateLockError(error) || delayMs === undefined) {
				throw error;
			}
			await sleep(delayMs);
		}
	}
	throw lastError;
}
