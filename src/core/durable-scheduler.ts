/**
 * The durable long-run job scheduler — DECISION CORE (todo §5.AF; the C3 "unattended + restart-survivable" milestone).
 *
 * A multi-card !Klein run is a dependency graph of jobs that must survive a runtime restart and a worker dying
 * mid-flight. Today the foreground `verify-*.mts` pipeline is fragile (one transient `fetch failed` killed a 30-min
 * run). The durable scheduler makes a run a persisted, lease-based job graph: each ready job is **leased** to a worker
 * with a heartbeat-bounded expiry; if the worker dies (lease expires) the job is **reclaimed** and retried within a
 * budget; dependent jobs **unblock** only when their dependencies succeed. The persisted state lives in the §5.AF
 * Agent Attempt Ledger (the `scheduler` event family — `queued`/`dequeued`/`lease_acquired`/`heartbeat`/`lease_expired`/
 * `reclaimed`/`retry_backoff`/`cancelled`/`dependency_unblocked`), so a fresh process replays the ledger and resumes
 * "exactly where it was" without re-asking a weak model to rediscover state.
 *
 * This module is the PURE, deterministic brain: given the current jobs + clock + caps, it decides the next actions
 * (reclaim / fail / unblock / lease). It runs nothing and persists nothing — the runtime layer applies the actions,
 * appends the matching ledger events, and dispatches leased jobs to the endpoint scheduler (§6.5) / sandbox pool.
 * Pure-core-first mirrors `retry-policy` / `model-fitness` / `agent-attempt-ledger`, so the "what to schedule next"
 * logic is fully testable before its wiring (and replayable, §5.AF replay).
 *
 * Invariants: host-side control-plane only (#1/#2 — it decides scheduling, never runs the agent); deterministic given
 * its inputs (so a replay reproduces the same decisions); terminating (a job either reaches a terminal state or is
 * leased/ready, never lost).
 */

/** Lifecycle state of one durable job. Terminal: `succeeded` / `failed`. */
export type DurableJobState =
	/** Waiting on at least one dependency that has not succeeded yet. */
	| "blocked"
	/** All dependencies succeeded and the job is eligible to be leased (subject to backoff + concurrency). */
	| "ready"
	/** A worker holds a (heartbeat-bounded) lease and is responsible for running it. */
	| "leased"
	| "succeeded"
	| "failed";

export interface DurableJobLease {
	workerId: string;
	/** Epoch ms after which the lease is considered lost (the worker missed its heartbeat) and may be reclaimed. */
	expiresAt: number;
}

export interface DurableJob {
	jobId: string;
	state: DurableJobState;
	/** Job ids that must reach `succeeded` before this job may run. */
	dependsOn: readonly string[];
	/** Non-null only while `leased`. */
	lease: DurableJobLease | null;
	/** How many times the job has been leased (each reclaim-then-release counts) — the retry budget basis. */
	attempts: number;
	/** Earliest epoch ms the job may be (re)leased — set by retry-backoff after a reclaim. */
	nextEligibleAt: number;
}

export type DurableSchedulerAction =
	/** A `leased` job whose lease expired (worker presumed dead) → back to `ready` with backoff (within budget). */
	| { type: "reclaim"; jobId: string; reason: "lease_expired" }
	/** A job that can no longer make progress → `failed`. */
	| { type: "fail"; jobId: string; reason: "max_attempts" | "dependency_failed" }
	/** A `blocked` job whose dependencies all succeeded → `ready`. */
	| { type: "unblock"; jobId: string }
	/** A `ready`, eligible job granted a worker lease → `leased`. */
	| { type: "lease"; jobId: string; workerId: string; expiresAt: number };

export interface DurableSchedulerInput {
	jobs: readonly DurableJob[];
	/** Current clock (epoch ms). Passed in so the core stays pure + replay-deterministic. */
	now: number;
	/** Max jobs that may hold a lease at once (the run's concurrency cap; ≥1). */
	maxConcurrentLeases: number;
	/** Lease length granted on a new lease (ms; ≥1). */
	leaseDurationMs: number;
	/** Lease attempts allowed before a repeatedly-dying job is failed (≥1). */
	maxAttempts: number;
	/** Backoff before a reclaimed job becomes eligible again (ms; ≥0). */
	reclaimBackoffMs: number;
	/** Mint a worker id for a new lease (e.g. a uuid). Called once per `lease` action, in decision order. */
	mintWorkerId: () => string;
}

function dependenciesSucceeded(job: DurableJob, byId: ReadonlyMap<string, DurableJob>): boolean {
	return job.dependsOn.every((depId) => byId.get(depId)?.state === "succeeded");
}

function anyDependencyFailed(job: DurableJob, byId: ReadonlyMap<string, DurableJob>): boolean {
	return job.dependsOn.some((depId) => byId.get(depId)?.state === "failed");
}

/**
 * Decide the scheduler's next actions for this tick, deterministically, in a fixed priority order so a replay
 * reproduces them:
 *   1. **reclaim** expired leases (frees slots first) — unless the attempt budget is spent, then **fail** the job;
 *   2. **fail** any job whose a dependency has failed (it can never run);
 *   3. **unblock** blocked jobs whose dependencies all succeeded;
 *   4. **lease** ready + eligible jobs (deps met, past backoff), oldest-first by input order, up to the free
 *      concurrency slots.
 * Actions are returned against the INPUT snapshot; the caller applies them (see `applyDurableSchedulerActions`),
 * appends the matching `scheduler` ledger events, and dispatches the leased jobs. Returns `[]` when nothing is due.
 */
export function decideDurableSchedulerActions(input: DurableSchedulerInput): DurableSchedulerAction[] {
	const maxConcurrent = Math.max(1, Math.trunc(input.maxConcurrentLeases));
	const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts));
	const leaseDurationMs = Math.max(1, Math.trunc(input.leaseDurationMs));
	const reclaimBackoffMs = Math.max(0, Math.trunc(input.reclaimBackoffMs));
	const byId = new Map(input.jobs.map((job) => [job.jobId, job]));
	const actions: DurableSchedulerAction[] = [];

	// Track lease occupancy as we go so reclaims free slots that new leases can immediately reuse this same tick.
	let activeLeases = input.jobs.filter((job) => job.state === "leased").length;

	// 1. Reclaim expired leases (or fail if the budget is spent). A reclaim frees a slot.
	for (const job of input.jobs) {
		if (job.state !== "leased" || job.lease === null || job.lease.expiresAt > input.now) {
			continue;
		}
		activeLeases -= 1;
		if (job.attempts >= maxAttempts) {
			actions.push({ type: "fail", jobId: job.jobId, reason: "max_attempts" });
		} else {
			actions.push({ type: "reclaim", jobId: job.jobId, reason: "lease_expired" });
		}
	}

	// 2. Fail non-terminal jobs blocked behind a failed dependency (they can never run).
	for (const job of input.jobs) {
		if ((job.state === "blocked" || job.state === "ready") && anyDependencyFailed(job, byId)) {
			actions.push({ type: "fail", jobId: job.jobId, reason: "dependency_failed" });
		}
	}

	// 3. Unblock blocked jobs whose dependencies all succeeded.
	for (const job of input.jobs) {
		if (job.state === "blocked" && !anyDependencyFailed(job, byId) && dependenciesSucceeded(job, byId)) {
			actions.push({ type: "unblock", jobId: job.jobId });
		}
	}

	// 4. Lease ready + eligible jobs up to the free slots. Include jobs reclaimed/unblocked above (they become
	//    eligible this tick) — but never a job we just decided to fail.
	const failedThisTick = new Set(actions.filter((action) => action.type === "fail").map((action) => action.jobId));
	const reclaimedThisTick = new Set(
		actions.filter((action) => action.type === "reclaim").map((action) => action.jobId),
	);
	const unblockedThisTick = new Set(
		actions.filter((action) => action.type === "unblock").map((action) => action.jobId),
	);
	for (const job of input.jobs) {
		if (activeLeases >= maxConcurrent) {
			break;
		}
		if (failedThisTick.has(job.jobId)) {
			continue;
		}
		const willBeReady = job.state === "ready" || reclaimedThisTick.has(job.jobId) || unblockedThisTick.has(job.jobId);
		if (!willBeReady) {
			continue;
		}
		// A reclaimed job's backoff starts now; an already-ready job must be past its recorded backoff.
		const eligibleAt = reclaimedThisTick.has(job.jobId) ? input.now + reclaimBackoffMs : job.nextEligibleAt;
		if (eligibleAt > input.now) {
			continue;
		}
		if (!dependenciesSucceeded(job, byId)) {
			continue;
		}
		actions.push({
			type: "lease",
			jobId: job.jobId,
			workerId: input.mintWorkerId(),
			expiresAt: input.now + leaseDurationMs,
		});
		activeLeases += 1;
	}

	return actions;
}

/**
 * Apply scheduler actions to a job snapshot, returning the next snapshot (pure; for the caller's in-memory mirror +
 * tests + replay). External completion (a worker reporting `succeeded`/`failed`) is a separate transition — see
 * `markDurableJob`. `now`/`reclaimBackoffMs` set the reclaimed job's backoff window.
 */
export function applyDurableSchedulerActions(
	jobs: readonly DurableJob[],
	actions: readonly DurableSchedulerAction[],
	options: { now: number; reclaimBackoffMs: number },
): DurableJob[] {
	const byId = new Map(jobs.map((job) => [job.jobId, { ...job }]));
	for (const action of actions) {
		const job = byId.get(action.jobId);
		if (!job) {
			continue;
		}
		switch (action.type) {
			case "reclaim":
				job.state = "ready";
				job.lease = null;
				job.nextEligibleAt = options.now + Math.max(0, Math.trunc(options.reclaimBackoffMs));
				break;
			case "fail":
				job.state = "failed";
				job.lease = null;
				break;
			case "unblock":
				job.state = "ready";
				break;
			case "lease":
				job.state = "leased";
				job.lease = { workerId: action.workerId, expiresAt: action.expiresAt };
				job.attempts += 1;
				break;
		}
	}
	return [...byId.values()];
}

/**
 * Record an external completion for a leased job: the worker finished it (`succeeded`), it hit a terminal failure
 * (`failed`, e.g. the §5.AA retry ladder parked it), or it failed on a TRANSIENT error (`transient_retry`, §5.AF — a
 * body/headers timeout / connection blip / 5xx). A transient failure is NOT terminal: the job drops its lease and
 * returns to `ready` (eligible next tick — no clock, so replay stays deterministic), burning ONE attempt so a
 * persistently-flaky endpoint still reaches `maxAttempts` and fails rather than looping forever. A no-op if the job
 * isn't found or is already terminal.
 */
export function markDurableJob(
	jobs: readonly DurableJob[],
	jobId: string,
	outcome: "succeeded" | "failed" | "transient_retry",
	maxAttempts = Number.MAX_SAFE_INTEGER,
): DurableJob[] {
	return jobs.map((job) => {
		if (job.jobId !== jobId || job.state === "succeeded" || job.state === "failed") {
			return job;
		}
		if (outcome === "transient_retry") {
			const attempts = job.attempts + 1;
			return attempts >= Math.max(1, Math.trunc(maxAttempts))
				? { ...job, state: "failed", lease: null }
				: { ...job, state: "ready", lease: null, attempts, nextEligibleAt: 0 };
		}
		return { ...job, state: outcome, lease: null };
	});
}

/** True when every job is terminal (`succeeded`/`failed`) — the run is finished and the scheduler can stop ticking. */
export function isDurableRunComplete(jobs: readonly DurableJob[]): boolean {
	return jobs.every((job) => job.state === "succeeded" || job.state === "failed");
}

/** One in-flight lease, for the operator view (which worker holds which card, until when). */
export interface DurableRunLeaseRow {
	jobId: string;
	workerId: string;
	expiresAt: number;
}

/** A glanceable summary of a durable run — the projection operator UX reads to see + trust an unattended C3 run. */
export interface DurableRunSummary {
	total: number;
	byState: Record<DurableJobState, number>;
	/** Currently-leased cards + who holds them (for "what's running now" + stuck-lease detection). */
	leased: DurableRunLeaseRow[];
	/** Failed (parked) card ids — the ones that need operator attention. */
	failed: string[];
	/** succeeded / total in [0,1] (0 when there are no jobs). */
	progress: number;
	complete: boolean;
}

/**
 * Summarize a durable run's jobs for operator UX (pure projection): counts by state, the in-flight leases, the parked
 * failures, and overall progress. Preserves input order for the lease/failed lists. The C3 milestone requires the
 * operator to SEE + trust an unattended run; this is the read model behind that (board badge, `nklein dev`/Settings view).
 */
export function summarizeDurableRun(jobs: readonly DurableJob[]): DurableRunSummary {
	const byState: Record<DurableJobState, number> = {
		blocked: 0,
		ready: 0,
		leased: 0,
		succeeded: 0,
		failed: 0,
	};
	const leased: DurableRunLeaseRow[] = [];
	const failed: string[] = [];
	for (const job of jobs) {
		byState[job.state] += 1;
		if (job.state === "leased" && job.lease !== null) {
			leased.push({ jobId: job.jobId, workerId: job.lease.workerId, expiresAt: job.lease.expiresAt });
		}
		if (job.state === "failed") {
			failed.push(job.jobId);
		}
	}
	return {
		total: jobs.length,
		byState,
		leased,
		failed,
		progress: jobs.length === 0 ? 0 : byState.succeeded / jobs.length,
		complete: isDurableRunComplete(jobs),
	};
}

/** A board dependency edge: `fromTaskId` depends on (is blocked until) `toTaskId`. */
export interface DurableJobDependencyEdge {
	fromTaskId: string;
	toTaskId: string;
}

export interface DurableJobGraphInput {
	/** The task ids that make up the run (e.g. the decompose DAG's cards). */
	taskIds: readonly string[];
	/**
	 * Board dependencies. Direction matches `task-board-mutations` (authoritative): a card unblocks its `fromTaskId`
	 * dependents when it — the `toTaskId` — completes, i.e. **`fromTaskId` depends on `toTaskId`**. Edges referencing a
	 * task outside `taskIds`, and self-edges, are ignored.
	 */
	dependencies: readonly DurableJobDependencyEdge[];
	/** Task ids already known complete (e.g. cards already in the completed column when resuming a run). */
	succeededTaskIds?: readonly string[];
}

/**
 * Map a decompose DAG (cards + dependency edges) to the durable scheduler's `DurableJob[]` — the bridge from a board
 * run to {@link decideDurableSchedulerActions}. A job is `succeeded` if already complete, else `ready` when it has no
 * unsatisfied dependency, else `blocked`. Pure + deterministic (preserves `taskIds` order); the scheduler then leases
 * ready jobs and unblocks dependents as their prerequisites succeed. Cycles aren't resolved here — a cyclic edge just
 * leaves both jobs `blocked` (the scheduler never leases them), surfacing the bad graph rather than looping (a
 * decompose-validation concern, §5.B, not the scheduler's).
 */
export function buildDurableJobGraph(input: DurableJobGraphInput): DurableJob[] {
	const ids = new Set(input.taskIds);
	const succeeded = new Set(input.succeededTaskIds ?? []);
	const dependsOnByTask = new Map<string, Set<string>>();
	for (const id of input.taskIds) {
		dependsOnByTask.set(id, new Set());
	}
	for (const edge of input.dependencies) {
		if (edge.fromTaskId === edge.toTaskId || !ids.has(edge.fromTaskId) || !ids.has(edge.toTaskId)) {
			continue;
		}
		dependsOnByTask.get(edge.fromTaskId)?.add(edge.toTaskId);
	}
	return input.taskIds.map((jobId) => {
		const dependsOn = [...(dependsOnByTask.get(jobId) ?? [])];
		const state: DurableJobState = succeeded.has(jobId)
			? "succeeded"
			: dependsOn.every((depId) => succeeded.has(depId))
				? "ready"
				: "blocked";
		return { jobId, state, dependsOn, lease: null, attempts: 0, nextEligibleAt: 0 };
	});
}

/**
 * One durable, append-only record of what happened to the run — the persistence unit the runtime writes (mapped to the
 * §5.AF `scheduler` ledger event family + the `attempt` outcome) and reads back on boot. Either a scheduler-decided
 * action that was applied (`scheduled`, with the clock it ran at — needed to reconstruct reclaim backoff) or an
 * external worker completion (`completed`).
 */
export type DurableSchedulerLogEntry =
	| { kind: "scheduled"; now: number; action: DurableSchedulerAction }
	| { kind: "completed"; jobId: string; outcome: "succeeded" | "failed" | "transient_retry" };

/**
 * Rebuild the current job state from the initial graph + the ordered log — the **boot-replay** that lets a restarted
 * runtime resume a multi-card run "exactly where it was" (C3) without re-asking a weak model to rediscover progress.
 * Deterministic: folding the same log over the same initial graph always yields the same state (the decision core is
 * deterministic too, so re-deciding from here continues identically). Pure — the runtime persists each entry as it
 * applies it, then on boot calls this over the replayed log.
 */
export function replayDurableJobs(
	initialJobs: readonly DurableJob[],
	log: readonly DurableSchedulerLogEntry[],
	options: { reclaimBackoffMs: number; maxAttempts?: number },
): DurableJob[] {
	let jobs: DurableJob[] = initialJobs.map((job) => ({ ...job }));
	for (const entry of log) {
		jobs =
			entry.kind === "scheduled"
				? applyDurableSchedulerActions(jobs, [entry.action], {
						now: entry.now,
						reclaimBackoffMs: options.reclaimBackoffMs,
					})
				: markDurableJob(jobs, entry.jobId, entry.outcome, options.maxAttempts);
	}
	return jobs;
}
