import {
	createHostActionConfirmQueue,
	DEFAULT_HOST_ACTION_CONFIRM_TIMEOUT_MS,
	type HostActionConfirmRequest,
} from "../core/host-action-confirm-queue";

/**
 * F2.2b/F2.12b — the effectful bridge over the pure {@link createHostActionConfirmQueue}: park a `confirm`-tier host
 * action and AWAIT the operator's decision (bounded, fail-closed). The runtime holds ONE queue (one chat runtime =
 * one process); the control-channel tRPC lists + resolves its pending entries, and the chat's `confirm` callback
 * calls {@link awaitHostActionConfirmation} to block on it.
 *
 * Fail-closed by construction: the wait resolves `false` (deny) unless the operator explicitly APPROVES before the
 * deadline — a denial, an expiry, or no answer all resolve `false`. The timeout consumes the entry so a late
 * approval can never apply to a resolved attempt.
 */

/** The runtime-wide host-action confirm queue (one process = one chat runtime). */
export const hostActionConfirmQueue = createHostActionConfirmQueue();

/**
 * Park `request` on the queue and resolve to the operator's decision: `true` ONLY on an explicit approval before the
 * deadline; `false` on deny / expiry / timeout. Injectable `now`/`setTimer` keep it deterministically testable.
 */
export function awaitHostActionConfirmation(
	request: HostActionConfirmRequest,
	options: {
		timeoutMs?: number;
		now?: () => number;
		queue?: ReturnType<typeof createHostActionConfirmQueue>;
	} = {},
): Promise<boolean> {
	const queue = options.queue ?? hostActionConfirmQueue;
	const now = options.now ?? Date.now;
	const timeoutMs = options.timeoutMs ?? DEFAULT_HOST_ACTION_CONFIRM_TIMEOUT_MS;
	queue.enqueue(request, now(), timeoutMs);
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const settle = (approved: boolean): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			unsubscribe();
			resolve(approved);
		};
		const unsubscribe = queue.subscribe(request.attemptId, (status) => settle(status === "approved"));
		// A little past the queue's own deadline: consume the (now-expired) entry so a late approval can't apply,
		// then fail closed. `subscribe` may already have fired on an approve/deny before this runs (settle no-ops).
		const timer = setTimeout(() => {
			queue.take(request.attemptId, now());
			settle(false);
		}, timeoutMs + 50);
	});
}
