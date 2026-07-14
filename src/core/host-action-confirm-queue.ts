/**
 * F2.2b/F2.12b (§5.L/§5.M) — the HOST-ACTION confirm queue: the pure state machine behind an operator confirmation
 * of a chat's host action. When the policy gate says a host action needs the operator's OK (the `confirm` tier,
 * neither auto-allow nor deny), the turn parks the attempt here; a control surface lists the pending confirmations
 * and resolves them; the chat's `confirm` callback waits (bounded) for the resolution and FAILS CLOSED on anything
 * but a clean approval. Parallel to {@link ./egress-confirm-queue} (egress CONNECTs) — same fail-closed shape, a
 * different identity (the host action a chat session attempted, not a host:port CONNECT).
 *
 * Fail-closed properties, by construction:
 *   - a resolution is BOUND to (attemptId, sessionId, action, target) — all four must match the queued entry
 *     EXACTLY, so a stale/cross-attempt approval resolves NOTHING (`mismatch`; the pending attempt keeps waiting
 *     and times out to deny);
 *   - decisions are ONE-SHOT: taking a resolution consumes the entry — an approval can never be replayed;
 *   - expiry is deny: an entry past its deadline resolves `expired` and can never be approved;
 *   - unknown attempt ids resolve nothing (`unknown`).
 * Pure + clock-injected (every method takes `now`).
 */

export interface HostActionConfirmRequest {
	attemptId: string;
	sessionId: string;
	/** The host-action kind (e.g. `host_command`, `host_write`) — carried as a plain string to keep this core dependency-free. */
	action: string;
	/** The least-scope target the operator is approving (the exact command / path / host); never secrets. */
	target: string;
}

export interface PendingHostActionConfirm extends HostActionConfirmRequest {
	requestedAt: number;
	expiresAt: number;
}

export const DEFAULT_HOST_ACTION_CONFIRM_TIMEOUT_MS = 60_000;

export type HostActionConfirmResolveOutcome = "applied" | "mismatch" | "expired" | "unknown" | "already_resolved";
export type HostActionConfirmStatus = "approved" | "denied" | "pending" | "expired" | "unknown";

export interface HostActionConfirmQueue {
	/** Park a confirm-tier host action. Idempotent per attemptId (re-enqueue returns the existing entry). */
	enqueue: (request: HostActionConfirmRequest, now: number, timeoutMs?: number) => PendingHostActionConfirm;
	/**
	 * Apply an operator decision. `applied` ONLY when attemptId+sessionId+action+target all match the queued entry
	 * and it has not expired or been resolved; every other outcome changes nothing.
	 */
	resolve: (decision: HostActionConfirmRequest & { approve: boolean }, now: number) => HostActionConfirmResolveOutcome;
	/** The attempt's current status. Reading does not consume. */
	status: (attemptId: string, now: number) => HostActionConfirmStatus;
	/** Consume the attempt's final resolution (removes the entry). `pending` leaves it in place. */
	take: (attemptId: string, now: number) => HostActionConfirmStatus;
	/** Unexpired, unresolved attempts (the control surface's list), oldest first. */
	listPending: (now: number) => PendingHostActionConfirm[];
	/** Drop expired unresolved entries, returning them (for timeout-deny audits). */
	sweep: (now: number) => PendingHostActionConfirm[];
	/** Observe resolution/expiry for an attempt (the confirm callback's wait hook). Fires at most once. Returns unsubscribe. */
	subscribe: (attemptId: string, onSettled: (status: "approved" | "denied" | "expired") => void) => () => void;
}

interface QueueEntry {
	pending: PendingHostActionConfirm;
	resolution: "approved" | "denied" | null;
	subscribers: Array<(status: "approved" | "denied" | "expired") => void>;
}

export function createHostActionConfirmQueue(): HostActionConfirmQueue {
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
		enqueue(request, now, timeoutMs = DEFAULT_HOST_ACTION_CONFIRM_TIMEOUT_MS) {
			const existing = entries.get(request.attemptId);
			if (existing) {
				return existing.pending;
			}
			const pending: PendingHostActionConfirm = {
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
				entry.pending.sessionId === decision.sessionId &&
				entry.pending.action === decision.action &&
				entry.pending.target === decision.target;
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
			const expired: PendingHostActionConfirm[] = [];
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
