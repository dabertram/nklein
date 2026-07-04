/**
 * Durable-lease RENEWAL / EXPIRY / STEAL decision — pure core (todo.md §5.AF; the C3 durable long-run scheduler).
 *
 * WHAT: given ONE lease's identity + timing (who holds it, when it was acquired, its TTL, its last heartbeat) plus an
 * INJECTED clock, decide what should happen to that lease this tick — `hold` (alive, nothing to do), `renew` (the
 * holder is alive but the lease is nearing expiry, so push the deadline back), `expire` (the holder went silent past
 * its TTL — the DEAD-worker case the scheduler reclaims), or `steal` (a *different*, live worker legitimately takes
 * over a lapsed lease, fencing the old holder out by a monotonic epoch). This is the missing DECISION layer beneath
 * the mechanical {@link module:core/durable-scheduler#renewDurableLease} + `DurableRunController.heartbeat`.
 *
 * WHY: today the durable scheduler treats a lease as strictly binary — `decideDurableSchedulerActions` reclaims iff
 * `lease.expiresAt <= now`, and `renewDurableLease` / the controller's `heartbeat(jobId)` extend the expiry
 * UNCONDITIONALLY (any caller, any time, no liveness or ownership check). Two real gaps fall through that:
 *   1. **A hung-but-not-yet-lapsed worker is invisible.** A worker can hold a lease whose `expiresAt` is still in the
 *      future while its LAST HEARTBEAT is already stale (it stopped beating — hung / deadlocked / GC-paused). The
 *      `expiresAt > now` check can't see that until the whole lease finally lapses, so a dead worker keeps its slot far
 *      longer than the heartbeat interval implies. Deciding on `lastHeartbeatAt` (not just `expiresAt`) surfaces it
 *      as `expire` the moment the heartbeat goes stale past a grace window.
 *   2. **There is no fenced hand-off (`steal`).** A *different* worker wanting to take over a lapsed lease — before the
 *      scheduler's own reclaim tick runs, or in a peer-to-peer takeover — has no representation: no fencing token
 *      exists on `DurableJobLease`, and `SCHEDULER_EVENT_NAMES` has no `stolen`. Blindly renewing lets a resurrected
 *      zombie (an old holder that wakes up after being presumed dead) keep writing under a lease a new worker already
 *      took. A monotonic `fenceEpoch` per (re)grant, checked here, makes a steal safe: the new holder gets a strictly
 *      higher epoch, and any later action from a lower epoch is refused as fenced-out.
 *
 * This core answers ONE lease's question deterministically; the caller (the runtime around
 * {@link module:core/durable-run-controller}) maps the verdict onto the existing scheduler/ledger vocabulary
 * (`renew` → {@link module:core/durable-scheduler#renewDurableLease}; `expire` → the scheduler's `reclaim` /
 * `lease_expired`; `steal` → a fenced re-grant). It COMPOSES the existing {@link module:core/durable-scheduler}
 * lease types by import and does not modify them.
 *
 * PURE + deterministic: no I/O, no network, no model, no ambient clock (the clock is the injected `now`) — the verdict
 * is a property of the inputs alone, so a ledger replay reproduces the same decision. Total: every input yields exactly
 * one verdict. Host-side control-plane, local-only (#1/#2).
 */

import type { DurableJobLease } from "./durable-scheduler";

/** The lease-lifecycle verdict for one lease this tick. Exactly one is returned. */
export type LeaseRenewalVerdict =
	/** The lease is healthy and not near expiry — do nothing this tick. */
	| "hold"
	/** The holder is alive (heartbeat fresh) and the lease is within the renew window of expiry — push the deadline back. */
	| "renew"
	/** The holder went silent (heartbeat stale past the grace window, or the lease fully lapsed) — reclaim it (DEAD worker). */
	| "expire"
	/** A DIFFERENT, live worker legitimately takes over a lapsed lease, fencing the old holder out (a monotonic epoch bump). */
	| "steal";

/**
 * The current lease, extended with the two timing/identity signals a renewal decision needs beyond the base
 * {@link DurableJobLease} (which carries only `workerId` + `expiresAt`). All epoch ms.
 */
export interface RenewableLease extends DurableJobLease {
	/** Epoch ms the lease was granted (or last stolen). Used to reason about lease age; INJECTED, never read from a clock here. */
	readonly acquiredAt: number;
	/**
	 * Epoch ms of the holder's most recent heartbeat (liveness proof). Absent/`null` ⇒ never beaten since acquire, so
	 * {@link acquiredAt} stands in as the last liveness signal (a just-granted lease is considered fresh until its first
	 * heartbeat would be due).
	 */
	readonly lastHeartbeatAt?: number | null;
	/**
	 * A monotonic fencing token, bumped on every (re)grant/steal. Absent ⇒ epoch 0. A `steal` mints a strictly higher
	 * epoch so any later action carrying a lower epoch is refused as fenced-out (the zombie-holder guard). Optional so a
	 * caller that hasn't adopted fencing still gets `hold`/`renew`/`expire` decisions.
	 */
	readonly fenceEpoch?: number;
}

/** Timing policy for the decision — all durations in ms; each has a sensible default and is validated (non-finite ⇒ default). */
export interface LeaseRenewalPolicy {
	/**
	 * How long a heartbeat stays "fresh". If `now - lastLiveness > heartbeatIntervalMs + heartbeatGraceMs`, the holder is
	 * presumed silent (→ `expire`). Default 15000 (15s).
	 */
	readonly heartbeatIntervalMs?: number;
	/** Extra slack on top of one interval before a missed heartbeat counts as silent (absorbs one dropped beat). Default 5000. */
	readonly heartbeatGraceMs?: number;
	/**
	 * Renew when the lease is within this many ms of `expiresAt` (and the holder is alive). Renewing eagerly (before the
	 * deadline) keeps a slow-but-alive worker from being reclaimed on the next scheduler tick. Default 5000.
	 */
	readonly renewWithinMs?: number;
	/** New TTL granted on a `renew` or `steal`, measured from `now`. Default 30000 (30s). */
	readonly leaseDurationMs?: number;
}

const DEFAULT_POLICY: Required<LeaseRenewalPolicy> = {
	heartbeatIntervalMs: 15_000,
	heartbeatGraceMs: 5_000,
	renewWithinMs: 5_000,
	leaseDurationMs: 30_000,
};

/** A request to (re)assess a lease, optionally on behalf of a specific worker that wants to hold it. */
export interface LeaseRenewalRequest {
	/** The lease under assessment. */
	readonly lease: RenewableLease;
	/** Current clock (epoch ms). INJECTED so the core stays pure + replay-deterministic. */
	readonly now: number;
	/**
	 * The worker asking (e.g. the heartbeat caller, or a peer wanting to take over). Absent ⇒ the scheduler itself
	 * assessing (only `hold`/`renew`/`expire` are reachable — an anonymous assessor never STEALS). When present and it
	 * differs from the lease holder, a lapsed lease yields `steal` (a live foreign worker taking over) rather than
	 * `expire` (which is the holder-absent / same-holder-gone-silent case).
	 */
	readonly requesterId?: string;
	/** Optional timing overrides. */
	readonly policy?: LeaseRenewalPolicy;
}

/** The decision plus the derived facts that produced it (for the operator "why" surface + the caller's fenced re-grant). */
export interface LeaseRenewalDecision {
	readonly verdict: LeaseRenewalVerdict;
	/** ms since the holder's last liveness signal (heartbeat, or acquire if never beaten). Clamped ≥ 0 (future skew ⇒ 0). */
	readonly sinceLastHeartbeatMs: number;
	/** ms until (negative = past) the lease's `expiresAt`. */
	readonly untilExpiryMs: number;
	/** True once `sinceLastHeartbeatMs` exceeds one interval + grace — the holder is presumed silent. */
	readonly holderSilent: boolean;
	/** True once `now >= expiresAt` — the lease has fully lapsed. */
	readonly lapsed: boolean;
	/**
	 * On `renew`/`steal`, the new `expiresAt` the caller should grant (`now + leaseDurationMs`); on `hold`/`expire`, the
	 * unchanged current `expiresAt` (nothing new is granted).
	 */
	readonly nextExpiresAt: number;
	/**
	 * On `steal`, the monotonic fencing epoch the new holder must adopt (strictly greater than the stolen lease's epoch);
	 * otherwise the lease's current epoch, unchanged.
	 */
	readonly nextFenceEpoch: number;
	/** Human-readable one-liner naming the signals behind the verdict (for the §5.AG attention surface). */
	readonly reason: string;
}

/** A finite value, else the fallback. */
function finiteOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A finite, non-negative duration (values `< 0` or non-finite ⇒ the fallback) — a duration can never be negative. */
function nonNegativeDurationOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** A finite, strictly-positive duration (values `<= 0` or non-finite ⇒ the fallback) — used where a 0-length window is nonsensical. */
function positiveDurationOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

/** A finite epoch, or the fallback epoch (used for `fenceEpoch` where absent/garbage ⇒ 0). */
function finiteEpochOr(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * Decide the lifecycle verdict for ONE durable lease this tick — pure + deterministic. In priority order:
 *
 *   1. **fully lapsed** (`now >= expiresAt`) OR **holder silent** (no heartbeat within one interval + grace): the holder
 *      is presumed dead. If a DIFFERENT live worker is asking (`requesterId` set and ≠ the holder), it may take over →
 *      `steal` (with a strictly-higher fence epoch, so the old holder is fenced out on resurrection). Otherwise → `expire`
 *      (the scheduler reclaims the DEAD worker's slot).
 *   2. **near expiry while alive** (within `renewWithinMs` of `expiresAt`, heartbeat still fresh): a slow-but-live worker
 *      → `renew`, pushing the deadline to `now + leaseDurationMs` so the next scheduler tick doesn't reclaim it.
 *   3. otherwise the lease is healthy and comfortably ahead of its deadline → `hold`.
 *
 * The clock is the injected `now` (never read here), so a replay reproduces the same verdict. A foreign requester never
 * causes a healthy lease to be stolen — a steal is reachable ONLY once the current holder has lapsed/gone silent (this
 * is a fenced hand-off of DEAD work, not preemption of a live worker).
 */
export function decideLeaseRenewal(request: LeaseRenewalRequest): LeaseRenewalDecision {
	const policy: Required<LeaseRenewalPolicy> = {
		heartbeatIntervalMs: nonNegativeDurationOr(
			request.policy?.heartbeatIntervalMs,
			DEFAULT_POLICY.heartbeatIntervalMs,
		),
		heartbeatGraceMs: nonNegativeDurationOr(request.policy?.heartbeatGraceMs, DEFAULT_POLICY.heartbeatGraceMs),
		renewWithinMs: nonNegativeDurationOr(request.policy?.renewWithinMs, DEFAULT_POLICY.renewWithinMs),
		leaseDurationMs: positiveDurationOr(request.policy?.leaseDurationMs, DEFAULT_POLICY.leaseDurationMs),
	};

	const now = finiteOr(request.now, 0);
	const acquiredAt = finiteOr(request.lease.acquiredAt, now);
	const expiresAt = finiteOr(request.lease.expiresAt, now);
	const currentEpoch = finiteEpochOr(request.lease.fenceEpoch, 0);

	// Last liveness proof: the most recent heartbeat, or the acquire time if the holder has never beaten yet (a
	// just-granted lease is considered fresh until its first heartbeat would be due).
	const lastLiveness =
		typeof request.lease.lastHeartbeatAt === "number" && Number.isFinite(request.lease.lastHeartbeatAt)
			? request.lease.lastHeartbeatAt
			: acquiredAt;

	// Clamp future skew to 0: a heartbeat/expiry "in the future" relative to `now` is not aged.
	const sinceLastHeartbeatMs = Math.max(0, now - lastLiveness);
	const untilExpiryMs = expiresAt - now;

	const silenceDeadlineMs = policy.heartbeatIntervalMs + policy.heartbeatGraceMs;
	const holderSilent = sinceLastHeartbeatMs > silenceDeadlineMs;
	const lapsed = now >= expiresAt;

	const foreignRequester =
		typeof request.requesterId === "string" &&
		request.requesterId.length > 0 &&
		request.requesterId !== request.lease.workerId;

	// 1. Dead-holder case: fully lapsed OR gone silent past the grace window.
	if (lapsed || holderSilent) {
		if (foreignRequester) {
			return {
				verdict: "steal",
				sinceLastHeartbeatMs,
				untilExpiryMs,
				holderSilent,
				lapsed,
				nextExpiresAt: now + policy.leaseDurationMs,
				nextFenceEpoch: currentEpoch + 1,
				reason: formatReason("steal", {
					sinceLastHeartbeatMs,
					lapsed,
					holderSilent,
					requesterId: request.requesterId,
				}),
			};
		}
		return {
			verdict: "expire",
			sinceLastHeartbeatMs,
			untilExpiryMs,
			holderSilent,
			lapsed,
			nextExpiresAt: expiresAt,
			nextFenceEpoch: currentEpoch,
			reason: formatReason("expire", {
				sinceLastHeartbeatMs,
				lapsed,
				holderSilent,
				requesterId: request.requesterId,
			}),
		};
	}

	// 2. Alive but nearing expiry → renew (push the deadline back for a slow-but-live worker).
	if (untilExpiryMs <= policy.renewWithinMs) {
		return {
			verdict: "renew",
			sinceLastHeartbeatMs,
			untilExpiryMs,
			holderSilent,
			lapsed,
			nextExpiresAt: now + policy.leaseDurationMs,
			nextFenceEpoch: currentEpoch,
			reason: formatReason("renew", {
				sinceLastHeartbeatMs,
				lapsed,
				holderSilent,
				requesterId: request.requesterId,
			}),
		};
	}

	// 3. Healthy and comfortably ahead of its deadline → nothing to do.
	return {
		verdict: "hold",
		sinceLastHeartbeatMs,
		untilExpiryMs,
		holderSilent,
		lapsed,
		nextExpiresAt: expiresAt,
		nextFenceEpoch: currentEpoch,
		reason: formatReason("hold", { sinceLastHeartbeatMs, lapsed, holderSilent, requesterId: request.requesterId }),
	};
}

/**
 * Guard a mutating action carried by `actionEpoch` against the lease's current `fenceEpoch` — the zombie-holder fence.
 * A resurrected old holder (or a duplicate in-flight message) carries a STALE (lower) epoch than the one a `steal`
 * minted for the new holder; this returns `true` for it (FENCED — refuse the stale action) and `false` only when the
 * action's epoch is at least the lease's current epoch (not fenced — the action may apply). Pure. Absent epochs fold to
 * 0, so a caller that never adopted fencing is never fenced out
 * (0 ≥ 0). This is the check a `steal`'s `nextFenceEpoch` exists to enable.
 */
export function isLeaseActionFenced(currentFenceEpoch: number | undefined, actionEpoch: number | undefined): boolean {
	return finiteEpochOr(actionEpoch, 0) < finiteEpochOr(currentFenceEpoch, 0);
}

function formatReason(
	verdict: LeaseRenewalVerdict,
	facts: { sinceLastHeartbeatMs: number; lapsed: boolean; holderSilent: boolean; requesterId?: string },
): string {
	switch (verdict) {
		case "hold":
			return "lease healthy; holder alive and not near expiry";
		case "renew":
			return `holder alive (beat ${facts.sinceLastHeartbeatMs}ms ago); lease near expiry — renew`;
		case "expire": {
			const cause = facts.lapsed
				? "lease lapsed"
				: `holder silent (${facts.sinceLastHeartbeatMs}ms since last heartbeat)`;
			return `${cause}; presumed dead — expire/reclaim`;
		}
		case "steal": {
			const cause = facts.lapsed ? "lapsed" : "silent";
			return `holder ${cause}; live worker ${facts.requesterId ?? "?"} takes over — steal (fenced)`;
		}
	}
}
