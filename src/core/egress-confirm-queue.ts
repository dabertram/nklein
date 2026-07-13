/**
 * F2.3 (§5.L I5) — the egress CONFIRM queue: the pure state machine behind the host↔proxy approval channel. A
 * `confirm`-tier egress attempt parks here; the loopback-only control surface lists pending attempts and
 * resolves them; the proxy waits (bounded) for the resolution and FAILS CLOSED on anything but a clean approval.
 *
 * Fail-closed properties, by construction:
 *   - a resolution is BOUND to (attemptId, host, port, role) — all four must match the queued entry EXACTLY, so
 *     a stale/cross-attempt approval (approve arrived for a different target than what is actually queued) is a
 *     `mismatch` that resolves nothing (the pending attempt keeps waiting and times out to deny);
 *   - decisions are ONE-SHOT: taking a resolution consumes the entry — an approval can never be replayed onto a
 *     later attempt (which would necessarily carry a new attemptId anyway);
 *   - expiry is deny: an entry past its deadline resolves `expired` for the waiter and can never be approved;
 *   - unknown attempt ids resolve nothing (`unknown`).
 * Pure + clock-injected (every method takes `now`); the proxy composes its scheduler around `subscribe`.
 */

export interface EgressConfirmRequest {
	attemptId: string;
	host: string;
	port: number;
	role: string;
}

export interface PendingEgressConfirm extends EgressConfirmRequest {
	requestedAt: number;
	expiresAt: number;
}

export const DEFAULT_EGRESS_CONFIRM_TIMEOUT_MS = 60_000;

export type EgressConfirmResolveOutcome = "applied" | "mismatch" | "expired" | "unknown" | "already_resolved";
export type EgressConfirmStatus = "approved" | "denied" | "pending" | "expired" | "unknown";

export interface EgressConfirmQueue {
	/** Park a confirm-tier attempt. Idempotent per attemptId (re-enqueue returns the existing entry). */
	enqueue: (request: EgressConfirmRequest, now: number, timeoutMs?: number) => PendingEgressConfirm;
	/**
	 * Apply an operator decision. `applied` ONLY when attemptId+host+port+role all match the queued entry and it
	 * has not expired or been resolved; every other outcome changes nothing.
	 */
	resolve: (decision: EgressConfirmRequest & { approve: boolean }, now: number) => EgressConfirmResolveOutcome;
	/** The attempt's current status. Reading does not consume. */
	status: (attemptId: string, now: number) => EgressConfirmStatus;
	/** Consume the attempt's final resolution (removes the entry). `pending` leaves it in place. */
	take: (attemptId: string, now: number) => EgressConfirmStatus;
	/** Unexpired, unresolved attempts (the control surface's list), oldest first. */
	listPending: (now: number) => PendingEgressConfirm[];
	/** Drop expired unresolved entries, returning them (for timeout-deny audits). */
	sweep: (now: number) => PendingEgressConfirm[];
	/** Observe resolution/expiry for an attempt (the proxy's wait hook). Fires at most once. Returns unsubscribe. */
	subscribe: (attemptId: string, onSettled: (status: "approved" | "denied" | "expired") => void) => () => void;
}

interface QueueEntry {
	pending: PendingEgressConfirm;
	resolution: "approved" | "denied" | null;
	subscribers: Array<(status: "approved" | "denied" | "expired") => void>;
}

export function createEgressConfirmQueue(): EgressConfirmQueue {
	const entries = new Map<string, QueueEntry>();

	const notify = (entry: QueueEntry, status: "approved" | "denied" | "expired"): void => {
		const subscribers = entry.subscribers.splice(0, entry.subscribers.length);
		for (const subscriber of subscribers) {
			subscriber(status);
		}
	};

	const isExpired = (entry: QueueEntry, now: number): boolean =>
		entry.resolution === null && now >= entry.pending.expiresAt;

	return {
		enqueue(request, now, timeoutMs = DEFAULT_EGRESS_CONFIRM_TIMEOUT_MS) {
			const existing = entries.get(request.attemptId);
			if (existing) {
				return existing.pending;
			}
			const pending: PendingEgressConfirm = {
				...request,
				requestedAt: now,
				expiresAt: now + Math.max(0, timeoutMs),
			};
			entries.set(request.attemptId, { pending, resolution: null, subscribers: [] });
			return pending;
		},

		resolve(decision, now) {
			const entry = entries.get(decision.attemptId);
			if (!entry) {
				return "unknown";
			}
			if (entry.resolution !== null) {
				return "already_resolved";
			}
			if (isExpired(entry, now)) {
				return "expired";
			}
			const bound =
				entry.pending.host === decision.host &&
				entry.pending.port === decision.port &&
				entry.pending.role === decision.role;
			if (!bound) {
				// The decision was made against different facts than what is queued — it applies to NOTHING.
				return "mismatch";
			}
			entry.resolution = decision.approve ? "approved" : "denied";
			notify(entry, entry.resolution);
			return "applied";
		},

		status(attemptId, now) {
			const entry = entries.get(attemptId);
			if (!entry) {
				return "unknown";
			}
			if (entry.resolution !== null) {
				return entry.resolution;
			}
			return isExpired(entry, now) ? "expired" : "pending";
		},

		take(attemptId, now) {
			const entry = entries.get(attemptId);
			if (!entry) {
				return "unknown";
			}
			if (entry.resolution !== null) {
				entries.delete(attemptId);
				return entry.resolution;
			}
			if (isExpired(entry, now)) {
				entries.delete(attemptId);
				notify(entry, "expired");
				return "expired";
			}
			return "pending";
		},

		listPending(now) {
			return [...entries.values()]
				.filter((entry) => entry.resolution === null && !isExpired(entry, now))
				.map((entry) => ({ ...entry.pending }))
				.sort((left, right) => left.requestedAt - right.requestedAt);
		},

		sweep(now) {
			const expired: PendingEgressConfirm[] = [];
			for (const [attemptId, entry] of entries) {
				if (isExpired(entry, now)) {
					expired.push({ ...entry.pending });
					entries.delete(attemptId);
					notify(entry, "expired");
				}
			}
			return expired.sort((left, right) => left.requestedAt - right.requestedAt);
		},

		subscribe(attemptId, onSettled) {
			const entry = entries.get(attemptId);
			if (!entry) {
				return () => {};
			}
			if (entry.resolution !== null) {
				onSettled(entry.resolution);
				return () => {};
			}
			entry.subscribers.push(onSettled);
			return () => {
				const index = entry.subscribers.indexOf(onSettled);
				if (index >= 0) {
					entry.subscribers.splice(index, 1);
				}
			};
		},
	};
}
