/**
 * The durable scheduler's ENDPOINT-SATURATION BACKPRESSURE / ADMISSION-CONTROL policy — pure core (todo §5.AF,
 * "Resource governance → Wire endpoint-saturation backpressure into the durable scheduler").
 *
 * WHAT: given a snapshot of the resource POOLS a durable run leases against (each pool = an endpoint / machine /
 * sandbox lane, carrying its own concurrency cap, its current inflight lease count, and how many jobs are already
 * queued against it), a GLOBAL inflight ceiling across all pools, and a batch of PENDING admission requests (each
 * targeting one pool), this core decides — per request, in a fixed order — exactly one of three outcomes:
 *   - **admit** — a slot is genuinely free (the target pool is below its cap AND the run is below the global ceiling),
 *     accounting for the admissions already granted earlier in THIS same tick;
 *   - **defer** — no slot right now (the pool or the global ceiling is saturated) but the pool's queue still has room,
 *     so the request is held to be retried on a later tick (backpressure, not loss);
 *   - **shed** — the pool's queue is already at/over its bound, so admitting/queueing more would grow an unbounded
 *     backlog; the request is rejected so the caller can surface it (re-queue deliberately) instead of silently piling
 *     up. Also the terminal answer for a request that targets an unknown / disabled pool.
 *
 * WHY: {@link module:core/durable-scheduler#decideDurableSchedulerActions} leases ready jobs up to ONE global
 * concurrency cap, and {@link module:core/durable-scheduler-ready-order#orderReadyJobs} picks WHICH ready jobs fill the
 * free slots — but neither is aware that the leased work fans out across several saturable endpoints, nor does either
 * ever REJECT: a job that can't lease this tick simply waits, with no bound on how deep the per-endpoint queue grows. On
 * a real multi-card run that fans many cards onto a handful of LM-Studio endpoints, a slow/overloaded endpoint's queue
 * grows without limit (the live scout's "endpoint-saturation" signal), and there is no principled point at which the
 * scheduler says "this lane is full, hold" vs "this lane's backlog is pathological, shed". This core is that admission
 * decision: it turns per-pool caps + inflight + queue depth + a global ceiling into a transparent, tested admit /
 * defer / shed verdict the scheduler (or its caller) applies BEFORE leasing, so backpressure is explicit and the
 * backlog is bounded.
 *
 * Composability: this is ORTHOGONAL to the two existing scheduler cores. `orderReadyJobs` answers "of the jobs that
 * COULD run, which matter most?"; this answers "given where the endpoints stand, may each candidate be admitted at all,
 * or must it wait / be shed?". A caller runs the ordering first, then feeds the ordered candidates through this gate.
 * It is also broader than {@link module:core/machine-concurrency-gate} (one machine, one cap, binary allow/hold, no
 * queue, no shed) and {@link module:core/background-eval-admission} (the §5.AI idle-yield gate — one global rail, binary
 * admit/hold): this handles MANY pools with per-pool caps + a global ceiling and a distinct third `shed` outcome for a
 * bounded backlog.
 *
 * Pure + deterministic (no fs / network / model / db / clock / randomness): every input — the pool snapshots, the
 * global ceiling, the pending batch — is INJECTED, so a ledger replay reproduces the same verdicts. The decision is a
 * property of the inputs alone. This module DECIDES admission; it does not lease, reclaim, order, or run anything — the
 * scheduler applies the verdict (an `admit` maps onto its lease path, a `defer` leaves the job `ready`, a `shed` maps
 * onto a `cancelled`/surfaced outcome). Requests are processed in input order so that, within one tick, earlier
 * candidates claim the scarce slots first (feed this core the ready-ordered sequence to lease the most-important work
 * under contention).
 */

/** A snapshot of one saturable resource pool (an endpoint / machine / sandbox lane) at admission time. INJECTED. */
export interface BackpressurePoolSnapshot {
	/** Stable pool identifier (e.g. an endpoint key, a machine id, a sandbox-lane name). Requests target it by this id. */
	readonly poolId: string;
	/**
	 * Max concurrent leases this pool may hold. `≤ 0` DISABLES the pool — every request targeting it is `shed`
	 * (`pool_disabled`), since there is no capacity to ever admit into. Non-finite ⇒ treated as 0 (disabled). Floored.
	 */
	readonly cap: number;
	/** Leases the pool currently holds (in-flight work), from the live lease state. Non-finite / `< 0` ⇒ 0. Floored. */
	readonly inflight: number;
	/**
	 * Jobs already queued (deferred, awaiting a slot) against this pool. Combined with {@link maxQueueDepth} to decide
	 * defer-vs-shed. Non-finite / `< 0` ⇒ 0. Floored.
	 */
	readonly queued: number;
	/**
	 * Max jobs that may sit queued against this pool before further requests are SHED (a bounded backlog — the point at
	 * which "hold and retry" becomes "reject so the backlog can't grow unbounded"). `< 0` / non-finite ⇒ unbounded (never
	 * shed for depth; requests always `defer` when saturated). `0` ⇒ shed as soon as the pool is saturated (no queue at
	 * all). Floored.
	 */
	readonly maxQueueDepth?: number;
}

export interface BackpressureAdmissionRequest {
	/** Caller's opaque id for this pending admission (echoed on the verdict so the caller can correlate). */
	readonly requestId: string;
	/** The pool this request wants a slot in. An id not present in the pool snapshots is `shed` (`unknown_pool`). */
	readonly poolId: string;
}

/** Why a request could not be admitted this tick (defer = retriable backpressure; shed = terminal reject). */
export type BackpressureHoldReason =
	/** The pool is at/over its cap AND the run is below the global ceiling — the pool itself is saturated. */
	| "pool_saturated"
	/** The pool has a free slot but the GLOBAL inflight ceiling (across all pools) is reached. */
	| "global_saturated"
	/** Saturated AND the pool's queue is at/over `maxQueueDepth` — shed to bound the backlog. */
	| "queue_full"
	/** The request targets a pool id not in the snapshot — nothing to admit into. */
	| "unknown_pool"
	/** The target pool's cap is `≤ 0` (disabled) — no capacity to ever admit. */
	| "pool_disabled";

/** One admission verdict. `admit` grants a slot; `defer` holds (retriable); `shed` rejects (terminal). */
export type BackpressureVerdict =
	| { readonly requestId: string; readonly poolId: string; readonly decision: "admit"; readonly reason: string }
	| {
			readonly requestId: string;
			readonly poolId: string;
			readonly decision: "defer" | "shed";
			readonly reason: BackpressureHoldReason;
	  };

export interface DecideBackpressureInput {
	/** The pools available to admit into. A duplicate `poolId` uses the LAST occurrence (last write wins). INJECTED. */
	readonly pools: readonly BackpressurePoolSnapshot[];
	/** Pending admission requests, processed in this order (earlier requests claim scarce slots first). INJECTED. */
	readonly pending: readonly BackpressureAdmissionRequest[];
	/**
	 * Max total inflight leases across ALL pools (the run-wide concurrency ceiling — mirrors the scheduler's
	 * `maxConcurrentLeases`). `< 0` / non-finite ⇒ unbounded (only per-pool caps apply). `0` ⇒ admit nothing. Floored.
	 */
	readonly globalInflightCap?: number;
}

/** A verdict plus the pool/global state used to reach it, for the §5.AG "why admitted / held / shed" surface. */
export interface BackpressureResult {
	/** One verdict per pending request, in input order. */
	readonly verdicts: readonly BackpressureVerdict[];
	readonly counts: {
		/** Requests granted a slot this tick. */
		readonly admitted: number;
		/** Requests held for a later tick (retriable backpressure). */
		readonly deferred: number;
		/** Requests rejected (unbounded-backlog / disabled / unknown pool). */
		readonly shed: number;
	};
	/**
	 * The projected inflight per pool AFTER applying this tick's admits (the pool's `inflight` plus admissions granted
	 * into it), keyed by `poolId` — for the operator surface + the caller's own bookkeeping.
	 */
	readonly projectedInflightByPool: Readonly<Record<string, number>>;
	/** Projected total inflight across all pools after this tick's admits. */
	readonly projectedGlobalInflight: number;
	/** Human-readable one-liner for the scheduler "what was admitted / held / shed + why" surface. */
	readonly summary: string;
}

/** A finite, non-negative count (floored); anything else ⇒ 0. */
function nonNegativeCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.floor(value);
}

/**
 * A finite, non-negative bound (floored) or `undefined` when the bound does not apply. A negative / non-finite value ⇒
 * `undefined` (unbounded); `0` is a real, meaningful bound (admit/queue nothing) and is preserved.
 */
function optionalBound(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return undefined;
	}
	return Math.floor(value);
}

/** Mutable per-pool accounting used while walking the pending batch in order. */
interface PoolState {
	readonly cap: number;
	/** Live inflight + admissions granted so far this tick. */
	inflight: number;
	/** Live queued + defers accumulated so far this tick (a defer joins the queue, so it counts toward the bound). */
	queued: number;
	/** `undefined` ⇒ unbounded queue (never shed for depth). */
	readonly maxQueueDepth: number | undefined;
	/** `cap <= 0` ⇒ the pool is disabled (no capacity to admit). */
	readonly disabled: boolean;
}

/**
 * Decide admission for a batch of pending requests against a set of saturable pools + a global inflight ceiling (pure).
 * Each request yields exactly one verdict — `admit` (a slot is free in both the pool and the global ceiling, counting
 * this tick's earlier admits), `defer` (saturated but the pool's queue has room — hold + retry later), or `shed` (the
 * pool's queue is at/over its bound, or the pool is unknown/disabled — reject to bound the backlog). Requests are
 * processed in input order, so under contention the earlier candidates (feed the ready-ordered sequence) win the scarce
 * slots. Deterministic: the verdicts are a function of the inputs alone (replay-stable, §5.AF).
 *
 * Precedence per request: unknown pool → shed(`unknown_pool`); disabled pool (cap ≤ 0) → shed(`pool_disabled`); a free
 * pool slot AND global headroom → admit; a free pool slot but NO global headroom → hold (defer/shed by queue depth,
 * `global_saturated`); no free pool slot → hold (defer/shed by queue depth, `pool_saturated`). A hold becomes a `shed`
 * (`queue_full`) when the pool's projected queue has reached `maxQueueDepth`, else a `defer`. Admissions and defers
 * accumulate across the batch (each admit consumes a pool + global slot; each defer consumes a queue slot), so a later
 * request sees the capacity the earlier ones took.
 */
export function decideDurableSchedulerBackpressure(input: DecideBackpressureInput): BackpressureResult {
	// Index pools once (last write wins for a duplicate id).
	const poolStateById = new Map<string, PoolState>();
	for (const pool of input.pools) {
		const cap = nonNegativeCount(pool.cap);
		poolStateById.set(pool.poolId, {
			cap,
			inflight: nonNegativeCount(pool.inflight),
			queued: nonNegativeCount(pool.queued),
			maxQueueDepth: optionalBound(pool.maxQueueDepth),
			disabled: cap <= 0,
		});
	}

	const globalCap = optionalBound(input.globalInflightCap);
	// Live global inflight = the sum of every pool's live inflight; admits this tick add to it.
	let globalInflight = 0;
	for (const state of poolStateById.values()) {
		globalInflight += state.inflight;
	}

	const verdicts: BackpressureVerdict[] = [];
	let admitted = 0;
	let deferred = 0;
	let shed = 0;

	for (const request of input.pending) {
		const state = poolStateById.get(request.poolId);
		if (state === undefined) {
			verdicts.push({
				requestId: request.requestId,
				poolId: request.poolId,
				decision: "shed",
				reason: "unknown_pool",
			});
			shed += 1;
			continue;
		}
		if (state.disabled) {
			verdicts.push({
				requestId: request.requestId,
				poolId: request.poolId,
				decision: "shed",
				reason: "pool_disabled",
			});
			shed += 1;
			continue;
		}

		const poolHasSlot = state.inflight < state.cap;
		const globalHasSlot = globalCap === undefined || globalInflight < globalCap;

		if (poolHasSlot && globalHasSlot) {
			state.inflight += 1;
			globalInflight += 1;
			admitted += 1;
			verdicts.push({
				requestId: request.requestId,
				poolId: request.poolId,
				decision: "admit",
				reason: `slot free (pool ${state.inflight}/${state.cap}${globalCap === undefined ? "" : `, global ${globalInflight}/${globalCap}`})`,
			});
			continue;
		}

		// Saturated: hold. The blocker is the global ceiling only when the pool itself had room.
		const holdReason: BackpressureHoldReason = poolHasSlot ? "global_saturated" : "pool_saturated";
		// A defer would join the queue; shed instead when the queue has no room left for it.
		const queueFull = state.maxQueueDepth !== undefined && state.queued >= state.maxQueueDepth;
		if (queueFull) {
			verdicts.push({
				requestId: request.requestId,
				poolId: request.poolId,
				decision: "shed",
				reason: "queue_full",
			});
			shed += 1;
			continue;
		}
		state.queued += 1;
		deferred += 1;
		verdicts.push({ requestId: request.requestId, poolId: request.poolId, decision: "defer", reason: holdReason });
	}

	const projectedInflightByPool: Record<string, number> = {};
	for (const [poolId, state] of poolStateById) {
		projectedInflightByPool[poolId] = state.inflight;
	}

	return {
		verdicts,
		counts: { admitted, deferred, shed },
		projectedInflightByPool,
		projectedGlobalInflight: globalInflight,
		summary: formatSummary({ admitted, deferred, shed }, input.pending.length),
	};
}

function formatSummary(counts: { admitted: number; deferred: number; shed: number }, total: number): string {
	if (total === 0) {
		return "No pending admissions.";
	}
	return `Admitted ${counts.admitted}/${total}, deferred ${counts.deferred}, shed ${counts.shed}.`;
}
